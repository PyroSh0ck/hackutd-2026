import { AssessmentsResponseSchema } from "@/contracts/observer";
import { observerService, parseObserverSessionId } from "@/server/observer/runtime";
import { playerRoute } from "@/server/http/route";

/** Audit trail: every pipeline run (applied and stale) with attempts and validation history. No prompts. */
export const GET = playerRoute<{ id: string }>("/api/observer/sessions/[id]/assessments", "Could not load assessments.", async ({ playerKey, params }) => ({
  status: 200,
  body: AssessmentsResponseSchema.parse({ assessments: await observerService().assessments(playerKey, parseObserverSessionId(params.id)) }),
}));
