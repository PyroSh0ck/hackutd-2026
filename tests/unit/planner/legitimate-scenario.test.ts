import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ObserverService } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import { FixtureStructuredModel } from "@/server/observer/testing/fixture-model";
import { selectScenario } from "@/server/engine/selection";
import { ACCOUNT_HOME_RECORD } from "@/server/observer/state";
import { FixtureActorModel, FixturePlannerModel } from "@/server/planner/testing/fixture-models";
import { MOBILE_CODE_SCENARIO, MOBILE_NOTICE_SCENARIO } from "@/server/planner/scenario";
import type { SessionSummary } from "@/server/engine/history";

const OWNER = "anon:legit-tests";
const PORTAL = MOBILE_NOTICE_SCENARIO.portal!.id;

function service() {
  return new ObserverService({
    store: new MemoryObserverStore(),
    models: () => ({ observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") }),
    policy: "consequential_and_flagged",
    timeoutMs: 1000,
    planning: { models: () => ({ planner: new FixturePlannerModel(), actor: new FixtureActorModel() }), timeoutMs: 1000 },
    enabledScenarios: ["mobile-code-01", "mobile-notice-01"],
  });
}

async function notice() {
  const svc = service();
  const { session } = await svc.createSession(OWNER, { scenarioId: "mobile-notice-01" });
  const id = session.sessionId;
  const act = (type: Parameters<ObserverService["submitEvent"]>[2]["type"], extra: Partial<Parameters<ObserverService["submitEvent"]>[2]> = {}) =>
    svc.submitEvent(OWNER, id, { idempotencyKey: randomUUID(), type, requestId: null, ...extra });
  return { svc, id, session, act };
}

describe("mobile-notice-01 (legitimate) rules and outcomes", () => {
  it("B02: before the end the view hides the scenario id/kind; no code, no request card, no official result", async () => {
    const { session } = await notice();
    expect(session.scenario).toMatchObject({ id: "practice", version: 0 });
    expect(session.practiceCode).toBeNull();
    expect(session.verification.officialResult).toBeNull();
    expect(JSON.stringify(session)).not.toMatch(/mobile-notice|legitimate|authorized_notice/);
    expect(session.messages[0].content).toMatch(/new monthly statement/);
  });

  it("B09: verify → Proceed → open and review the trusted notice = legitimate_task_completed", async () => {
    const t = await notice();
    const start = await t.act("official_verification_started");
    expect(start.session.verification.officialResult).toMatch(/monthly-statement notice was issued/);
    await t.act("official_verification_completed", { challengeId: start.challengeId });
    await t.act("final_decision_proceed");
    await t.act("portal_record_opened", { recordId: PORTAL });
    const done = (await t.act("portal_notice_reviewed", { recordId: PORTAL })).session;
    expect(done).toMatchObject({ ended: true, outcome: "legitimate_task_completed", scenario: { id: "mobile-notice-01" } });
  });

  it("B10: reviewing the trusted notice without the support check = benign_task_completed_unverified", async () => {
    const t = await notice();
    await t.act("portal_record_opened", { recordId: ACCOUNT_HOME_RECORD });
    await expect(t.act("portal_notice_reviewed", { recordId: PORTAL })).rejects.toMatchObject({ details: { reason: "RECORD_NOT_OPENED" } });
    await t.act("portal_record_opened", { recordId: PORTAL });
    expect((await t.act("portal_notice_reviewed", { recordId: PORTAL })).session.outcome).toBe("benign_task_completed_unverified");
  });

  it("B11: reporting the genuine notice = legitimate_request_declined (never exposure)", async () => {
    const t = await notice();
    expect((await t.act("conversation_reported")).session.outcome).toBe("legitimate_request_declined");
  });

  it("Proceed after verification only allows the portal action; it completes nothing", async () => {
    const t = await notice();
    const start = await t.act("official_verification_started");
    await t.act("official_verification_completed", { challengeId: start.challengeId });
    await expect(t.act("portal_notice_reviewed", { recordId: PORTAL })).rejects.toMatchObject({ status: 422 });
    const proceeded = (await t.act("final_decision_proceed")).session;
    expect(proceeded.ended).toBe(false);
  });

  it("unknown records are rejected; the account shows the notice summary only once opened", async () => {
    const t = await notice();
    await expect(t.act("portal_record_opened", { recordId: "made-up-record" })).rejects.toMatchObject({ details: { reason: "RECORD_NOT_FOUND" } });
    expect((await t.svc.account(OWNER, t.id)).notices[0]).toMatchObject({ id: PORTAL, summary: null, opened: false });
    await t.act("portal_record_opened", { recordId: PORTAL });
    expect((await t.svc.account(OWNER, t.id)).notices[0]).toMatchObject({ opened: true, summary: expect.stringMatching(/fictional statement/) });
  });

  it("the opponent never presents a code request; candidates come only from the scenario registry", async () => {
    const t = await notice();
    const reply = (await t.svc.submitMessage(OWNER, t.id, { idempotencyKey: randomUUID(), content: "Sure, go on." })).session;
    expect(reply.requests).toHaveLength(0);
    expect(reply.requestStatus).toBe("not_presented");
    const planner = await t.svc.planner(OWNER, t.id);
    if (planner.eligibility.kind === "candidates") for (const c of planner.eligibility.candidates) expect(["answer_identity", "answer_procedure", "answer_scenario_fact", "acknowledge_refusal"]).toContain(c.moveId);
  });

  it("the opponent answers an identity question with the scenario's own facts and no fraud-only additions", async () => {
    const t = await notice();
    const v = (await t.svc.submitMessage(OWNER, t.id, { idempotencyKey: randomUUID(), content: "Who are you?" })).session;
    expect(v.technicalNotice).toBeNull();
    const reply = v.messages.filter((m) => m.role === "assistant");
    expect(reply).toHaveLength(2);
    expect(reply[1].content).not.toMatch(/Account Review|CD-\d/);
  });

  it("a fraud-scenario account has no notices (checking it independently finds nothing)", async () => {
    const svc = service();
    const { session } = await svc.createSession(OWNER, { scenarioId: "mobile-code-01" });
    expect((await svc.account(OWNER, session.sessionId)).notices).toEqual([]);
  });
});

describe("scenario selection (rule-based coverage, not personalization)", () => {
  const ended = (scenarioId: string, at: string): SessionSummary => ({ id: randomUUID(), scenarioId, scenarioVersion: 1, createdAt: at, ended: true, stage: "ended", outcome: "safely_disengaged", turn: 1, endedAt: at, verificationCompleted: false, reported: false, requestDeclined: false, codeShared: false });
  const both = [MOBILE_CODE_SCENARIO, MOBILE_NOTICE_SCENARIO];

  it("recommended picks the other scenario when only one has been completed", () => {
    expect(selectScenario("recommended", both, [ended("mobile-code-01", "2026-11-08T01:00:00.000Z")], () => 0).id).toBe("mobile-notice-01");
    expect(selectScenario("recommended", both, [ended("mobile-notice-01", "2026-11-08T01:00:00.000Z")], () => 0).id).toBe("mobile-code-01");
  });

  it("recommended otherwise picks the least recently completed, catalog id as tie-break", () => {
    expect(selectScenario("recommended", both, [ended("mobile-code-01", "2026-11-08T02:00:00.000Z"), ended("mobile-notice-01", "2026-11-08T01:00:00.000Z")], () => 0).id).toBe("mobile-notice-01");
    expect(selectScenario("recommended", both, [], () => 0.99).id).toBe("mobile-code-01");
  });

  it("mixed is uniform over enabled scenarios using the supplied backend randomness", () => {
    expect(selectScenario("mixed", both, [], () => 0.1).id).toBe("mobile-code-01");
    expect(selectScenario("mixed", both, [], () => 0.9).id).toBe("mobile-notice-01");
  });

  it("without enabled-scenario configuration creation stays backward compatible (default scenario)", async () => {
    const svc = new ObserverService({ store: new MemoryObserverStore(), models: () => ({ observer: null, reviewer: null }), policy: "consequential_and_flagged", timeoutMs: 1000 });
    const { session } = await svc.createSession(OWNER);
    expect(session.messages[0].content).toMatch(/Avery from Cedar Account Support/);
  });
});
