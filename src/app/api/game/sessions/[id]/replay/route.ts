import { ReplayResponseSchema } from "@/contracts/game";
import { gameService, parseSessionId } from "@/server/game/runtime";
import { playerRoute } from "@/server/http/route";

export const GET = playerRoute<{ id: string }>("/api/game/sessions/[id]/replay", "Could not load the replay.", async ({ playerKey, params }) => {
  const replay = await gameService().replay(playerKey, parseSessionId(params.id));
  return { status: 200, body: ReplayResponseSchema.parse(replay) };
});
