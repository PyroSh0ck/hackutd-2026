import type { ActorInstruction, Candidate, PlannerInput } from "@/contracts/planner";
import type { StructuredModel, StructuredRequest, StructuredResult } from "@/server/observer/model";

/**
 * TEST-ONLY deterministic planner and actor (selected only when E2E_TEST=1 AND OBSERVER_MODEL_MODE=fixture).
 * They prove wiring and boundaries over HTTP/E2E, not model quality; real behavior is measured by
 * `pnpm planner:eval`. Failure hooks: a user message containing "[[planner-fail]]" makes every planner
 * call time out; "[[planner-fail-once]]" fails only the first processing attempt for that message;
 * "[[slow]]" holds the planner call for SLOW_FIXTURE_MS (to exercise stop-while-generating).
 */

const payload = (request: StructuredRequest) => JSON.parse(request.user.slice(request.user.indexOf("\n") + 1));
const PRIORITY: Candidate["moveId"][] = ["answer_identity", "answer_procedure", "answer_scenario_fact", "address_doubt", "clarify_condition", "clarify_decision", "clarify_claimed_check", "acknowledge_refusal", "present_code_request", "continue_premise"];
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
  answer_identity: (i) => `I'm Avery with Cedar Account Support${i.additions.some((a) => a.id === "team_label") ? ", on the Account Review team" : ""}. I'm reaching out about the security check on your practice line ending 0142.`,
  answer_procedure: () => "The simulator shows a request card for the practice code, and you can use the Verify independently control in the app at any time.",
  answer_scenario_fact: (i) => (i.focusCode === "acknowledge_unknown" ? "I don't have that information available." : "This is about the account security check on your practice line ending 0142."),
  clarify_decision: () => "Could you tell me what you'd like to do about the request?",
  clarify_condition: () => "Could you tell me what you need to happen first?",
  clarify_claimed_check: () => "What did you check, and what did it show?",
  continue_premise: () => "I'm following up on the security check for your practice line ending 0142.",
  present_code_request: () => "To finish the security check, please use the request card to share the practice code.",
  address_doubt: () => "I understand the doubt. I can only tell you I'm Avery from Cedar Account Support.",
  acknowledge_refusal: () => "Understood. I won't ask you for it again.",
};

/** Reads the actor v2 payload: `ActorInput` (initial) or `{ originalInput }` (repair). */
export class FixtureActorModel implements StructuredModel {
  constructor(readonly modelId = "fixture-actor") {}
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    const body = payload(request);
    const instruction = ((request.stage === "actor_repair" ? body.originalInput : body) as { instruction: ActorInstruction }).instruction;
    const text = TEXT[instruction.moveId](instruction);
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
