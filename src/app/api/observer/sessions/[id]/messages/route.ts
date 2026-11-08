import { ObserverSessionResponseSchema, SubmitMessageRequestSchema } from "@/contracts/observer";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { parseInput, playerRoute, readJson } from "@/server/http/route";

/** Record a user message, then assess it (models run outside any transaction) before responding. */
export const POST = playerRoute<{ id: string }>("/api/observer/sessions/[id]/messages", "Could not record that message.", async ({ request, playerKey, params }) => {
  const sessionId = parseObserverSessionId(params.id);
  const input = parseInput(SubmitMessageRequestSchema, await readJson(request));
  return { status: 200, body: ObserverSessionResponseSchema.parse(await observerService().submitMessage(playerKey, sessionId, input)) };
});
