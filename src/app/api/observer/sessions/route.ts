import { CreateSessionRequestSchema, HistoryQuerySchema, HistoryResponseSchema } from "@/contracts/history";
import { HttpError, InvalidJsonError } from "@/server/http/errors";
import { ObserverSessionResponseSchema } from "@/contracts/observer";
import { observerService } from "@/server/observer/runtime";
import { parseInput, parseQuery, playerRoute } from "@/server/http/route";

/** Explicit scenario choice: test server or an operator-enabled admin flag only (never a player control). */
const scenarioSelectionAllowed = () => process.env.E2E_TEST === "1" || process.env.PRACTICE_ALLOW_SCENARIO_SELECTION === "1";

/** Start a fictional practice conversation. Owner comes from the signed player cookie. */
export const POST = playerRoute("/api/observer/sessions", "Could not start the practice conversation.", async ({ playerKey, request }) => {
  const raw = await request.text();
  let json: unknown = {};
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      throw new InvalidJsonError();
    }
  }
  const body = parseInput(CreateSessionRequestSchema, json);
  if (body.scenarioId && !scenarioSelectionAllowed()) throw new HttpError(403, "FORBIDDEN", "Scenario selection is not available.");
  return { status: 201, body: ObserverSessionResponseSchema.parse(await observerService().createSession(playerKey, body)) };
});

/** The owner's practice history from the authoritative backend (newest first; opaque cursor). */
export const GET = playerRoute("/api/observer/sessions", "Could not load your practice history.", async ({ playerKey, request }) => {
  const { limit, cursor } = parseQuery(HistoryQuerySchema, request);
  return { status: 200, body: HistoryResponseSchema.parse(await observerService().history(playerKey, limit, cursor)) };
});
