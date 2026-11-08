import type { CheckpointView } from "@/contracts/game";
import type { Scenario } from "../scenario/schema";
import type { GameEvent } from "./events";
import type { GameState } from "./state";

/**
 * The single predefined checkpoint, "before-payment-decision": the event immediately before the
 * decision that determined the outcome — the first approval if any, else the first rejection.
 * Clients cannot choose a sequence; the server derives it from the session's own history.
 */
export function findCheckpoint(scenario: Scenario, state: GameState, events: readonly GameEvent[]): CheckpointView {
  const base = { checkpointId: scenario.checkpoint.checkpointId, label: scenario.checkpoint.label };
  const decided = (status: "approved" | "rejected") =>
    state.requests
      .filter((r) => r.status === status && r.decisionSequence !== null)
      .map((r) => r.decisionSequence!)
      .sort((a, b) => a - b)[0];
  const decisionSequence = decided("approved") ?? decided("rejected");
  if (decisionSequence === undefined || decisionSequence < 2) return { ...base, available: false, sequence: null, eventId: null };
  const checkpointEvent = events.find((e) => e.sequence === decisionSequence - 1);
  if (!checkpointEvent) return { ...base, available: false, sequence: null, eventId: null };
  return { ...base, available: true, sequence: checkpointEvent.sequence, eventId: checkpointEvent.eventId };
}
