import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorInstruction, Plan, PlannerInput, PlanRecord } from "@/contracts/planner";
import { assembleActor, evidenceMessageIds, executionState, planApplicable, UI_CONTROLS } from "@/server/actor/controller";
import { actorUserPrompt } from "@/server/actor/prompts";
import type { Snapshot } from "@/server/observer/store/types";
import { buildActorInstruction } from "@/server/planner/actor";
import { emptyRecord } from "@/server/planner/run";
import { MAX_USER_TURNS, OFFICIAL_RESULT, TEAM_LABEL } from "@/server/planner/scenario";
import { plannerInputAfter } from "./session-fixture";

function planFor(input: PlannerInput, moveIndex = 0, over: Partial<Plan> = {}): Plan {
  const c = input.candidates[moveIndex];
  return { candidateId: c.id, basedOnRevision: input.basedOnRevision, selectedFactIds: c.constraints.allowedFactIds, selectedAdditionIds: c.constraints.allowedAdditionIds, style: c.constraints.allowedStyles[0], contentFocus: "Answer directly.", evidenceRefs: c.evidenceRefs.filter((r) => r.kind === "message").slice(0, 1), briefJustification: "j", ...over };
}
const instructionFor = (input: PlannerInput, moveIndex = 0, over: Partial<Plan> = {}): ActorInstruction => buildActorInstruction("plan-1", planFor(input, moveIndex, over), input.candidates[moveIndex], input);

/** A stored "prepared" plan record for the candidate, as the controller saves it before running the actor. */
function stored(s: Snapshot, input: PlannerInput, moveIndex = 0): { snap: Snapshot; record: PlanRecord } {
  const record = { ...emptyRecord({ input, inputId: "m-x", inputKind: "message", attempt: 1, ruleId: "P", sessionActive: true }, `plan-${randomUUID()}`, "fixture-planner", new Date()), status: "prepared" as const };
  record.acceptedPlan = planFor(input, moveIndex);
  record.actorInstruction = buildActorInstruction(record.id, record.acceptedPlan, input.candidates[moveIndex], input);
  return { snap: { ...s, plans: [...s.plans, record] }, record };
}
const trigger = (s: Snapshot) => ({ kind: "message" as const, id: [...s.messages].reverse().find((m) => m.role === "user")!.id });

describe("Stage 4: actor instruction builder", async () => {
  const identity = await plannerInputAfter(["Who are you?"]);
  const fresh = await plannerInputAfter(["Sure, go on."]);

  it("binding fields come from the candidate; the plan contributes only validated selections", () => {
    const i = instructionFor(identity.input, 0, { selectedFactIds: ["F01"], selectedAdditionIds: ["team_label"] });
    const c = identity.input.candidates[0];
    expect(i).toMatchObject({ action: c.action, moveId: c.moveId, toolIntent: "none", focusCode: c.focusCode, constraints: c.constraints, target: { issueId: c.issueId, requestId: null } });
    expect(i.facts.map((f) => f.id)).toEqual(["F01"]);
    expect(i.additions).toEqual([{ id: "team_label", text: TEAM_LABEL, introduced: false }]);
    expect(i.target.description).toMatch(/Observer summary of the user's issue \(an interpretation\)/);
  });

  it("only the present_code_request candidate authorizes the request tool", () => {
    expect(fresh.input.candidates.map((c, n) => [c.moveId, instructionFor(fresh.input, n).toolIntent])).toEqual([
      ["present_code_request", "present_practice_code_request"],
      ["continue_premise", "none"],
    ]);
  });

  it("procedure instructions retain the requested action even when the planner selects only its duration", () => {
    const candidate = { ...identity.input.candidates[0], moveId: "answer_procedure" as const, constraints: { ...identity.input.candidates[0].constraints, allowedFactIds: ["F04", "F05"] as const } };
    const input = { ...identity.input, candidates: [{ ...candidate, constraints: { ...candidate.constraints, allowedFactIds: [...candidate.constraints.allowedFactIds] } }] };
    const i = instructionFor(input, 0, { selectedFactIds: ["F05"] });
    expect(i.facts.map((f) => f.id)).toContain("F04");
  });
});

describe("Actor v2 controller assembly (src/server/actor/controller.ts)", async () => {
  const identity = await plannerInputAfter(["Who are you?"]);
  const fresh = await plannerInputAfter(["Sure, go on."]);

  it("input and envelope are server-assembled; hidden facts never reach the actor payload", () => {
    for (const { snapshot, input, practiceCode } of [identity, fresh]) {
      const { snap, record } = stored(snapshot, input);
      const { input: actorInput, envelope } = assembleActor(snap, { record, candidate: input.candidates[0], trigger: trigger(snap), processingAttemptId: "pa-1", claimId: "claim-1", modelId: "fixture-actor" });
      expect(envelope).toMatchObject({ sessionId: snap.session.id, planId: record.id, basedOnRevision: snap.session.revision, processingAttempt: 1, claimId: "claim-1", modelId: "fixture-actor", actorPromptVersion: "actor-prompt-v3" });
      const prompt = actorUserPrompt(actorInput);
      expect(prompt).not.toContain(OFFICIAL_RESULT);
      expect(prompt).not.toContain(practiceCode);
      expect(prompt).not.toMatch(/F06|not_initiated|ownerKey|anon:/);
      expect(prompt).not.toContain("claim-1");
    }
  });

  it("controls are the labels actually rendered; the share control appears only when a request is created or pending", () => {
    const a = stored(identity.snapshot, identity.input);
    const noRequest = assembleActor(a.snap, { record: a.record, candidate: identity.input.candidates[0], trigger: trigger(a.snap), processingAttemptId: "p", claimId: "c", modelId: "m" }).input;
    expect(noRequest.controls).toEqual([
      { id: "verify_independently", label: UI_CONTROLS.verify_independently },
      { id: "end_practice", label: UI_CONTROLS.end_practice },
    ]);
    const b = stored(fresh.snapshot, fresh.input, 0);
    const creating = assembleActor(b.snap, { record: b.record, candidate: fresh.input.candidates[0], trigger: trigger(b.snap), processingAttemptId: "p", claimId: "c", modelId: "m" }).input;
    expect(creating.controls.map((c) => c.id)).toContain("share_practice_code");
  });

  it("assessment evidence references resolve to the assessed user message", () => {
    const { snap, record } = stored(identity.snapshot, identity.input);
    const ids = evidenceMessageIds(snap, record, identity.input.candidates[0]);
    expect(ids).toContain(trigger(snap).id);
  });

  it("execution state: plan applicable only while the stored plan is pending at the same revision; claim must be held", () => {
    const { snap, record } = stored(identity.snapshot, identity.input);
    expect(planApplicable(snap, record, MAX_USER_TURNS)).toBe(true);
    expect(planApplicable({ ...snap, session: { ...snap.session, revision: snap.session.revision + 1 } }, record, MAX_USER_TURNS)).toBe(false);
    expect(planApplicable({ ...snap, plans: snap.plans.filter((p) => p.id !== record.id) }, record, MAX_USER_TURNS)).toBe(false);
    const held = { ...snap, session: { ...snap.session, claim: { id: "c", expiresAt: new Date(Date.now() + 60_000).toISOString() } } };
    expect(executionState(held, record, "c", new Date(), MAX_USER_TURNS)).toMatchObject({ claimValid: true, planApplicable: true });
    expect(executionState(held, record, "other", new Date(), MAX_USER_TURNS).claimValid).toBe(false);
    expect(executionState(held, record, "c", new Date(Date.now() + 120_000), MAX_USER_TURNS).claimValid).toBe(false);
  });
});
