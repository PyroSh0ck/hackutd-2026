import type { z } from "zod";
import {
  ObserverAssessmentSchema,
  type AssessmentScope,
  type Evidence,
  type KnownIssue,
  type Message,
  type ObserverAssessment,
  type ObserverInput,
  type ValidationError,
} from "@/contracts/observer";

/**
 * Pure structural, reference, evidence, and cross-field validation (brief §4.4, §4.5, §7).
 * Passing means the shape and references are correct. It does NOT mean the interpretation is correct.
 */

export type EvidenceContext = {
  sessionId: string;
  scope: AssessmentScope;
  /** Null in conversation scope. */
  requestId: string | null;
  currentMessageId: string;
  /** The messages actually supplied to the model. Evidence may only cite user messages from here. */
  messages: readonly Message[];
  /** Issues supplied to the model (this session only). Acknowledgments may cite only addressed ones. */
  knownIssues: readonly KnownIssue[];
};

export type CandidateValidation = {
  assessment: ObserverAssessment | null;
  structurallyValid: boolean;
  evidenceReferencesValid: boolean;
  errors: ValidationError[];
};

const REFERENCE_CODES = new Set<ValidationError["code"]>(["invalid_request_reference", "invalid_message_reference", "non_user_evidence", "quote_not_found", "invalid_issue_reference"]);
const CATEGORY_KEYS = new Set(["label", "behavior", "channelProvenance", "kind", "claimedResult"]);

export function contextFor(input: ObserverInput): EvidenceContext {
  return {
    sessionId: input.sessionId,
    scope: input.scope,
    requestId: input.request?.id ?? null,
    currentMessageId: input.currentMessageId,
    messages: input.relevantMessages,
    knownIssues: input.knownIssues,
  };
}

function pathOf(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => (typeof key === "number" ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)), "") || "(root)";
}

export function zodIssuesToErrors(error: z.ZodError): ValidationError[] {
  return error.issues.slice(0, 20).map((issue) => {
    const last = issue.path.at(-1);
    const category = issue.code === "invalid_value" && typeof last === "string" && CATEGORY_KEYS.has(last);
    return {
      field: pathOf(issue.path),
      code: category ? "invalid_category" : "invalid_structure",
      detail: issue.code === "unrecognized_keys" ? `Unknown keys are not allowed: ${issue.keys.join(", ")}` : issue.message,
    };
  });
}

/** Every evidence list in an assessment, with its field path. */
export function evidenceFields(assessment: ObserverAssessment): Array<{ field: string; evidence: Evidence[] }> {
  return [
    { field: "decision.evidence", evidence: assessment.decision.evidence },
    ...(assessment.condition ? [{ field: "condition.evidence", evidence: assessment.condition.evidence }] : []),
    ...assessment.verificationObservations.map((o, i) => ({ field: `verificationObservations[${i}].evidence`, evidence: o.evidence })),
    ...(assessment.statedUnderstanding ? [{ field: "statedUnderstanding.evidence", evidence: assessment.statedUnderstanding.evidence }] : []),
    ...assessment.ambiguities.map((a, i) => ({ field: `ambiguities[${i}].evidence`, evidence: a.evidence })),
    ...assessment.openIssues.map((d, i) => ({ field: `openIssues[${i}].evidence`, evidence: d.evidence })),
    ...assessment.issueAcknowledgments.map((k, i) => ({ field: `issueAcknowledgments[${i}].evidence`, evidence: k.evidence })),
  ];
}

/**
 * Exact-duplicate key for an issue draft: kind + ordered evidence (addendum §4). No semantic matching.
 * JSON-encoded (no NUL separators: the key is stored in a Postgres text column).
 */
export const issueDraftKey = (d: { kind: string; evidence: readonly Evidence[] }) => JSON.stringify([d.kind, ...d.evidence.map((e) => [e.messageId, e.quote])]);

/** Checks one evidence span. Exact, case-preserving substring match against the original text. */
export function checkEvidence(evidence: Evidence, field: string, ctx: EvidenceContext): ValidationError | null {
  const message = ctx.messages.find((m) => m.id === evidence.messageId);
  if (!message) return { field, code: "invalid_message_reference", detail: `Message ${evidence.messageId} is not in the supplied context.` };
  if (message.sessionId !== ctx.sessionId) return { field, code: "invalid_message_reference", detail: `Message ${evidence.messageId} belongs to another session.` };
  if (message.role !== "user") return { field, code: "non_user_evidence", detail: `Message ${evidence.messageId} is an ${message.role} message, not user evidence.` };
  if (evidence.quote.trim().length === 0) return { field, code: "quote_not_found", detail: "Quote is blank." };
  if (!message.content.includes(evidence.quote)) return { field, code: "quote_not_found", detail: `Quote is not an exact substring of message ${evidence.messageId}.` };
  return null;
}

export function crossFieldErrors(a: ObserverAssessment, ctx: EvidenceContext): ValidationError[] {
  const errors: ValidationError[] = [];
  if (ctx.scope === "conversation") {
    // Addendum §3: no request exists, so there is no stance to classify.
    if (a.requestId !== null) errors.push({ field: "requestId", code: "invalid_scope", detail: "Conversation scope: requestId must be null." });
    if (a.decision.label !== "unclear") errors.push({ field: "decision.label", code: "invalid_scope", detail: "Conversation scope: the decision must be unclear (no request has been presented)." });
    if (a.decision.evidence.length) errors.push({ field: "decision.evidence", code: "invalid_scope", detail: "Conversation scope: decision evidence must be empty." });
    if (a.condition) errors.push({ field: "condition", code: "invalid_scope", detail: "Conversation scope: condition must be null." });
  } else if (a.requestId !== ctx.requestId) errors.push({ field: "requestId", code: "invalid_request_reference", detail: "requestId does not match the request being assessed." });
  if (a.currentMessageId !== ctx.currentMessageId) errors.push({ field: "currentMessageId", code: "invalid_message_reference", detail: "currentMessageId does not match the message being assessed." });
  if (a.decision.label !== "unclear" && a.decision.evidence.length === 0) {
    errors.push({ field: "decision.evidence", code: "missing_evidence", detail: `Decision "${a.decision.label}" needs at least one evidence span.` });
  }
  if (a.decision.label === "conditional_acceptance") {
    if (!a.condition) errors.push({ field: "condition", code: "missing_condition", detail: "conditional_acceptance requires a condition." });
    else if (a.condition.evidence.length === 0) errors.push({ field: "condition.evidence", code: "missing_evidence", detail: "The condition needs evidence." });
  } else if (a.condition) {
    errors.push({ field: "condition", code: "inconsistent_fields", detail: `condition must be null unless the decision is conditional_acceptance (got "${a.decision.label}").` });
  }
  a.verificationObservations.forEach((o, i) => {
    if (o.evidence.length === 0) errors.push({ field: `verificationObservations[${i}].evidence`, code: "missing_evidence", detail: "Each verification observation needs evidence." });
    if (o.claimedResult !== "unspecified" && o.behavior !== "claimed_verification_completed") {
      errors.push({ field: `verificationObservations[${i}].claimedResult`, code: "inconsistent_fields", detail: `claimedResult must be unspecified unless the behavior is claimed_verification_completed (got ${o.behavior}).` });
    }
  });
  const drafts = new Set<string>();
  a.openIssues.forEach((d, i) => {
    const key = issueDraftKey(d);
    if (drafts.has(key)) errors.push({ field: `openIssues[${i}]`, code: "inconsistent_fields", detail: "Duplicate issue draft (same kind and evidence)." });
    drafts.add(key);
  });
  const acknowledged = new Set<string>();
  a.issueAcknowledgments.forEach((k, i) => {
    const issue = ctx.knownIssues.find((x) => x.id === k.issueId);
    if (!issue) errors.push({ field: `issueAcknowledgments[${i}].issueId`, code: "invalid_issue_reference", detail: `Issue ${k.issueId} was not supplied in knownIssues.` });
    else if (issue.status !== "addressed") errors.push({ field: `issueAcknowledgments[${i}].issueId`, code: "invalid_issue_reference", detail: `Issue ${k.issueId} has not been addressed, so it cannot be acknowledged.` });
    if (acknowledged.has(k.issueId)) errors.push({ field: `issueAcknowledgments[${i}]`, code: "inconsistent_fields", detail: "The same issue is acknowledged twice." });
    acknowledged.add(k.issueId);
  });
  if (a.statedUnderstanding && a.statedUnderstanding.evidence.length === 0) {
    errors.push({ field: "statedUnderstanding.evidence", code: "missing_evidence", detail: "Stated understanding needs evidence." });
  }
  return errors;
}

/** Full deterministic validation of an untrusted candidate (initial, repaired, or reviewer-corrected). */
export function validateCandidate(raw: unknown, ctx: EvidenceContext): CandidateValidation {
  const parsed = ObserverAssessmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { assessment: null, structurallyValid: false, evidenceReferencesValid: false, errors: zodIssuesToErrors(parsed.error) };
  }
  const assessment = parsed.data;
  const errors = crossFieldErrors(assessment, ctx);
  for (const { field, evidence } of evidenceFields(assessment)) {
    evidence.forEach((e, i) => {
      const error = checkEvidence(e, `${field}[${i}]`, ctx);
      if (error) errors.push(error);
    });
  }
  return {
    assessment: errors.length === 0 ? assessment : null,
    structurallyValid: true,
    evidenceReferencesValid: !errors.some((e) => REFERENCE_CODES.has(e.code)),
    errors,
  };
}

export class InvalidObserverInputError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid observer input: ${problems.join("; ")}`);
    this.name = "InvalidObserverInputError";
  }
}

/** Rule 5: the request, its introducing message, the current message, and events belong together. */
export function assertObserverInput(input: ObserverInput): void {
  const problems: string[] = [];
  const byId = new Map(input.relevantMessages.map((m) => [m.id, m]));
  for (const m of input.relevantMessages) if (m.sessionId !== input.sessionId) problems.push(`message ${m.id} belongs to another session`);
  const current = byId.get(input.currentMessageId);
  if (!current) problems.push("current message missing from context");
  else if (current.role !== "user") problems.push("current message is not a user message");
  if ((input.scope === "conversation") !== (input.request === null)) problems.push("scope must be conversation exactly when request is null");
  const requestId = input.request?.id ?? null;
  if (input.request) {
    const intro = byId.get(input.request.introducedByMessageId);
    if (!intro) problems.push("request's introducing message missing from context");
    else if (intro.role !== "assistant") problems.push("request must be introduced by an assistant message");
  }
  for (const e of input.relevantEvents) {
    if (e.sessionId !== input.sessionId) problems.push(`event ${e.id} belongs to another session`);
    if (e.requestId !== null && e.requestId !== requestId) problems.push(`event ${e.id} belongs to another request`);
  }
  if (input.previousAssessment && input.previousAssessment.requestId !== requestId) problems.push("previous assessment is for another scope or request");
  const issueIds = new Set<string>();
  for (const issue of input.knownIssues) {
    if (issueIds.has(issue.id)) problems.push(`known issue ${issue.id} is listed twice`);
    issueIds.add(issue.id);
  }
  if (problems.length) throw new InvalidObserverInputError(problems);
}
