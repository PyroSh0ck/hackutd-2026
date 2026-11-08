import type { ActorInstruction, Candidate, PlannerInput } from "@/contracts/planner";
import { ACTOR_JSON_ONLY } from "@/server/actor/prompts";
import type { StructuredModel, StructuredRequest, StructuredResult } from "@/server/observer/model";

/**
 * TEST-ONLY deterministic planner and actor (selected only when E2E_TEST=1 AND OBSERVER_MODEL_MODE=fixture).
 * They prove wiring and boundaries over HTTP/E2E, not model quality; real behavior is measured by
 * `pnpm planner:eval`. Failure hooks: a user message containing "[[planner-fail]]" makes every planner
 * call time out; "[[planner-fail-once]]" fails only the first processing attempt for that message;
 * "[[slow]]" holds the planner call for SLOW_FIXTURE_MS (to exercise stop-while-generating).
 */

const payload = (request: StructuredRequest) => {
  const user = request.user.endsWith(ACTOR_JSON_ONLY) ? request.user.slice(0, -ACTOR_JSON_ONLY.length) : request.user;
  return JSON.parse(user.slice(user.indexOf("\n") + 1));
};
const PRIORITY: Candidate["moveId"][] = ["answer_identity", "answer_procedure", "answer_scenario_fact", "address_doubt", "back_off_doubt", "clarify_condition", "clarify_decision", "clarify_claimed_check", "acknowledge_refusal", "present_code_request", "continue_premise"];
const failedOnce = new Set<string>();

/** Test-only hold for "[[slow]]" inputs. */
export const SLOW_FIXTURE_MS = 4000;

export class FixturePlannerModel implements StructuredModel {
  constructor(readonly modelId = "fixture-planner") {}
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    const body = payload(request);
    const input = (request.stage === "planner_repair" ? body.originalInput : body) as Omit<PlannerInput, "observer" | "relevantMessages"> & {
      conversationUntrustedData: Array<{ id: string; role: string; content: string }>;
    };
    const latest = [...input.conversationUntrustedData].reverse().find((m) => m.role === "user");
    if (latest?.content.includes("[[slow]]")) await new Promise((r) => setTimeout(r, SLOW_FIXTURE_MS));
    if (latest?.content.includes("[[planner-fail]]")) return { ok: false, failure: "timeout", detail: "fixture timeout" };
    if (latest?.content.includes("[[planner-fail-once]]") && !failedOnce.has(latest.id)) {
      failedOnce.add(latest.id);
      return { ok: false, failure: "timeout", detail: "fixture timeout (once)" };
    }
    const candidate = [...input.candidates].sort((a, b) => PRIORITY.indexOf(a.moveId) - PRIORITY.indexOf(b.moveId))[0];
    const refs = candidate.evidenceRefs.filter((r) => r.kind !== "assessment").slice(0, 2);
    return {
      ok: true,
      output: {
        candidateId: candidate.id,
        basedOnRevision: input.basedOnRevision,
        selectedFactIds: candidate.constraints.allowedFactIds.slice(0, 2),
        selectedAdditionIds: candidate.moveId === "answer_identity" ? candidate.constraints.allowedAdditionIds : [],
        style: candidate.constraints.allowedStyles[0],
        contentFocus: `Address the target of ${candidate.moveId} using only the selected facts.`,
        evidenceRefs: refs.length ? refs : candidate.evidenceRefs.slice(0, 1),
        briefJustification: "Highest-priority supplied candidate.",
      },
    };
  }
}

const TEXT: Record<Candidate["moveId"], (i: ActorInstruction) => string> = {
  answer_identity: (i) => `I'm Avery with Cedar Account Support${i.additions.some((a) => a.id === "team_label") ? ", on the Account Review team" : ""}. I'm reaching out about the security check on your mobile line ending 0142.`,
  answer_procedure: () => "The check relies on a six-digit code that was texted to your phone. It only takes about a minute.",
  answer_scenario_fact: (i) => (i.focusCode === "acknowledge_unknown" ? "I don't have that information available." : "This is about the account security check on your mobile line ending 0142."),
  clarify_decision: () => "Could you tell me what you'd like to do about the request?",
  clarify_condition: () => "Could you tell me what you need to happen first?",
  clarify_claimed_check: () => "What did you check, and what did it show?",
  continue_premise: () => "I'm following up on the security check for your mobile line ending 0142.",
  present_code_request: () => "To finish the security check, please share the six-digit code we texted to your phone.",
  address_doubt: () => "I understand the doubt. I can only tell you I'm Avery from Cedar Account Support.",
  back_off_doubt: () => "I understand that my answer hasn't settled your concern. I'll leave it there.",
  acknowledge_refusal: (i) => i.target.requestId ? "Understood. I won't ask you for it again." : "Understood. I'll leave it there.",
};

const ALT: Partial<Record<Candidate["moveId"], string>> = {
  acknowledge_refusal: "Okay. I won't bring the code up again.",
  answer_identity: "As I said, I'm Avery from Cedar Account Support, and this is about the security check on your account.",
  address_doubt: "That's a fair concern. All I can say is that I'm Avery from Cedar Account Support.",
  continue_premise: "This is still about the security check on your mobile line ending 0142.",
};

/** Reads the actor v2 payload: `ActorInput` (initial) or `{ originalInput }` (repair). */
export class FixtureActorModel implements StructuredModel {
  constructor(readonly modelId = "fixture-actor") {}
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    const body = payload(request);
    const actorInput = (request.stage === "actor_repair" ? body.originalInput : body) as { instruction: ActorInstruction; recentActorMessages?: Array<{ text: string }> };
    const instruction = actorInput.instruction;
    const first = TEXT[instruction.moveId](instruction);
    // Like a live model, never send the exact same line twice in a row of recent replies (the validator
    // rejects exact repeats of longer replies): fall back to the move's alternate wording.
    const text = actorInput.recentActorMessages?.some((m) => m.text === first) && ALT[instruction.moveId] ? ALT[instruction.moveId]! : first;
    return {
      ok: true,
      output: {
        text,
        usedFactIds: instruction.facts.map((f) => f.id),
        // Only additions used here for the first time are declared (already introduced ones are reused).
        introducedAdditionIds: instruction.additions.filter((a) => !a.introduced && text.includes(a.text)).map((a) => a.id),
      },
    };
  }
}
