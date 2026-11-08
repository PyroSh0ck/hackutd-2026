import type { AssessmentRecord, FailureReason, PlannerObservation } from "@/contracts/observer";
import type { PlanRecord } from "@/contracts/planner";
import { publicEvent, publicIssue, publicMessage, publicRequest, reduceRequestState, requestStatusOf, verificationState } from "./state";
import type { Snapshot } from "./store/types";

/**
 * Planner handoff (observer brief §4.9 + addendum §5). Model interpretations and server facts are separate
 * fields. Issue records, request status, verification state and stage are server-owned. The official
 * verification RESULT is never included. `unresolvedQuestions` is display text only, never policy input.
 */

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

function questionsFor(record: AssessmentRecord, action: PlannerObservation["action"], verification: PlannerObservation["verification"]): string[] {
  const a = record.finalAssessment;
  const out: string[] = [];
  if (record.failureReason) out.push(FAILURE_TEXT[record.failureReason]);
  if (record.requestId && a.decision.label === "unclear") out.push("The user's decision about this request is unresolved; a clarifying question may be appropriate.");
  for (const amb of a.ambiguities) out.push(`${amb.field}: ${amb.description}`);
  if ((a.decision.label === "explicit_acceptance" || a.decision.label === "conditional_acceptance") && action?.status !== "completed") {
    out.push("Acceptance is an expressed intention only; no completed action has been observed.");
  }
  if (a.condition) out.push(`Condition stated by the user (fulfillment not established): ${a.condition.description}`);
  if (a.verificationObservations.some((o) => o.behavior === "claimed_verification_completed") && verification.status !== "completed") {
    out.push("The user claims to have verified; no in-app verification has been observed (this does not prove they did not).");
  }
  if (a.verificationObservations.some((o) => o.channelProvenance === "sender_supplied")) out.push("A verification channel mentioned by the user was supplied by the sender.");
  return out;
}

export function recentPlans(plans: readonly PlanRecord[]): PlannerObservation["recentPlans"] {
  return plans
    .filter((p) => p.status === "committed" && p.acceptedPlan)
    .slice(-2)
    .map((p) => {
      const c = p.candidateSnapshot.find((x) => x.id === p.acceptedPlan!.candidateId)!;
      return { action: c.action, moveId: c.moveId, targetId: c.issueId ?? c.requestId };
    });
}

/** The observation for the latest APPLIED assessment. Stale records are never used. */
export function plannerObservation(s: Snapshot, maxUserTurns: number): PlannerObservation | null {
  const applied = s.assessments.filter((a) => a.application === "applied");
  const latest = applied.at(-1);
  if (!latest) return null;
  const { request, status } = requestStatusOf(s);
  const verification = verificationState(s.events);
  const action = request ? reduceRequestState(request, s.events, s.assessments).action : null;
  const previous = applied.filter((a) => a.requestId === latest.requestId).at(-2) ?? null;
  const issues = s.issues.filter((i) => i.status !== "resolved");
  const cited = new Set<string>([latest.currentMessageId]);
  for (const list of [latest.finalAssessment.decision.evidence, latest.finalAssessment.condition?.evidence ?? [], ...latest.finalAssessment.verificationObservations.map((o) => o.evidence), ...issues.map((i) => i.evidence)]) {
    for (const e of list) cited.add(e.messageId);
  }
  if (request) cited.add(request.introducedByMessageId);
  const eventIds = new Set([...(action?.eventIds ?? []), ...verification.eventIds]);
  const supportingEvents = s.events.filter((e) => eventIds.has(e.id) || (request && e.requestId === request.id));
  const userTurns = s.messages.filter((m) => m.role === "user").length;
  const verificationView = { status: verification.status, eventIds: verification.eventIds };
  return {
    sessionId: s.session.id,
    assessmentId: latest.id,
    scope: latest.requestId ? "request" : "conversation",
    basedOnRevision: latest.basedOnRevision,
    currentRevision: s.session.revision,
    sessionStage: s.session.stage,
    request: request ? publicRequest(request) : null,
    requestStatus: status,
    assessment: latest.finalAssessment,
    interpretationSource: "model_interpretation",
    resolution: latest.resolution,
    reviewStatus: latest.reviewStatus,
    previousAssessment: previous?.finalAssessment ?? null,
    issues: issues.map(publicIssue),
    action,
    verification: verificationView,
    recentPlans: recentPlans(s.plans),
    supportingMessages: s.messages.filter((m) => cited.has(m.id)).map(publicMessage),
    supportingEvents: supportingEvents.map(publicEvent),
    unresolvedQuestions: questionsFor(latest, action, verificationView),
    remainingTurns: Math.max(0, maxUserTurns - userTurns),
  };
}
