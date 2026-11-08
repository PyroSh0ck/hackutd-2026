import { LIMITS, type AppEvent, type AppEventType, type AssessmentRecord, type ObserverAssessment, type ObserverInput, type RequestState, type SubmitEventRequest, type TargetAction } from "@/contracts/observer";
import { RUBRIC, RUBRIC_VERSION } from "./rubric";
import type { EventRow, MessageRow, RequestRow, Snapshot } from "./store/types";

/**
 * Pure server-side state: fallback construction, event-driven request state, event applicability, and
 * observer-input assembly. Model output never reaches these reducers: action and in-app verification
 * status come from application events only.
 */

export function fallbackAssessment(input: Pick<ObserverInput, "request" | "currentMessageId">): ObserverAssessment {
  // Conservative (brief §8): correct ids, unclear, no condition, no invented evidence, empty observations.
  // The failure reason lives in AssessmentRecord.failureReason, never in a fabricated quote.
  return {
    requestId: input.request.id,
    currentMessageId: input.currentMessageId,
    decision: { label: "unclear", evidence: [] },
    condition: null,
    verificationObservations: [],
    statedUnderstanding: null,
    ambiguities: [],
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
const SESSION_EVENTS = new Set<AppEventType>(["conversation_reported", "conversation_ended"]);

/** Session-level verification events (requestId null) apply to every request. */
const appliesTo = (e: AppEvent, requestId: string) => e.requestId === requestId || (e.requestId === null && (e.type === "official_directory_opened" || e.type === "official_verification_completed"));

export function reduceRequestState(request: RequestRow, events: readonly AppEvent[], assessments: readonly AssessmentRecord[]): RequestState {
  const state: RequestState = {
    requestId: request.id,
    latestAssessmentId: [...assessments].reverse().find((a) => a.application === "applied" && a.requestId === request.id)?.id ?? null,
    action: { status: "not_started", eventIds: [] },
    inAppVerification: { status: "not_observed", eventIds: [] },
  };
  for (const e of events) {
    if (!appliesTo(e, request.id)) continue;
    if (e.type === STARTS[request.targetAction]) {
      state.action.eventIds.push(e.id);
      if (state.action.status === "not_started") state.action.status = "started";
    } else if (e.type === COMPLETES[request.targetAction]) {
      state.action.eventIds.push(e.id);
      state.action.status = "completed";
    } else if (e.type === "official_directory_opened") {
      state.inAppVerification.eventIds.push(e.id);
      if (state.inAppVerification.status === "not_observed") state.inAppVerification.status = "directory_opened";
    } else if (e.type === "official_verification_completed") {
      state.inAppVerification.eventIds.push(e.id);
      state.inAppVerification.status = "completed";
    }
  }
  return state;
}

export const requestStates = (s: Pick<Snapshot, "requests" | "events" | "assessments">) => s.requests.map((r) => reduceRequestState(r, s.events, s.assessments));

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
  | "SESSION_LEVEL_EVENT";

export type EventPlan =
  | { ok: true; event: Omit<EventRow, "id" | "createdAt" | "revision" | "sessionId" | "turn">; closeRequestIds: string[]; ended: boolean; issueChallenge: boolean }
  | { ok: false; reason: EventRejection; message: string };

/**
 * Decides whether a client-requested event is applicable. Clients choose only the event type, the
 * request, and (for completion) the challenge id issued when they opened the official directory.
 */
export function planEvent(s: Pick<Snapshot, "session" | "requests" | "events" | "assessments">, cmd: SubmitEventRequest): EventPlan {
  const no = (reason: EventRejection, message: string): EventPlan => ({ ok: false, reason, message });
  if (s.session.ended) return no("SESSION_ENDED", "The practice conversation has ended.");
  const base = { type: cmd.type, requestId: cmd.requestId, challengeId: null as string | null };

  if (SESSION_EVENTS.has(cmd.type)) {
    if (cmd.requestId !== null) return no("SESSION_LEVEL_EVENT", "This event applies to the whole conversation.");
    return { ok: true, event: base, closeRequestIds: s.requests.filter((r) => r.status === "open").map((r) => r.id), ended: true, issueChallenge: false };
  }

  if (cmd.type === "official_directory_opened") {
    if (cmd.requestId !== null && !s.requests.some((r) => r.id === cmd.requestId)) return no("REQUEST_NOT_FOUND", "Unknown request.");
    return { ok: true, event: base, closeRequestIds: [], ended: false, issueChallenge: true };
  }

  if (cmd.type === "official_verification_completed") {
    if (!cmd.challengeId) return no("CHALLENGE_REQUIRED", "Open the official directory and finish its verification step first.");
    const opened = s.events.find((e) => e.type === "official_directory_opened" && e.challengeId === cmd.challengeId);
    if (!opened) return no("CHALLENGE_INVALID", "That verification step was not started here.");
    if (s.events.some((e) => e.type === "official_verification_completed" && e.challengeId === cmd.challengeId)) return no("ALREADY_COMPLETED", "That verification was already completed.");
    if (cmd.requestId !== null && cmd.requestId !== opened.requestId) return no("CHALLENGE_INVALID", "The verification step belongs to another request.");
    return { ok: true, event: { type: cmd.type, requestId: opened.requestId, challengeId: cmd.challengeId }, closeRequestIds: [], ended: false, issueChallenge: false };
  }

  if (cmd.requestId === null) return no("REQUEST_REQUIRED", "This event must name the request it answers.");
  const request = s.requests.find((r) => r.id === cmd.requestId);
  if (!request) return no("REQUEST_NOT_FOUND", "Unknown request.");
  if (request.status === "closed") return no("REQUEST_CLOSED", "That request is closed.");

  if (cmd.type === "request_rejected") return { ok: true, event: base, closeRequestIds: [request.id], ended: false, issueChallenge: false };

  if (ACTION_EVENTS.has(cmd.type)) {
    if (cmd.type !== COMPLETES[request.targetAction] && cmd.type !== STARTS[request.targetAction]) return no("WRONG_REQUEST_TYPE", `That action does not apply to a ${request.targetAction} request.`);
    const state = reduceRequestState(request, s.events, s.assessments);
    if (state.action.status === "completed") return no("ALREADY_COMPLETED", "That action was already completed.");
    if (cmd.type === STARTS[request.targetAction] && state.action.status === "started") return no("ALREADY_STARTED", "That action was already started.");
    if (STARTS[request.targetAction] && cmd.type === COMPLETES[request.targetAction] && state.action.status !== "started") return no("NOT_STARTED", "Start the action before completing it.");
    return { ok: true, event: base, closeRequestIds: [], ended: false, issueChallenge: false };
  }
  return no("WRONG_REQUEST_TYPE", "Unsupported event.");
}

/**
 * Latest user message and the open requests introduced before it that have no record for this pair yet.
 * A stale record counts: each message/request pair gets at most one pipeline run (brief §8 budget).
 */
export function pendingWork(s: Snapshot): { message: MessageRow; requests: RequestRow[] } | null {
  if (s.session.ended) return null;
  const message = [...s.messages].reverse().find((m) => m.role === "user");
  if (!message) return null;
  const requests = s.requests
    .filter((r) => r.status === "open" && r.revision <= message.revision)
    .filter((r) => !s.assessments.some((a) => a.requestId === r.id && a.currentMessageId === message.id))
    .slice(0, LIMITS.openRequests);
  return requests.length ? { message, requests } : null;
}

const strip = <T extends { revision: number }>({ revision: _r, ...rest }: T) => (void _r, rest);
const stripEvent = ({ revision: _r, challengeId: _c, ...rest }: EventRow): AppEvent => (void _r, void _c, rest);

/** Builds a bounded, request-specific observer input from a snapshot (brief §4.3). */
export function buildObserverInput(s: Snapshot, message: MessageRow, request: RequestRow): ObserverInput {
  const upTo = s.messages.filter((m) => m.revision <= message.revision);
  const recent = upTo.slice(-LIMITS.relevantMessages);
  const intro = s.messages.find((m) => m.id === request.introducedByMessageId);
  const relevant = intro && !recent.some((m) => m.id === intro.id) ? [intro, ...recent] : recent;
  const previous = [...s.assessments].reverse().find((a) => a.application === "applied" && a.requestId === request.id);
  return {
    sessionId: s.session.id,
    turn: message.turn,
    basedOnRevision: s.session.conversationRevision,
    currentMessageId: message.id,
    request: strip(request),
    relevantMessages: relevant.map(strip),
    previousAssessment: previous?.finalAssessment ?? null,
    relevantEvents: s.events.filter((e) => appliesTo(e, request.id)).slice(-LIMITS.relevantEvents).map(stripEvent),
    rubricVersion: RUBRIC_VERSION,
    rubric: RUBRIC,
  };
}

export const publicMessage = strip<MessageRow>;
export const publicRequest = strip<RequestRow>;
export const publicEvent = stripEvent;
