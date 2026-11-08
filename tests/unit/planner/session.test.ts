import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HttpError } from "@/server/http/errors";
import type { StructuredModel, StructuredRequest, StructuredResult } from "@/server/observer/model";
import { ObserverService } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import { FixtureActorModel, FixturePlannerModel } from "@/server/planner/testing/fixture-models";
import { gate } from "../observer/rule-model";
import { OWNER, started } from "./session-fixture";

/** Counts calls and can hold them on a gate (to interleave concurrent inputs) or fail them. */
class Probe implements StructuredModel {
  calls = 0;
  gate: Promise<void> | null = null;
  failWith: Extract<StructuredResult, { ok: false }>["failure"] | null = null;
  constructor(private readonly inner: StructuredModel) {}
  get modelId() {
    return this.inner.modelId;
  }
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    this.calls++;
    if (this.gate) await this.gate;
    if (this.failWith) return { ok: false, failure: this.failWith, detail: "probe" };
    return this.inner.generate(request);
  }
}

async function game() {
  const planner = new Probe(new FixturePlannerModel());
  const actor = new Probe(new FixtureActorModel());
  const s = await started({ planner: () => planner, actor: () => actor });
  const view = async () => (await s.service.getSession(OWNER, s.id)).session;
  const assistantTexts = async () => (await view()).messages.filter((m) => m.role === "assistant").map((m) => m.content);
  return { ...s, planner, actor, view, assistantTexts };
}
/** Simulates the process dying inside the commit: the commit and every later read in that attempt throw. */
function crashOnCommit(store: MemoryObserverStore) {
  const commit = store.commitPlan.bind(store);
  const load = store.load.bind(store);
  let dead = false;
  store.commitPlan = async () => {
    dead = true;
    throw new Error("process crashed");
  };
  store.load = async (id) => {
    if (dead) {
      dead = false;
      store.commitPlan = commit;
      throw new Error("process crashed");
    }
    return load(id);
  };
}

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e.details?.reason ?? e.code;
    throw e;
  }
  throw new Error("expected rejection");
}
/** Question answered, then the request is presented. */
async function withRequest() {
  const g = await game();
  await g.say("Who are you?");
  await g.say("Sure, go on.");
  const v = await g.view();
  expect(v.requestStatus).toBe("pending");
  return { ...g, requestId: v.requests[0].id, code: v.practiceCode! };
}

describe("Stage 6: end-to-end flows (fixture planner/actor, memory store)", () => {
  it("opening → question → answer → request: issue addressed only on commit; addition recorded once", async () => {
    const g = await game();
    expect((await g.view()).messages[0].content).toMatch(/^Hi, I'm Avery from Cedar Account Support/);
    expect(g.planner.calls).toBe(0); // fixed opening, no planner call
    await g.say("Who are you?");
    let v = await g.view();
    expect(v.issues).toMatchObject([{ kind: "identity_question", status: "addressed", addressedMessageId: v.messages.at(-1)!.id }]);
    expect(v.messages.at(-1)!.content).toMatch(/Account Review/);
    expect((await g.snap()).additions.find((a) => a.id === "team_label")!.introducedMessageId).toBe(v.messages.at(-1)!.id);
    await g.say("Sure, go on.");
    v = await g.view();
    expect(v).toMatchObject({ requestStatus: "pending", practiceCode: expect.stringMatching(/^\d{6}$/) });
    expect(v.events.map((e) => e.type)).toEqual(["request_presented"]);
    expect(v.requests[0].introducedByMessageId).toBe(v.messages.at(-1)!.id);
    const committed = (await g.snap()).plans.filter((p) => p.status === "committed");
    expect(committed.map((p) => p.ruleId)).toEqual(["P3", "P10"]);
    expect(committed.every((p) => p.committedMessageId)).toBe(true);
  });

  it("refusal does not end the chat; a rejection is acknowledged once; the request is never re-presented", async () => {
    const g = await withRequest();
    await g.say("I won't send the code.");
    let v = await g.view();
    expect(v).toMatchObject({ ended: false, stage: "active" });
    expect(v.messages.at(-1)!.content).toMatch(/won't ask you for it again/);
    const before = (await g.assistantTexts()).length;
    const r = await g.act({ type: "request_rejected", requestId: g.requestId });
    expect(r.session.ended).toBe(false);
    expect((await g.assistantTexts()).length).toBe(before + 1); // acknowledges the rejection event
    await g.say("Sure, go on.");
    v = await g.view();
    expect((await g.assistantTexts()).length).toBe(before + 1); // waits; nothing new
    expect(v.requests).toHaveLength(1);
  });

  it("explicit acceptance without submission: no extra pressure, no automatic submission", async () => {
    const g = await withRequest();
    const calls = g.planner.calls;
    const before = (await g.assistantTexts()).length;
    await g.say("Yes, I'll send the code.");
    expect((await g.assistantTexts()).length).toBe(before);
    expect(g.planner.calls).toBe(calls);
    expect((await g.view()).requestStates[0].action.status).toBe("not_started");
  });

  it("verification intent without action is not terminal and generates nothing", async () => {
    const g = await withRequest();
    const before = (await g.assistantTexts()).length;
    await g.say("I'll check with Cedar myself first.");
    expect(await g.view()).toMatchObject({ ended: false, stage: "active" });
    expect((await g.assistantTexts()).length).toBe(before);
  });

  it("cancelled verification returns active with history and no automatic message", async () => {
    const g = await withRequest();
    const before = (await g.assistantTexts()).length;
    await g.act({ type: "official_verification_started", requestId: null });
    const v = (await g.act({ type: "official_verification_cancelled", requestId: null })).session;
    expect(v).toMatchObject({ stage: "active", verification: { status: "directory_opened", officialResult: null } });
    expect((await g.assistantTexts()).length).toBe(before);
    expect(v.events.map((e) => e.type)).toEqual(expect.arrayContaining(["official_verification_started", "official_verification_cancelled"]));
  });

  it("completed verification → reject and report: defense, and no opponent model call after the result is shown", async () => {
    const g = await withRequest();
    const s = await g.act({ type: "official_verification_started", requestId: null });
    const calls = g.planner.calls + g.actor.calls;
    expect(await rejection(g.say("Is this real?"))).toBe("STAGE_PAUSED");
    await g.act({ type: "official_verification_completed", requestId: null, challengeId: s.challengeId });
    expect(await rejection(g.say("Hello?"))).toBe("STAGE_PAUSED");
    expect(await rejection(g.act({ type: "practice_code_submitted", requestId: g.requestId, practiceCode: g.code }))).toBe("PROCEED_REQUIRED");
    const end = await g.act({ type: "request_rejected", requestId: g.requestId });
    expect(end.session).toMatchObject({ ended: true, outcome: "defense_demonstrated" });
    expect(g.planner.calls + g.actor.calls).toBe(calls);
  });

  it("completed verification → proceed (request never presented) → cancel confirmation → confirm: exposure", async () => {
    const g = await game();
    await g.say("Who are you?");
    const s = await g.act({ type: "official_verification_started", requestId: null });
    await g.act({ type: "official_verification_completed", requestId: null, challengeId: s.challengeId });
    const proceeded = (await g.act({ type: "final_decision_proceed", requestId: null })).session;
    expect(proceeded).toMatchObject({ stage: "awaiting_final_decision", requestStatus: "pending", finalDecisionProceeded: true });
    expect(proceeded.events.slice(-2).map((e) => e.type)).toEqual(["final_decision_proceed", "request_presented"]);
    // A cancelled confirmation is client-side: nothing is recorded and the stage is unchanged.
    expect((await g.view()).stage).toBe("awaiting_final_decision");
    expect(await rejection(g.act({ type: "final_decision_proceed", requestId: null }))).toBe("ALREADY_PROCEEDED");
    const done = await g.act({ type: "practice_code_submitted", requestId: proceeded.requests[0].id, practiceCode: proceeded.practiceCode! });
    expect(done.session).toMatchObject({ ended: true, outcome: "simulated_exposure" });
  });

  it("request submission before verification: exposure; later verification and report are rejected and audited", async () => {
    const g = await withRequest();
    expect(await rejection(g.act({ type: "practice_code_submitted", requestId: g.requestId }))).toBe("CODE_REQUIRED");
    await g.act({ type: "practice_code_submitted", requestId: g.requestId, practiceCode: g.code });
    expect(await rejection(g.act({ type: "official_verification_started", requestId: null }))).toBe("SESSION_ENDED");
    expect(await rejection(g.act({ type: "conversation_reported", requestId: null }))).toBe("SESSION_ENDED");
    const v = await g.view();
    expect(v.outcome).toBe("simulated_exposure");
    expect(v.events.filter((e) => e.type === "event_rejected_after_end")).toHaveLength(2);
  });

  it("explicit textual stop ends safely with no model work; skepticism is not a stop", async () => {
    const g = await game();
    await g.say("This is a scam, you're not from Cedar.");
    expect((await g.view()).ended).toBe(false);
    const calls = g.planner.calls;
    const r = await g.say("Please end the practice now.");
    expect(r.session).toMatchObject({ ended: true, outcome: "safely_disengaged" });
    expect(r.session.events.at(-1)).toMatchObject({ type: "conversation_ended" });
    expect(g.planner.calls).toBe(calls);
  });

  it("ambiguous stop pauses with a fixed confirmation; dismissing it resumes without generation; confirming ends", async () => {
    const g = await game();
    const before = (await g.assistantTexts()).length;
    await g.say("stop");
    expect((await g.view()).stopConfirmationPending).toBe(true);
    expect((await g.assistantTexts()).length).toBe(before);
    expect(await rejection(g.say("hello"))).toBe("STOP_CONFIRMATION_PENDING");
    await g.act({ type: "stop_confirmation_dismissed", requestId: null });
    expect((await g.assistantTexts()).length).toBe(before);
    await g.say("I'm done.");
    const end = await g.act({ type: "conversation_ended", requestId: null });
    expect(end.session).toMatchObject({ ended: true, outcome: "safely_disengaged" });
  });

  it("turn limit: the 12th message is assessed, no reply is planned for it, outcome inconclusive", async () => {
    const g = await game();
    for (let i = 0; i < 11; i++) await g.say(`Tell me more ${i}.`);
    const calls = g.planner.calls;
    const last = await g.say("And then?");
    expect(last.session).toMatchObject({ ended: true, outcome: "inconclusive", turn: 12 });
    expect(g.planner.calls).toBe(calls);
  });

  it("technical failure: neutral notice, no state mutation, one retry succeeds; a second failure ends technical_interruption", async () => {
    const g = await game();
    g.planner.failWith = "timeout";
    await g.say("Who are you?");
    let v = await g.view();
    expect(v.technicalNotice).toMatchObject({ attempts: 1, canRetry: true });
    expect(v.issues[0].status).toBe("open");
    expect(v.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(v.events.map((e) => e.type)).toEqual(["planning_failed"]);
    g.planner.failWith = null;
    v = (await g.service.retry(OWNER, g.id, { idempotencyKey: randomUUID() })).session;
    expect(v.technicalNotice).toBeNull();
    expect(v.issues[0].status).toBe("addressed");

    const h = await game();
    h.planner.failWith = "timeout";
    await h.say("Who are you?");
    const key = randomUUID();
    v = (await h.service.retry(OWNER, h.id, { idempotencyKey: key })).session;
    expect(v).toMatchObject({ ended: true, outcome: "technical_interruption", technicalNotice: { attempts: 2, canRetry: false } });
    expect((await h.service.retry(OWNER, h.id, { idempotencyKey: key })).duplicate).toBe(true);
    expect(await rejection(h.service.retry(OWNER, h.id, { idempotencyKey: randomUUID() }))).toBe("SESSION_ENDED");
    expect(h.planner.calls).toBe(2);
  });

  it("retry is unavailable when nothing failed", async () => {
    const g = await game();
    expect(await rejection(g.service.retry(OWNER, g.id, { idempotencyKey: randomUUID() }))).toBe("RETRY_NOT_AVAILABLE");
  });
});

describe("Stage 5: concurrency, staleness, crashes, duplicates", () => {
  it.each([
    ["concurrent stop", async (g: Awaited<ReturnType<typeof game>>) => g.act({ type: "conversation_ended", requestId: null })],
    ["concurrent verification", async (g: Awaited<ReturnType<typeof game>>) => g.act({ type: "official_verification_started", requestId: null })],
  ])("%s during generation: the draft is audited stale and never committed", async (_n, interrupt) => {
    const g = await game();
    const hold = gate();
    g.actor.gate = hold.promise;
    const pending = g.say("Who are you?");
    await new Promise((r) => setTimeout(r, 15));
    await interrupt(g);
    hold.open();
    await pending;
    const snap = await g.snap();
    expect(snap.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(snap.plans.map((p) => p.status)).toEqual(["stale"]);
    expect(snap.issues[0].status).toBe("open");
  });

  it("stale revision: a newer message invalidates the in-flight plan; the newer input is answered against current state", async () => {
    const g = await game();
    const hold = gate();
    g.actor.gate = hold.promise;
    const first = g.say("Who are you?");
    await new Promise((r) => setTimeout(r, 15));
    g.actor.gate = null;
    const second = await g.say("Where do I check independently?");
    expect(second.processing?.status).toBe("queued");
    hold.open();
    await first;
    await g.service.process(OWNER, g.id);
    const snap = await g.snap();
    expect(snap.plans.map((p) => p.status)).toEqual(["stale", "committed"]);
    const committed = snap.plans[1];
    expect(committed.inputId).toBe(snap.messages.find((m) => m.content === "Where do I check independently?")!.id);
    expect(snap.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  });

  it("process crash after the actor draft was stored: resume commits it without new model calls", async () => {
    const g = await game();
    crashOnCommit(g.store);
    await g.say("Who are you?");
    let snap = await g.snap();
    expect(snap.plans.map((p) => [p.status, Boolean(p.actorOutput)])).toEqual([["prepared", true]]);
    expect(snap.messages.filter((m) => m.role === "assistant")).toHaveLength(1); // atomic: nothing partial
    expect(snap.issues[0].status).toBe("open");
    const calls = g.planner.calls + g.actor.calls;
    await g.service.process(OWNER, g.id);
    snap = await g.snap();
    expect(snap.plans.map((p) => p.status)).toEqual(["committed"]);
    expect(snap.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
    expect(g.planner.calls + g.actor.calls).toBe(calls);
  });

  it("process crash, then the state changed: the stored draft is audited stale, not committed", async () => {
    const g = await game();
    crashOnCommit(g.store);
    await g.say("Who are you?");
    await g.act({ type: "official_verification_started", requestId: null });
    await g.act({ type: "official_verification_cancelled", requestId: null });
    await g.service.process(OWNER, g.id);
    const snap = await g.snap();
    expect(snap.plans.map((p) => p.status)).toEqual(["stale"]);
    expect(snap.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  it("a database error during commit rolls back everything; the durable retry reuses the still-eligible plan (no planner call) and commits", async () => {
    const g = await game();
    g.store.failNext = { op: "commit", error: new Error("db down") };
    await g.say("Who are you?");
    let v = await g.view();
    expect(v.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(v.issues[0].status).toBe("open");
    expect(v.technicalNotice).toMatchObject({ attempts: 1, canRetry: true, message: expect.stringMatching(/couldn't be generated/) });
    const plannerCalls = g.planner.calls;
    const key = randomUUID();
    v = (await g.service.retry(OWNER, g.id, { idempotencyKey: key })).session;
    expect(g.planner.calls).toBe(plannerCalls); // plan reused
    expect(v.issues[0].status).toBe("addressed");
    const plans = (await g.snap()).plans;
    expect(plans.map((p) => p.status)).toEqual(["failed", "committed"]);
    expect(plans[1]).toMatchObject({ attempt: 2, reusedPlanFrom: plans[0].id, actorAudit: { processingAttempt: 2 } });
    expect(plans[1].actorAudit!.processingAttemptId).not.toBe(plans[0].actorAudit!.processingAttemptId);
    // Replaying the idempotent retry starts no new actor attempt.
    const actorCalls = g.actor.calls;
    expect((await g.service.retry(OWNER, g.id, { idempotencyKey: key })).duplicate).toBe(true);
    expect(g.actor.calls).toBe(actorCalls);
  });

  it("actor failure on the retry ends technical_interruption; the actor runs at most twice per attempt", async () => {
    const g = await game();
    g.actor.failWith = "timeout";
    await g.say("Who are you?");
    expect((await g.view()).technicalNotice?.canRetry).toBe(true);
    expect(g.actor.calls).toBe(1); // timeout: no repair
    const v = (await g.service.retry(OWNER, g.id, { idempotencyKey: randomUUID() })).session;
    expect(v).toMatchObject({ ended: true, outcome: "technical_interruption" });
    expect(g.actor.calls).toBe(2);
  });

  it("duplicate inputs produce one response; the request is created at most once", async () => {
    const g = await game();
    const key = randomUUID();
    await Promise.all([g.say("Sure, go on.", key), g.say("Sure, go on.", key), g.say("Sure, go on.", key)]);
    await g.service.process(OWNER, g.id);
    const snap = await g.snap();
    expect(snap.plans.filter((p) => p.status === "committed")).toHaveLength(1);
    expect(snap.requests).toHaveLength(1);
    expect(snap.events.filter((e) => e.type === "request_presented")).toHaveLength(1);
  });

  it("restart: a new service over the same store sees the same state (resume after refresh/tab close)", async () => {
    const store = new MemoryObserverStore();
    const g = await started({ store, planner: () => new FixturePlannerModel(), actor: () => new FixtureActorModel() });
    await g.say("Who are you?");
    const again = new ObserverService({ store, models: () => ({ observer: null, reviewer: null }), policy: "consequential_and_flagged", timeoutMs: 1000 });
    const v = (await again.getSession(OWNER, g.id)).session;
    expect(v.messages).toHaveLength(3);
    expect(v.stage).toBe("active");
  });

  it("authorization across sessions: plans/retry are not found; another session's issue cannot be linked", async () => {
    const g = await withRequest();
    const other = await g.service.createSession("anon:someone-else");
    for (const p of [g.service.plans("anon:someone-else", g.id), g.service.retry("anon:someone-else", g.id, { idempotencyKey: randomUUID() })]) {
      expect(await rejection(p)).toBe("NOT_FOUND");
    }
    const issueId = (await g.view()).issues[0].id;
    const r = await rejection(g.service.submitEvent("anon:someone-else", other.session.sessionId, { idempotencyKey: randomUUID(), type: "official_verification_started", requestId: null, linkedIssueId: issueId }));
    expect(r).toBe("ISSUE_INVALID");
  });
});

describe("Addendum §4/§6: issue lifecycle", () => {
  it("extraction does not mark addressed; planner failure leaves the issue open", async () => {
    const g = await started({ planning: false });
    await g.say("Where do I check independently?");
    expect((await g.snap()).issues.map((i) => i.status)).toEqual(["open"]);
  });

  it("acknowledging an addressed issue resolves it after the assessment applies; generic thanks does not", async () => {
    const g = await game();
    await g.say("Where do I check independently?");
    expect((await g.view()).issues[0].status).toBe("addressed");
    await g.say("Thanks.");
    expect((await g.view()).issues[0].status).toBe("addressed");
    await g.say("That answers my question about where to verify.");
    const issue = (await g.view()).issues[0];
    expect(issue).toMatchObject({ status: "resolved", resolvedByAssessmentId: expect.any(String), resolutionEventId: null });
  });

  it("verification completion resolves only the explicitly linked procedure issue", async () => {
    const g = await game();
    await g.say("Who are you?");
    await g.say("Where do I check independently?");
    const v = await g.view();
    expect(v.verificationLinkIssueId).toBe(v.issues.find((i) => i.kind === "procedure_question")!.id);
    const s = await g.act({ type: "official_verification_started", requestId: null, linkedIssueId: v.verificationLinkIssueId! });
    const done = (await g.act({ type: "official_verification_completed", requestId: null, challengeId: s.challengeId })).session;
    const byKind = Object.fromEntries(done.issues.map((i) => [i.kind, i.status]));
    expect(byKind).toEqual({ identity_question: "addressed", procedure_question: "resolved" });
    expect(done.issues.find((i) => i.kind === "procedure_question")!.resolutionEventId).toBe(done.events.at(-1)!.id);
  });

  it("linking a non-procedure issue is rejected; ending archives issues without resolving them", async () => {
    const g = await game();
    await g.say("Who are you?");
    const issueId = (await g.view()).issues[0].id;
    expect(await rejection(g.act({ type: "official_verification_started", requestId: null, linkedIssueId: issueId }))).toBe("ISSUE_INVALID");
    const end = (await g.act({ type: "conversation_ended", requestId: null })).session;
    expect(end.issues[0].status).toBe("addressed");
  });

  it("the same question asked again (same evidence) is not duplicated; a new message's question is a separate issue", async () => {
    const g = await started({ planning: false });
    await g.say("Who are you?");
    await g.say("Who are you?");
    const issues = (await g.snap()).issues;
    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((i) => i.evidence[0].messageId)).size).toBe(2);
  });

  it("stale and fallback assessments change no issue records", async () => {
    const g = await started({ planning: false });
    await g.say("Who are you?");
    const before = (await g.snap()).issues;
    const broken = new ObserverService({ store: g.store, models: () => ({ observer: null, reviewer: null }), policy: "consequential_and_flagged", timeoutMs: 1000 });
    await broken.submitMessage(OWNER, g.id, { idempotencyKey: randomUUID(), content: "Where do I check independently?" });
    const after = await g.snap();
    expect(after.assessments.at(-1)).toMatchObject({ resolution: "unclear_fallback", finalAssessment: { openIssues: [], issueAcknowledgments: [] } });
    expect(after.issues).toEqual(before);
  });
});
