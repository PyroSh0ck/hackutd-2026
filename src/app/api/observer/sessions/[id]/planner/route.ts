import { NotFoundError } from "@/server/http/errors";
import { traceEnabled } from "@/server/observer/trace";
import { PlannerResponseSchema } from "@/contracts/planner";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** Planner handoff + current deterministic eligibility. Never includes the official result or practice code. */
export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]/planner", "Could not load planner observations.", async ({ playerKey, params }) => {
  // Raw audit records can contain private exercise truth: development / AGENT_DEBUG=1 only.
  if (!traceEnabled()) throw new NotFoundError("Audit records");
  return {
  status: 200,
  body: PlannerResponseSchema.parse(await observerService().planner(playerKey, parseObserverSessionId(params.id))),
  };
});
