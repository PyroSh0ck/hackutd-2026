import { TraceResponseSchema } from "@/contracts/trace";
import { NotFoundError } from "@/server/http/errors";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { sharedTrace, traceEnabled } from "@/server/observer/trace";
import { playerRoute } from "@/server/http/route";

/** Agent lab trace for the owner's session. Development or AGENT_DEBUG=1 only; otherwise not found. */
export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]/trace", "Could not load the trace.", async ({ playerKey, params }) => {
  if (!traceEnabled()) throw new NotFoundError("Trace");
  const sessionId = parseObserverSessionId(params.id);
  await observerService().getSession(playerKey, sessionId); // ownership check (404 otherwise)
  return { status: 200, body: TraceResponseSchema.parse({ entries: sharedTrace().entries(sessionId) }) };
});
