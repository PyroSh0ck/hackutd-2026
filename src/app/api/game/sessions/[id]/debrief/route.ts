import { DebriefResponseSchema } from "@/contracts/game";
import { gameService, parseSessionId } from "@/server/game/runtime";
import { playerRoute } from "@/server/http/route";

export const GET = playerRoute<{ id: string }>("/api/game/sessions/[id]/debrief", "Could not load the debrief.", async ({ playerKey, params }) => {
  const debrief = await gameService().debrief(playerKey, parseSessionId(params.id));
  return { status: 200, body: DebriefResponseSchema.parse(debrief) };
});
