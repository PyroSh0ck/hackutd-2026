import { ObserverSessionResponseSchema, SubmitEventRequestSchema } from "@/contracts/observer";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { parseInput, playerRoute, readJson } from "@/server/http/route";

/** Record an in-app action. The server validates applicability; no model is involved. */
export const POST = playerRoute<{ id: string }>("/api/observer/sessions/[id]/events", "Could not record that action.", async ({ request, playerKey, params }) => {
  const sessionId = parseObserverSessionId(params.id);
  const input = parseInput(SubmitEventRequestSchema, await readJson(request));
  return { status: 200, body: ObserverSessionResponseSchema.parse(await observerService().submitEvent(playerKey, sessionId, input)) };
});
