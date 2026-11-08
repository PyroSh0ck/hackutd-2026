import { after } from "next/server";
import { ObserverSessionResponseSchema, SubmitMessageRequestSchema } from "@/contracts/observer";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { parseInput, playerRoute, readJson } from "@/server/http/route";

/**
 * Record a user message, then assess it and generate the reply (models run outside any transaction).
 * `respond: "after_save"` answers as soon as the message is durable and runs the same processing after the
 * response; the client follows `session.turnStatus`. The default waits for the reply.
 */
export const POST = playerRoute<{ id: string }>("/api/observer/sessions/[id]/messages", "Could not record that message.", async ({ request, playerKey, params }) => {
  const sessionId = parseObserverSessionId(params.id);
  const input = parseInput(SubmitMessageRequestSchema, await readJson(request));
  const defer = input.respond === "after_save" ? (work: () => Promise<unknown>) => after(work) : undefined;
  return { status: 200, body: ObserverSessionResponseSchema.parse(await observerService().submitMessage(playerKey, sessionId, input, defer)) };
});
