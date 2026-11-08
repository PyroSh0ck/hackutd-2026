import type { Scenario } from "../scenario/schema";
import { findCheckpoint } from "./checkpoint";
import { decide } from "./decide";
import type { GameEvent } from "./events";
import { evolve, initialState, reconstructState, type GameState } from "./state";

export class CheckpointUnavailableError extends Error {
  constructor() {
    super("This run has no payment decision to retry from yet.");
    this.name = "CheckpointUnavailableError";
  }
}

/**
 * Fork semantics (docs/scamper/contracts.md): new session, SAME initial state; parent events
 * 1..K copied with fresh eventIds and sourceEventId -> parent event; then branch.started at K+1.
 * State is derived by folding this new stream only (never by also applying a parent snapshot).
 * No model call, no external writes. The parent's events are only read.
 */
export function buildForkStream(
  scenario: Scenario,
  parent: { sessionId: string; state: GameState; events: readonly GameEvent[] },
  fork: { sessionId: string; newId: () => string; now: string },
): { events: GameEvent[]; state: GameState; checkpointEventId: string } {
  const checkpoint = findCheckpoint(scenario, parent.state, parent.events);
  if (!checkpoint.available || checkpoint.sequence === null || checkpoint.eventId === null) throw new CheckpointUnavailableError();

  const prefix = parent.events.filter((e) => e.sequence <= checkpoint.sequence!);
  const copied: GameEvent[] = prefix.map((e) => ({ ...e, eventId: fork.newId(), sessionId: fork.sessionId, sourceEventId: e.eventId }));
  let state = reconstructState(initialState(scenario), copied);

  const branch = decide(scenario, state, {
    actor: "system",
    kind: "branch",
    parentSessionId: parent.sessionId,
    checkpointEventId: checkpoint.eventId,
    inheritedEventCount: copied.length,
  });
  if (!branch.ok) throw new Error(branch.message);
  const branchEvent = {
    ...branch.events[0],
    eventId: fork.newId(),
    sessionId: fork.sessionId,
    sequence: state.lastSequence + 1,
    actionId: `system:fork:${parent.sessionId}`,
    sourceEventId: null,
    createdAt: fork.now,
  } as GameEvent;
  state = evolve(state, branchEvent);
  return { events: [...copied, branchEvent], state, checkpointEventId: checkpoint.eventId };
}
