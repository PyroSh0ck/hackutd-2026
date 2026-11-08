import { AccountResponseSchema } from "@/contracts/history";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** The simulated account for this session (owner-scoped). Notice summaries appear only once opened. */
export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]/account", "Could not load the account.", async ({ playerKey, params }) => ({
  status: 200,
  body: AccountResponseSchema.parse(await observerService().account(playerKey, parseObserverSessionId(params.id))),
}));
