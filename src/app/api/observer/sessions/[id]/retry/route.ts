import { after } from "next/server";
import { ObserverSessionResponseSchema, RetryRequestSchema } from "@/contracts/observer";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { parseInput, playerRoute, readJson } from "@/server/http/route";

/**
 * One retry of a failed planning attempt for the same input. A second failure ends the session. With
 * `respond: "after_save"` the retry is recorded first and the reply is generated after the response.
 */
export const POST = playerRoute<{ id: string }>("/api/observer/sessions/[id]/retry", "Could not retry.", async ({ request, playerKey, params }) => {
  const sessionId = parseObserverSessionId(params.id);
  const input = parseInput(RetryRequestSchema, await readJson(request));
  const defer = input.respond === "after_save" ? (work: () => Promise<unknown>) => after(work) : undefined;
  return { status: 200, body: ObserverSessionResponseSchema.parse(await observerService().retry(playerKey, sessionId, input, defer)) };
});
