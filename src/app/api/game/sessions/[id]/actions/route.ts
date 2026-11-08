import { ActionResponseSchema, SubmitActionRequestSchema } from "@/contracts/game";
import { gameService, parseSessionId } from "@/server/game/runtime";
import { parseInput, playerRoute, readJson } from "@/server/http/route";

/** Submit one player action. If it triggers an opponent turn, the turn completes before responding. */
export const POST = playerRoute<{ id: string }>("/api/game/sessions/[id]/actions", "Could not apply that action.", async ({ request, playerKey, params }) => {
  const sessionId = parseSessionId(params.id);
  const input = parseInput(SubmitActionRequestSchema, await readJson(request));
  const response = await gameService().submitAction(playerKey, sessionId, input);
  return { status: 200, body: ActionResponseSchema.parse(response) };
});
