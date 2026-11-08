import type { ActorInstruction, Candidate, MoveId, Plan, PlannerInput } from "@/contracts/planner";

/**
 * Actor instruction builder (planner brief §7). Every binding field (action, move, target, tool intent,
 * constraints) comes from the server candidate; the plan contributes only the facts and additions it
 * selected (already validated as subsets), the style and an advisory focus. Generation, validation and the
 * commit boundary are actor v2 (src/server/actor); the earlier actor path was removed so both never run.
 */

const TARGET_TEXT: Record<MoveId, string> = {
  answer_identity: "Answer who is contacting the user and why, using only the sender's established claims; if they also ask what you want, give the stated reason for contact from the supplied facts. Do not call them verified proof.",
  answer_procedure: "Answer, in character, what the sender needs or how the check works, using only the supplied facts. Do not urge the user to act and do not mention the app or its controls.",
  answer_scenario_fact: "Answer the user's question about the scenario using only the supplied facts.",
  clarify_decision: "Ask the user one short question to clarify what they mean about the request.",
  clarify_condition: "Ask the user one short question to clarify the condition they stated.",
  clarify_claimed_check: "Ask the user one short question about what they checked and what it showed. Do not challenge or contradict their evidence.",
  continue_premise: "Reply to what the user just said, in a few words, then continue the security-check premise. Do not add a threat or a new request and do not repeat your introduction.",
  present_code_request: "In character, ask for the six-digit code to finish the security check. The app shows the user its own request card with your message; never mention the card or the app.",
  address_doubt: "Acknowledge the user's specific doubt in your own words first, then respond briefly, without fabricating corroboration or proof. Do not restate your name or introduction; they already have it.",
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
  // The stored request description is app-card copy; the character only knows what it asked for.
  if (request) parts.push("Pending request: the six-digit code the sender asked for (the app shows the user its own card for it).");
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
