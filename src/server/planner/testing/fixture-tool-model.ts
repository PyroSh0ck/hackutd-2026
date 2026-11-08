import type { PlannerInput } from "@/contracts/planner";
import { plannerUserPrompt } from "../prompts";
import type { ChatMessage, ToolChatModel, ToolChatResult, ToolSpec } from "../tool-model";
import { FixturePlannerModel, SLOW_FIXTURE_MS } from "./fixture-models";

/**
 * LABELED TEST FIXTURE: a deterministic stand-in for a function-calling Nemotron planner. It follows the
 * real tool protocol (reads context through the tool, then executes one move with call ids), choosing the
 * same plan as FixturePlannerModel. Hooks in the latest user message:
 *   [[tool-bad-args]]  first move uses an ineligible candidate id, then repairs once
 *   [[tool-no-call]]   answers in prose without calling a tool
 *   [[slow]]           holds the move decision for SLOW_FIXTURE_MS (stop-while-generating tests)
 * Never used outside E2E_TEST=1 + OBSERVER_MODEL_MODE=fixture or unit tests.
 */
export class FixtureToolPlannerModel implements ToolChatModel {
  private seq = 0;
  constructor(readonly modelId = "fixture-tool-planner") {}

  async chat({ messages }: { messages: ChatMessage[]; tools: ToolSpec[]; timeoutMs: number }): Promise<ToolChatResult> {
    const call = (name: string, args: unknown): ToolChatResult => ({ ok: true, content: "", toolCalls: [{ id: `fixture_call_${++this.seq}`, name, arguments: JSON.stringify(args) }], protocol: "native" });
    const toolResults = messages.filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool");
    if (toolResults.length === 0) return call("get_training_context", {});
    const context = JSON.parse(toolResults[0].content) as PlannerInput;
    const text = JSON.stringify(context);
    if (text.includes("[[slow]]")) await new Promise((r) => setTimeout(r, SLOW_FIXTURE_MS));
    if (text.includes("[[tool-no-call]]")) return { ok: true, content: "I think we should continue.", toolCalls: [], protocol: "native" };
    const planned = await new FixturePlannerModel().generate({ stage: "planner", schemaName: "submit_plan", schemaDescription: "", jsonSchema: {}, system: "", user: plannerUserPrompt(context), timeoutMs: 1000 });
    if (!planned.ok) return { ok: false, failure: planned.failure === "malformed_output" ? "malformed_output" : planned.failure, detail: planned.detail };
    const firstMove = toolResults.length === 1;
    if (text.includes("[[tool-bad-args]]") && firstMove) return call("execute_training_move", { ...(planned.output as object), candidateId: "c_0000000000000000" });
    return call("execute_training_move", planned.output);
  }
}
