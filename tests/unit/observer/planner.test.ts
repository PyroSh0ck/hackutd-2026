import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PlannerObservationSchema, type PlannerObservation } from "@/contracts/observer";
import { ObserverService } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import { FixtureStructuredModel } from "@/server/observer/testing/fixture-model";
import { OFFICIAL_RESULT } from "@/server/planner/scenario";
import { LEGACY_SCENARIO } from "./legacy-scenario";

const OWNER = "anon:planner";

/** One fictional code request presented by the opening; observer only (no planner) to isolate the handoff. */
const CODE_ONLY = { ...LEGACY_SCENARIO, openingRequests: [LEGACY_SCENARIO.openingRequests[0]], officialResult: OFFICIAL_RESULT, officialResultCode: "not_initiated_by_provider" };

async function scenario(store = new MemoryObserverStore()) {
  const service = new ObserverService({
    store,
    models: () => ({ observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") }),
    policy: "consequential_and_flagged",
    timeoutMs: 1000,
    scenario: CODE_ONLY,
  });
  const { session } = await service.createSession(OWNER);
  const code = session.requests[0];
  const say = (content: string) => service.submitMessage(OWNER, session.sessionId, { idempotencyKey: randomUUID(), content });
  const act = (type: Parameters<ObserverService["submitEvent"]>[2]["type"], requestId: string | null, challengeId?: string) =>
    service.submitEvent(OWNER, session.sessionId, { idempotencyKey: randomUUID(), type, requestId, challengeId });
  const obs = async (): Promise<PlannerObservation> => PlannerObservationSchema.parse((await service.planner(OWNER, session.sessionId)).observation);
  return { service, store, id: session.sessionId, code, say, act, obs };
}

describe("Stage 6 + addendum §5: planner handoff", () => {
  it("refusal: credited as refused; no action; planner gets the refusal evidence and server state separately", async () => {
    const s = await scenario();
    await s.say("I won't send the code.");
    const o = await s.obs();
    expect(o).toMatchObject({
      scope: "request",
      requestStatus: "pending",
      sessionStage: "active",
      assessment: { decision: { label: "refused" } },
      action: { status: "not_started" },
      verification: { status: "not_observed", eventIds: [] },
      reviewStatus: "supported",
      interpretationSource: "model_interpretation",
    });
    expect(o.supportingMessages.map((m) => m.content)).toContain("I won't send the code.");
    expect(o.currentRevision).toBeGreaterThanOrEqual(o.basedOnRevision);
  });

  it("conditional acceptance: the condition kind is surfaced as unfulfilled; independent-check intent kept with provenance", async () => {
    const s = await scenario();
    await s.say("Only after I contact official support myself.");
    const o = await s.obs();
    expect(o.assessment.decision.label).toBe("conditional_acceptance");
    expect(o.assessment.condition?.kind).toBe("independent_verification");
    expect(o.assessment.verificationObservations[0]).toMatchObject({ behavior: "expressed_verification_intent", channelProvenance: "user_claimed_independent", claimedResult: "unspecified" });
    expect(o.verification.status).toBe("not_observed");
    expect(o.unresolvedQuestions.join("\n")).toMatch(/Condition stated by the user \(fulfillment not established\)/);
    expect(o.unresolvedQuestions.join("\n")).toMatch(/expressed intention only; no completed action/);
  });

  it("sender-supplied check: flagged as sender-supplied, not verification", async () => {
    const s = await scenario();
    await s.say("I'll call the number you just sent.");
    const o = await s.obs();
    expect(o.assessment.decision.label).toBe("unclear");
    expect(o.assessment.verificationObservations[0]).toMatchObject({ behavior: "expressed_verification_intent", channelProvenance: "sender_supplied" });
    expect(o.unresolvedQuestions.join("\n")).toMatch(/supplied by the sender/);
  });

  it("a contradicting verification CLAIM stays a textual claim; server verification is unaffected", async () => {
    const s = await scenario();
    await s.say("I checked with support and they said this request isn't theirs.");
    const o = await s.obs();
    expect(o.assessment.verificationObservations[0]).toMatchObject({ behavior: "claimed_verification_completed", claimedResult: "contradicts_request", channelProvenance: "user_claimed_independent" });
    expect(o.verification).toEqual({ status: "not_observed", eventIds: [] });
  });

  it("code submission: action completed comes from the event, separately from the expressed decision", async () => {
    const s = await scenario();
    await s.say("Yes, I'll send the code.");
    let o = await s.obs();
    expect(o).toMatchObject({ assessment: { decision: { label: "explicit_acceptance" } }, action: { status: "not_started", eventIds: [] } });
    const { session } = await s.act("practice_code_submitted", s.code.id);
    o = await s.obs();
    expect(o.action).toEqual({ status: "completed", eventIds: [session.events[0].id] });
    expect(o).toMatchObject({ requestStatus: "completed", sessionStage: "ended" });
    expect(o.supportingEvents.map((e) => e.type)).toEqual(["practice_code_submitted"]);
    expect(o.unresolvedQuestions.join("\n")).not.toMatch(/no completed action/);
  });

  it("ambiguous acknowledgment: unclear with ambiguity evidence, and display text for the planner", async () => {
    const s = await scenario();
    await s.say("Okay.");
    const o = await s.obs();
    expect(o.assessment.decision).toEqual({ label: "unclear", evidence: [] });
    expect(o.assessment.ambiguities[0].evidence).toHaveLength(1);
    expect(o.unresolvedQuestions[0]).toMatch(/unresolved; a clarifying question may be appropriate/);
  });

  it("changed mind: latest interpretation wins, previous stays visible", async () => {
    const s = await scenario();
    await s.say("Yes, I'll send the code.");
    await s.say("I won't send the code.");
    const o = await s.obs();
    expect(o.assessment.decision.label).toBe("refused");
    expect(o.previousAssessment?.decision.label).toBe("explicit_acceptance");
    const records = (await s.service.assessments(OWNER, s.id)).filter((r) => r.requestId === s.code.id);
    expect(records[1].validation.reviewFlags.map((f) => f.code)).toContain("conflicting_evidence");
  });

  it("in-app verification: in_progress vs completed are distinct server facts; the official result is never in the handoff", async () => {
    const s = await scenario();
    await s.say("Okay.");
    const started = await s.act("official_verification_started", null);
    expect((await s.obs()).verification.status).toBe("in_progress");
    expect(started.session.verification.officialResult).toBe(OFFICIAL_RESULT);
    await s.act("official_verification_completed", null, started.challengeId);
    const o = await s.obs();
    expect(o).toMatchObject({ verification: { status: "completed" }, sessionStage: "awaiting_final_decision" });
    const handoff = JSON.stringify(await s.service.planner(OWNER, s.id));
    expect(handoff).not.toContain(OFFICIAL_RESULT);
    expect(handoff).not.toContain("not_initiated_by_provider");
  });

  it("flagged correction and fallback states reach the planner with their uncertainty", async () => {
    const s = await scenario();
    await s.say("If I sent it, would that help?");
    let o = await s.obs();
    expect(o).toMatchObject({ resolution: "corrected", reviewStatus: "corrected", assessment: { decision: { label: "unclear" } } });
    expect(o.unresolvedQuestions.join("\n")).toMatch(/Hypothetical question/);

    const fresh = await scenario();
    const broken = new ObserverService({ store: fresh.store, models: () => ({ observer: null, reviewer: null }), policy: "consequential_and_flagged", timeoutMs: 1000, scenario: CODE_ONLY });
    await broken.submitMessage(OWNER, fresh.id, { idempotencyKey: randomUUID(), content: "Yes, I'll send the code." });
    o = await fresh.obs();
    expect(o).toMatchObject({ resolution: "unclear_fallback", assessment: { decision: { label: "unclear", evidence: [] }, openIssues: [], issueAcknowledgments: [] } });
    expect(o.unresolvedQuestions[0]).toMatch(/unavailable, so this reply was not interpreted/);
  });

  it("issues reach the planner as server records (open), never as free text policy", async () => {
    const s = await scenario();
    await s.say("Where do I check independently?");
    const o = await s.obs();
    expect(o.issues).toHaveLength(1);
    expect(o.issues[0]).toMatchObject({ kind: "procedure_question", status: "open", addressedMessageId: null, originAssessmentId: o.assessmentId });
  });

  it("remaining turns count down from the 12-turn cap", async () => {
    const s = await scenario();
    await s.say("Okay.");
    await s.say("Okay.");
    expect((await s.obs()).remainingTurns).toBe(10);
  });
});
