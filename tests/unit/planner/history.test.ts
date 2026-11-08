import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ObserverService } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import { FixtureStructuredModel } from "@/server/observer/testing/fixture-model";
import { DETERMINISTIC_TEST_RESERVATIONS as R } from "../../fixtures/reference";

function service(now = () => new Date(R.timestamp)) {
  return new ObserverService({
    store: new MemoryObserverStore(),
    models: () => ({ observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") }),
    policy: "consequential_and_flagged",
    timeoutMs: 1000,
    now,
  });
}

describe("server-side history and progress (backend-completion brief §5)", () => {
  it("B01: each owner lists only their own sessions; another owner gets 404 for a foreign session", async () => {
    const svc = service();
    const a = (await svc.createSession(R.ownerA)).session.sessionId;
    await svc.createSession(R.ownerB);
    const list = await svc.history(R.ownerA, 20, undefined);
    expect(list.sessions.map((s) => s.sessionId)).toEqual([a]);
    await expect(svc.getSession(R.ownerB, a)).rejects.toMatchObject({ status: 404 });
  });

  it("B21: equal creation timestamps paginate stably with no omission or duplication", async () => {
    const svc = service(); // every session gets the same createdAt
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push((await svc.createSession(R.ownerA)).session.sessionId);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await svc.history(R.ownerA, 3, cursor);
      seen.push(...page.sessions.map((s) => s.sessionId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen).toEqual([...ids].sort().reverse());
  });

  it("summaries are neutral (no scenario id or kind) and progress counts each ended outcome once", async () => {
    const svc = service(() => new Date());
    const id = (await svc.createSession(R.ownerA)).session.sessionId;
    await svc.submitEvent(R.ownerA, id, { idempotencyKey: randomUUID(), type: "conversation_reported", requestId: null });
    await svc.createSession(R.ownerA);
    const list = await svc.history(R.ownerA, 20, undefined);
    expect(JSON.stringify(list)).not.toMatch(/mobile-code|fraudulent|legitimate/);
    const progress = await svc.progress(R.ownerA);
    expect(progress).toMatchObject({ completed: 1, outcomes: { defense_demonstrated: 1 }, observations: { reported: 1 } });
  });

  it("rejects a malformed cursor", async () => {
    await expect(service().history(R.ownerA, 20, "not-a-cursor")).rejects.toMatchObject({ status: 422 });
  });
});
