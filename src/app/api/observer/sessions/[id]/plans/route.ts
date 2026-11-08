import { NotFoundError } from "@/server/http/errors";
import { traceEnabled } from "@/server/observer/trace";
import { PlansResponseSchema } from "@/contracts/planner";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** Planner/actor audit records (prepared, committed, rejected, stale, failed). Invalid drafts are never stored. */
export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]/plans", "Could not load plan records.", async ({ playerKey, params }) => {
  // Raw audit records can contain private exercise truth: development / AGENT_DEBUG=1 only.
  if (!traceEnabled()) throw new NotFoundError("Audit records");
  return {
  status: 200,
  body: PlansResponseSchema.parse({ plans: await observerService().plans(playerKey, parseObserverSessionId(params.id)) }),
  };
});
