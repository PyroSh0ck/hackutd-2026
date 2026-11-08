import { ActionResponseSchema, SessionResponseSchema, ReplayResponseSchema, DebriefResponseSchema, type CreateSessionRequest, type SubmitActionRequest, type PlayerView, type ReplayResponse, type DebriefResponse } from "@/contracts/game";
import * as f from "@/contracts/game-fixtures";
import { apiRequest } from "@/lib/api-client";

export interface GameAdapter {
  readonly source: "fixtures" | "api";
  create(input: CreateSessionRequest): Promise<PlayerView>;
  get(id: string): Promise<PlayerView>;
  submit(id: string, input: SubmitActionRequest): Promise<PlayerView>;
  replay(id: string): Promise<ReplayResponse>;
  debrief(id: string): Promise<DebriefResponse>;
  fork(id: string): Promise<PlayerView>;
}
const path = (id: string) => `/api/game/sessions/${encodeURIComponent(id)}`;
export const apiGameAdapter: GameAdapter = {
  source: "api",
  create: async input => (await apiRequest("/api/game/sessions", SessionResponseSchema, { method: "POST", body: input })).session,
  get: async id => (await apiRequest(path(id), SessionResponseSchema)).session,
  submit: async (id, input) => (await apiRequest(`${path(id)}/actions`, ActionResponseSchema, { method: "POST", body: input })).session,
  replay: id => apiRequest(`${path(id)}/replay`, ReplayResponseSchema),
  debrief: id => apiRequest(`${path(id)}/debrief`, DebriefResponseSchema),
  fork: async id => (await apiRequest(`${path(id)}/fork`, SessionResponseSchema, { method: "POST", body: { checkpointId: "before-payment-decision" } })).session,
};

/** Snapshot storyboard only. No client-side reducer, scoring, ledger or invented outcomes. */
export function createFixtureAdapter(): GameAdapter {
  let view = f.fixtureInitialView;
  const show = async (next: PlayerView) => {
    await new Promise(resolve => setTimeout(resolve, 350));
    view = structuredClone(next);
    return view;
  };
  return {
    source: "fixtures",
    create: () => show(f.fixtureInitialView),
    get: async () => view,
    submit: async (_id, { action }) => {
      switch (action.type) {
        case "send_message": return show(f.fixturePaymentRequestedView);
        case "inspect_payment": return show(f.fixtureInspectedView);
        case "verify_trusted_contact": return show(f.fixtureVerifiedView);
        case "approve_payment": return show(f.fixtureLossView);
        case "reject_payment": if (view.verification.status === "verified") return show(f.fixtureProtectedView); break;
      }
      throw new Error("This path has no committed public snapshot. Use the API for a full encounter, or restart the preview.");
    },
    replay: async () => {
      if (view.outcome?.kind !== "loss") throw new Error("Only the loss replay is supplied in public fixtures. Other replays need the game API.");
      return structuredClone(f.fixtureLossReplay);
    },
    debrief: async () => structuredClone(view.outcome?.kind === "loss" ? f.fixtureLossDebrief : f.fixtureProtectedDebrief),
    fork: () => show(f.fixtureForkActiveView),
  };
}
