import type { TurnLog } from "@/contracts/game";
import type { Scenario } from "../scenario/schema";
import { ProviderError, type ChatMessage, type ModelClient } from "./client";
import type { OpponentObservation } from "./observation-schema";
import { OPPONENT_SYSTEM_PROMPT, TOOL_NAMES, ToolArgumentSchemas, toolDefinitions, type ToolName } from "./tools";

export type ToolDispatchResult = {
  status: "applied" | "rejected" | "duplicate";
  reason: string | null;
  message: string | null;
  requestId?: string;
  eventIds: string[];
  encounterEnded: boolean;
};

export type ParsedToolCall =
  | { callId: string; name: "sendSimulatedMessage"; args: { text: string } }
  | { callId: string; name: "presentPaymentRequest"; args: { recipientId: string; amount: number } }
  | { callId: string; name: "finishEncounter"; args: { reason?: string } };

export type LiveTurnResult = {
  modelRequests: number;
  toolCalls: TurnLog["toolCalls"];
  appliedMessages: number;
  applied: number;
  rejected: number;
  failure: null | "timeout" | "provider_error" | "invalid_output";
};

/**
 * One bounded opponent turn: <= maxModelRequestsPerTurn requests, <= maxToolCallsPerTurn dispatches,
 * an overall deadline. Each proposal goes through `dispatch` (engine validation + atomic commit).
 * Results — including rejections — are returned to the model so it can adapt within the turn.
 * Fails closed: unknown tools and malformed arguments are rejected and never dispatched.
 */
export async function runLiveTurn(input: {
  client: ModelClient;
  scenario: Scenario;
  observation: OpponentObservation;
  deadlineAt: number;
  now?: () => number;
  dispatch: (call: ParsedToolCall) => Promise<ToolDispatchResult>;
}): Promise<LiveTurnResult> {
  const { client, scenario, observation, dispatch } = input;
  const now = input.now ?? Date.now;
  const limits = scenario.limits;
  const thinkingOff = /nemotron/i.test(client.modelId) && process.env.MODEL_THINKING !== "on";
  const messages: ChatMessage[] = [
    { role: "system", content: `${thinkingOff ? "/no_think\n" : ""}${OPPONENT_SYSTEM_PROMPT}` },
    {
      role: "user",
      content: `OBSERVATION (JSON):\n${JSON.stringify(observation)}\n\nTake your turn now by calling tools.`,
    },
  ];
  const tools = toolDefinitions(scenario);
  const result: LiveTurnResult = { modelRequests: 0, toolCalls: [], appliedMessages: 0, applied: 0, rejected: 0, failure: null };
  let dispatched = 0;

  const record = (callId: string, name: string, args: unknown, outcome: ToolDispatchResult) => {
    result.toolCalls.push({ callId, name, arguments: args, status: outcome.status, rejectionReason: outcome.reason, eventIds: outcome.eventIds });
    if (outcome.status === "applied") {
      result.applied++;
      if (name === "sendSimulatedMessage") result.appliedMessages++;
    } else if (outcome.status === "rejected") result.rejected++;
  };
  const rejectedLocally = (reason: string, message: string): ToolDispatchResult => ({ status: "rejected", reason, message, eventIds: [], encounterEnded: false });

  for (let request = 0; request < limits.maxModelRequestsPerTurn; request++) {
    const remaining = input.deadlineAt - now();
    if (remaining <= 0) {
      result.failure = "timeout";
      break;
    }
    let response;
    try {
      result.modelRequests++;
      response = await client.complete({ messages, tools, tool_choice: "auto", temperature: 0.7, max_tokens: 400 }, AbortSignal.timeout(remaining));
    } catch (error) {
      result.failure = error instanceof ProviderError ? (error.kind === "timeout" ? "timeout" : error.kind === "invalid_output" ? "invalid_output" : "provider_error") : "provider_error";
      break;
    }

    if (response.toolCalls.length === 0) {
      // Plain text: accept as the turn's message only if no message was sent yet (validated by the engine).
      const text = response.content?.trim();
      if (text && result.appliedMessages === 0 && dispatched < limits.maxToolCallsPerTurn) {
        dispatched++;
        const call: ParsedToolCall = { callId: `content-${request}`, name: "sendSimulatedMessage", args: { text } };
        record(call.callId, call.name, call.args, await dispatch(call));
      }
      break;
    }

    messages.push({ role: "assistant", content: response.content, tool_calls: response.toolCalls });
    let anyRejected = false;
    let ended = false;
    for (const call of response.toolCalls) {
      let outcome: ToolDispatchResult;
      let args: unknown = call.function.arguments;
      if (dispatched >= limits.maxToolCallsPerTurn) {
        outcome = rejectedLocally("TOOL_BUDGET_EXCEEDED", "Tool call limit for this turn reached.");
      } else if (!(TOOL_NAMES as readonly string[]).includes(call.function.name)) {
        outcome = rejectedLocally("TOOL_NOT_ALLOWED", `Unknown tool. Allowed: ${TOOL_NAMES.join(", ")}.`);
      } else {
        const name = call.function.name as ToolName;
        let raw: unknown;
        try {
          raw = JSON.parse(call.function.arguments || "{}");
        } catch {
          raw = undefined;
        }
        const parsed = raw === undefined ? null : ToolArgumentSchemas[name].safeParse(raw);
        if (!parsed?.success) {
          outcome = rejectedLocally("INVALID_ARGUMENTS", "Arguments did not match the tool schema.");
          args = typeof call.function.arguments === "string" ? call.function.arguments.slice(0, 500) : null;
        } else {
          args = parsed.data;
          dispatched++;
          outcome = await dispatch({ callId: call.id, name, args: parsed.data } as ParsedToolCall);
        }
      }
      record(call.id, call.function.name, args, outcome);
      if (outcome.status === "rejected") anyRejected = true;
      if (outcome.encounterEnded) ended = true;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(
          outcome.status === "rejected"
            ? { ok: false, error: outcome.reason, message: outcome.message }
            : { ok: true, status: outcome.status, ...(outcome.requestId ? { requestId: outcome.requestId } : {}), ...(outcome.encounterEnded ? { encounterEnded: true } : {}) },
        ),
      });
    }
    if (ended) break;
    if (!anyRejected && result.appliedMessages > 0) break;
  }

  if (!result.failure && result.appliedMessages === 0 && result.toolCalls.every((c) => c.name !== "finishEncounter" || c.status !== "applied")) {
    result.failure = "invalid_output";
  }
  return result;
}
