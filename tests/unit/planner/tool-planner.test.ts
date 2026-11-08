import { describe, expect, it } from "vitest";
import type { PlanRecord } from "@/contracts/planner";
import { FixtureActorModel } from "@/server/planner/testing/fixture-models";
import { FixtureToolPlannerModel } from "@/server/planner/testing/fixture-tool-model";
import type { ChatMessage, ToolChatModel, ToolChatResult, ToolSpec } from "@/server/planner/tool-model";
import { MAX_TOOL_PLANNER_CALLS } from "@/server/planner/tool-run";
import { OWNER, started } from "./session-fixture";

/** Records every request so the protocol (tool ids, message order) can be asserted. */
class Recording implements ToolChatModel {
  requests: ChatMessage[][] = [];
  before?: (call: number) => Promise<void>;
  constructor(
    private readonly inner: ToolChatModel,
    readonly modelId = inner.modelId,
  ) {}
  async chat(r: { messages: ChatMessage[]; tools: ToolSpec[]; timeoutMs: number }): Promise<ToolChatResult> {
    this.requests.push(structuredClone(r.messages));
    await this.before?.(this.requests.length);
    return this.inner.chat(r);
  }
}

async function toolGame(model: Recording = new Recording(new FixtureToolPlannerModel())) {
  const s = await started({ toolPlanner: () => model, actor: () => new FixtureActorModel() });
  const plans = async () => (await s.snap()).plans as PlanRecord[];
  const view = async () => (await s.service.getSession(OWNER, s.id)).session;
  return { ...s, model, plans, view };
}

describe("tool-calling planner (Spacetime/Nemotron brief §7)", () => {
  it("reads context through a tool, executes one move through a tool, and stops; results carry the call ids", async () => {
    const g = await toolGame();
    await g.say("Who are you?");
    const v = await g.view();
    expect(v.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
    expect(g.model.requests).toHaveLength(2); // context read + one move; no acknowledgement call
    const [record] = await g.plans();
    expect(record).toMatchObject({ status: "committed", plannerProtocol: "tools" });
    expect(record.toolCalls!.map((c) => [c.name, c.status])).toEqual([
      ["get_training_context", "ok"],
      ["execute_training_move", "executing"],
    ]);
    // The second request contains the assistant tool call and the tool result under the same id.
    const second = g.model.requests[1];
    const assistant = second.find((m) => m.role === "assistant") as Extract<ChatMessage, { role: "assistant" }>;
    const tool = second.find((m) => m.role === "tool") as Extract<ChatMessage, { role: "tool" }>;
    expect(tool.tool_call_id).toBe(assistant.tool_calls![0].id);
    expect(JSON.parse(tool.content).candidates.length).toBeGreaterThan(0);
  });

  it("the move tool creates the authorized request; the commit result reports real request/event ids", async () => {
    const g = await toolGame();
    await g.say("Sure, go on.");
    const v = await g.view();
    expect(v.requestStatus).toBe("pending");
    const record = (await g.plans()).find((p) => p.status === "committed")!;
    const request = v.requests.at(-1)!;
    expect(record.committedMessageId).toBe(request.introducedByMessageId);
  });

  it("invalid move arguments get one repair (bounded); the invalid call produced no message or request", async () => {
    const g = await toolGame();
    await g.say("Sure, go on. [[tool-bad-args]]");
    const record = (await g.plans()).find((p) => p.status === "committed")!;
    expect(record.toolCalls!.map((c) => c.status)).toEqual(["ok", "invalid", "executing"]);
    expect(record.repairAttempted).toBe(true);
    expect(g.model.requests.length).toBeLessThanOrEqual(MAX_TOOL_PLANNER_CALLS);
    expect((await g.view()).messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  });

  it("no tool call: no visible message, no partial request, truthful technical notice", async () => {
    const g = await toolGame();
    await g.say("Who are you? [[tool-no-call]]");
    const v = await g.view();
    expect(v.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(v.requests).toHaveLength(0);
    expect(v.technicalNotice).toMatchObject({ canRetry: true });
    expect(v.outcome).toBeNull();
  });

  it("stop races the planner: the context read sees the changed state and the turn is abandoned", async () => {
    const model = new Recording(new FixtureToolPlannerModel());
    const g = await toolGame(model);
    model.before = async (n) => {
      if (n === 1) await g.act({ type: "conversation_ended", requestId: null });
    };
    await g.say("Who are you?");
    const v = await g.view();
    expect(v.outcome).toBe("safely_disengaged");
    expect(v.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect((await g.plans()).some((p) => p.status === "committed")).toBe(false);
  });

  it("provider failure leaves a recoverable state, not a manufactured success", async () => {
    const failing: ToolChatModel = { modelId: "down", chat: async () => ({ ok: false, failure: "unavailable", detail: "down" }) };
    const g = await toolGame(new Recording(failing));
    await g.say("Who are you?");
    const v = await g.view();
    expect(v.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(v.technicalNotice?.canRetry).toBe(true);
    expect((await g.plans())[0]).toMatchObject({ status: "failed", failureReason: "planner_unavailable" });
  });
});
