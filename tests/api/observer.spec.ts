import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ApiErrorResponseSchema } from "@/contracts/api-error";
import { AssessmentsResponseSchema, ObserverSessionResponseSchema, PlannerResponseSchema, type ObserverSessionView, type SubmitEventRequest } from "@/contracts/observer";

// Real API + Postgres (Neon test branch). Models are the LABELED test-only fixture models
// (E2E_TEST=1 + OBSERVER_MODEL_MODE=fixture): this proves persistence, ownership, idempotency, and
// concurrency over HTTP — not semantic quality. Real-model behavior: `pnpm observer:eval`.

const ORIGIN = "http://127.0.0.1:3100";
const headers = { Origin: ORIGIN };

async function create(request: APIRequestContext) {
  const response = await request.post("/api/observer/sessions", { headers });
  expect(response.status(), await response.text()).toBe(201);
  return ObserverSessionResponseSchema.parse(await response.json());
}
const say = (request: APIRequestContext, id: string, content: string, idempotencyKey = randomUUID()) =>
  request.post(`/api/observer/sessions/${id}/messages`, { headers, data: { idempotencyKey, content } });
const act = (request: APIRequestContext, id: string, cmd: Omit<SubmitEventRequest, "idempotencyKey">, idempotencyKey = randomUUID()) =>
  request.post(`/api/observer/sessions/${id}/events`, { headers, data: { idempotencyKey, ...cmd } });
async function okBody(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(response.status(), await response.text()).toBe(200);
  return ObserverSessionResponseSchema.parse(await response.json());
}
const assessments = async (request: APIRequestContext, id: string) => AssessmentsResponseSchema.parse(await (await request.get(`/api/observer/sessions/${id}/assessments`)).json()).assessments;
const planner = async (request: APIRequestContext, id: string) => PlannerResponseSchema.parse(await (await request.get(`/api/observer/sessions/${id}/planner`)).json()).observations;
const codeOf = (s: ObserverSessionView) => s.requests.find((r) => r.targetAction === "share_fictional_code")!;

test.describe("observer API", () => {
  test("create: cookie identity, no-store, opening with two fictional requests, nothing private exposed", async ({ request }) => {
    const response = await request.post("/api/observer/sessions", { headers });
    expect(response.status()).toBe(201);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toMatch(/scamper_player=/);
    const { session } = ObserverSessionResponseSchema.parse(await response.json());
    expect(session.requests.map((r) => r.targetAction)).toEqual(["share_fictional_code", "approve_simulated_payment"]);
    expect(JSON.stringify(session)).not.toMatch(/ownerKey|anon:|challengeId/);
  });

  test("refusal assessed, then a submitted code: both persist across reload; audit is labeled", async ({ request }) => {
    const { session } = await create(request);
    const code = codeOf(session);
    const res = await okBody(await say(request, session.sessionId, "I won't send the code."));
    expect(res.processing).toMatchObject({ status: "processed", assessed: 2, stale: 0 });
    await okBody(await act(request, session.sessionId, { type: "practice_code_submitted", requestId: code.id }));

    const reloaded = ObserverSessionResponseSchema.parse(await (await request.get(`/api/observer/sessions/${session.sessionId}`)).json()).session;
    expect(reloaded.requestStates.find((s) => s.requestId === code.id)!.action.status).toBe("completed");
    const [obs] = (await planner(request, session.sessionId)).filter((o) => o.request.id === code.id);
    expect(obs).toMatchObject({ assessment: { decision: { label: "refused" } }, action: { status: "completed" }, interpretationSource: "model_interpretation", reviewStatus: "supported" });
    const records = await assessments(request, session.sessionId);
    expect(records.every((r) => r.observerModel === "fixture-observer" && r.application === "applied")).toBe(true);
    expect(JSON.stringify(records)).not.toMatch(/OBSERVER_SYSTEM|You are the observer/);
  });

  test("flagged correction and single repair paths persist their history", async ({ request }) => {
    const { session } = await create(request);
    const code = codeOf(session);
    await okBody(await say(request, session.sessionId, "If I sent it, would that help?"));
    await okBody(await say(request, session.sessionId, "Hmm, let me think about whether to do it."));
    const records = (await assessments(request, session.sessionId)).filter((r) => r.requestId === code.id);
    expect(records[0]).toMatchObject({ reviewStatus: "corrected", resolution: "corrected", proposedAssessment: { decision: { label: "explicit_acceptance" } }, finalAssessment: { decision: { label: "unclear" } } });
    expect(records[0].attempts.map((a) => a.stage)).toEqual(["observer", "reviewer"]);
    expect(records[1]).toMatchObject({ repairAttempted: true, resolution: "accepted", finalAssessment: { decision: { label: "considering" } } });
    expect(records[1].attempts.map((a) => [a.stage, a.outcome])).toEqual([["observer", "malformed_output"], ["repair", "ok"]]);
    const [obs] = (await planner(request, session.sessionId)).filter((o) => o.request.id === code.id);
    expect(obs.previousAssessment?.decision.label).toBe("unclear");
  });

  test("Stage 6 scenarios over HTTP: conditional + independent check, sender-supplied check, ambiguous, changed mind", async ({ request }) => {
    const run = async (lines: string[]) => {
      const { session } = await create(request);
      for (const line of lines) await okBody(await say(request, session.sessionId, line));
      return (await planner(request, session.sessionId)).find((o) => o.request.id === codeOf(session).id)!;
    };
    const conditional = await run(["Only after I contact official support myself."]);
    expect(conditional.assessment).toMatchObject({ decision: { label: "conditional_acceptance" }, verificationObservations: [{ channelProvenance: "user_claimed_independent" }] });
    expect(conditional).toMatchObject({ action: { status: "not_started" }, inAppVerification: { status: "not_observed" } });

    const sender = await run(["I'll call the number you just sent."]);
    expect(sender.assessment.verificationObservations[0]).toMatchObject({ behavior: "expressed_verification_intent", channelProvenance: "sender_supplied" });

    const ambiguous = await run(["Okay."]);
    expect(ambiguous.assessment.decision.label).toBe("unclear");
    expect(ambiguous.unresolvedQuestions.length).toBeGreaterThan(0);

    const changed = await run(["Yes, I'll send the code.", "I won't send the code."]);
    expect(changed.assessment.decision.label).toBe("refused");
    expect(changed.previousAssessment?.decision.label).toBe("explicit_acceptance");
  });

  test("idempotency over the database: duplicates apply once; reused key with new body conflicts", async ({ request }) => {
    const { session } = await create(request);
    const key = randomUUID();
    const responses = await Promise.all([1, 2, 3].map(() => say(request, session.sessionId, "Okay.", key)));
    const bodies = await Promise.all(responses.map(okBody));
    expect(bodies.filter((b) => b.duplicate).length).toBe(2);
    const after = await okBody(await say(request, session.sessionId, "Okay.", key));
    expect(after.session.messages.filter((m) => m.role === "user")).toHaveLength(1);
    const conflict = await say(request, session.sessionId, "Different", key);
    expect(conflict.status()).toBe(409);
    expect(ApiErrorResponseSchema.parse(await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await assessments(request, session.sessionId)).length).toBe(2);
  });

  test("simultaneous distinct turns: both recorded, never two applied records for one pair, latest turn assessed", async ({ request }) => {
    const { session } = await create(request);
    const [a, b] = await Promise.all([say(request, session.sessionId, "Okay."), say(request, session.sessionId, "Yes, I'll send the code.")]);
    await okBody(a);
    await okBody(b);
    await okBody(await request.post(`/api/observer/sessions/${session.sessionId}/process`, { headers }));
    const view = ObserverSessionResponseSchema.parse(await (await request.get(`/api/observer/sessions/${session.sessionId}`)).json()).session;
    const users = view.messages.filter((m) => m.role === "user");
    expect(users).toHaveLength(2);
    const records = await assessments(request, session.sessionId);
    const applied = records.filter((r) => r.application === "applied");
    const pairs = applied.map((r) => `${r.requestId}/${r.currentMessageId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const latest = users.at(-1)!.id;
    for (const r of view.requests) expect(applied.some((x) => x.requestId === r.id && x.currentMessageId === latest)).toBe(true);
    for (const o of await planner(request, session.sessionId)) expect(o.assessment.currentMessageId).toBe(latest);
  });

  test("verification needs the server-issued challenge; duplicate events apply once; inapplicable events are 422", async ({ request }) => {
    const { session } = await create(request);
    const key = randomUUID();
    const opened = await okBody(await act(request, session.sessionId, { type: "official_directory_opened", requestId: null }, key));
    const again = await okBody(await act(request, session.sessionId, { type: "official_directory_opened", requestId: null }, key));
    expect(again).toMatchObject({ duplicate: true, challengeId: opened.challengeId });
    expect(again.session.events).toHaveLength(1);
    expect(opened.session.requestStates.every((s) => s.inAppVerification.status === "directory_opened")).toBe(true);

    const forged = await act(request, session.sessionId, { type: "official_verification_completed", requestId: null, challengeId: "forged" });
    expect(forged.status()).toBe(422);
    expect(ApiErrorResponseSchema.parse(await forged.json()).error.reason).toBe("CHALLENGE_INVALID");
    const done = await okBody(await act(request, session.sessionId, { type: "official_verification_completed", requestId: null, challengeId: opened.challengeId }));
    expect(done.session.requestStates.every((s) => s.inAppVerification.status === "completed")).toBe(true);

    const wrong = await act(request, session.sessionId, { type: "simulated_payment_approved", requestId: codeOf(session).id });
    expect(ApiErrorResponseSchema.parse(await wrong.json()).error.reason).toBe("WRONG_REQUEST_TYPE");
    const smuggled = await request.post(`/api/observer/sessions/${session.sessionId}/events`, { headers, data: { idempotencyKey: randomUUID(), type: "practice_code_submitted", requestId: codeOf(session).id, code: "123456" } });
    expect(smuggled.status()).toBe(400);
  });

  test("ownership: other identities get 404 everywhere; malformed ids 404; cross-origin writes 403", async ({ request, playwright }) => {
    const { session } = await create(request);
    const stranger = await playwright.request.newContext({ baseURL: ORIGIN });
    const base = `/api/observer/sessions/${session.sessionId}`;
    for (const response of [
      await stranger.get(base),
      await stranger.get(`${base}/assessments`),
      await stranger.get(`${base}/planner`),
      await stranger.post(`${base}/messages`, { headers, data: { idempotencyKey: randomUUID(), content: "hi" } }),
      await stranger.post(`${base}/events`, { headers, data: { idempotencyKey: randomUUID(), type: "conversation_ended", requestId: null } }),
      await stranger.post(`${base}/process`, { headers }),
      await request.get("/api/observer/sessions/not-a-uuid"),
    ]) {
      expect(response.status()).toBe(404);
    }
    await stranger.dispose();
    const crossOrigin = await request.post(`${base}/messages`, { headers: { Origin: "https://evil.example" }, data: { idempotencyKey: randomUUID(), content: "hi" } });
    expect(crossOrigin.status()).toBe(403);
  });
});
