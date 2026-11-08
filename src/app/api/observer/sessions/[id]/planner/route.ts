import { PlannerResponseSchema } from "@/contracts/observer";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** The planner handoff, derived from applied assessments and server events only. */
export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]/planner", "Could not load planner observations.", async ({ playerKey, params }) => ({
  status: 200,
  body: PlannerResponseSchema.parse({ observations: await observerService().planner(playerKey, parseObserverSessionId(params.id)) }),
}));
