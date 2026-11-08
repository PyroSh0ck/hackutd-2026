import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PlannerObservationSchema, type PlannerObservation } from "@/contracts/observer";
import { ObserverService, type PlannerNotice } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import { FixtureStructuredModel } from "@/server/observer/testing/fixture-model";

const OWNER = "anon:planner";

/** Uses the same fixture models as the HTTP tests, through the real service and memory store. */
async function scenario() {
  const store = new MemoryObserverStore();
  const notices: Array<PlannerNotice & { appliedAtNotify: string[] }> = [];
  const service = new ObserverService({
    store,
    models: () => ({ observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") }),
    policy: "consequential_and_flagged",
    timeoutMs: 1000,
    planner: async (n) => {
      // The planner runs only after the record is durably applied: verify against the store itself.
      const snap = (await store.load(n.sessionId))!;
      notices.push({ ...n, appliedAtNotify: snap.assessments.filter((a) => a.application === "applied").map((a) => a.id) });
    },
  });
  const { session } = await service.createSession(OWNER);
  const code = session.requests.find((r) => r.targetAction === "share_fictional_code")!;
  const say = (content: string) => service.submitMessage(OWNER, session.sessionId, { idempotencyKey: randomUUID(), content });
  const act = (type: Parameters<ObserverService["submitEvent"]>[2]["type"], requestId: string | null, challengeId?: string) =>
    service.submitEvent(OWNER, session.sessionId, { idempotencyKey: randomUUID(), type, requestId, challengeId });
  const codeObs = async (): Promise<PlannerObservation> => (await service.planner(OWNER, session.sessionId)).find((o) => o.request.id === code.id)!;
  return { service, store, notices, id: session.sessionId, code, say, act, codeObs };
}

describe("Stage 6: planner handoff scenarios", () => {
  it("refusal: credited as refused; no action; planner gets the refusal evidence", async () => {
    const s = await scenario();
    await s.say("I won't send the code.");
    const obs = await s.codeObs();
    expect(PlannerObservationSchema.parse(obs)).toBeTruthy();
    expect(obs).toMatchObject({ assessment: { decision: { label: "refused" } }, action: { status: "not_started" }, reviewStatus: "supported", interpretationSource: "model_interpretation" });
    expect(obs.supportingMessages.map((m) => m.content)).toContain("I won't send the code.");
  });

  it("conditional acceptance: the condition is surfaced as unfulfilled; independent-check intent kept with provenance", async () => {
    const s = await scenario();
    await s.say("Only after I contact official support myself.");
    const obs = await s.codeObs();
    expect(obs.assessment.decision.label).toBe("conditional_acceptance");
    expect(obs.assessment.verificationObservations[0]).toMatchObject({ behavior: "expressed_verification_intent", channelProvenance: "user_claimed_independent" });
    expect(obs.inAppVerification.status).toBe("not_observed");
    expect(obs.unresolvedQuestions.join("\n")).toMatch(/Condition stated by the user \(fulfillment not established\)/);
    expect(obs.unresolvedQuestions.join("\n")).toMatch(/expressed intention only; no completed action/);
  });

  it("sender-supplied check: flagged as sender-supplied, not verification", async () => {
    const s = await scenario();
    await s.say("I'll call the number you just sent.");
    const obs = await s.codeObs();
    expect(obs.assessment.decision.label).toBe("unclear");
    expect(obs.assessment.verificationObservations[0]).toMatchObject({ behavior: "expressed_verification_intent", channelProvenance: "sender_supplied" });
    expect(obs.unresolvedQuestions.join("\n")).toMatch(/supplied by the sender/);
    expect(obs.inAppVerification.status).toBe("not_observed");
  });

  it("code submission: action completed comes from the event, separately from the expressed decision", async () => {
    const s = await scenario();
    await s.say("Yes, I'll send the code.");
    let obs = await s.codeObs();
    expect(obs).toMatchObject({ assessment: { decision: { label: "explicit_acceptance" } }, action: { status: "not_started", eventIds: [] } });
    const { session } = await s.act("practice_code_submitted", s.code.id);
    obs = await s.codeObs();
    expect(obs.action).toEqual({ status: "completed", eventIds: [session.events[0].id] });
    expect(obs.supportingEvents.map((e) => e.type)).toEqual(["practice_code_submitted"]);
    expect(obs.unresolvedQuestions.join("\n")).not.toMatch(/no completed action/);
    expect(s.notices.at(-1)).toMatchObject({ trigger: "event" });
  });

  it("ambiguous acknowledgment: unclear, with a clarification prompt for the planner", async () => {
    const s = await scenario();
    await s.say("Okay.");
    const obs = await s.codeObs();
    expect(obs.assessment.decision).toEqual({ label: "unclear", evidence: [] });
    expect(obs.unresolvedQuestions[0]).toMatch(/unresolved; a clarifying question may be appropriate/);
  });

  it("changed mind: latest interpretation wins, previous stays visible, action history untouched", async () => {
    const s = await scenario();
    await s.say("Yes, I'll send the code.");
    await s.say("I won't send the code.");
    const obs = await s.codeObs();
    expect(obs.assessment.decision.label).toBe("refused");
    expect(obs.previousAssessment?.decision.label).toBe("explicit_acceptance");
    const records = (await s.service.assessments(OWNER, s.id)).filter((r) => r.requestId === s.code.id);
    expect(records.map((r) => r.finalAssessment.decision.label)).toEqual(["explicit_acceptance", "refused"]);
    expect(records[1].validation.reviewFlags.map((f) => f.code)).toContain("conflicting_evidence");
  });

  it("in-app verification: directory opened vs completed are distinct server facts", async () => {
    const s = await scenario();
    await s.say("Okay.");
    const opened = await s.act("official_directory_opened", null);
    expect((await s.codeObs()).inAppVerification.status).toBe("directory_opened");
    await s.act("official_verification_completed", null, opened.challengeId);
    expect((await s.codeObs()).inAppVerification).toMatchObject({ status: "completed" });
  });

  it("flagged correction and fallback states reach the planner with their uncertainty", async () => {
    const s = await scenario();
    await s.say("If I sent it, would that help?");
    let obs = await s.codeObs();
    expect(obs).toMatchObject({ resolution: "corrected", reviewStatus: "corrected", assessment: { decision: { label: "unclear" } } });
    expect(obs.unresolvedQuestions.join("\n")).toMatch(/Hypothetical question/);

    const fresh = await scenario();
    const broken = new ObserverService({
      store: fresh.store,
      models: () => ({ observer: null, reviewer: null }),
      policy: "consequential_and_flagged",
      timeoutMs: 1000,
    });
    await broken.submitMessage(OWNER, fresh.id, { idempotencyKey: randomUUID(), content: "Yes, I'll send the code." });
    obs = await fresh.codeObs();
    expect(obs).toMatchObject({ resolution: "unclear_fallback", assessment: { decision: { label: "unclear", evidence: [] } } });
    expect(obs.unresolvedQuestions[0]).toMatch(/unavailable, so this reply was not interpreted/);
  });

  it("the planner is notified only after application, once per applied assessment, never for stale results", async () => {
    const s = await scenario();
    await s.say("I won't send the code.");
    await s.say("Okay.");
    const assessmentNotices = s.notices.filter((n) => n.trigger === "assessment");
    expect(assessmentNotices).toHaveLength(4);
    for (const n of assessmentNotices) {
      for (const o of n.observations) {
        const record = (await s.service.assessments(OWNER, s.id)).find((r) => r.requestId === o.request.id && r.currentMessageId === o.assessment.currentMessageId)!;
        expect(record.application).toBe("applied");
        expect(n.appliedAtNotify).toContain(record.id);
      }
    }
  });

  it("remaining turns count down from the turn cap", async () => {
    const s = await scenario();
    await s.say("Okay.");
    await s.say("Okay.");
    expect((await s.codeObs()).remainingTurns).toBe(6);
  });
});
