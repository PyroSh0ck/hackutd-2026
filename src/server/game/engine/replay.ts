import type { ReplayEvent, ReplayResponse } from "@/contracts/game";
import type { Scenario } from "../scenario/schema";
import { findCheckpoint } from "./checkpoint";
import type { GameEvent } from "./events";
import { evolve, initialState, type GameState } from "./state";
import { lineageView } from "./view";

/** Public one-line description of an event (no hidden data). */
export function summarizeEvent(scenario: Scenario, event: GameEvent): string {
  const recipientName = (id: string) => scenario.recipients.find((r) => r.recipientId === id)?.displayName ?? id;
  const originLabel = (origin: string) =>
    origin === "live_model" ? "live model" : origin === "scripted_fallback" ? "scripted fallback" : origin;
  switch (event.type) {
    case "encounter.started":
      return `Encounter started (${event.payload.scenarioId} v${event.payload.scenarioVersion}).`;
    case "branch.started":
      return `Practice branch started from the checkpoint (${event.payload.inheritedEventCount} events copied from the original run).`;
    case "message.sent":
      if (event.payload.from === "player") return "You sent a message.";
      return event.payload.origin === "scenario"
        ? `Opening alert from ${scenario.opponentPersona.senderLabel}.`
        : `Opponent message (${originLabel(event.payload.origin)}).`;
    case "payment.requested":
      return `Opponent requested ${event.payload.amount} credits to ${recipientName(event.payload.recipientId)} (${originLabel(event.payload.origin)}).`;
    case "payment.inspected":
      return "You inspected the payment request.";
    case "verification.completed":
      return "You called the bank's official line from your trusted contacts.";
    case "payment.approved":
      return "You approved the transfer.";
    case "ledger.debited":
      return `${event.payload.amount} credits left your checking account.`;
    case "payment.rejected":
      return "You declined the payment request.";
    case "payment.withdrawn":
      return "The pending payment request was closed.";
    case "encounter.ended": {
      const by = { payment_approved: "after the transfer", player_ended: "you ended it", opponent_finished: "the opponent stopped", turn_cap_reached: "turn limit reached" }[event.payload.reason];
      return `Encounter ended (${by}): ${event.payload.outcome.replace("_", " ")}.`;
    }
    case "reflection.submitted":
      return `You picked ${event.payload.warningSignIds.length} warning sign(s).`;
  }
}

/** Payload shown in replay: speech text omitted (it's in the transcript), everything else is public. */
function publicPayload(event: GameEvent): Record<string, unknown> {
  if (event.type === "message.sent") {
    const { messageId, from, origin } = event.payload;
    return { messageId, from, origin };
  }
  return { ...event.payload };
}

/** Canonical JSON (sorted keys): JSONB storage does not preserve key order. */
export function stableState(state: GameState): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]))
        : value;
  return JSON.stringify(canonical(state));
}

export function buildReplay(
  scenario: Scenario,
  meta: { sessionId: string; version: number; forkSessionIds: string[]; storedState: GameState },
  events: readonly GameEvent[],
): ReplayResponse {
  let state = initialState(scenario);
  const replayEvents: ReplayEvent[] = events.map((event) => {
    state = evolve(state, event);
    return {
      eventId: event.eventId,
      sequence: event.sequence,
      type: event.type,
      actor: event.actor,
      summary: summarizeEvent(scenario, event),
      payload: publicPayload(event),
      actionId: event.actionId,
      inherited: event.sourceEventId !== null,
      sourceEventId: event.sourceEventId,
      createdAt: event.createdAt,
      snapshot: {
        balance: state.balance,
        verified: state.verification.verified,
        pendingRequestIds: state.requests.filter((r) => r.status === "pending").map((r) => r.requestId),
        status: state.status,
        outcomeKind: state.ended?.outcome ?? null,
      },
    };
  });
  return {
    sessionId: meta.sessionId,
    scenarioVersion: scenario.version,
    events: replayEvents,
    decisiveEventId: state.ended?.decisiveEventId ?? null,
    checkpoint: findCheckpoint(scenario, state, events),
    lineage: lineageView(state, meta.forkSessionIds),
    reconstruction: {
      matchesStoredState: stableState(state) === stableState(meta.storedState),
      eventCount: events.length,
      version: meta.version,
    },
  };
}
