import type { GameRejectionReason, OutcomeKind, PlayerAction, AllowedAction } from "@/contracts/game";
import type { Scenario } from "../scenario/schema";
import type { EventDraft } from "./events";
import type { GameState } from "./state";

/**
 * decide(state, command) validates a command against the current authoritative state and returns
 * domain event drafts or a typed rejection. Pure: no I/O, clocks, or randomness. Payload ids are
 * derived from the next sequence numbers so reconstruction and forks stay deterministic.
 */

export type OpponentOrigin = "live_model" | "scripted_fallback";

export type OpponentRejectionReason =
  | "ENCOUNTER_ENDED"
  | "UNKNOWN_RECIPIENT"
  | "AMOUNT_OUT_OF_RANGE"
  | "PAYMENT_REQUEST_ALREADY_PENDING"
  | "MESSAGE_EMPTY"
  | "MESSAGE_TOO_LONG"
  | "LINKS_NOT_ALLOWED";

export type Command =
  | { actor: "player"; action: PlayerAction }
  | { actor: "opponent"; kind: "message"; text: string; origin: OpponentOrigin; turnId: string }
  | { actor: "opponent"; kind: "payment_request"; recipientId: string; amount: number; origin: OpponentOrigin; turnId: string }
  | { actor: "opponent"; kind: "finish"; origin: OpponentOrigin; turnId: string }
  | { actor: "system"; kind: "start" }
  | { actor: "system"; kind: "turn_cap"; turnId: string }
  | { actor: "system"; kind: "branch"; parentSessionId: string; checkpointEventId: string; inheritedEventCount: number };

export type Decision =
  | { ok: true; events: EventDraft[] }
  | { ok: false; reason: GameRejectionReason | OpponentRejectionReason; message: string };

const reject = (reason: GameRejectionReason | OpponentRejectionReason, message: string): Decision => ({ ok: false, reason, message });

export function outcomeFor(state: Pick<GameState, "debits" | "verification">): OutcomeKind {
  if (state.debits.length > 0) return "loss";
  return state.verification.verified ? "protected" : "safe_exit";
}

/** Assigns deterministic payload ids from the sequence each draft will receive. */
function seqAt(state: GameState, index: number) {
  return state.lastSequence + index + 1;
}

function withdrawPending(state: GameState, reason: "encounter_ended" | "opponent_finished"): EventDraft[] {
  return state.requests
    .filter((r) => r.status === "pending")
    .map((r) => ({ type: "payment.withdrawn", actor: "system", payload: { requestId: r.requestId, reason } }) as const);
}

const LINK_PATTERN = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|co|app|info|biz|link)\b/i;

export function decide(scenario: Scenario, state: GameState, command: Command): Decision {
  if (command.actor === "system") return decideSystem(scenario, state, command);
  if (command.actor === "opponent") return decideOpponent(scenario, state, command);
  return decidePlayer(scenario, state, command.action);
}

function decideSystem(scenario: Scenario, state: GameState, command: Extract<Command, { actor: "system" }>): Decision {
  switch (command.kind) {
    case "start":
      if (state.lastSequence !== 0) return reject("ENCOUNTER_ACTIVE", "This encounter already started.");
      return {
        ok: true,
        events: [
          { type: "encounter.started", actor: "system", payload: { scenarioId: scenario.scenarioId, scenarioVersion: scenario.version } },
          {
            type: "message.sent",
            actor: "opponent",
            payload: { messageId: `msg-${seqAt(state, 1)}`, from: "opponent", text: scenario.openingMessage, origin: "scenario", turnId: null },
          },
        ],
      };
    case "branch":
      return {
        ok: true,
        events: [
          {
            type: "branch.started",
            actor: "system",
            payload: {
              parentSessionId: command.parentSessionId,
              checkpointId: "before-payment-decision",
              checkpointEventId: command.checkpointEventId,
              inheritedEventCount: command.inheritedEventCount,
            },
          },
        ],
      };
    case "turn_cap": {
      if (state.status === "ended") return reject("ENCOUNTER_ENDED", "The encounter has ended.");
      return {
        ok: true,
        events: [
          ...withdrawPending(state, "encounter_ended"),
          { type: "encounter.ended", actor: "system", payload: { reason: "turn_cap_reached", outcome: outcomeFor(state), turnId: command.turnId } },
        ],
      };
    }
  }
}

function decideOpponent(scenario: Scenario, state: GameState, command: Extract<Command, { actor: "opponent" }>): Decision {
  if (state.status === "ended") return reject("ENCOUNTER_ENDED", "The encounter has ended; no further actions are possible.");
  switch (command.kind) {
    case "message": {
      const text = command.text.trim();
      if (!text) return reject("MESSAGE_EMPTY", "Message text is empty.");
      if (text.length > scenario.limits.maxOpponentMessageChars)
        return reject("MESSAGE_TOO_LONG", `Messages are limited to ${scenario.limits.maxOpponentMessageChars} characters.`);
      if (LINK_PATTERN.test(text)) return reject("LINKS_NOT_ALLOWED", "Links and web addresses are not allowed in this simulation.");
      return {
        ok: true,
        events: [
          {
            type: "message.sent",
            actor: "opponent",
            payload: { messageId: `msg-${seqAt(state, 0)}`, from: "opponent", text, origin: command.origin, turnId: command.turnId },
          },
        ],
      };
    }
    case "payment_request": {
      if (!scenario.recipients.some((r) => r.recipientId === command.recipientId))
        return reject("UNKNOWN_RECIPIENT", `Unknown recipient. Allowed: ${scenario.recipients.map((r) => r.recipientId).join(", ")}.`);
      const { min, max } = scenario.paymentLimits;
      if (!Number.isInteger(command.amount) || command.amount < min || command.amount > max)
        return reject("AMOUNT_OUT_OF_RANGE", `Amount must be a whole number of credits between ${min} and ${max}.`);
      if (state.requests.filter((r) => r.status === "pending").length >= scenario.limits.maxOpenPaymentRequests)
        return reject("PAYMENT_REQUEST_ALREADY_PENDING", "A payment request is already waiting for the player's decision.");
      return {
        ok: true,
        events: [
          {
            type: "payment.requested",
            actor: "opponent",
            payload: {
              requestId: `req-${seqAt(state, 0)}`,
              recipientId: command.recipientId,
              amount: command.amount,
              origin: command.origin,
              turnId: command.turnId,
            },
          },
        ],
      };
    }
    case "finish":
      return {
        ok: true,
        events: [
          ...withdrawPending(state, "opponent_finished"),
          { type: "encounter.ended", actor: "system", payload: { reason: "opponent_finished", outcome: outcomeFor(state), turnId: command.turnId } },
        ],
      };
  }
}

function findRequest(state: GameState, requestId: string) {
  return state.requests.find((r) => r.requestId === requestId);
}

function decidePlayer(scenario: Scenario, state: GameState, action: PlayerAction): Decision {
  if (action.type === "submit_reflection") {
    if (state.status !== "ended") return reject("ENCOUNTER_ACTIVE", "Finish the encounter before reflecting.");
    if (state.reflection) return reject("REFLECTION_ALREADY_SUBMITTED", "You already submitted your reflection.");
    const known = new Set(scenario.warningSigns.map((s) => s.signId));
    if (action.warningSignIds.some((id) => !known.has(id))) return reject("UNKNOWN_WARNING_SIGN", "Choose from the listed warning signs.");
    return { ok: true, events: [{ type: "reflection.submitted", actor: "player", payload: { warningSignIds: [...new Set(action.warningSignIds)] } }] };
  }

  if (state.status === "ended") return reject("ENCOUNTER_ENDED", "This encounter has ended.");

  switch (action.type) {
    case "send_message":
      return {
        ok: true,
        events: [
          {
            type: "message.sent",
            actor: "player",
            payload: { messageId: `msg-${seqAt(state, 0)}`, from: "player", text: action.text.trim(), origin: "player", turnId: null },
          },
        ],
      };
    case "inspect_payment": {
      const request = findRequest(state, action.requestId);
      if (!request) return reject("PAYMENT_REQUEST_NOT_FOUND", "That payment request doesn't exist.");
      if (request.status !== "pending") return reject("PAYMENT_REQUEST_NOT_PENDING", "That payment request is no longer waiting.");
      if (request.inspected) return { ok: true, events: [] };
      return { ok: true, events: [{ type: "payment.inspected", actor: "player", payload: { requestId: request.requestId } }] };
    }
    case "verify_trusted_contact": {
      if (action.contactId !== scenario.verification.contactId || !scenario.contacts.some((c) => c.contactId === action.contactId))
        return reject("CONTACT_NOT_FOUND", "That contact isn't in your trusted directory.");
      if (state.verification.verified) return reject("ALREADY_VERIFIED", "You already verified with the bank.");
      return {
        ok: true,
        events: [
          {
            type: "verification.completed",
            actor: "player",
            payload: { contactId: action.contactId, factIds: scenario.verification.facts.map((f) => f.factId) },
          },
        ],
      };
    }
    case "approve_payment": {
      const request = findRequest(state, action.requestId);
      if (!request) return reject("PAYMENT_REQUEST_NOT_FOUND", "That payment request doesn't exist.");
      if (request.status !== "pending") return reject("PAYMENT_REQUEST_NOT_PENDING", "That payment request is no longer waiting.");
      if (!request.inspected) return reject("PAYMENT_NOT_INSPECTED", "Inspect the payment request before approving it.");
      if (request.amount > state.balance) return reject("INSUFFICIENT_FUNDS", "Not enough credits for this transfer.");
      return {
        ok: true,
        events: [
          { type: "payment.approved", actor: "player", payload: { requestId: request.requestId } },
          {
            type: "ledger.debited",
            actor: "system",
            payload: { transactionId: `txn-${seqAt(state, 1)}`, requestId: request.requestId, recipientId: request.recipientId, amount: request.amount },
          },
          { type: "encounter.ended", actor: "system", payload: { reason: "payment_approved", outcome: "loss", turnId: null } },
        ],
      };
    }
    case "reject_payment": {
      const request = findRequest(state, action.requestId);
      if (!request) return reject("PAYMENT_REQUEST_NOT_FOUND", "That payment request doesn't exist.");
      if (request.status !== "pending") return reject("PAYMENT_REQUEST_NOT_PENDING", "That payment request is no longer waiting.");
      return { ok: true, events: [{ type: "payment.rejected", actor: "player", payload: { requestId: request.requestId } }] };
    }
    case "end_encounter":
      return {
        ok: true,
        events: [
          ...withdrawPending(state, "encounter_ended"),
          { type: "encounter.ended", actor: "player", payload: { reason: "player_ended", outcome: outcomeFor(state), turnId: null } },
        ],
      };
  }
}

/** Player actions that trigger one bounded opponent turn after they commit. */
export function triggersOpponentTurn(action: PlayerAction): boolean {
  return action.type === "send_message" || action.type === "reject_payment";
}

/** Controls the UI may offer now. Derived from the same rules as decide. */
export function allowedActions(scenario: Scenario, state: GameState, options: { turnPending: boolean }): AllowedAction[] {
  if (state.status === "ended") return state.reflection ? [] : [{ type: "submit_reflection" }];
  const actions: AllowedAction[] = [];
  if (!options.turnPending) actions.push({ type: "send_message" });
  for (const request of state.requests.filter((r) => r.status === "pending")) {
    if (!request.inspected) actions.push({ type: "inspect_payment", requestId: request.requestId });
  }
  if (!state.verification.verified) actions.push({ type: "verify_trusted_contact", contactId: scenario.verification.contactId });
  for (const request of state.requests.filter((r) => r.status === "pending")) {
    if (request.inspected && request.amount <= state.balance) actions.push({ type: "approve_payment", requestId: request.requestId });
    actions.push({ type: "reject_payment", requestId: request.requestId });
  }
  actions.push({ type: "end_encounter" });
  return actions;
}
