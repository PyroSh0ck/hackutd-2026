import type { ActorInstruction, Candidate, MoveId, Plan, PlannerInput } from "@/contracts/planner";

/**
 * Actor instruction builder (planner brief §7). Every binding field (action, move, target, tool intent,
 * constraints) comes from the server candidate; the plan contributes only the facts and additions it
 * selected (already validated as subsets), the style and an advisory focus. Generation, validation and the
 * commit boundary are actor v2 (src/server/actor); the earlier actor path was removed so both never run.
 */

const TARGET_TEXT: Record<MoveId, string> = {
  answer_identity: "Answer who is contacting the user and why using the established claims. If identity is already known and the user challenges proof, address what can establish identity: this message alone cannot prove it. Repeating a name or purpose is not proof. Do not invent corroboration.",
  answer_procedure: "Answer what the sender needs or the next step directly, in first person, using the supplied scenario facts. Explain the actual step, not just the time it takes. Do not claim a message was actually sent or invent delivery events. Do not mention the app or its controls.",
  answer_scenario_fact: "Answer the user's question about the scenario using only the supplied facts.",
  clarify_decision: "Ask the user one short question to clarify what they mean about the request.",
  clarify_condition: "Ask the user one short question to clarify the condition they stated.",
  clarify_claimed_check: "Ask the user one short question about what they checked and what it showed. Do not challenge or contradict their evidence.",
  continue_premise: "Reply to what the user just said, in a few words, then continue the security-check premise. Do not add a threat or a new request and do not repeat your introduction.",
  present_code_request: "In character, ask for the six-digit code to finish the security check. The app shows the user its own request card with your message; never mention the card or the app.",
  address_doubt: "Respond to the specific objection directly. If asked for proof, acknowledge that this message alone cannot establish identity; the user can independently check through an official channel they find themselves. Do not supply a destination or imply the check happened. The supplied claims are not proof. Do not repeat the name, security-check premise, or generic empathy as an answer. Do not invent corroboration.",
  back_off_doubt: "You already told the user this message cannot prove your identity. Acknowledge that this has not changed, then back off. Do not repeat the previous wording, reassert your identity, ask for a code, or claim verification happened. Leave independent verification to the user without supplying a destination.",
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
  if (candidate.moveId === "acknowledge_refusal" && !candidate.requestId) parts.push("The user declined your invitation to talk. Acknowledge that and back off; do not imply a code request was already made.");
  // The stored request description is app-card copy; the character only knows what it asked for.
  if (request) parts.push("Pending request: the six-digit code the sender asked for (the app shows the user its own card for it).");
  // The code requirement is essential context for explaining this procedure. A planner that selects
  // only the duration otherwise leaves the actor unable to answer what is needed. This stays inside
  // the authoritative candidate's fact permissions and creates no request or completed action.
  const requiredCodeFact = (candidate.moveId === "answer_procedure" || candidate.moveId === "present_code_request") && candidate.constraints.allowedFactIds.includes("F04");
  if (requiredCodeFact && candidate.moveId === "answer_procedure") parts.push("Explain the six-digit-code requirement; if the request is pending, sharing that code is the requested next step.");
  return {
    planId,
    basedOnRevision: plan.basedOnRevision,
    action: candidate.action,
    moveId: candidate.moveId,
    target: { requestId: candidate.requestId, issueId: candidate.issueId, description: parts.join(" ").slice(0, 600) },
    facts: input.facts.filter((f) => plan.selectedFactIds.includes(f.id) || (requiredCodeFact && f.id === "F04")),
    additions: input.additions.filter((a) => plan.selectedAdditionIds.includes(a.id)),
    style: plan.style,
    contentFocus: plan.contentFocus,
    focusCode: candidate.focusCode,
    constraints: candidate.constraints,
    toolIntent: candidate.toolIntent,
  };
}
