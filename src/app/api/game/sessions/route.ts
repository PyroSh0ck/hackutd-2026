import { CreateSessionRequestSchema, SessionResponseSchema } from "@/contracts/game";
import { InvalidJsonError } from "@/server/http/errors";
import { gameService } from "@/server/game/runtime";
import { parseInput, playerRoute } from "@/server/http/route";

/** Start (or restart) an encounter: a fresh session from the immutable scenario fixture. Body optional. */
export const POST = playerRoute("/api/game/sessions", "Could not start the game.", async ({ request, playerKey }) => {
  const text = await request.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new InvalidJsonError();
    }
  }
  const session = await gameService().createSession(playerKey, parseInput(CreateSessionRequestSchema, raw));
  return { status: 201, body: SessionResponseSchema.parse({ session }) };
});
