import type { AssessmentScope, IssueRecord, ObserverAssessment, PlannerRequestStatus, Resolution, SessionStage } from "@/contracts/observer";
import type { Action, AdditionId, EvidenceRef, MoveId, PlannerAddition } from "@/contracts/planner";
import { publicIssue, requestStatusOf, stopConfirmationPending } from "@/server/observer/state";
import type { Snapshot } from "@/server/observer/store/types";
import { additionsFor } from "./scenario";

/**
 * Pure planning context (planner brief §5–§6). Everything the eligibility rules read, derived from the
 * durable snapshot. No model calls, no network. The planner never reclassifies stance: it reads the
 * applied observer assessment and server-owned state only.
 */

export type PlanHistoryEntry = { moveId: MoveId; action: Action; requestId: string | null; issueId: string | null; evidenceRefs: EvidenceRef[] };

export type PlanningContext = {
  sessionId: string;
  revision: number;
  stage: SessionStage;
  ended: boolean;
  stopConfirmationPending: boolean;
  userTurns: number;
  maxUserTurns: number;
  /** The input this planning step responds to: the latest user message or request-rejection event. */
  trigger: { kind: "message" | "event"; id: string } | null;
  /** Null until the request has been presented. */
  request: { id: string; description: string; status: Exclude<PlannerRequestStatus, "not_presented"> } | null;
  /** Latest applied assessment (for the latest user message). */
  assessment: { id: string; scope: AssessmentScope; resolution: Resolution; currentMessageId: string; final: ObserverAssessment } | null;
  /** Open and addressed issues, oldest first. */
  issues: IssueRecord[];
  /** request_rejected events for the current request. */
  rejectionEventIds: string[];
  /** Committed plans, oldest first, with the SERVER candidate's evidence (not model-chosen refs). */
  history: PlanHistoryEntry[];
  additions: PlannerAddition[];
};

export function triggerOf(s: Snapshot): PlanningContext["trigger"] {
  const message = [...s.messages].reverse().find((m) => m.role === "user");
  const rejection = [...s.events].reverse().find((e) => e.type === "request_rejected");
  if (!message && !rejection) return null;
  if (rejection && (!message || rejection.revision > message.revision)) return { kind: "event", id: rejection.id };
  return { kind: "message", id: message!.id };
}

export function derivePlanningContext(s: Snapshot, maxUserTurns: number): PlanningContext {
  const { request, status } = requestStatusOf(s);
  const latestUser = [...s.messages].reverse().find((m) => m.role === "user");
  const applied = s.assessments.filter((a) => a.application === "applied");
  const latest = latestUser ? [...applied].reverse().find((a) => a.currentMessageId === latestUser.id) : undefined;
  const introduced = new Set<AdditionId>(s.additions.filter((a) => a.introducedMessageId !== null).map((a) => a.id));
  return {
    sessionId: s.session.id,
    revision: s.session.revision,
    stage: s.session.stage,
    ended: s.session.ended,
    stopConfirmationPending: stopConfirmationPending(s.events),
    userTurns: s.messages.filter((m) => m.role === "user").length,
    maxUserTurns,
    trigger: triggerOf(s),
    request: request && status !== "not_presented" ? { id: request.id, description: request.description, status } : null,
    assessment: latest ? { id: latest.id, scope: latest.requestId ? "request" : "conversation", resolution: latest.resolution, currentMessageId: latest.currentMessageId, final: latest.finalAssessment } : null,
    issues: s.issues.filter((i) => i.status !== "resolved").map(publicIssue),
    rejectionEventIds: request ? s.events.filter((e) => e.type === "request_rejected" && e.requestId === request.id).map((e) => e.id) : [],
    history: s.plans
      .filter((p) => p.status === "committed" && p.acceptedPlan)
      .map((p) => {
        const c = p.candidateSnapshot.find((x) => x.id === p.acceptedPlan!.candidateId)!;
        return { moveId: c.moveId, action: c.action, requestId: c.requestId, issueId: c.issueId, evidenceRefs: c.evidenceRefs };
      }),
    additions: additionsFor(s.session.caseReference, introduced),
  };
}
