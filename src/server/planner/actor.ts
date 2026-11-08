import type { ActorInstruction, Candidate, MoveId, Plan, PlannerInput } from "@/contracts/planner";

/**
 * Actor instruction builder (planner brief §7). Every binding field (action, move, target, tool intent,
 * constraints) comes from the server candidate; the plan contributes only the facts and additions it
 * selected (already validated as subsets), the style and an advisory focus. Generation, validation and the
 * commit boundary are actor v2 (src/server/actor); the earlier actor path was removed so both never run.
 */

const TARGET_TEXT: Record<MoveId, string> = {
  answer_identity: "Answer the user's question about who is contacting them, using only the sender's established claims. Do not call them verified proof.",
  answer_procedure: "Explain the relevant simulated controls (the request card and the Verify independently control).",
  answer_scenario_fact: "Answer the user's question about the scenario using only the supplied facts.",
  clarify_decision: "Ask the user one short question to clarify what they mean about the request.",
  clarify_condition: "Ask the user one short question to clarify the condition they stated.",
  clarify_claimed_check: "Ask the user one short question about what they checked and what it showed. Do not challenge or contradict their evidence.",
  continue_premise: "Continue the existing security-check premise without adding a threat or a new request.",
  present_code_request: "Present the simulator's practice-code request card; it is shown with your message.",
  address_doubt: "Respond to the user's stated doubt about the sender without fabricating corroboration or proof.",
  acknowledge_refusal: "Acknowledge the user's boundary. Do not repeat or re-present the request.",
};

const FOCUS_OVERRIDE: Partial<Record<Candidate["focusCode"], string>> = {
  acknowledge_unknown: "Acknowledge that this information is not available; do not supply or guess it.",
};

export function buildActorInstruction(planId: string, plan: Plan, candidate: Candidate, input: PlannerInput): ActorInstruction {
  const issue = candidate.issueId ? input.observer.issues.find((i) => i.id === candidate.issueId) : undefined;
  const request = candidate.requestId && input.observer.request?.id === candidate.requestId ? input.observer.request : null;
  const parts = [FOCUS_OVERRIDE[candidate.focusCode] ?? TARGET_TEXT[candidate.moveId]];
  if (issue) parts.push(`Observer summary of the user's issue (an interpretation): ${issue.summary}`);
  if (request) parts.push(`Request: ${request.description}`);
  return {
    planId,
    basedOnRevision: plan.basedOnRevision,
    action: candidate.action,
    moveId: candidate.moveId,
    target: { requestId: candidate.requestId, issueId: candidate.issueId, description: parts.join(" ").slice(0, 600) },
    facts: input.facts.filter((f) => plan.selectedFactIds.includes(f.id)),
    additions: input.additions.filter((a) => plan.selectedAdditionIds.includes(a.id)),
    style: plan.style,
    contentFocus: plan.contentFocus,
    focusCode: candidate.focusCode,
    constraints: candidate.constraints,
    toolIntent: candidate.toolIntent,
  };
}
