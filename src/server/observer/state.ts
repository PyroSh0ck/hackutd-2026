import {
  LIMITS,
  type AppEvent,
  type AppEventType,
  type AssessmentRecord,
  type IssueRecord,
  type KnownIssue,
  type ObserverAssessment,
  type ObserverInput,
  type Outcome,
  type PlannerRequestStatus,
  type RequestState,
  type SessionStage,
  type SubmitEventRequest,
  type TargetAction,
  type VerificationStatus,
} from "@/contracts/observer";
import { issueDraftKey } from "./evidence";
import { RUBRIC, RUBRIC_VERSION } from "./rubric";
import type { EventRow, InputChange, IssueChanges, IssueRow, MessageRow, RequestRow, Snapshot } from "./store/types";

/**
 * Pure server-side state: fallback construction, event-driven request/verification state, session stage
 * and terminal outcomes, event applicability, observer-input assembly, and the issue lifecycle. Model
 * output never reaches these reducers: action, verification, stage and outcome come from server events.
 */

export function fallbackAssessment(input: Pick<ObserverInput, "request" | "currentMessageId">): ObserverAssessment {
  // Conservative (brief §8, addendum §4): correct ids, unclear, no condition, no invented evidence, empty
  // observations, no issues and no acknowledgments. Persisted issue records are left untouched.
  // The failure reason lives in AssessmentRecord.failureReason, never in a fabricated quote.
  return {
    requestId: input.request?.id ?? null,
    currentMessageId: input.currentMessageId,
    decision: { label: "unclear", evidence: [] },
    condition: null,
    verificationObservations: [],
    statedUnderstanding: null,
    ambiguities: [],
    openIssues: [],
    issueAcknowledgments: [],
  };
}

const COMPLETES: Record<TargetAction, AppEventType> = {
  share_fictional_code: "practice_code_submitted",
  share_fictional_account_details: "practice_account_details_submitted",
  open_simulated_link: "simulated_link_opened",
  approve_simulated_payment: "simulated_payment_approved",
};
const STARTS: Partial<Record<TargetAction, AppEventType>> = { approve_simulated_payment: "simulated_payment_started" };
const ACTION_EVENTS = new Set<AppEventType>([...Object.values(COMPLETES), ...Object.values(STARTS)]);
const VERIFICATION_EVENTS = new Set<AppEventType>(["official_directory_opened", "official_verification_started", "official_verification_cancelled", "official_verification_completed"]);
/** Completing these ends the exercise (planner brief §4). */
const TERMINAL_ACTIONS = new Set<AppEventType>(Object.values(COMPLETES));

// ---------------------------------------------------------------- verification (addendum §5)

export type VerificationState = {
  status: VerificationStatus;
  eventIds: string[];
  /** Challenge of the in-progress verification (required to complete it). */
  activeChallengeId: string | null;
  linkedIssueId: string | null;
  completedEventId: string | null;
};

/** Session-level verification state from server events only. Cancellation returns to directory_opened. */
export function verificationState(events: readonly EventRow[]): VerificationState {
  const state: VerificationState = { status: "not_observed", eventIds: [], activeChallengeId: null, linkedIssueId: null, completedEventId: null };
  for (const e of events) {
    // Verification is session-level. (Legacy v1 rows may name a request; they still count here.)
    if (!VERIFICATION_EVENTS.has(e.type) || state.status === "completed") continue;
    state.eventIds.push(e.id);
    if (e.type === "official_directory_opened") {
      if (state.status === "not_observed") state.status = "directory_opened";
      state.activeChallengeId = e.challengeId;
    } else if (e.type === "official_verification_started") {
      state.status = "in_progress";
      state.activeChallengeId = e.challengeId;
      state.linkedIssueId = e.detail;
    } else if (e.type === "official_verification_cancelled") {
      state.status = "directory_opened";
      state.activeChallengeId = null;
      state.linkedIssueId = null;
    } else if (e.type === "official_verification_completed") {
      state.status = "completed";
      state.completedEventId = e.id;
    }
  }
  return state;
}

export function reduceRequestState(request: RequestRow, events: readonly EventRow[], assessments: readonly AssessmentRecord[]): RequestState {
  const verification = verificationState(events);
  const state: RequestState = {
    requestId: request.id,
    latestAssessmentId: [...assessments].reverse().find((a) => a.application === "applied" && a.requestId === request.id)?.id ?? null,
    action: { status: "not_started", eventIds: [] },
    inAppVerification: { status: verification.status, eventIds: verification.eventIds },
  };
  for (const e of events) {
    if (e.requestId !== request.id) continue;
    if (e.type === STARTS[request.targetAction]) {
      state.action.eventIds.push(e.id);
      if (state.action.status === "not_started") state.action.status = "started";
    } else if (e.type === COMPLETES[request.targetAction]) {
      state.action.eventIds.push(e.id);
      state.action.status = "completed";
    }
  }
  return state;
}

export const requestStates = (s: Pick<Snapshot, "requests" | "events" | "assessments">) => s.requests.map((r) => reduceRequestState(r, s.events, s.assessments));

/** The planner's request status (adapter over open/closed + events; the observer enum is unchanged). */
export function requestStatusOf(s: Pick<Snapshot, "requests" | "events" | "assessments">): { request: RequestRow | null; status: PlannerRequestStatus } {
  const request = s.requests.at(-1) ?? null;
  if (!request) return { request: null, status: "not_presented" };
  if (reduceRequestState(request, s.events, s.assessments).action.status === "completed") return { request, status: "completed" };
  if (s.events.some((e) => e.type === "request_rejected" && e.requestId === request.id)) return { request, status: "rejected" };
  return { request, status: request.status === "open" ? "pending" : "rejected" };
}

export function stopConfirmationPending(events: readonly EventRow[]): boolean {
  let pending = false;
  for (const e of events) {
    if (e.type === "stop_confirmation_requested") pending = true;
    else if (e.type === "stop_confirmation_dismissed") pending = false;
  }
  return pending;
}

export const finalDecisionProceeded = (events: readonly EventRow[]) => events.some((e) => e.type === "final_decision_proceed");

// ---------------------------------------------------------------- event applicability

export type EventRejection =
  | "SESSION_ENDED"
  | "REQUEST_REQUIRED"
  | "REQUEST_NOT_FOUND"
  | "REQUEST_CLOSED"
  | "WRONG_REQUEST_TYPE"
  | "ALREADY_COMPLETED"
  | "NOT_STARTED"
  | "ALREADY_STARTED"
  | "CHALLENGE_REQUIRED"
  | "CHALLENGE_INVALID"
  | "SESSION_LEVEL_EVENT"
  | "STAGE_MISMATCH"
  | "STOP_CONFIRMATION_PENDING"
  | "NO_STOP_CONFIRMATION"
  | "PROCEED_REQUIRED"
  | "ALREADY_PROCEEDED"
  | "CODE_REQUIRED"
  | "CODE_MISMATCH"
  | "ISSUE_INVALID"
  | "NO_REQUEST_AVAILABLE";

type EventDraft = { type: AppEventType; requestId: string | null; challengeId: string | null; detail: string | null };

export type EventPlan =
  | {
      ok: true;
      events: EventDraft[];
      /** Index of the event whose id answers the command (the receipt's result). */
      primary: number;
      closeRequestIds: string[];
      stage?: SessionStage;
      outcome?: Outcome;
      issueChallenge: boolean;
      createRequest?: { targetAction: TargetAction; description: string; introducedByMessageId: string };
      resolveIssueId?: string;
    }
  | { ok: false; reason: EventRejection; message: string };

export type EventScenario = { request: { targetAction: TargetAction; description: string } | null; officialResultCode: string | null };

const terminal = (outcome: Outcome, ev: EventDraft, closeRequestIds: string[] = []): EventPlan => ({ ok: true, events: [ev], primary: 0, closeRequestIds, stage: "ended", outcome, issueChallenge: false });

/**
 * Decides whether a client-requested event is applicable (planner brief §4). Clients choose only the type,
 * the request, the issued challenge, the fictional practice code shown to them, and an optional linked
 * issue. First terminal event wins; anything after it is rejected (the service audits the attempt).
 */
export function planEvent(s: Pick<Snapshot, "session" | "requests" | "events" | "assessments" | "issues" | "messages">, cmd: SubmitEventRequest, scenario: EventScenario): EventPlan {
  const no = (reason: EventRejection, message: string): EventPlan => ({ ok: false, reason, message });
  const stage = s.session.stage;
  if (s.session.ended || stage === "ended") return no("SESSION_ENDED", "The practice conversation has ended.");
  const base: EventDraft = { type: cmd.type, requestId: cmd.requestId, challengeId: null, detail: null };
  const openIds = () => s.requests.filter((r) => r.status === "open").map((r) => r.id);
  const pendingStop = stopConfirmationPending(s.events);

  if (cmd.type === "conversation_ended" || cmd.type === "conversation_reported") {
    if (cmd.requestId !== null) return no("SESSION_LEVEL_EVENT", "This event applies to the whole conversation.");
    return terminal(cmd.type === "conversation_reported" ? "defense_demonstrated" : "safely_disengaged", { ...base, detail: cmd.type === "conversation_ended" ? "end_practice_control" : null }, openIds());
  }
  if (cmd.type === "stop_confirmation_dismissed") {
    if (cmd.requestId !== null) return no("SESSION_LEVEL_EVENT", "This event applies to the whole conversation.");
    if (!pendingStop) return no("NO_STOP_CONFIRMATION", "There is no stop confirmation to dismiss.");
    return { ok: true, events: [base], primary: 0, closeRequestIds: [], issueChallenge: false };
  }
  if (pendingStop) return no("STOP_CONFIRMATION_PENDING", "Confirm whether you want to end the practice first.");

  if (cmd.type === "official_verification_started") {
    if (cmd.requestId !== null && !s.requests.some((r) => r.id === cmd.requestId)) return no("REQUEST_NOT_FOUND", "Unknown request.");
    if (stage !== "active") return no("STAGE_MISMATCH", "Verification can only be started during the conversation.");
    if (verificationState(s.events).status === "completed") return no("ALREADY_COMPLETED", "Verification was already completed.");
    if (cmd.linkedIssueId !== undefined) {
      const issue = s.issues.find((i) => i.id === cmd.linkedIssueId);
      if (!issue || issue.kind !== "procedure_question" || issue.status === "resolved") return no("ISSUE_INVALID", "That issue cannot be linked to verification.");
    }
    return { ok: true, events: [{ ...base, requestId: null, detail: cmd.linkedIssueId ?? null }], primary: 0, closeRequestIds: [], stage: "verifying", issueChallenge: true };
  }
  if (cmd.type === "official_verification_cancelled") {
    if (stage !== "verifying") return no("STAGE_MISMATCH", "No verification is in progress.");
    return { ok: true, events: [{ ...base, requestId: null }], primary: 0, closeRequestIds: [], stage: "active", issueChallenge: false };
  }
  if (cmd.type === "official_verification_completed") {
    if (!cmd.challengeId) return no("CHALLENGE_REQUIRED", "Open the official verification and read its result first.");
    const v = verificationState(s.events);
    if (v.status === "completed") return no("ALREADY_COMPLETED", "That verification was already completed.");
    const legacy = s.events.some((e) => e.type === "official_directory_opened" && e.challengeId === cmd.challengeId);
    if (!legacy && stage !== "verifying") return no("STAGE_MISMATCH", "No verification is in progress.");
    if (v.activeChallengeId !== cmd.challengeId) return no("CHALLENGE_INVALID", "That verification step was not started here.");
    // The result is server-derived from the scenario; the client cannot submit its own verdict.
    return {
      ok: true,
      events: [{ type: cmd.type, requestId: null, challengeId: cmd.challengeId, detail: scenario.officialResultCode }],
      primary: 0,
      closeRequestIds: [],
      stage: "awaiting_final_decision",
      issueChallenge: false,
      ...(v.linkedIssueId ? { resolveIssueId: v.linkedIssueId } : {}),
    };
  }
  if (cmd.type === "final_decision_proceed") {
    if (cmd.requestId !== null) return no("SESSION_LEVEL_EVENT", "This event applies to the whole conversation.");
    if (stage !== "awaiting_final_decision") return no("STAGE_MISMATCH", "Proceed is a final decision after verification.");
    if (finalDecisionProceeded(s.events)) return no("ALREADY_PROCEEDED", "You already chose to proceed.");
    const { status } = requestStatusOf(s);
    if (status === "pending") return { ok: true, events: [base], primary: 0, closeRequestIds: [], issueChallenge: false };
    if (status !== "not_presented" || !scenario.request) return no("NO_REQUEST_AVAILABLE", "There is no request to proceed with.");
    // Create the sole request (it was never presented). It is anchored to the latest assistant message;
    // no observer assessment can follow because no messages are accepted in this stage.
    const anchor = [...s.messages].reverse().find((m) => m.role === "assistant");
    if (!anchor) return no("NO_REQUEST_AVAILABLE", "There is no request to proceed with.");
    return {
      ok: true,
      events: [base, { type: "request_presented", requestId: null, challengeId: null, detail: "final_decision" }],
      primary: 0,
      closeRequestIds: [],
      issueChallenge: false,
      createRequest: { ...scenario.request, introducedByMessageId: anchor.id },
    };
  }

  if (cmd.requestId === null) return no("REQUEST_REQUIRED", "This event must name the request it answers.");
  const request = s.requests.find((r) => r.id === cmd.requestId);
  if (!request) return no("REQUEST_NOT_FOUND", "Unknown request.");
  if (request.status === "closed") return no("REQUEST_CLOSED", "That request is closed.");
  if (stage === "verifying") return no("STAGE_MISMATCH", "Finish or cancel verification first.");

  if (cmd.type === "request_rejected") {
    // After completed verification, rejecting is the defense decision and ends the exercise.
    if (stage === "awaiting_final_decision") return terminal("defense_demonstrated", base, [request.id]);
    return { ok: true, events: [base], primary: 0, closeRequestIds: [request.id], issueChallenge: false };
  }

  if (ACTION_EVENTS.has(cmd.type)) {
    if (cmd.type !== COMPLETES[request.targetAction] && cmd.type !== STARTS[request.targetAction]) return no("WRONG_REQUEST_TYPE", `That action does not apply to a ${request.targetAction} request.`);
    const state = reduceRequestState(request, s.events, s.assessments);
    if (state.action.status === "completed") return no("ALREADY_COMPLETED", "That action was already completed.");
    if (cmd.type === STARTS[request.targetAction] && state.action.status === "started") return no("ALREADY_STARTED", "That action was already started.");
    if (STARTS[request.targetAction] && cmd.type === COMPLETES[request.targetAction] && state.action.status !== "started") return no("NOT_STARTED", "Start the action before completing it.");
    if (stage === "awaiting_final_decision" && !finalDecisionProceeded(s.events)) return no("PROCEED_REQUIRED", "Choose Proceed with simulated sharing first.");
    if (cmd.type === "practice_code_submitted" && s.session.practiceCode !== null) {
      // Only the server's fictional token counts; the code itself is never stored.
      if (!cmd.practiceCode) return no("CODE_REQUIRED", "Use the Share practice code button on the request card.");
      if (cmd.practiceCode !== s.session.practiceCode) return no("CODE_MISMATCH", "That is not this session's fictional practice code.");
    }
    if (TERMINAL_ACTIONS.has(cmd.type)) return terminal("simulated_exposure", base, openIds());
    return { ok: true, events: [base], primary: 0, closeRequestIds: [], issueChallenge: false };
  }
  return no("WRONG_REQUEST_TYPE", "Unsupported event.");
}

// ---------------------------------------------------------------- observer work and input

export type Pair = { message: MessageRow; request: RequestRow | null };

const recorded = (s: Snapshot, requestId: string | null, messageId: string) => s.assessments.some((a) => a.requestId === requestId && a.currentMessageId === messageId);

/**
 * Latest user message and the scopes it still needs assessing in: each open request introduced before it,
 * or the conversation scope when no request is open. A stale record counts: each pair gets at most one
 * pipeline run (brief §8 budget).
 */
export function pendingWork(s: Snapshot): { message: MessageRow; requests: Array<RequestRow | null> } | null {
  if (s.session.ended) return null;
  const message = [...s.messages].reverse().find((m) => m.role === "user");
  if (!message) return null;
  const open = s.requests.filter((r) => r.status === "open" && r.revision <= message.revision);
  const scopes: Array<RequestRow | null> = open.length ? open : [null];
  const requests = scopes.filter((r) => !recorded(s, r?.id ?? null, message.id)).slice(0, LIMITS.openRequests);
  return requests.length ? { message, requests } : null;
}

const strip = <T extends { revision: number }>({ revision: _r, ...rest }: T) => (void _r, rest);
const stripEvent = ({ revision: _r, challengeId: _c, detail: _d, ...rest }: EventRow): AppEvent => (void _r, void _c, void _d, rest);

/** Events shown to the observer for a scope: the request's own events plus session-level verification. */
const appliesTo = (e: EventRow, requestId: string | null) => (e.requestId !== null && e.requestId === requestId) || (e.requestId === null && VERIFICATION_EVENTS.has(e.type));

export const knownIssues = (issues: readonly IssueRow[]): KnownIssue[] =>
  issues
    .filter((i): i is IssueRow & { status: "open" | "addressed" } => i.status !== "resolved")
    .slice(-LIMITS.knownIssues)
    .map((i) => ({ id: i.id, kind: i.kind, summary: i.summary, evidence: i.evidence, status: i.status, addressedMessageId: i.addressedMessageId }));

/** Builds a bounded observer input for one scope (addendum §2–§3). */
export function buildObserverInput(s: Snapshot, message: MessageRow, request: RequestRow | null): ObserverInput {
  const upTo = s.messages.filter((m) => m.revision <= message.revision);
  const recent = upTo.slice(-LIMITS.relevantMessages);
  const intro = request ? s.messages.find((m) => m.id === request.introducedByMessageId) : undefined;
  const relevant = intro && !recent.some((m) => m.id === intro.id) ? [intro, ...recent] : recent;
  const requestId = request?.id ?? null;
  const previous = [...s.assessments].reverse().find((a) => a.application === "applied" && a.requestId === requestId);
  return {
    sessionId: s.session.id,
    turn: message.turn,
    basedOnRevision: s.session.conversationRevision,
    currentMessageId: message.id,
    scope: request ? "request" : "conversation",
    request: request ? strip(request) : null,
    relevantMessages: relevant.map(strip),
    previousAssessment: previous?.finalAssessment ?? null,
    relevantEvents: s.events.filter((e) => appliesTo(e, requestId)).slice(-LIMITS.relevantEvents).map(stripEvent),
    knownIssues: knownIssues(s.issues),
    rubricVersion: RUBRIC_VERSION,
    rubric: RUBRIC,
  };
}

// ---------------------------------------------------------------- issue lifecycle (addendum §4)

/**
 * Issue changes implied by an assessment that is about to be APPLIED. Only accepted/corrected assessments
 * create or resolve anything; a fallback carries no issues. Ids are assigned here (server code).
 * Deduplication is exact: the same assessment + kind + ordered evidence (replays), or an existing
 * unresolved issue with the same kind + ordered evidence. No semantic deduplication.
 */
export function issueChangesFor(s: Pick<Snapshot, "issues" | "session">, record: AssessmentRecord, newId: () => string): IssueChanges {
  if (record.resolution === "unclear_fallback") return { create: [], resolve: [] };
  const existing = new Set(s.issues.filter((i) => i.status !== "resolved").map((i) => issueDraftKey(i)));
  const create: IssueRow[] = [];
  for (const draft of record.finalAssessment.openIssues) {
    const key = issueDraftKey(draft);
    if (existing.has(key)) continue;
    existing.add(key);
    create.push({
      id: newId(),
      sessionId: record.sessionId,
      requestId: record.requestId,
      kind: draft.kind,
      summary: draft.summary,
      evidence: draft.evidence,
      status: "open",
      originAssessmentId: record.id,
      addressedMessageId: null,
      resolvedByAssessmentId: null,
      resolutionEventId: null,
      dedupeKey: `${record.id}:${key}`,
    });
  }
  const resolve = record.finalAssessment.issueAcknowledgments
    .filter((k) => s.issues.some((i) => i.id === k.issueId && i.status === "addressed" && i.sessionId === record.sessionId))
    .map((k) => ({ id: k.issueId, assessmentId: record.id }));
  return { create, resolve };
}

export const publicIssue = ({ dedupeKey: _k, ...rest }: IssueRow): IssueRecord => (void _k, rest);
export const publicMessage = strip<MessageRow>;
export const publicRequest = strip<RequestRow>;
export const publicEvent = stripEvent;

/** Builds the event rows + change for a planned event. */
export function eventChange(
  plan: Extract<EventPlan, { ok: true }>,
  ctx: { sessionId: string; turn: number; revision: number; at: string; ids: () => string; challengeId: string | null },
): { change: InputChange; primaryId: string } {
  const events: EventRow[] = plan.events.map((e, i) => ({
    ...e,
    challengeId: i === plan.primary && plan.issueChallenge ? ctx.challengeId : e.challengeId,
    id: ctx.ids(),
    sessionId: ctx.sessionId,
    turn: ctx.turn,
    createdAt: ctx.at,
    revision: ctx.revision,
  }));
  const requests: RequestRow[] = plan.createRequest
    ? [{ id: ctx.ids(), introducedByMessageId: plan.createRequest.introducedByMessageId, targetAction: plan.createRequest.targetAction, description: plan.createRequest.description, status: "open", revision: ctx.revision }]
    : [];
  for (const e of events) if (e.type === "request_presented" && requests[0]) e.requestId = requests[0].id;
  const resolution = plan.resolveIssueId ? [{ id: plan.resolveIssueId, resolutionEventId: events[plan.primary].id }] : undefined;
  return {
    primaryId: events[plan.primary].id,
    change: {
      events,
      requests,
      closeRequestIds: plan.closeRequestIds,
      ...(plan.stage ? { stage: plan.stage } : {}),
      ...(plan.outcome ? { outcome: plan.outcome, ended: true } : {}),
      ...(resolution ? { resolveIssues: resolution } : {}),
    },
  };
}
