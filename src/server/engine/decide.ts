import type { AssessmentRecord, ObserverSessionView, SubmitEventRequest } from "@/contracts/observer";
import type { PlanRecord } from "@/contracts/planner";
import { derivePlanningContext, triggerOf } from "@/server/planner/context";
import { getEligibleCandidates } from "@/server/planner/eligibility";
import { TEAM_LABEL, type ScenarioDefinition } from "@/server/planner/scenario";
import { stopIntent, type StopIntent } from "@/server/planner/stop-intent";
import { eventChange, issueChangesFor, pendingWork, planEvent, stopConfirmationPending } from "@/server/observer/state";
import type { EventRow, InputChange, IssueChanges, MessageRow, PlanCommit, RequestRow, SessionRow, Snapshot } from "@/server/observer/store/types";

/**
 * The training rules as pure decisions: given the current authoritative snapshot and a command, what
 * changes (or why the command is rejected). No I/O, clocks or randomness beyond what `Env` supplies, and no
 * Node imports, so the SpacetimeDB module runs exactly this code inside its transactions.
 */

export const ACTOR_FAILURE_NOTICE = "The practice response couldn't be generated. You can retry or end this session.";

export type Env = { scenario: ScenarioDefinition; newId: () => string; now: Date };

export type Rejection = { ok: false; status: 409 | 422; code: "ACTION_REJECTED" | "VERSION_CONFLICT"; reason: string; message: string };
const reject = (reason: string, message: string, status: 409 | 422 = 422, code: Rejection["code"] = "ACTION_REJECTED"): Rejection => ({ ok: false, status, code, reason, message });
export const SESSION_ENDED = reject("SESSION_ENDED", "The practice conversation has ended.");

const serverEvent = (s: Snapshot, env: Env, type: EventRow["type"], detail: string | null, requestId: string | null = null): EventRow => ({
  id: env.newId(),
  sessionId: s.session.id,
  requestId,
  turn: s.session.turn,
  type,
  challengeId: null,
  detail,
  createdAt: env.now.toISOString(),
  revision: s.session.revision + 1,
});

const closeOpen = (s: Snapshot) => s.requests.filter((r) => r.status === "open").map((r) => r.id);

// ---------------------------------------------------------------------------------------------- session

export function decideCreate(env: Env, ownerKey: string, sessionId: string, threadId: string, random: () => number): { session: Omit<SessionRow, "claim">; change: InputChange } {
  const { scenario } = env;
  const at = env.now.toISOString();
  const opening: MessageRow = { id: env.newId(), sessionId, turn: 0, role: "assistant", content: scenario.opening, createdAt: at, revision: 1 };
  const requests: RequestRow[] = scenario.openingRequests.map((r) => ({ id: env.newId(), introducedByMessageId: opening.id, targetAction: r.targetAction, description: r.description, status: "open", revision: 1 }));
  const { practiceCode, caseReference } = scenario.reserve(random);
  const additions = scenario.request
    ? [...(caseReference ? [{ id: "case_reference" as const, text: caseReference, introducedMessageId: null }] : []), { id: "team_label" as const, text: TEAM_LABEL, introducedMessageId: null }]
    : [];
  return {
    session: { id: sessionId, ownerKey, threadId, scenarioId: scenario.id, scenarioVersion: scenario.version, revision: 1, conversationRevision: 1, turn: 0, ended: false, stage: "active", outcome: null, practiceCode, caseReference, createdAt: at },
    change: { messages: [opening], requests, additions },
  };
}

// ---------------------------------------------------------------------------------------------- messages

/** Whether a user message may be accepted now. "ended" is audited by the caller and then rejected. */
export function messageGate(s: Snapshot, scenario: ScenarioDefinition): "ok" | "ended" | Rejection {
  if (s.session.ended) return "ended";
  if (s.session.stage === "verifying" || s.session.stage === "awaiting_final_decision") return reject("STAGE_PAUSED", "The conversation is paused while you verify or decide.");
  if (stopConfirmationPending(s.events)) return reject("STOP_CONFIRMATION_PENDING", "Confirm whether you want to end the practice first.");
  if (s.session.turn >= scenario.maxUserTurns) return reject("TURN_LIMIT", "This practice conversation has reached its turn limit.");
  return "ok";
}

export type MessageDecision = { ok: true; change: InputChange; messageId: string; intent: StopIntent; endedNow: boolean } | Rejection;

export function decideMessage(s: Snapshot, input: { key: string; content: string; payloadHash: string; messageId: string }, env: Env): MessageDecision {
  const gate = messageGate(s, env.scenario);
  if (gate === "ended") return SESSION_ENDED;
  if (gate !== "ok") return gate;
  const intent = stopIntent(input.content);
  const turn = s.session.turn + 1;
  const revision = s.session.revision + 1;
  const at = env.now.toISOString();
  const message: MessageRow = { id: input.messageId, sessionId: s.session.id, turn, role: "user", content: input.content, createdAt: at, revision };
  const receipt = { key: input.key, kind: "message" as const, payloadHash: input.payloadHash, resultId: input.messageId, challengeId: null };
  const base = { ok: true as const, messageId: input.messageId, intent };
  if (intent === "clear") {
    // Explicit out-of-character stop: terminal in the same commit; no model work follows.
    return {
      ...base,
      endedNow: true,
      change: {
        messages: [message],
        turn,
        receipt,
        events: [{ id: env.newId(), sessionId: s.session.id, requestId: null, turn, type: "conversation_ended", challengeId: null, detail: "text_stop", createdAt: at, revision }],
        closeRequestIds: closeOpen(s),
        stage: "ended",
        outcome: "safely_disengaged",
        ended: true,
      },
    };
  }
  if (intent === "ambiguous") {
    return { ...base, endedNow: false, change: { messages: [message], turn, receipt, events: [{ id: env.newId(), sessionId: s.session.id, requestId: null, turn, type: "stop_confirmation_requested", challengeId: null, detail: null, createdAt: at, revision }] } };
  }
  return { ...base, endedNow: false, change: { messages: [message], turn, receipt } };
}

/** Inputs after termination are audited (planner brief §4); the caller still rejects the input. */
export const decideAfterEnd = (s: Snapshot, attempted: string, env: Env): InputChange => ({ events: [serverEvent(s, env, "event_rejected_after_end", attempted)] });

// ---------------------------------------------------------------------------------------------- events

export type EventDecision = { ok: true; change: InputChange; primaryId: string; challengeId: string | null } | Rejection;

export function decideEvent(s: Snapshot, request: SubmitEventRequest, payloadHash: string, env: Env): EventDecision {
  if (s.session.ended) return SESSION_ENDED;
  const plan = planEvent(s, request, env.scenario);
  if (!plan.ok) return reject(plan.reason, plan.message);
  const challengeId = plan.issueChallenge ? env.newId() : null;
  const { change, primaryId } = eventChange(plan, { sessionId: s.session.id, turn: s.session.turn, revision: s.session.revision + 1, at: env.now.toISOString(), ids: env.newId, challengeId });
  return { ok: true, primaryId, challengeId, change: { ...change, receipt: { key: request.idempotencyKey, kind: "event", payloadHash, resultId: primaryId, challengeId } } };
}

// ---------------------------------------------------------------------------------------------- planning lifecycle

/** Neutral technical notice for the latest input whose planning failed (planner brief §9). */
export function technicalNotice(s: Snapshot): ObserverSessionView["technicalNotice"] {
  const trigger = triggerOf(s);
  if (!trigger) return null;
  const records = s.plans.filter((p) => p.inputId === trigger.id);
  if (records.some((p) => p.status === "committed")) return null;
  const failures = records.filter((p) => p.status === "failed" || p.status === "rejected").length;
  if (!failures) return null;
  const retried = s.events.some((e) => e.type === "planning_retry_requested" && e.detail === trigger.id);
  return { inputId: trigger.id, attempts: failures, canRetry: failures === 1 && !retried && !s.session.ended, message: ACTOR_FAILURE_NOTICE };
}

export function decideRetry(s: Snapshot, input: { key: string; payloadHash: string; eventId: string }, env: Env): { ok: true; change: InputChange } | Rejection {
  if (s.session.ended) return SESSION_ENDED;
  const notice = technicalNotice(s);
  if (!notice?.canRetry) return reject("RETRY_NOT_AVAILABLE", "There is nothing to retry.");
  return { ok: true, change: { events: [{ ...serverEvent(s, env, "planning_retry_requested", notice.inputId), id: input.eventId }], receipt: { key: input.key, kind: "retry", payloadHash: input.payloadHash, resultId: input.eventId, challengeId: null } } };
}

export function turnLimitDue(s: Snapshot, scenario: ScenarioDefinition): boolean {
  if (s.session.ended || pendingWork(s)) return false;
  const last = [...s.messages].reverse().find((m) => m.role === "user");
  return Boolean(last && last.turn >= scenario.maxUserTurns);
}

/** Turn-limit conclusion. Empty change when it no longer applies (already ended, or new work arrived). */
export const decideTurnLimit = (s: Snapshot, env: Env): InputChange =>
  !turnLimitDue(s, env.scenario) ? {} : { events: [serverEvent(s, env, "turn_limit_reached", null)], closeRequestIds: closeOpen(s), stage: "ended", outcome: "inconclusive", ended: true };

/** A planning failure: neutral notice; the second failure for the same input ends the session. */
export function decideTechnicalFailure(s: Snapshot, inputId: string, attempt: 1 | 2, env: Env): InputChange {
  if (s.session.ended) return {};
  const notice = serverEvent(s, env, "planning_failed", `${inputId}:${attempt}`);
  if (attempt < 2) return { events: [notice] };
  return { events: [notice, serverEvent(s, env, "technical_interruption", inputId)], closeRequestIds: closeOpen(s), stage: "ended", outcome: "technical_interruption", ended: true };
}

// ---------------------------------------------------------------------------------------------- assessment

export const decideIssues = (s: Snapshot, record: AssessmentRecord, newId: () => string): IssueChanges => issueChangesFor(s, record, newId);

// ---------------------------------------------------------------------------------------------- commit

/**
 * The candidate a commit may execute: recomputed from the authoritative snapshot (never taken from the
 * caller's record), and only if the plan was made against this exact revision for the current input.
 */
export function authorizedCandidate(s: Snapshot, record: PlanRecord, scenario: ScenarioDefinition) {
  if (!record.acceptedPlan || record.basedOnRevision !== s.session.revision) return null;
  const trigger = triggerOf(s);
  if (!trigger || trigger.id !== record.inputId) return null;
  const eligibility = getEligibleCandidates(derivePlanningContext(s, scenario.maxUserTurns));
  if (eligibility.kind !== "candidates") return null;
  return eligibility.candidates.find((c) => c.id === record.acceptedPlan!.candidateId) ?? null;
}

/**
 * Builds the atomic commit for a prepared plan: the actor message, the authorized request (only when the
 * server-built candidate carries the request tool) and its presentation event, the addressed issue, and
 * newly introduced additions. Returns null when the record cannot be committed (no candidate/output).
 */
export function decideCommit(s: Snapshot, record: PlanRecord, claimId: string, env: Env): PlanCommit | null {
  const candidate = authorizedCandidate(s, record, env.scenario);
  if (!candidate || !record.actorOutput) return null;
  // Server-held truth never leaves through the opponent's message, whatever the worker sent.
  const text = record.actorOutput.text;
  if ((s.session.practiceCode && text.includes(s.session.practiceCode)) || (env.scenario.officialResult && text.includes(env.scenario.officialResult))) return null;
  const revision = record.basedOnRevision + 1;
  const at = env.now.toISOString();
  const message: MessageRow = { id: env.newId(), sessionId: s.session.id, turn: s.session.turn, role: "assistant", content: record.actorOutput.text, createdAt: at, revision };
  const requests: RequestRow[] =
    candidate.toolIntent === "present_practice_code_request" && env.scenario.request
      ? [{ id: env.newId(), introducedByMessageId: message.id, targetAction: env.scenario.request.targetAction, description: env.scenario.request.description, status: "open", revision }]
      : [];
  const events: EventRow[] = requests.map((r) => ({ id: env.newId(), sessionId: s.session.id, requestId: r.id, turn: s.session.turn, type: "request_presented", challengeId: null, detail: "planner", createdAt: at, revision }));
  const introduced = new Set(s.additions.filter((a) => a.introducedMessageId !== null).map((a) => a.id));
  return {
    record: {
      ...record,
      status: "committed",
      committedMessageId: message.id,
      // The valid actor attempt is linked to the message the module actually committed.
      ...(record.actorAudit ? { actorAudit: { ...record.actorAudit, attempts: record.actorAudit.attempts.map((a) => (a.status === "valid" ? { ...a, committedMessageId: message.id } : a)) } } : {}),
    },
    claimId,
    now: env.now,
    message,
    requests,
    events,
    addressIssueId: candidate.issueId,
    introduceAdditionIds: record.actorOutput.introducedAdditionIds.filter((id) => !introduced.has(id)),
  };
}
