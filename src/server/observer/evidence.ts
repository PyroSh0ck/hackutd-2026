import type { z } from "zod";
import {
  ObserverAssessmentSchema,
  type Evidence,
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
  requestId: string;
  currentMessageId: string;
  /** The messages actually supplied to the model. Evidence may only cite user messages from here. */
  messages: readonly Message[];
};

export type CandidateValidation = {
  assessment: ObserverAssessment | null;
  structurallyValid: boolean;
  evidenceReferencesValid: boolean;
  errors: ValidationError[];
};

const REFERENCE_CODES = new Set<ValidationError["code"]>(["invalid_request_reference", "invalid_message_reference", "non_user_evidence", "quote_not_found"]);
const CATEGORY_KEYS = new Set(["label", "behavior", "channelProvenance"]);

export function contextFor(input: ObserverInput): EvidenceContext {
  return { sessionId: input.sessionId, requestId: input.request.id, currentMessageId: input.currentMessageId, messages: input.relevantMessages };
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
  ];
}

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
  if (a.requestId !== ctx.requestId) errors.push({ field: "requestId", code: "invalid_request_reference", detail: "requestId does not match the request being assessed." });
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
  const intro = byId.get(input.request.introducedByMessageId);
  if (!intro) problems.push("request's introducing message missing from context");
  else if (intro.role !== "assistant") problems.push("request must be introduced by an assistant message");
  for (const e of input.relevantEvents) {
    if (e.sessionId !== input.sessionId) problems.push(`event ${e.id} belongs to another session`);
    if (e.requestId !== null && e.requestId !== input.request.id) problems.push(`event ${e.id} belongs to another request`);
  }
  if (input.previousAssessment && input.previousAssessment.requestId !== input.request.id) problems.push("previous assessment is for another request");
  if (problems.length) throw new InvalidObserverInputError(problems);
}
