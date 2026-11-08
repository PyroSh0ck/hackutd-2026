import { ObserverSessionResponseSchema } from "@/contracts/observer";
import { observerService } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** Start a fictional practice conversation. Owner comes from the signed player cookie. */
export const POST = playerRoute("/api/observer/sessions", "Could not start the practice conversation.", async ({ playerKey }) => ({
  status: 201,
  body: ObserverSessionResponseSchema.parse(await observerService().createSession(playerKey)),
}));
