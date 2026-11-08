import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StructuredModel } from "@/server/observer/model";
import { ObserverService } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import { FixtureStructuredModel } from "@/server/observer/testing/fixture-model";
import { MemoryTrace, type TraceSink } from "@/server/observer/trace";
import { FixtureActorModel, FixturePlannerModel } from "@/server/planner/testing/fixture-models";
import { fail, ScriptedModel } from "../observer/scripted-model";

const OWNER = "anon:trace";
function lab(trace: TraceSink, planner: () => StructuredModel | null = () => new FixturePlannerModel()) {
  const store = new MemoryObserverStore();
  const service = new ObserverService({
    store,
    models: () => ({ observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") }),
    policy: "consequential_and_flagged",
    timeoutMs: 1000,
    planning: { models: () => ({ planner: planner(), actor: new FixtureActorModel() }), timeoutMs: 1000 },
    trace,
  });
  return { store, service };
}

describe("Agent lab trace", () => {
  it("records every step for a message: input, observer input, raw model calls, observer output, eligibility, planner input, plan, commit", async () => {
    const trace = new MemoryTrace();
    const { service, store } = lab(trace);
    const { session } = await service.createSession(OWNER);
    const r = await service.submitMessage(OWNER, session.sessionId, { idempotencyKey: randomUUID(), content: "Who are you?" });
    const messageId = r.session.messages.find((m) => m.role === "user")!.id;
    const entries = trace.entries(session.sessionId).filter((e) => e.inputId === messageId);
    expect(entries.map((e) => (e.step === "model.call" ? `${e.step}:${(e.data as { stage: string }).stage}` : e.step))).toEqual([
      "input.received",
      "observer.input",
      "model.call:observer",
      "observer.result",
      "planner.eligibility",
      "planner.input",
      "model.call:planner",
      "planner.result",
      "actor.input",
      "model.call:actor",
      "actor.result",
      "commit",
    ]);
    const call = entries.find((e) => e.step === "model.call")!.data as { input: { conversationUntrustedData: unknown[] }; rawOutput: { openIssues: unknown[] }; systemPrompt: string };
    expect(call.input.conversationUntrustedData).toHaveLength(2);
    expect(call.rawOutput.openIssues).toHaveLength(1);
    expect(call.systemPrompt).toMatch(/You are the observer/);
    // Hidden facts never enter model payloads, so they never appear in the trace of them either.
    const code = (await store.load(session.sessionId))!.session.practiceCode!;
    expect(JSON.stringify(entries.filter((e) => e.step === "model.call"))).not.toContain(code);
  });

  it("records raw failures (the point of the lab) and wait decisions with no planner call", async () => {
    const trace = new MemoryTrace();
    const { service } = lab(trace, () => new ScriptedModel("broken-planner", fail("malformed_output", "{not json"), fail("malformed_output", "still not json")));
    const { session } = await service.createSession(OWNER);
    await service.submitMessage(OWNER, session.sessionId, { idempotencyKey: randomUUID(), content: "Who are you?" });
    const entries = trace.entries(session.sessionId);
    const plannerCalls = entries.filter((e) => e.step === "model.call" && e.agent === "planner");
    expect(plannerCalls.map((e) => (e.data as { rawOutput: { rawOutput: string } }).rawOutput.rawOutput)).toEqual(["{not json", "still not json"]);
    expect(entries.find((e) => e.step === "planner.result")).toMatchObject({ status: "fail", title: expect.stringMatching(/rejected \(plan_invalid_after_repair\)/) });
    expect(entries.some((e) => e.step === "session.event" && /retry available/.test(e.title))).toBe(true);
  });

  it("a throwing trace sink never affects processing", async () => {
    const { service } = lab({ emit: () => { throw new Error("sink down"); } });
    const { session } = await service.createSession(OWNER);
    const r = await service.submitMessage(OWNER, session.sessionId, { idempotencyKey: randomUUID(), content: "Who are you?" });
    expect(r.session.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  });
});
