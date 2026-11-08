import {
  REVIEW_FIELD_PATTERN,
  ReviewerResponseSchema,
  type FailureReason,
  type ObserverAssessment,
  type ObserverInput,
  type ReviewerResponse,
  type ReviewFlag,
  type ValidationError,
} from "@/contracts/observer";
import { checkEvidence, contextFor, validateCandidate, zodIssuesToErrors } from "./evidence";
import { contradictionFlags, isSemanticFlag } from "./flags";
import { collapseDuplicateIssues } from "./issue-support";

/**
 * Reviewer validation and resolution (brief §4.7). A supported review is corroboration, not ground truth:
 * the final assessment stays labeled as a model interpretation. There is no reviewer repair and no second
 * review: anything unresolved becomes the conservative unclear fallback.
 */

export type ReviewValidation = { response: ReviewerResponse | null; errors: ValidationError[] };

function indexIn(field: string, a: ObserverAssessment): boolean {
  const m = /^(verificationObservations|ambiguities|openIssues|issueAcknowledgments)\[(\d{1,2})\]/.exec(field);
  if (!m) return true;
  const lists = { verificationObservations: a.verificationObservations, ambiguities: a.ambiguities, openIssues: a.openIssues, issueAcknowledgments: a.issueAcknowledgments } as const;
  return Number(m[2]) < lists[m[1] as keyof typeof lists].length;
}

export function validateReview(raw: unknown, input: ObserverInput, proposed: ObserverAssessment): ReviewValidation {
  const normalized = raw && typeof raw === "object" && "correctedAssessment" in raw
    ? { ...raw, correctedAssessment: collapseDuplicateIssues((raw as { correctedAssessment?: unknown }).correctedAssessment) }
    : raw;
  const parsed = ReviewerResponseSchema.safeParse(normalized);
  if (!parsed.success) return { response: null, errors: zodIssuesToErrors(parsed.error) };
  const response = parsed.data;
  const ctx = contextFor(input);
  const errors: ValidationError[] = [];
  const target = response.correctedAssessment ?? proposed;

  response.findings.forEach((f, i) => {
    if (!REVIEW_FIELD_PATTERN.test(f.field) || !(indexIn(f.field, proposed) || indexIn(f.field, target))) {
      errors.push({ field: `findings[${i}].field`, code: "inconsistent_fields", detail: `Unsupported field path "${f.field}".` });
    }
    f.evidence.forEach((e, j) => {
      const error = checkEvidence(e, `findings[${i}].evidence[${j}]`, ctx);
      if (error) errors.push(error);
    });
  });

  const verdicts = response.findings.map((f) => f.verdict);
  if (response.verdict === "supported") {
    if (response.correctedAssessment) errors.push({ field: "correctedAssessment", code: "inconsistent_fields", detail: "A supported verdict must not carry a correction." });
    if (verdicts.some((v) => v !== "supported")) errors.push({ field: "findings", code: "inconsistent_fields", detail: "Findings contradict the supported verdict." });
  } else if (response.verdict === "contradicted") {
    if (!response.correctedAssessment) errors.push({ field: "correctedAssessment", code: "inconsistent_fields", detail: "A contradicted verdict needs a complete correctedAssessment." });
    if (!verdicts.includes("contradicted")) errors.push({ field: "findings", code: "inconsistent_fields", detail: "A contradicted verdict needs at least one contradicted finding." });
  } else {
    if (response.correctedAssessment) errors.push({ field: "correctedAssessment", code: "inconsistent_fields", detail: "An ambiguous verdict must not carry a correction." });
    if (!verdicts.includes("ambiguous")) errors.push({ field: "findings", code: "inconsistent_fields", detail: "An ambiguous verdict needs at least one ambiguous finding." });
    if (verdicts.includes("contradicted")) errors.push({ field: "findings", code: "inconsistent_fields", detail: "Contradicted findings require a contradicted verdict with a correction." });
  }

  if (response.correctedAssessment) {
    for (const e of validateCandidate(response.correctedAssessment, ctx).errors) errors.push({ ...e, field: `correctedAssessment.${e.field}` });
  }
  return { response: errors.length ? null : response, errors };
}

function covers(findingField: string, flagField: string): boolean {
  if (findingField === "overall" || findingField === flagField) return true;
  const [a, b] = [findingField, flagField].sort((x, y) => x.length - y.length);
  return b.startsWith(a) && (b[a.length] === "." || b[a.length] === "[");
}

/** A semantic flag is resolved only by an evidence-backed, non-ambiguous finding on that field citing a flagged message. */
export function isFlagResolved(flag: ReviewFlag, response: ReviewerResponse): boolean {
  if (!isSemanticFlag(flag)) return response.verdict !== "ambiguous";
  return response.findings.some(
    (f) => f.verdict !== "ambiguous" && f.evidence.length > 0 && covers(f.field, flag.field) && f.evidence.some((e) => flag.messageIds.includes(e.messageId)),
  );
}

export type ReviewResolution =
  | { kind: "supported"; final: ObserverAssessment }
  | { kind: "corrected"; final: ObserverAssessment; correctedFlags: ReviewFlag[] }
  | { kind: "fallback"; reviewStatus: "ambiguous" | "failed"; failureReason: FailureReason; correctedFlags: ReviewFlag[] };

export function resolveReview(response: ReviewerResponse, input: ObserverInput, proposed: ObserverAssessment, flags: ReviewFlag[]): ReviewResolution {
  if (response.verdict === "ambiguous") return { kind: "fallback", reviewStatus: "ambiguous", failureReason: "review_ambiguous", correctedFlags: [] };
  if (response.verdict === "supported") {
    const unresolved = flags.filter((f) => !isFlagResolved(f, response));
    return unresolved.length ? { kind: "fallback", reviewStatus: "failed", failureReason: "review_unresolved_flags", correctedFlags: [] } : { kind: "supported", final: proposed };
  }
  const corrected = response.correctedAssessment!;
  // A correction that still trips any deterministic contradiction check falls back conservatively.
  // It is never sent for a second review, and the same review cannot excuse its own correction.
  const correctedFlags = contradictionFlags(corrected, input);
  if (correctedFlags.length) return { kind: "fallback", reviewStatus: "failed", failureReason: "correction_flagged", correctedFlags };
  return { kind: "corrected", final: corrected, correctedFlags };
}
