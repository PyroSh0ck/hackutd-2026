import { DeveloperLogResponseSchema } from "@/contracts/game";
import { gameService, parseSessionId } from "@/server/game/runtime";
import { playerRoute } from "@/server/http/route";

/** Developer evidence: actual tool calls, validation results, and event ids. No prompts or secrets. */
export const GET = playerRoute<{ id: string }>("/api/game/sessions/[id]/developer", "Could not load the developer log.", async ({ playerKey, params }) => {
  const log = await gameService().developerLog(playerKey, parseSessionId(params.id));
  return { status: 200, body: DeveloperLogResponseSchema.parse(log) };
});
