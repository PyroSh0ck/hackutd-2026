import type { EventDraft, GameEvent } from "./events";
import { evolve, type GameState } from "./state";

/**
 * Turns decided drafts into committed events (ids + timestamps assigned here, outside the reducer)
 * and applies them with the same `evolve` reconstruction uses. Pure given `newId`/`now`.
 */
export function materialize(
  state: GameState,
  drafts: readonly EventDraft[],
  meta: { sessionId: string; actionId: string | null; newId: () => string; now: string; sourceEventIds?: (string | null)[] },
): { events: GameEvent[]; state: GameState } {
  let current = state;
  const events: GameEvent[] = [];
  drafts.forEach((draft, index) => {
    const event = {
      ...draft,
      eventId: meta.newId(),
      sessionId: meta.sessionId,
      sequence: state.lastSequence + index + 1,
      actionId: meta.actionId,
      sourceEventId: meta.sourceEventIds?.[index] ?? null,
      createdAt: meta.now,
    } as GameEvent;
    current = evolve(current, event);
    events.push(event);
  });
  return { events, state: current };
}
