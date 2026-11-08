import { PLAN_LIMITS, PlannerInputSchema, type Candidate, type PlannerInput } from "@/contracts/planner";
import { plannerObservation, recentPlans } from "@/server/observer/planner-input";
import { publicMessage } from "@/server/observer/state";
import type { Snapshot } from "@/server/observer/store/types";
import type { PlanningContext } from "./context";
import { POLICY_VERSION } from "./eligibility";
import { FACTS, scenarioById } from "./scenario";

/**
 * Planner payload assembly (planner brief §5, §10). Includes the last six messages plus every message cited
 * by current evidence; excluded history stays persisted and is not permission to invent facts. Never
 * includes the official verification result (F06), the practice code, owner identity, or other sessions.
 */
export function buildPlannerInput(s: Snapshot, ctx: PlanningContext, candidates: Candidate[], maxUserTurns: number): PlannerInput {
  const observer = plannerObservation(s, maxUserTurns);
  if (!observer) throw new Error("Planner input requires an applied assessment.");
  const cited = new Set(observer.supportingMessages.map((m) => m.id));
  const recent = new Set(s.messages.slice(-PLAN_LIMITS.relevantMessages).map((m) => m.id));
  const relevantMessages = s.messages.filter((m) => recent.has(m.id) || cited.has(m.id)).map(publicMessage);
  // Contracts bound user messages to 1,000 and assistant messages to 2,000 characters, below the 4,000
  // ingestion bound, so no quoted evidence message is ever truncated.
  if (relevantMessages.some((m) => m.content.length > PLAN_LIMITS.messageChars)) throw new Error("Message exceeds the ingestion bound.");
  return PlannerInputSchema.parse({
    sessionId: s.session.id,
    scenarioId: s.session.scenarioId as PlannerInput["scenarioId"],
    scenarioVersion: s.session.scenarioVersion,
    basedOnRevision: s.session.revision,
    policyVersion: POLICY_VERSION,
    observer,
    relevantMessages,
    candidates,
    facts: [...(scenarioById(s.session.scenarioId, s.session.scenarioVersion)?.facts ?? FACTS)],
    additions: ctx.additions,
    recentPlans: recentPlans(s.plans),
    remainingTurns: Math.max(0, maxUserTurns - ctx.userTurns),
  });
}
