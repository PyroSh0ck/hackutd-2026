import type { Evidence, IssueRecord, ObserverAssessment } from "@/contracts/observer";
import type { EvidenceRef, MoveId } from "@/contracts/planner";
import type { PlanHistoryEntry, PlanningContext } from "@/server/planner/context";
import { MOVES } from "@/server/planner/eligibility";
import { additionsFor } from "@/server/planner/scenario";

export const CUR = "m-cur";
export const ev = (quote: string, messageId = CUR): Evidence => ({ messageId, quote });

export function assessment(over: Partial<ObserverAssessment> = {}): ObserverAssessment {
  return {
    requestId: null,
    currentMessageId: CUR,
    decision: { label: "unclear", evidence: [] },
    condition: null,
    verificationObservations: [],
    statedUnderstanding: null,
    ambiguities: [],
    openIssues: [],
    issueAcknowledgments: [],
    ...over,
  };
}

let issueSeq = 0;
export function issue(kind: IssueRecord["kind"], quote: string, over: Partial<IssueRecord> = {}): IssueRecord {
  issueSeq++;
  return {
    id: `i-${issueSeq}`,
    sessionId: "s-1",
    requestId: null,
    kind,
    summary: `Issue ${issueSeq}`,
    evidence: [ev(quote, over.evidence?.[0]?.messageId ?? CUR)],
    status: "open",
    originAssessmentId: "a-1",
    addressedMessageId: null,
    resolvedByAssessmentId: null,
    resolutionEventId: null,
    ...over,
  };
}

export const past = (moveId: MoveId, over: Partial<PlanHistoryEntry> & { refs?: EvidenceRef[] } = {}): PlanHistoryEntry => ({
  moveId,
  action: MOVES[moveId].action,
  requestId: over.requestId ?? null,
  issueId: over.issueId ?? null,
  evidenceRefs: over.refs ?? over.evidenceRefs ?? [{ kind: "message", id: CUR }],
});

/** Defaults: active, one user message assessed in conversation scope, nothing open, no request. */
export function ctx(over: Partial<PlanningContext> & { a?: Partial<ObserverAssessment>; resolution?: "accepted" | "corrected" | "unclear_fallback" } = {}): PlanningContext {
  const { a, resolution, ...rest } = over;
  const requestId = rest.request?.id ?? null;
  return {
    moves: null,
    sessionId: "s-1",
    revision: 7,
    stage: "active",
    ended: false,
    stopConfirmationPending: false,
    userTurns: 1,
    maxUserTurns: 12,
    trigger: { kind: "message", id: CUR },
    request: null,
    assessment: { id: "a-1", scope: requestId ? "request" : "conversation", resolution: resolution ?? "accepted", currentMessageId: CUR, final: assessment({ requestId, ...a }) },
    issues: [],
    rejectionEventIds: [],
    history: [],
    doubtBoundaryGiven: false,
    conversationDeclined: false,
    additions: additionsFor("CD-123456", new Set()),
    ...rest,
  };
}

export const PENDING = { id: "r-1", description: "Share the fictional practice code through the simulator's request card.", status: "pending" as const };
