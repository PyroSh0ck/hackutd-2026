import type { GameState } from "../engine/state";
import type { Scenario } from "../scenario/schema";
import { OpponentObservationSchema, type OpponentObservation } from "./observation-schema";
import { redactPlayerText } from "./redact";

/**
 * buildOpponentObservation: explicit allowlist projection. Each field is picked by name; nothing
 * is spread from state or scenario. The strict schema parse makes an accidental extra field fail.
 * Hidden state (balance, transactions, verification, inspection, contacts) is never read here.
 */
export function buildOpponentObservation(scenario: Scenario, state: GameState): OpponentObservation {
  const turnNumber = state.opponentTurnIds.length + 1;
  return OpponentObservationSchema.parse({
    simulation: {
      notice: "Scam-awareness training simulation. Everything is fictional.",
      brief: scenario.opponentBrief,
    },
    persona: { displayName: scenario.opponentPersona.displayName, channel: scenario.opponentPersona.channel },
    playerDisplayName: scenario.player.displayName,
    allowedRecipients: scenario.recipients.map((r) => ({ recipientId: r.recipientId, displayName: r.displayName, claimedPurpose: r.claimedPurpose })),
    paymentLimits: { min: scenario.paymentLimits.min, max: scenario.paymentLimits.max },
    transcript: state.messages.map((m) => ({
      from: m.from === "player" ? "player" : "you",
      text: m.from === "player" ? redactPlayerText(m.text) : m.text,
    })),
    yourPaymentRequests: state.requests.map((r) => ({ requestId: r.requestId, recipientId: r.recipientId, amount: r.amount, status: r.status })),
    encounter: {
      status: state.status,
      turnNumber,
      turnsRemaining: Math.max(0, scenario.limits.maxOpponentTurns - turnNumber),
    },
  });
}
