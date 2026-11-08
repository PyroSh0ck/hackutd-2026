import { ObserverSessionResponseSchema } from "@/contracts/observer";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]", "Could not load the conversation.", async ({ playerKey, params }) => ({
  status: 200,
  body: ObserverSessionResponseSchema.parse(await observerService().getSession(playerKey, parseObserverSessionId(params.id))),
}));
