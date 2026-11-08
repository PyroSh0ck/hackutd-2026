import { HistoryQuerySchema, HistoryResponseSchema } from "@/contracts/history";
import { ObserverSessionResponseSchema } from "@/contracts/observer";
import { observerService } from "@/server/observer/runtime";
import { parseQuery, playerRoute } from "@/server/http/route";

/** Start a fictional practice conversation. Owner comes from the signed player cookie. */
export const POST = playerRoute("/api/observer/sessions", "Could not start the practice conversation.", async ({ playerKey }) => ({
  status: 201,
  body: ObserverSessionResponseSchema.parse(await observerService().createSession(playerKey)),
}));

/** The owner's practice history from the authoritative backend (newest first; opaque cursor). */
export const GET = playerRoute("/api/observer/sessions", "Could not load your practice history.", async ({ playerKey, request }) => {
  const { limit, cursor } = parseQuery(HistoryQuerySchema, request);
  return { status: 200, body: HistoryResponseSchema.parse(await observerService().history(playerKey, limit, cursor)) };
});
