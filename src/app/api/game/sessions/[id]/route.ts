import { SessionResponseSchema } from "@/contracts/game";
import { gameService, parseSessionId } from "@/server/game/runtime";
import { playerRoute } from "@/server/http/route";

export const GET = playerRoute<{ id: string }>("/api/game/sessions/[id]", "Could not load the game.", async ({ playerKey, params }) => {
  const session = await gameService().getSession(playerKey, parseSessionId(params.id));
  return { status: 200, body: SessionResponseSchema.parse({ session }) };
});
