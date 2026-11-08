import { describe, expect, it, vi } from "vitest";
import { commitActorResponse, type ActorCommitPort } from "@/server/actor/commit";
import { executionViolations, runActor, type PreparedActorResponse } from "@/server/actor/run";
import { validateActorOutput } from "@/server/actor/validate";
import type { ActorEnvelope } from "@/server/actor/schemas";
import { options, setup } from "./harness";
import { output } from "./fixtures";

/** Explicit MOCK transaction port. Exercises the actor boundary, not production PostgreSQL behavior.
 * A serialized durable blob simulates a persistence reload; a single atomic assignment simulates commit. */
class MockAtomicPort implements ActorCommitPort {
  execution = setup().current;
  durable = { messages: [] as Array<{ messageId: string; text: string; inputEventId: string }>, requests: [] as string[], events: [] as string[], additions: [] as string[], addressed: [] as string[], attempts: [] as unknown[], retries: {} as Record<string, number> };
  failAt: "message" | "request" | "addition" | "issue" | "audit" | null = null;
  beforeTransaction: (() => void) | null = null;
  async readValidationState() { return { execution: { ...this.execution }, validation: { reserved: options().reserved, knownSecrets: options().knownSecrets, state: { ...this.execution } } }; }
  async findCommitted(e: ActorEnvelope) {
    if (e.ownerKey !== this.execution.ownerKey || e.sessionId !== this.execution.sessionId) return null;
    return this.durable.messages.find((m) => m.inputEventId === e.inputEventId) ?? null;
  }
  async commitValidated(response: PreparedActorResponse) {
    this.beforeTransaction?.();
    const e = response.envelope;
    const existing = e.ownerKey === this.execution.ownerKey && e.sessionId === this.execution.sessionId ? this.durable.messages.find((m) => m.inputEventId === e.inputEventId) : null;
    if (existing) return { kind: "duplicate" as const, ...existing };
    if (executionViolations(this.execution, e).length) return { kind: "stale" as const };
    const check = validateActorOutput(response.output, response.input, { reserved: options().reserved, knownSecrets: options().knownSecrets, state: this.execution });
    if (!check.valid) return { kind: "stale" as const };
    // No await between snapshot and assignment: compare-and-swap is atomic in this mock.
    const next = structuredClone(this.durable);
    const messageId = `committed-${next.messages.length + 1}`;
    next.messages.push({ messageId, text: response.output.text, inputEventId: e.inputEventId }); this.maybeFail("message");
    if (response.input.instruction.toolIntent === "present_practice_code_request") { next.requests.push(messageId); next.events.push("request_presented"); } this.maybeFail("request");
    next.additions.push(...response.output.introducedAdditionIds); this.maybeFail("addition");
    if (response.input.instruction.target.issueId) next.addressed.push(response.input.instruction.target.issueId); this.maybeFail("issue");
    next.attempts.push(...response.attempts.map((a) => ({ ...a, committedMessageId: messageId }))); this.maybeFail("audit");
    this.durable = next; this.execution.revision++;
    return { kind: "committed" as const, messageId, text: response.output.text };
  }
  private maybeFail(at: typeof this.failAt) { if (this.failAt === at) throw new Error("injected transaction failure"); }
  explicitRetry(eventId: string, unchanged = true) {
    if (!unchanged) return "queue_current";
    if (this.durable.retries[eventId]) return "exhausted";
    this.durable.retries[eventId] = 1; return "authorized";
  }
}
async function prepared(request = false) {
  const s = setup(); const o = options();
  if (request) {
    o.input.instruction.action = "present_simulated_request"; o.input.instruction.toolIntent = "present_practice_code_request";
    o.input.instruction.target.issueId = "issue";
    o.input.instruction.additions = [...o.reserved];
    const { buildStyleProfile } = await import("@/server/actor/style"); o.input.styleProfile = buildStyleProfile(o.input.instruction);
    s.deps.model.generate = vi.fn(async () => ({ ok: true as const, output: { text: "Case CD-123456 from Account Review. Will you share the six-digit code we texted you?", usedFactIds: [], introducedAdditionIds: ["case_reference", "team_label"] } }));
  }
  const result = await runActor(o, s.deps); if (result.kind !== "prepared") throw new Error("fixture preparation failed"); return result;
}

describe("actor commit port contract and post-commit delivery (mock persistence)", () => {
  it("demo: delivers a normal answer only after commit", async () => {
    const response = await prepared(); const port = new MockAtomicPort();
    expect(port.durable.messages).toHaveLength(0);
    expect(await commitActorResponse(response, port)).toEqual({ kind: "delivered", messageId: "committed-1", text: output().text, duplicate: false });
    expect(port.durable.messages).toHaveLength(1); expect(port.execution.revision).toBe(21);
  });
  it("demo: request/message/event/additions/issue and audit metadata commit together", async () => {
    const response = await prepared(true); const port = new MockAtomicPort();
    expect(port.durable.addressed).toEqual([]);
    const result = await commitActorResponse(response, port); expect(result.kind).toBe("delivered");
    expect(port.durable).toMatchObject({ requests: ["committed-1"], events: ["request_presented"], additions: ["case_reference", "team_label"], addressed: ["issue"] });
    expect(port.durable.messages).toHaveLength(1); expect(port.durable.attempts).toHaveLength(1);
    expect(port.durable.attempts[0]).toMatchObject({ committedMessageId: "committed-1", styleMetrics: { styleVersion: "style-v1" } });
  });
  it.each(["message", "request", "addition", "issue", "audit"] as const)("rolls back all mock effects on %s write failure", async (failAt) => {
    const response = await prepared(true); const port = new MockAtomicPort(); port.failAt = failAt;
    const before = structuredClone(port.durable);
    expect(await commitActorResponse(response, port)).toMatchObject({ kind: "failed" });
    expect(port.durable).toEqual(before); expect(port.execution.revision).toBe(20);
  });
  it("replays persisted message after lost HTTP delivery and reload, with no new writes", async () => {
    const response = await prepared(); const port = new MockAtomicPort(); await commitActorResponse(response, port);
    const reloaded = new MockAtomicPort(); reloaded.durable = JSON.parse(JSON.stringify(port.durable)); reloaded.execution.revision = 21; reloaded.execution.claimValid = false;
    expect(await commitActorResponse(response, reloaded)).toMatchObject({ kind: "delivered", duplicate: true, messageId: "committed-1", text: output().text }); expect(reloaded.durable.messages).toHaveLength(1);
  });
  it("handles duplicate/concurrent response commits at most once", async () => {
    const response = await prepared(true); const port = new MockAtomicPort();
    const results = await Promise.all([commitActorResponse(response, port), commitActorResponse(response, port)]);
    expect(results.map((r) => r.kind)).toEqual(["delivered", "delivered"]); expect(port.durable.messages).toHaveLength(1); expect(port.durable.events).toHaveLength(1);
  });
  it.each(["revision", "verification", "stop", "claim", "owner", "plan"])("rechecks %s inside the transaction and discards late results", async (change) => {
    const response = await prepared(); const port = new MockAtomicPort();
    port.beforeTransaction = () => {
      if (change === "revision") port.execution.revision++;
      if (change === "verification") port.execution.stage = "verifying";
      if (change === "stop") port.execution.stage = "ended";
      if (change === "claim") port.execution.claimValid = false;
      if (change === "owner") port.execution.ownerKey = "other";
      if (change === "plan") port.execution.planApplicable = false;
    };
    expect(await commitActorResponse(response, port)).toEqual({ kind: "discarded" }); expect(port.durable.messages).toHaveLength(0);
  });
  it("never replays a different owner's/session's response", async () => {
    const response = await prepared(); const port = new MockAtomicPort(); await commitActorResponse(response, port);
    response.envelope.ownerKey = "other"; expect(await commitActorResponse(response, port)).toEqual({ kind: "discarded" });
    response.envelope.ownerKey = "owner"; response.envelope.sessionId = "other"; expect(await commitActorResponse(response, port)).toEqual({ kind: "discarded" });
  });
  it("rejects a draft changed after validation", async () => {
    const response = await prepared(); response.output.text = "Replaced after validation.";
    const port = new MockAtomicPort(); expect(await commitActorResponse(response, port)).toEqual({ kind: "discarded" }); expect(port.durable.messages).toHaveLength(0);
  });
  it("models one durable explicit retry, current-plan check, and the maximum four calls", async () => {
    const port = new MockAtomicPort();
    const first = setup([{ ok: true, output: {} }, { ok: true, output: {} }]); const initial = await runActor(options(), first.deps);
    expect(port.explicitRetry("m1", false)).toBe("queue_current"); expect(port.explicitRetry("m1")).toBe("authorized");
    const reloaded = new MockAtomicPort(); reloaded.durable = JSON.parse(JSON.stringify(port.durable)); expect(reloaded.explicitRetry("m1")).toBe("exhausted");
    const second = setup([{ ok: true, output: {} }, { ok: true, output: {} }]); const o = options(); o.envelope.processingAttempt = 2;
    const retry = await runActor(o, second.deps); expect(retry).toMatchObject({ kind: "failed", endReason: "technical_interruption" }); expect(initial.calls + retry.calls).toBe(4);
    expect(reloaded.durable.messages).toHaveLength(0);
  });
});
