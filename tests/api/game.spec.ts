import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ApiErrorResponseSchema } from "@/contracts/api-error";
import {
  ActionResponseSchema,
  DebriefResponseSchema,
  DeveloperLogResponseSchema,
  ReplayResponseSchema,
  SessionResponseSchema,
  type PlayerAction,
  type PlayerView,
} from "@/contracts/game";

// The test server has no MODEL_* env, so opponent turns use the LABELED scripted fallback
// (fallbackReason "provider_unconfigured"). Live-provider acceptance is checked separately (pnpm game:smoke).

const ORIGIN = "http://127.0.0.1:3100";

async function create(request: APIRequestContext, body: object = { opponentMode: "live" }) {
  const response = await request.post("/api/game/sessions", { data: body, headers: { Origin: ORIGIN } });
  expect(response.status(), await response.text()).toBe(201);
  return SessionResponseSchema.parse(await response.json()).session;
}

async function act(request: APIRequestContext, view: PlayerView, action: PlayerAction, actionId = randomUUID()) {
  return request.post(`/api/game/sessions/${view.sessionId}/actions`, {
    data: { actionId, expectedVersion: view.version, action },
    headers: { Origin: ORIGIN },
  });
}

async function ok(request: APIRequestContext, view: PlayerView, action: PlayerAction) {
  const response = await act(request, view, action);
  expect(response.status(), await response.text()).toBe(200);
  return ActionResponseSchema.parse(await response.json()).session;
}

const pending = (view: PlayerView) => view.paymentRequests.find((r) => r.status === "pending")!;

async function playToLoss(request: APIRequestContext) {
  let view = await create(request);
  view = await ok(request, view, { type: "send_message", text: "What do I need to do?" });
  view = await ok(request, view, { type: "inspect_payment", requestId: pending(view).requestId });
  view = await ok(request, view, { type: "approve_payment", requestId: pending(view).requestId });
  return view;
}

test.describe("game API", () => {
  test("create issues an httpOnly player cookie, no-store, request id; opening view is public-only", async ({ request }) => {
    const response = await request.post("/api/game/sessions", { headers: { Origin: ORIGIN } });
    expect(response.status()).toBe(201);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers()["set-cookie"]).toMatch(/scamper_player=[^;]+;.*HttpOnly.*SameSite=Lax/i);
    const view = SessionResponseSchema.parse(await response.json()).session;
    expect(view).toMatchObject({ version: 1, status: "active", bank: { balance: 1500 }, verification: { facts: [] } });
    expect(JSON.stringify(view)).not.toMatch(/ownerKey|anon:/);
  });

  test("E13/E14 loss path over HTTP with labeled fallback; reload preserves state", async ({ request }) => {
    const view = await playToLoss(request);
    expect(view.bank.balance).toBe(1000);
    expect(view.outcome).toMatchObject({ kind: "loss", fundsLost: true, amountLost: 500 });
    expect(view.messages.filter((m) => m.from === "opponent" && m.origin !== "scenario").every((m) => m.origin === "scripted_fallback")).toBe(true);
    expect(view.opponent.lastTurn?.fallbackReason).toBe("provider_unconfigured");
    const reload = await request.get(`/api/game/sessions/${view.sessionId}`);
    expect(SessionResponseSchema.parse(await reload.json()).session).toEqual(view);
    const debrief = DebriefResponseSchema.parse(await (await request.get(`/api/game/sessions/${view.sessionId}/debrief`)).json());
    expect(debrief.decisiveEvent.type).toBe("payment.approved");
    expect(debrief.outcome.fundsLost).toBe(true);
  });

  test("E4/E6 replay folds stored events (after a real DB round trip) and equals saved state", async ({ request }) => {
    const view = await playToLoss(request);
    const replay = ReplayResponseSchema.parse(await (await request.get(`/api/game/sessions/${view.sessionId}/replay`)).json());
    expect(replay.reconstruction.matchesStoredState).toBe(true);
    expect(replay.events.map((e) => e.sequence)).toEqual(replay.events.map((_, i) => i + 1));
    expect(replay.events.at(-1)!.snapshot).toMatchObject({ balance: 1000, outcomeKind: "loss" });
    expect(replay.decisiveEventId).toBe(view.outcome!.decisiveEventId);
  });

  test("E5 retry with the same action id is deduplicated; same id with a different body conflicts", async ({ request }) => {
    let view = await create(request);
    view = await ok(request, view, { type: "send_message", text: "hi" });
    view = await ok(request, view, { type: "inspect_payment", requestId: pending(view).requestId });
    const actionId = randomUUID();
    const first = await act(request, view, { type: "approve_payment", requestId: pending(view).requestId }, actionId);
    const second = await act(request, view, { type: "approve_payment", requestId: pending(view).requestId }, actionId);
    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    const dup = ActionResponseSchema.parse(await second.json());
    expect(dup.result.status).toBe("duplicate");
    expect(dup.session.bank.balance).toBe(1000);
    const conflict = await act(request, view, { type: "end_encounter" }, actionId);
    expect(conflict.status()).toBe(409);
    expect(ApiErrorResponseSchema.parse(await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("E6 concurrent distinct approvals debit at most once (database CAS)", async ({ request }) => {
    let view = await create(request);
    view = await ok(request, view, { type: "send_message", text: "hi" });
    view = await ok(request, view, { type: "inspect_payment", requestId: pending(view).requestId });
    const requestId = pending(view).requestId;
    const responses = await Promise.all(Array.from({ length: 4 }, () => act(request, view, { type: "approve_payment", requestId })));
    const statuses = responses.map((r) => r.status()).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    for (const r of responses.filter((r) => r.status() !== 200)) {
      expect(r.status()).toBe(409);
      expect(ApiErrorResponseSchema.parse(await r.json()).error).toMatchObject({ code: "VERSION_CONFLICT", currentVersion: expect.any(Number) });
    }
    const final = SessionResponseSchema.parse(await (await request.get(`/api/game/sessions/${view.sessionId}`)).json()).session;
    expect(final.bank.balance).toBe(1000);
    expect(final.bank.transactions.filter((t) => t.eventId !== null)).toHaveLength(1);
  });

  test("E3 invalid and reserved input rejected without mutation", async ({ request }) => {
    const view = await create(request);
    const cases: Array<[unknown, number, string]> = [
      [{ actionId: randomUUID(), expectedVersion: 1, action: { type: "approve_payment", requestId: "req-1", amount: 1 } }, 400, "VALIDATION_ERROR"],
      [{ actionId: randomUUID(), expectedVersion: 1, ownerId: "x", action: { type: "end_encounter" } }, 400, "VALIDATION_ERROR"],
      [{ actionId: randomUUID(), expectedVersion: 1, action: { type: "ledger.debited", amount: 500 } }, 400, "VALIDATION_ERROR"],
      [{ actionId: randomUUID(), expectedVersion: 1, action: { type: "approve_payment", requestId: "req-9" } }, 422, "ACTION_REJECTED"],
      [{ actionId: randomUUID(), expectedVersion: 7, action: { type: "end_encounter" } }, 409, "VERSION_CONFLICT"],
    ];
    for (const [data, status, code] of cases) {
      const response = await request.post(`/api/game/sessions/${view.sessionId}/actions`, { data, headers: { Origin: ORIGIN } });
      expect(response.status(), JSON.stringify(data)).toBe(status);
      expect(ApiErrorResponseSchema.parse(await response.json()).error.code).toBe(code);
    }
    const malformed = await request.post(`/api/game/sessions/${view.sessionId}/actions`, { data: "{nope", headers: { Origin: ORIGIN, "Content-Type": "application/json" } });
    expect(malformed.status()).toBe(400);
    const after = SessionResponseSchema.parse(await (await request.get(`/api/game/sessions/${view.sessionId}`)).json()).session;
    expect(after.version).toBe(1);
    expect(after.lastSequence).toBe(view.lastSequence);
  });

  test("E7 another cookie identity cannot read, act on, replay, debrief, fork, or inspect logs; malformed ids are 404", async ({ playwright, baseURL }) => {
    const owner = await playwright.request.newContext({ baseURL });
    const intruder = await playwright.request.newContext({ baseURL });
    try {
      const view = await playToLoss(owner);
      const id = view.sessionId;
      const calls = [
        intruder.get(`/api/game/sessions/${id}`),
        intruder.get(`/api/game/sessions/${id}/replay`),
        intruder.get(`/api/game/sessions/${id}/debrief`),
        intruder.get(`/api/game/sessions/${id}/developer`),
        intruder.post(`/api/game/sessions/${id}/fork`, { data: { checkpointId: "before-payment-decision" }, headers: { Origin: ORIGIN } }),
        intruder.post(`/api/game/sessions/${id}/actions`, {
          data: { actionId: randomUUID(), expectedVersion: view.version, action: { type: "submit_reflection", warningSignIds: ["urgency"] } },
          headers: { Origin: ORIGIN },
        }),
        owner.get("/api/game/sessions/not-a-uuid"),
        owner.get(`/api/game/sessions/${randomUUID()}`),
      ];
      for (const response of await Promise.all(calls)) {
        expect(response.status()).toBe(404);
        expect(ApiErrorResponseSchema.parse(await response.json()).error.code).toBe("NOT_FOUND");
      }
      const forged = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `scamper_player=${randomUUID()}.forged` } });
      expect((await forged.get(`/api/game/sessions/${id}`)).status()).toBe(404);
      await forged.dispose();
      const still = SessionResponseSchema.parse(await (await owner.get(`/api/game/sessions/${id}`)).json()).session;
      expect(still).toMatchObject({ version: view.version, reflectionSubmitted: false });
    } finally {
      await owner.dispose();
      await intruder.dispose();
    }
  });

  test("cross-origin mutations are refused", async ({ request }) => {
    const response = await request.post("/api/game/sessions", { headers: { Origin: "https://evil.example" } });
    expect(response.status()).toBe(403);
    expect(ApiErrorResponseSchema.parse(await response.json()).error.code).toBe("FORBIDDEN");
  });

  test("E16/E17/E18 fork: predefined checkpoint only, new id + lineage, original untouched, protected outcome", async ({ request }) => {
    const original = await playToLoss(request);
    const originalReplay = await (await request.get(`/api/game/sessions/${original.sessionId}/replay`)).json();

    const bad = await request.post(`/api/game/sessions/${original.sessionId}/fork`, { data: { checkpointId: "before-payment-decision", sequence: 2 }, headers: { Origin: ORIGIN } });
    expect(bad.status()).toBe(400);

    const forkResponse = await request.post(`/api/game/sessions/${original.sessionId}/fork`, { data: { checkpointId: "before-payment-decision" }, headers: { Origin: ORIGIN } });
    expect(forkResponse.status(), await forkResponse.text()).toBe(201);
    let fork = SessionResponseSchema.parse(await forkResponse.json()).session;
    expect(fork.sessionId).not.toBe(original.sessionId);
    expect(fork.lineage).toMatchObject({ parentSessionId: original.sessionId, checkpointEventId: original.checkpoint.eventId });
    expect(fork).toMatchObject({ status: "active", bank: { balance: 1500 } });

    fork = await ok(request, fork, { type: "verify_trusted_contact", contactId: "mrb-official" });
    fork = await ok(request, fork, { type: "reject_payment", requestId: pending(fork).requestId });
    fork = await ok(request, fork, { type: "end_encounter" });
    expect(fork.outcome).toMatchObject({ kind: "protected", fundsLost: false });

    const forkReplay = ReplayResponseSchema.parse(await (await request.get(`/api/game/sessions/${fork.sessionId}/replay`)).json());
    expect(forkReplay.reconstruction.matchesStoredState).toBe(true);
    expect(forkReplay.events.filter((e) => e.inherited).map((e) => e.sourceEventId)).toEqual(
      (originalReplay.events as Array<{ eventId: string; sequence: number }>).filter((e) => e.sequence <= original.checkpoint.sequence!).map((e) => e.eventId),
    );

    const afterReplay = await (await request.get(`/api/game/sessions/${original.sessionId}/replay`)).json();
    expect({ ...afterReplay, lineage: undefined }).toEqual({ ...originalReplay, lineage: undefined });
    expect(afterReplay.lineage.forkSessionIds).toEqual([fork.sessionId]);
    const parent = SessionResponseSchema.parse(await (await request.get(`/api/game/sessions/${original.sessionId}`)).json()).session;
    expect(parent.outcome?.kind).toBe("loss");
    expect(parent.bank.balance).toBe(1000);
    const forkDebrief = DebriefResponseSchema.parse(await (await request.get(`/api/game/sessions/${fork.sessionId}/debrief`)).json());
    expect(forkDebrief.isPracticeBranch).toBe(true);
  });

  test("developer log shows tool calls and fallback labels without prompts", async ({ request }) => {
    const view = await playToLoss(request);
    const log = DeveloperLogResponseSchema.parse(await (await request.get(`/api/game/sessions/${view.sessionId}/developer`)).json());
    expect(log.turns).toHaveLength(1);
    expect(log.turns[0]).toMatchObject({ status: "completed", origin: "scripted_fallback", fallbackReason: "provider_unconfigured" });
    expect(log.turns[0].toolCalls.map((c) => [c.name, c.status])).toEqual([
      ["sendSimulatedMessage", "applied"],
      ["presentPaymentRequest", "applied"],
    ]);
    expect(JSON.stringify(log)).not.toContain("TRAINING SIMULATION");
  });
});
