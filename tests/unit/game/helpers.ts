import type { PlayerAction } from "@/contracts/game";
import { materialize } from "@/server/game/engine/commit";
import { decide, type Command } from "@/server/game/engine/decide";
import type { GameEvent } from "@/server/game/engine/events";
import { initialState, type GameState } from "@/server/game/engine/state";
import { bankAlertScenario as scenario } from "@/server/game/scenario/bank-alert";

export { scenario };

/** Deterministic in-memory run of the pure engine (no DB, no model). */
export class Run {
  state: GameState = initialState(scenario);
  events: GameEvent[] = [];
  private counter = 0;
  constructor(public readonly sessionId = "00000000-0000-4000-8000-000000000001") {
    this.apply({ actor: "system", kind: "start" });
  }
  apply(command: Command, actionId: string | null = null) {
    const decision = decide(scenario, this.state, command);
    if (!decision.ok) return decision;
    const { events, state } = materialize(this.state, decision.events, {
      sessionId: this.sessionId,
      actionId,
      newId: () => `${this.sessionId.slice(-4)}-evt-${++this.counter}`,
      now: new Date(Date.UTC(2026, 10, 7, 15, 0, this.counter)).toISOString(),
    });
    this.state = state;
    this.events.push(...events);
    return decision;
  }
  player(action: PlayerAction) {
    return this.apply({ actor: "player", action }, `action-${this.events.length}`);
  }
  opponentRequest(amount = 500, recipientId = "mrb-secure-holding") {
    return this.apply({ actor: "opponent", kind: "payment_request", recipientId, amount, origin: "live_model", turnId: `turn-${this.events.length}` });
  }
  opponentSay(text: string) {
    return this.apply({ actor: "opponent", kind: "message", text, origin: "live_model", turnId: `turn-${this.events.length}` });
  }
  get pendingRequestId() {
    return this.state.requests.find((r) => r.status === "pending")?.requestId ?? "none";
  }
}

/** Loss path: reply, opponent asks, inspect, approve. */
export function lossRun() {
  const run = new Run();
  run.player({ type: "send_message", text: "What do I need to do?" });
  run.opponentSay("Please approve the transfer to our safe account.");
  run.opponentRequest(500);
  run.player({ type: "inspect_payment", requestId: run.pendingRequestId });
  run.player({ type: "approve_payment", requestId: run.pendingRequestId });
  return run;
}
