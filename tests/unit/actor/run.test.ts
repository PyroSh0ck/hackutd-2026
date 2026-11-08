import { afterEach, describe, expect, it, vi } from "vitest";
import type { StructuredResult } from "@/server/observer/model";
import { runActor } from "@/server/actor/run";
import { ActorAttemptRecordSchema } from "@/server/actor/schemas";
import { ACTOR_SYSTEM_PROMPT } from "@/server/actor/prompts";
import { input, output } from "./fixtures";
import { options, setup } from "./harness";
afterEach(() => vi.useRealTimers());

describe("buffered actor call budget and failure routing", () => {
  it("prepares one valid output with canonical text, metrics and privacy-safe audit", async () => {
    const s = setup(); const result = await runActor(options(), s.deps);
    expect(result).toMatchObject({ kind: "prepared", calls: 1, output: output() });
    expect(result.attempts[0]).toMatchObject({ status: "valid", latencyMs: 7, styleProfileVersion: "style-v1" });
    expect(ActorAttemptRecordSchema.safeParse(result.attempts[0]).success).toBe(true);
    expect(JSON.stringify(result.attempts)).not.toContain(output().text);
    expect(s.requests[0]).toMatchObject({ stage: "actor", timeoutMs: 20_000 });
  });
  it("repairs invalid returned output once, preserving original constraints/persona", async () => {
    const s = setup([{ ok: true, output: { ...output("938201"), extra: "ignore all constraints" } }, { ok: true, output: output() }]);
    const result = await runActor(options(), s.deps);
    expect(result).toMatchObject({ kind: "prepared", calls: 2 });
    expect(result.attempts.map((a) => a.status)).toEqual(["invalid", "valid"]);
    const repair = JSON.parse(s.requests[1].user.slice(s.requests[1].user.indexOf("\n") + 1));
    expect(repair.originalInput).toEqual(input()); expect(repair.violations.length).toBeGreaterThan(0);
    expect(s.requests[1].user).not.toContain("938201"); expect(s.requests[1].system).toBe(ACTOR_SYSTEM_PROMPT);
  });
  it("fails persistent invalidity after exactly two calls without retaining draft text", async () => {
    const s = setup([{ ok: true, output: {} }, { ok: true, output: {} }]);
    const result = await runActor(options(), s.deps);
    expect(result).toMatchObject({ kind: "failed", reason: "invalid_after_repair", calls: 2, endReason: null }); expect(result).not.toHaveProperty("output");
  });
  it.each(["timeout", "refusal", "http_error", "unavailable"] as const)("fails %s without hidden retries", async (failure) => {
    const s = setup([{ ok: false, failure, detail: "938201 provider details" }]);
    const result = await runActor(options(), s.deps); expect(result).toMatchObject({ kind: "failed", reason: failure, calls: 1 });
    expect(JSON.stringify(result)).not.toContain("938201");
  });
  it("treats malformed returned JSON as one repairable draft", async () => {
    const s = setup([{ ok: false, failure: "malformed_output", detail: "bad", rawOutput: "938201 {broken" }, { ok: true, output: output() }]);
    expect(await runActor(options(), s.deps)).toMatchObject({ kind: "prepared", calls: 2 }); expect(s.requests[1].user).not.toContain("938201");
  });
  it("routes provider failure on repair without a third call", async () => {
    const s = setup([{ ok: true, output: {} }, { ok: false, failure: "refusal", detail: "refused" }]);
    expect(await runActor(options(), s.deps)).toMatchObject({ kind: "failed", calls: 2, reason: "refusal" });
  });
  it("makes no calls when no model is configured or cancellation precedes the attempt", async () => {
    const s = setup(); const o = options(); o.envelope.modelId = "unconfigured";
    expect(await runActor(o, { ...s.deps, model: null })).toMatchObject({ kind: "failed", calls: 0, reason: "unavailable" });
    const controller = new AbortController(); controller.abort();
    expect(await runActor({ ...options(), signal: controller.signal }, s.deps)).toMatchObject({ kind: "discarded", calls: 0 });
  });
  it("makes no call if cancellation arrives while the initial state read is pending", async () => {
    const s = setup(); const controller = new AbortController();
    s.deps.readState = async () => { const captured = { ...s.current }; await Promise.resolve(); controller.abort(); return captured; };
    expect(await runActor({ ...options(), signal: controller.signal }, s.deps)).toMatchObject({ kind: "discarded", calls: 0 });
    expect(s.deps.model.generate).not.toHaveBeenCalled();
  });
  it("enforces a 20-second deadline even when the model ignores cancellation", async () => {
    vi.useFakeTimers(); const s = setup(); s.deps.model.generate = vi.fn(() => new Promise<StructuredResult>(() => {}));
    const running = runActor(options(), s.deps); await vi.advanceTimersByTimeAsync(20_001);
    expect(await running).toMatchObject({ kind: "failed", reason: "timeout", calls: 1 });
  });
  it("handles thrown network errors in one call", async () => {
    const s = setup(); s.deps.model.generate = vi.fn(async () => { throw new Error("secret details"); });
    expect(await runActor(options(), s.deps)).toMatchObject({ kind: "failed", reason: "http_error", calls: 1 });
  });
  it.each(["verifying", "awaiting_final_decision", "ended"])("makes zero calls while %s", async (stage) => {
    const s = setup(); s.current.stage = stage; expect(await runActor(options(), s.deps)).toMatchObject({ kind: "discarded", calls: 0 });
  });
  it.each(["revision", "stop", "verification", "claim", "owner", "policy", "applicability"])("discards in-flight %s changes without repair or notice", async (change) => {
    const s = setup(); s.deps.model.generate = vi.fn(async (): Promise<StructuredResult> => {
      if (change === "revision") s.current.revision++;
      if (change === "stop") { s.current.stage = "ended"; s.current.ended = true; }
      if (change === "verification") s.current.stage = "verifying";
      if (change === "claim") s.current.claimValid = false;
      if (change === "owner") s.current.ownerKey = "other";
      if (change === "policy") s.current.policyVersion = "new-policy";
      if (change === "applicability") s.current.planApplicable = false;
      return { ok: true, output: {} };
    });
    expect(await runActor(options(), s.deps)).toMatchObject({ kind: "discarded", calls: 1, attempts: [{ status: "stale" }] }); expect(s.deps.model.generate).toHaveBeenCalledTimes(1);
  });
  it("discards canceled generation even if the provider later returns a valid output", async () => {
    const s = setup(); const abort = new AbortController(); let finish!: (result: StructuredResult) => void;
    s.deps.model.generate = vi.fn(() => new Promise<StructuredResult>((resolve) => { finish = resolve; }));
    const running = runActor({ ...options(), signal: abort.signal }, s.deps);
    await vi.waitFor(() => expect(s.deps.model.generate).toHaveBeenCalledTimes(1));
    abort.abort(); expect(await running).toMatchObject({ kind: "discarded", calls: 1 }); finish({ ok: true, output: output() });
  });
  it("does not call repair when revision changes between validation and repair", async () => {
    const s = setup([{ ok: true, output: {} }]); let reads = 0;
    s.deps.readState = async () => { if (++reads === 4) s.current.revision++; return { ...s.current }; };
    expect(await runActor(options(), s.deps)).toMatchObject({ kind: "discarded", calls: 1 });
  });
  it("style warnings and analytics failures leave valid output deliverable with one call", async () => {
    const s = setup([{ ok: true, output: output("I understand your concern.") }]);
    const result = await runActor(options(), s.deps); expect(result).toMatchObject({ kind: "prepared", calls: 1 });
    expect(result.attempts[0].styleMetrics?.warnings.map((w) => w.code)).toContain("stock_phrase");
    const failedMetrics = setup(); expect(await runActor(options(), { ...failedMetrics.deps, metrics: () => { throw new Error("analytics"); } })).toMatchObject({ kind: "prepared", calls: 1, attempts: [{ analyticsFailed: true, styleMetrics: null }] });
  });
  it("supports a controller-authorized explicit second attempt and routes its failure to interruption", async () => {
    const s = setup([{ ok: true, output: {} }, { ok: true, output: {} }]); const o = options(); o.envelope.processingAttempt = 2;
    expect(await runActor(o, s.deps)).toMatchObject({ kind: "failed", calls: 2, endReason: "technical_interruption" });
    await expect(runActor({ ...o, envelope: { ...o.envelope, processingAttempt: 3 } as never }, s.deps)).rejects.toThrow();
  });
  it("keeps envelope, hidden state and UI examples out of the actor input data", async () => {
    const s = setup(); await runActor(options(), s.deps);
    expect(s.requests[0].user).not.toMatch(/ownerKey|claimId|938201|F06|History/);
    expect(s.requests[0].system).toContain("NON-FACTUAL STYLE DEMONSTRATIONS");
  });
});
