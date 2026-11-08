import { PlannerResponseSchema } from "@/contracts/planner";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** Planner handoff + current deterministic eligibility. Never includes the official result or practice code. */
export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]/planner", "Could not load planner observations.", async ({ playerKey, params }) => ({
  status: 200,
  body: PlannerResponseSchema.parse(await observerService().planner(playerKey, parseObserverSessionId(params.id))),
}));
