import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ApiErrorResponseSchema } from "@/contracts/api-error";
import { AssessmentsResponseSchema, ObserverSessionResponseSchema, type SubmitEventRequest } from "@/contracts/observer";
import { PlannerResponseSchema, PlansResponseSchema } from "@/contracts/planner";

// Real API + Postgres (Neon test branch), mobile-code-01 scenario. Models are the LABELED test-only fixture
// models (E2E_TEST=1 + OBSERVER_MODEL_MODE=fixture): this proves persistence, lifecycle, ownership and
// idempotency over HTTP — not semantic quality. Real-model behavior: `pnpm observer:eval`.

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
async function reason(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(response.status()).toBe(422);
  return ApiErrorResponseSchema.parse(await response.json()).error.reason;
}
const assessments = async (request: APIRequestContext, id: string) => AssessmentsResponseSchema.parse(await (await request.get(`/api/observer/sessions/${id}/assessments`)).json()).assessments;
const planner = async (request: APIRequestContext, id: string) => PlannerResponseSchema.parse(await (await request.get(`/api/observer/sessions/${id}/planner`)).json());
const plans = async (request: APIRequestContext, id: string) => PlansResponseSchema.parse(await (await request.get(`/api/observer/sessions/${id}/plans`)).json()).plans;

/** Question → answer, then "Okay." → the request card is presented. */
async function withRequest(request: APIRequestContext) {
  const { session } = await create(request);
  await okBody(await say(request, session.sessionId, "Who are you?"));
  const presented = await okBody(await say(request, session.sessionId, "Okay."));
  return { id: session.sessionId, session: presented.session };
}

test.describe("practice session API (observer + planner)", () => {
  test("create: cookie identity, no-store, fixed opening, no request yet, nothing private exposed", async ({ request }) => {
    const response = await request.post("/api/observer/sessions", { headers });
    expect(response.status()).toBe(201);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toMatch(/scamper_player=/);
    const { session } = ObserverSessionResponseSchema.parse(await response.json());
    expect(session).toMatchObject({ stage: "active", outcome: null, requestStatus: "not_presented", practiceCode: null, maxTurns: 12 });
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toMatch(/^Hi, I'm Avery from Cedar Account Support/);
    expect(session.requests).toHaveLength(0);
    expect(JSON.stringify(session)).not.toMatch(/ownerKey|anon:|challengeId|CD-\d{6}/);
  });

  test("question is answered, then the request is presented once; planner payload never sees hidden facts", async ({ request }) => {
    const { id, session } = await withRequest(request);
    expect(session.requestStatus).toBe("pending");
    expect(session.requests).toHaveLength(1);
    expect(session.practiceCode).toMatch(/^\d{6}$/);
    expect(session.issues[0]).toMatchObject({ kind: "identity_question", status: "addressed" });
    expect(session.messages.filter((m) => m.role === "assistant")).toHaveLength(3);
    const committed = (await plans(request, id)).filter((p) => p.status === "committed");
    expect(committed).toHaveLength(2);
    const handoff = JSON.stringify(await planner(request, id));
    expect(handoff).not.toContain(session.practiceCode!);
    expect(handoff).not.toMatch(/not initiated by Cedar|not_initiated_by_provider/);
    expect((await assessments(request, id)).every((r) => r.observerModel === "fixture-observer")).toBe(true);
  });

  test("refusal without ending; wrong code rejected; the server's code ends as simulated exposure", async ({ request }) => {
    const { id, session } = await withRequest(request);
    const refused = await okBody(await say(request, id, "I won't send the code."));
    expect(refused.session).toMatchObject({ ended: false, stage: "active" });
    expect(refused.session.messages.at(-1)!.role).toBe("assistant");
    const requestId = session.requests[0].id;
    const wrong = session.practiceCode === "000000" ? "111111" : "000000";
    expect(await reason(await act(request, id, { type: "practice_code_submitted", requestId, practiceCode: wrong }))).toBe("CODE_MISMATCH");
    const done = await okBody(await act(request, id, { type: "practice_code_submitted", requestId, practiceCode: session.practiceCode! }));
    expect(done.session).toMatchObject({ ended: true, outcome: "simulated_exposure", requestStatus: "completed" });
    expect(await reason(await say(request, id, "hello?"))).toBe("SESSION_ENDED");
  });

  test("verification pauses the opponent; completion requires the challenge; reject and report ends as defense", async ({ request }) => {
    const { id } = await withRequest(request);
    const started = await okBody(await act(request, id, { type: "official_verification_started", requestId: null }));
    expect(started.session).toMatchObject({ stage: "verifying", verification: { status: "in_progress" } });
    expect(started.session.verification.officialResult).toMatch(/not initiated by Cedar Mobile/);
    expect(await reason(await say(request, id, "Are you there?"))).toBe("STAGE_PAUSED");
    expect(await reason(await act(request, id, { type: "official_verification_completed", requestId: null, challengeId: "forged" }))).toBe("CHALLENGE_INVALID");
    const done = await okBody(await act(request, id, { type: "official_verification_completed", requestId: null, challengeId: started.challengeId }));
    expect(done.session.stage).toBe("awaiting_final_decision");
    const ended = await okBody(await act(request, id, { type: "conversation_reported", requestId: null }));
    expect(ended.session).toMatchObject({ ended: true, outcome: "defense_demonstrated" });
  });

  test("text stop ends safely; ambiguous stop asks for confirmation without generation", async ({ request }) => {
    const a = (await create(request)).session.sessionId;
    const stopped = await okBody(await say(request, a, "I want to stop the exercise."));
    expect(stopped.session).toMatchObject({ ended: true, outcome: "safely_disengaged" });
    const b = (await create(request)).session.sessionId;
    const paused = await okBody(await say(request, b, "stop"));
    expect(paused.session.stopConfirmationPending).toBe(true);
    expect(paused.session.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    const resumed = await okBody(await act(request, b, { type: "stop_confirmation_dismissed", requestId: null }));
    expect(resumed.session.stopConfirmationPending).toBe(false);
  });

  test("idempotency over the database: duplicates apply once; reused key with new body conflicts", async ({ request }) => {
    const { session } = await create(request);
    const key = randomUUID();
    const bodies = await Promise.all((await Promise.all([1, 2, 3].map(() => say(request, session.sessionId, "Okay.", key)))).map(okBody));
    expect(bodies.filter((b) => b.duplicate).length).toBe(2);
    const after = await okBody(await say(request, session.sessionId, "Okay.", key));
    expect(after.session.messages.filter((m) => m.role === "user")).toHaveLength(1);
    const conflict = await say(request, session.sessionId, "Different", key);
    expect(conflict.status()).toBe(409);
    expect(ApiErrorResponseSchema.parse(await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await plans(request, session.sessionId)).filter((p) => p.status === "committed")).toHaveLength(1);
  });

  test("ownership: other identities get 404 everywhere; malformed ids 404; cross-origin writes 403", async ({ request, playwright }) => {
    const { session } = await create(request);
    const stranger = await playwright.request.newContext({ baseURL: ORIGIN });
    const base = `/api/observer/sessions/${session.sessionId}`;
    for (const response of [
      await stranger.get(base),
      await stranger.get(`${base}/assessments`),
      await stranger.get(`${base}/planner`),
      await stranger.get(`${base}/plans`),
      await stranger.post(`${base}/messages`, { headers, data: { idempotencyKey: randomUUID(), content: "hi" } }),
      await stranger.post(`${base}/events`, { headers, data: { idempotencyKey: randomUUID(), type: "conversation_ended", requestId: null } }),
      await stranger.post(`${base}/retry`, { headers, data: { idempotencyKey: randomUUID() } }),
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
