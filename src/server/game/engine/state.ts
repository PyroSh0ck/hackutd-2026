import type { OutcomeKind } from "@/contracts/game";
import type { Scenario } from "../scenario/schema";
import type { GameEvent } from "./events";

/**
 * Authoritative game state. Derived ONLY by folding domain events over `initialState`.
 * The stored snapshot is a cache that tests (and the replay route) check against a fresh fold.
 */
export type GameState = {
  scenarioId: Scenario["scenarioId"];
  scenarioVersion: number;
  status: "active" | "ended";
  lastSequence: number;
  balance: number;
  debits: Array<{ transactionId: string; eventId: string; requestId: string; recipientId: string; amount: number; sequence: number }>;
  messages: Array<{ messageId: string; eventId: string; sequence: number; from: "player" | "opponent"; text: string; origin: "player" | "scenario" | "live_model" | "scripted_fallback"; turnId: string | null; createdAt: string }>;
  requests: Array<{
    requestId: string;
    eventId: string;
    sequence: number;
    recipientId: string;
    amount: number;
    origin: "live_model" | "scripted_fallback";
    status: "pending" | "approved" | "rejected" | "withdrawn";
    inspected: boolean;
    decisionEventId: string | null;
    decisionSequence: number | null;
  }>;
  verification: { verified: boolean; eventId: string | null; sequence: number | null };
  opponentTurnIds: string[];
  ended: null | { reason: "payment_approved" | "player_ended" | "opponent_finished" | "turn_cap_reached"; outcome: OutcomeKind; eventId: string; sequence: number; decisiveEventId: string };
  reflection: null | { warningSignIds: string[]; eventId: string };
  branch: null | { parentSessionId: string; checkpointEventId: string; inheritedEventCount: number; eventId: string };
};

/** Versioned initial state from the immutable scenario fixture. No events applied. */
export function initialState(scenario: Scenario): GameState {
  return {
    scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.version,
    status: "active",
    lastSequence: 0,
    balance: scenario.account.openingBalance,
    debits: [],
    messages: [],
    requests: [],
    verification: { verified: false, eventId: null, sequence: null },
    opponentTurnIds: [],
    ended: null,
    reflection: null,
    branch: null,
  };
}

export class ReconstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconstructionError";
  }
}

/** Pure: applies one already-validated event. Same function for live play and reconstruction. */
export function evolve(state: GameState, event: GameEvent): GameState {
  if (event.sequence !== state.lastSequence + 1) {
    throw new ReconstructionError(`Event sequence gap: expected ${state.lastSequence + 1}, got ${event.sequence}`);
  }
  const next: GameState = { ...state, lastSequence: event.sequence };
  const noteTurn = (turnId: string | null) => {
    if (turnId && !next.opponentTurnIds.includes(turnId)) next.opponentTurnIds = [...next.opponentTurnIds, turnId];
  };
  const updateRequest = (requestId: string, patch: Partial<GameState["requests"][number]>) => {
    if (!next.requests.some((r) => r.requestId === requestId)) throw new ReconstructionError(`Unknown request ${requestId}`);
    next.requests = next.requests.map((r) => (r.requestId === requestId ? { ...r, ...patch } : r));
  };

  switch (event.type) {
    case "encounter.started":
      if (event.payload.scenarioVersion !== state.scenarioVersion) throw new ReconstructionError("Scenario version mismatch");
      return next;
    case "branch.started":
      next.branch = {
        parentSessionId: event.payload.parentSessionId,
        checkpointEventId: event.payload.checkpointEventId,
        inheritedEventCount: event.payload.inheritedEventCount,
        eventId: event.eventId,
      };
      return next;
    case "message.sent":
      // Speech only: never touches balance, verification, requests, or outcome.
      next.messages = [
        ...next.messages,
        { ...event.payload, eventId: event.eventId, sequence: event.sequence, createdAt: event.createdAt },
      ];
      if (event.payload.from === "opponent") noteTurn(event.payload.turnId);
      return next;
    case "payment.requested":
      next.requests = [
        ...next.requests,
        {
          requestId: event.payload.requestId,
          eventId: event.eventId,
          sequence: event.sequence,
          recipientId: event.payload.recipientId,
          amount: event.payload.amount,
          origin: event.payload.origin,
          status: "pending",
          inspected: false,
          decisionEventId: null,
          decisionSequence: null,
        },
      ];
      noteTurn(event.payload.turnId);
      return next;
    case "payment.inspected":
      updateRequest(event.payload.requestId, { inspected: true });
      return next;
    case "verification.completed":
      next.verification = { verified: true, eventId: event.eventId, sequence: event.sequence };
      return next;
    case "payment.approved":
      updateRequest(event.payload.requestId, { status: "approved", decisionEventId: event.eventId, decisionSequence: event.sequence });
      return next;
    case "ledger.debited":
      next.balance = state.balance - event.payload.amount;
      next.debits = [...next.debits, { ...event.payload, eventId: event.eventId, sequence: event.sequence }];
      return next;
    case "payment.rejected":
      updateRequest(event.payload.requestId, { status: "rejected", decisionEventId: event.eventId, decisionSequence: event.sequence });
      return next;
    case "payment.withdrawn":
      updateRequest(event.payload.requestId, { status: "withdrawn" });
      return next;
    case "encounter.ended": {
      const approved = next.requests.find((r) => r.status === "approved");
      next.status = "ended";
      next.ended = {
        reason: event.payload.reason,
        outcome: event.payload.outcome,
        eventId: event.eventId,
        sequence: event.sequence,
        decisiveEventId: event.payload.reason === "payment_approved" && approved?.decisionEventId ? approved.decisionEventId : event.eventId,
      };
      noteTurn(event.payload.turnId);
      return next;
    }
    case "reflection.submitted":
      next.reflection = { warningSignIds: event.payload.warningSignIds, eventId: event.eventId };
      return next;
  }
}

/** Folds events from the versioned initial state. Checks sequence continuity and scenario version. */
export function reconstructState(initial: GameState, events: readonly GameEvent[]): GameState {
  return events.reduce(evolve, initial);
}
