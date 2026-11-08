import { ExplainResponseSchema } from "@/contracts/explain";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** "How this session worked": owner-scoped, ended sessions only; decision summaries, never reasoning. */
export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]/explain", "Could not load the session summary.", async ({ playerKey, params }) => ({
  status: 200,
  body: ExplainResponseSchema.parse(await observerService().explain(playerKey, parseObserverSessionId(params.id))),
}));
