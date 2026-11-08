import {
  ObserverAssessmentSchema,
  ReviewerResponseSchema,
  type FailureReason,
  type ModelAttempt,
  type ModelFailure,
  type ObserverAssessment,
  type ObserverInput,
  type ReviewerResponse,
  type ReviewFlag,
  type ReviewPolicy,
  type ValidationError,
  type ValidationResult,
} from "@/contracts/observer";
import { assertObserverInput, contextFor, validateCandidate } from "./evidence";
import { reviewFlags } from "./flags";
import { providerSchema, type StructuredModel, type StructuredRequest, type StructuredResult } from "./model";
import { OBSERVER_SYSTEM_PROMPT, observerUserPrompt, repairUserPrompt, REVIEWER_SYSTEM_PROMPT, reviewerUserPrompt } from "./prompts";
import { resolveReview, validateReview } from "./review";
import { fallbackAssessment } from "./state";

/**
 * Bounded orchestration for ONE message/request pair (brief §8). Explicit state machine, no loops:
 *
 *   observer ─ valid ─┬─ no flags ─────────────────────────────▶ accepted            (1 call)
 *       │             └─ flags ─ reviewer ─▶ supported/corrected/fallback          (2 calls)
 *       ├─ invalid output ─ repair ─ valid ─┬─ no flags ─▶ accepted                (2 calls)
 *       │                    │              └─ flags ─ reviewer ─▶ …               (3 calls)
 *       │                    └─ invalid/failure ─▶ unclear fallback                (2 calls)
 *       └─ transport failure/refusal/timeout ─▶ unclear fallback                   (1 call)
 *
 * Never more than 3 model invocations; no reviewer repair, no reviewer-of-reviewer, no hidden retries.
 * Pure apart from the injected models and clock.
 */

export const MAX_MODEL_CALLS = 3;

export type RunDeps = {
  observer: StructuredModel | null;
  reviewer: StructuredModel | null;
  policy: ReviewPolicy;
  timeoutMs: number;
  now?: () => Date;
};

export type RunOutcome = {
  observerModel: string;
  reviewerModel: string | null;
  proposedAssessment: ObserverAssessment | null;
  finalAssessment: ObserverAssessment;
  validation: ValidationResult;
  repairAttempted: boolean;
  reviewStatus: "not_requested" | "supported" | "corrected" | "ambiguous" | "failed";
  reviewerResponse: ReviewerResponse | null;
  resolution: "accepted" | "corrected" | "unclear_fallback";
  failureReason: FailureReason | null;
  attempts: ModelAttempt[];
  calls: number;
};

const TRANSPORT_REASON: Record<Exclude<ModelFailure, "malformed_output">, FailureReason> = {
  timeout: "model_timeout",
  unavailable: "model_unavailable",
  refusal: "model_refusal",
  http_error: "model_http_error",
};

const ASSESSMENT_JSON_SCHEMA = providerSchema(ObserverAssessmentSchema);
const REVIEW_JSON_SCHEMA = providerSchema(ReviewerResponseSchema);

export async function runObserver(input: ObserverInput, deps: RunDeps): Promise<RunOutcome> {
  assertObserverInput(input);
  const now = deps.now ?? (() => new Date());
  const ctx = contextFor(input);
  const attempts: ModelAttempt[] = [];
  let calls = 0;
  let repairAttempted = false;
  let proposed: ObserverAssessment | null = null;
  let validation: ValidationResult = { structurallyValid: false, evidenceReferencesValid: false, errors: [], reviewFlags: [] };

  const outcome = (o: Pick<RunOutcome, "finalAssessment" | "reviewStatus" | "reviewerResponse" | "resolution" | "failureReason">): RunOutcome => ({
    observerModel: deps.observer?.modelId ?? "unconfigured",
    reviewerModel: attempts.some((a) => a.stage === "reviewer") ? (deps.reviewer?.modelId ?? null) : null,
    proposedAssessment: proposed,
    validation,
    repairAttempted,
    attempts,
    calls,
    ...o,
  });
  const fallback = (failureReason: FailureReason, reviewStatus: RunOutcome["reviewStatus"] = "not_requested", reviewerResponse: ReviewerResponse | null = null) =>
    outcome({ finalAssessment: fallbackAssessment(input), reviewStatus, reviewerResponse, resolution: "unclear_fallback", failureReason });

  async function call(model: StructuredModel, request: Omit<StructuredRequest, "timeoutMs">): Promise<{ result: StructuredResult; attempt: ModelAttempt }> {
    if (calls >= MAX_MODEL_CALLS) throw new Error("Observer model-call budget exceeded (bug).");
    calls++;
    const startedAt = now();
    const started = performance.now();
    let result: StructuredResult;
    try {
      result = await model.generate({ ...request, timeoutMs: deps.timeoutMs });
    } catch {
      // An adapter bug must not crash the session or imply acceptance.
      result = { ok: false, failure: "http_error", detail: "Adapter threw." };
    }
    const attempt: ModelAttempt = {
      stage: request.stage,
      modelId: model.modelId,
      startedAt: startedAt.toISOString(),
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      outcome: result.ok ? "ok" : result.failure,
      validationErrors: [],
      reviewFlags: [],
    };
    attempts.push(attempt);
    return { result, attempt };
  }

  /** Validates a returned candidate, records its errors on the attempt, and returns it if error-free. */
  function check(result: StructuredResult, attempt: ModelAttempt): { candidate: ObserverAssessment | null; errors: ValidationError[]; raw: unknown } {
    if (!result.ok) {
      const errors: ValidationError[] = [{ field: "(root)", code: "invalid_structure", detail: result.detail }];
      attempt.validationErrors = errors;
      validation = { structurallyValid: false, evidenceReferencesValid: false, errors, reviewFlags: [] };
      return { candidate: null, errors, raw: result.rawOutput ?? null };
    }
    const v = validateCandidate(result.output, ctx);
    attempt.validationErrors = v.errors;
    validation = { structurallyValid: v.structurallyValid, evidenceReferencesValid: v.evidenceReferencesValid, errors: v.errors, reviewFlags: [] };
    const parsed = ObserverAssessmentSchema.safeParse(result.output);
    if (parsed.success) proposed = parsed.data;
    return { candidate: v.assessment, errors: v.errors, raw: result.output };
  }

  if (!deps.observer) return fallback("model_unavailable");

  // 1. Observer.
  const first = await call(deps.observer, {
    stage: "observer",
    schemaName: "submit_assessment",
    schemaDescription: "Submit the evidence-based assessment of the user's decision about this one fictional request.",
    jsonSchema: ASSESSMENT_JSON_SCHEMA,
    system: OBSERVER_SYSTEM_PROMPT,
    user: observerUserPrompt(input),
  });
  if (!first.result.ok && first.result.failure !== "malformed_output") return fallback(TRANSPORT_REASON[first.result.failure]);
  let checked = check(first.result, first.attempt);

  // 2. At most one repair, only after invalid returned output.
  if (!checked.candidate) {
    repairAttempted = true;
    const repair = await call(deps.observer, {
      stage: "repair",
      schemaName: "submit_assessment",
      schemaDescription: "Submit the corrected assessment.",
      jsonSchema: ASSESSMENT_JSON_SCHEMA,
      system: OBSERVER_SYSTEM_PROMPT,
      user: repairUserPrompt(input, checked.raw, checked.errors),
    });
    if (!repair.result.ok && repair.result.failure !== "malformed_output") return fallback(TRANSPORT_REASON[repair.result.failure]);
    checked = check(repair.result, repair.attempt);
    if (!checked.candidate) return fallback("invalid_after_repair");
  }
  const candidate = checked.candidate;

  // 3. Deterministic flags + configured policy.
  const flags: ReviewFlag[] = reviewFlags(candidate, input, deps.policy);
  validation = { ...validation, reviewFlags: flags };
  attempts.at(-1)!.reviewFlags = flags;
  if (flags.length === 0) return outcome({ finalAssessment: candidate, reviewStatus: "not_requested", reviewerResponse: null, resolution: "accepted", failureReason: null });

  // 4. At most one semantic review.
  if (!deps.reviewer) return fallback("review_failed", "failed");
  const review = await call(deps.reviewer, {
    stage: "reviewer",
    schemaName: "submit_review",
    schemaDescription: "Submit the evidence-support review of the proposed assessment.",
    jsonSchema: REVIEW_JSON_SCHEMA,
    system: REVIEWER_SYSTEM_PROMPT,
    user: reviewerUserPrompt({ input, proposedAssessment: candidate, flags }),
  });
  if (!review.result.ok) return fallback("review_failed", "failed");
  const reviewed = validateReview(review.result.output, input, candidate);
  review.attempt.validationErrors = reviewed.errors;
  if (!reviewed.response) return fallback("review_invalid", "failed");

  const resolution = resolveReview(reviewed.response, input, candidate, flags);
  if (resolution.kind === "supported") {
    return outcome({ finalAssessment: resolution.final, reviewStatus: "supported", reviewerResponse: reviewed.response, resolution: "accepted", failureReason: null });
  }
  review.attempt.reviewFlags = resolution.correctedFlags;
  if (resolution.kind === "corrected") {
    return outcome({ finalAssessment: resolution.final, reviewStatus: "corrected", reviewerResponse: reviewed.response, resolution: "corrected", failureReason: null });
  }
  return fallback(resolution.failureReason, resolution.reviewStatus, reviewed.response);
}
