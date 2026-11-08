import { ForkRequestSchema, SessionResponseSchema } from "@/contracts/game";
import { gameService, parseSessionId } from "@/server/game/runtime";
import { parseInput, playerRoute, readJson } from "@/server/http/route";

/** Retry from the predefined checkpoint: creates a NEW session; the original run is never modified. */
export const POST = playerRoute<{ id: string }>("/api/game/sessions/[id]/fork", "Could not start the retry.", async ({ request, playerKey, params }) => {
  const sessionId = parseSessionId(params.id);
  const input = parseInput(ForkRequestSchema, await readJson(request));
  const session = await gameService().fork(playerKey, sessionId, input);
  return { status: 201, body: SessionResponseSchema.parse({ session }) };
});
