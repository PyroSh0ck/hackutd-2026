import { ProgressResponseSchema } from "@/contracts/history";
import { observerService } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** Owner counts and recorded-action observations (not a skill score), from the authoritative backend. */
export const GET = playerRoute("/api/observer/progress", "Could not load your progress.", async ({ playerKey }) => ({
  status: 200,
  body: ProgressResponseSchema.parse(await observerService().progress(playerKey)),
}));
