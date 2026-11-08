import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StructuredModel, StructuredRequest, StructuredResult } from "@/server/observer/model";
import { pauseMessage } from "@/server/observer/service";
import { FixtureActorModel, FixturePlannerModel } from "@/server/planner/testing/fixture-models";
import { OWNER, started } from "./session-fixture";

/**
 * Server-derived turn status (manual-test fixes): the browser shows the player's message at once and follows
 * `turnStatus`, so the status must be right for every state the processor can be in, and recoverable after
 * a reload (it is computed from the stored snapshot, never kept in memory).
 */

class Failing implements StructuredModel {
  constructor(private readonly inner: StructuredModel) {}
  get modelId() {
    return this.inner.modelId;
  }
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    return { ok: false, failure: "http_error", detail: `probe (${request.stage})` };
  }
}

async function deferredGame(options: Parameters<typeof started>[0] = {}) {
  const s = await started({ planner: () => new FixturePlannerModel(), actor: () => new FixtureActorModel(), ...options });
  const queue: Array<() => Promise<unknown>> = [];
  const sayDeferred = (content: string, key = randomUUID()) => s.service.submitMessage(OWNER, s.id, { idempotencyKey: key, content, respond: "after_save" }, (work) => queue.push(work));
  const drain = async () => {
    while (queue.length) await queue.shift()!();
  };
  const view = async () => (await s.service.getSession(OWNER, s.id)).session;
  return { ...s, sayDeferred, drain, view, queue };
}

describe("turnStatus and deferred submission", () => {
  it("after_save returns the durable message as 'generating' before any model runs; the deferred work then answers it", async () => {
    const g = await deferredGame();
    const r = await g.sayDeferred("Who are you?");
    expect(r.processing).toEqual({ status: "queued", assessed: 0, stale: 0 });
    expect(r.session.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(r.session.turnStatus.state).toBe("generating");
    // A reload before the work runs sees the same state (derived from storage, not memory).
    expect((await g.view()).turnStatus).toMatchObject({ state: "generating", reason: "observing" });
    expect(g.queue).toHaveLength(1);
    await g.drain();
    const after = await g.view();
    expect(after.messages.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
    expect(after.turnStatus).toEqual({ state: "idle", reason: null, message: null });
  });

  it("a duplicate submission (same key) does not add a second message and stays consistent", async () => {
    const g = await deferredGame();
    const key = randomUUID();
    await g.sayDeferred("Who are you?", key);
    const again = await g.sayDeferred("Who are you?", key);
    expect(again.duplicate).toBe(true);
    expect(again.session.messages.filter((m) => m.role === "user")).toHaveLength(1);
    await g.drain();
    expect((await g.view()).messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("a generation failure after the message was saved reports 'failed' with the existing technical notice", async () => {
    const g = await deferredGame({ actor: () => new Failing(new FixtureActorModel()) });
    await g.sayDeferred("Who are you?");
    await g.drain();
    const v = await g.view();
    expect(v.technicalNotice?.canRetry).toBe(true);
    expect(v.turnStatus).toEqual({ state: "failed", reason: "planning_failed", message: null });
    expect(v.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("End practice before the deferred work runs: idle, no reply ever commits, and the review explains why", async () => {
    const g = await deferredGame();
    await g.sayDeferred("asdf");
    const ended = await g.act({ type: "conversation_ended", requestId: null });
    expect(ended.session.turnStatus.state).toBe("idle");
    await g.drain(); // the late worker runs after the stop
    const v = await g.view();
    expect(v.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    const explain = await g.service.explain(OWNER, g.id);
    expect(explain.turns[0].noReply).toMatch(/^Stopped \(conversation ended\)/);
  });

  it("an intentional rule wait is 'paused' with its rule (P1: the player opened the official check), not 'generating'", async () => {
    const g = await deferredGame();
    await g.sayDeferred("Who are you?");
    await g.act({ type: "official_verification_started", requestId: null });
    await g.drain();
    const v = await g.view();
    expect(v.stage).toBe("verifying");
    expect(v.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(v.turnStatus).toEqual({ state: "paused", reason: "P1", message: null }); // the verification banner explains it
  });
});

describe("pauseMessage (player-facing wording for rule waits)", () => {
  it("explains verification waits, acceptance waits and processing fallbacks; P1 has its own UI", () => {
    expect(pauseMessage("P6", "Verification intent: wait for the user.", "Cedar Account Support")).toMatch(/waiting while you check with official support/);
    expect(pauseMessage("P4", "Clear independent-verification condition: wait for the user.", "Cedar Account Support")).toMatch(/Check official support/);
    expect(pauseMessage("P7", "Explicit acceptance: wait for the actual user action.", "X")).toMatch(/request card/);
    expect(pauseMessage("P2", "Observer fallback and no pending request.", "X")).toMatch(/couldn't be processed/);
    expect(pauseMessage("P8", "Unclear without ambiguity evidence.", "X")).toMatch(/didn't clearly accept or decline/);
    expect(pauseMessage("P1", "Opponent paused (verifying).", "X")).toBeNull();
    expect(pauseMessage("P3", "Open issues; repetition exclusions emptied the set", "X")).toMatch(/nothing new to add/);
  });
});
