import type { ActorInstruction, ActorOutput, PlanRecord } from "@/contracts/planner";
import type { Snapshot, MessageRow } from "@/server/observer/store/types";
import { FACTS } from "@/server/planner/scenario";
import { buildActorInput } from "@/server/actor/input";
import type { ActorEnvelope } from "@/server/actor/schemas";

export const timestamp = "2026-11-07T19:00:00.000Z";
export const message = (n: number, content = `Message ${n}`, role: "user" | "assistant" = "user"): MessageRow => ({ id: `m${n}`, sessionId: "session", turn: n, revision: n, role, content, createdAt: timestamp });
export function instruction(overrides: Partial<ActorInstruction> = {}): ActorInstruction {
  return {
    planId: "plan", basedOnRevision: 20, action: "answer_question", moveId: "answer_procedure",
    target: { issueId: null, requestId: null, description: "Explain independent verification." },
    facts: [FACTS[4]], additions: [], style: "concise_professional", contentFocus: "Answer the question.", focusCode: "answer_target",
    constraints: { maxWords: 70, maxQuestions: 1, allowedStyles: ["concise_professional", "plain_explanatory"], allowedFactIds: ["F01", "F02", "F03", "F04", "F05"], allowedAdditionIds: ["case_reference", "team_label"], forbiddenClaimCodes: ["invented_user_action", "real_contact_destination", "new_request_type"] },
    toolIntent: "none", ...overrides,
  };
}
export function snapshot(): Snapshot {
  return {
    session: { id: "session", ownerKey: "owner", threadId: "thread", scenarioId: "mobile-code-01", scenarioVersion: 1, revision: 20, conversationRevision: 1, turn: 1, ended: false, stage: "active", outcome: null, practiceCode: "938201", caseReference: "CD-123456", claim: { id: "claim", expiresAt: "2026-11-07T20:00:00.000Z" }, createdAt: timestamp },
    messages: [message(1, "How can I check independently?")], requests: [], events: [], assessments: [], issues: [],
    additions: [{ id: "case_reference", text: "CD-123456", introducedMessageId: null }, { id: "team_label", text: "Account Review", introducedMessageId: null }], plans: [],
  };
}
export const input = (i = instruction(), s = snapshot()) => buildActorInput({ snapshot: s, instruction: i, currentUserMessageId: "m1", evidenceMessageIds: [], controls: [{ id: "verify_independently", label: "Verify independently" }, { id: "end_practice", label: "End practice" }] });
export const output = (text = "The check only takes about a minute."): ActorOutput => ({ text, usedFactIds: ["F05"], introducedAdditionIds: [] });
export const envelope = (): ActorEnvelope => ({ sessionId: "session", inputEventId: "m1", processingAttemptId: "attempt", processingAttempt: 1, planId: "plan", basedOnRevision: 20, policyVersion: "policy-v1", actorPromptVersion: "actor-prompt-v3", modelId: "fixture", claimId: "claim", ownerKey: "owner" });
export const committedPlan = (id: string): PlanRecord => ({
  id: `plan-${id}`, sessionId: "session", inputId: `event-${id}`, inputKind: "event", attempt: 1, basedOnRevision: 1, policyVersion: "policy-v1", scenarioVersion: 1, ruleId: "fixture", candidateSnapshot: [], proposedPlan: null, acceptedPlan: null, validationAttempts: [], repairAttempted: false, actorInstruction: null, actorOutput: output(), actorValidationAttempts: [], actorRepairAttempted: false, attempts: [], status: "committed", failureReason: null, committedMessageId: id, modelId: "fixture", actorModelId: "fixture", createdAt: timestamp,
});
