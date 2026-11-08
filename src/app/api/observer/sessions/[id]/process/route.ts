import { ObserverSessionResponseSchema } from "@/contracts/observer";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** Resume pending assessment (e.g. after a crash or a "queued" response). Idempotent. */
export const POST = playerRoute<{ id: string }>("/api/observer/sessions/[id]/process", "Could not process the conversation.", async ({ playerKey, params }) => ({
  status: 200,
  body: ObserverSessionResponseSchema.parse(await observerService().process(playerKey, parseObserverSessionId(params.id))),
}));
