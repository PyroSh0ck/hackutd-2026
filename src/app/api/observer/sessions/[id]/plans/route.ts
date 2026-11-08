import { PlansResponseSchema } from "@/contracts/planner";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** Planner/actor audit records (prepared, committed, rejected, stale, failed). Invalid drafts are never stored. */
export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]/plans", "Could not load plan records.", async ({ playerKey, params }) => ({
  status: 200,
  body: PlansResponseSchema.parse({ plans: await observerService().plans(playerKey, parseObserverSessionId(params.id)) }),
}));
