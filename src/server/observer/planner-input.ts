import type { AssessmentRecord, FailureReason, PlannerObservation } from "@/contracts/observer";
import { publicEvent, publicMessage, publicRequest, reduceRequestState } from "./state";
import type { Snapshot } from "./store/types";

/**
 * Planner handoff (brief §4.9). Model interpretations and server facts are separate fields. Uncertainty is
 * spelled out so the planner cannot equate explicit acceptance with a completed action, or the absence of
 * an observed verification with proof that none happened.
 */

export const MAX_USER_TURNS = 8;

const FAILURE_TEXT: Record<FailureReason, string> = {
  model_unavailable: "The observer model was unavailable, so this reply was not interpreted.",
  model_timeout: "The observer timed out, so this reply was not interpreted.",
  model_refusal: "The observer declined to interpret this reply.",
  model_http_error: "The observer call failed, so this reply was not interpreted.",
  invalid_after_repair: "The observer's interpretation failed validation twice and was discarded.",
  review_failed: "A required review could not be completed, so the interpretation was discarded.",
  review_invalid: "The review was invalid, so the interpretation was discarded.",
  review_ambiguous: "The reviewer found the reply ambiguous.",
  review_unresolved_flags: "A contradiction check was not resolved by review, so the interpretation was discarded.",
  correction_flagged: "The reviewer's correction still failed a contradiction check, so it was discarded.",
};

function questionsFor(record: AssessmentRecord, action: PlannerObservation["action"], verification: PlannerObservation["inAppVerification"]): string[] {
  const a = record.finalAssessment;
  const out: string[] = [];
  if (record.failureReason) out.push(FAILURE_TEXT[record.failureReason]);
  if (a.decision.label === "unclear") out.push("The user's decision about this request is unresolved; a clarifying question may be appropriate.");
  for (const amb of a.ambiguities) out.push(`${amb.field}: ${amb.description}`);
  if ((a.decision.label === "explicit_acceptance" || a.decision.label === "conditional_acceptance") && action.status !== "completed") {
    out.push("Acceptance is an expressed intention only; no completed action has been observed.");
  }
  if (a.condition) out.push(`Condition stated by the user (fulfillment not established): ${a.condition.description}`);
  if (a.verificationObservations.some((o) => o.behavior === "claimed_verification_completed") && verification.status !== "completed") {
    out.push("The user claims to have verified; no in-app verification has been observed (this does not prove they did not).");
  }
  if (a.verificationObservations.some((o) => o.channelProvenance === "sender_supplied")) out.push("A verification channel mentioned by the user was supplied by the sender.");
  return out;
}

/** One observation per request that has an applied assessment. Stale records are never used. */
export function plannerObservations(s: Snapshot, requestIds?: readonly string[]): PlannerObservation[] {
  const applied = s.assessments.filter((a) => a.application === "applied");
  const userTurns = s.messages.filter((m) => m.role === "user").length;
  return s.requests
    .filter((r) => !requestIds || requestIds.includes(r.id))
    .flatMap((request) => {
      const history = applied.filter((a) => a.requestId === request.id);
      const latest = history.at(-1);
      if (!latest) return [];
      const state = reduceRequestState(request, s.events, s.assessments);
      const cited = new Set([latest.currentMessageId, ...latest.finalAssessment.decision.evidence.map((e) => e.messageId)]);
      const supportingEvents = s.events.filter((e) => state.action.eventIds.includes(e.id) || state.inAppVerification.eventIds.includes(e.id) || e.requestId === request.id);
      return [
        {
          request: publicRequest(request),
          assessment: latest.finalAssessment,
          interpretationSource: "model_interpretation" as const,
          resolution: latest.resolution,
          reviewStatus: latest.reviewStatus,
          action: state.action,
          inAppVerification: state.inAppVerification,
          previousAssessment: history.at(-2)?.finalAssessment ?? null,
          supportingMessages: s.messages.filter((m) => cited.has(m.id) || m.id === request.introducedByMessageId).map(publicMessage),
          supportingEvents: supportingEvents.map(publicEvent),
          unresolvedQuestions: questionsFor(latest, state.action, state.inAppVerification),
          remainingTurns: Math.max(0, MAX_USER_TURNS - userTurns),
        },
      ];
    });
}
