import "server-only";
import { PlanSchema, type PlanAttempt, type PlanError, type PlannerInput, type PlanRecord } from "@/contracts/planner";
import { providerSchema } from "@/server/observer/model";
import { buildActorInstruction } from "./actor";
import { PLANNER_SYSTEM_PROMPT } from "./prompts";
import { emptyRecord, type PlanningTurnInput } from "./run";
import type { ChatMessage, ToolCall, ToolChatModel, ToolSpec } from "./tool-model";
import { validatePlan } from "./validate";

/**
 * The planner as a function-calling agent (Spacetime/Nemotron brief §7). Two app-defined tools, both
 * backed by the real training service:
 *
 *  - get_training_context: reads the authorized session from the authoritative backend and returns the
 *    server-computed candidates, permitted facts and observer handoff (no hidden truth).
 *  - execute_training_move: validates the chosen plan, stages it, runs the constrained actor, and invokes
 *    the backend's atomic commit; returns the committed message/request/event ids or the rejection.
 *
 * Bounds per invocation: at most one context read and one successful move; at most one repair for invalid
 * move arguments (the existing planner repair budget); never more than MAX_TOOL_PLANNER_CALLS model calls.
 * The loop stops after a move executes: no extra visible response is generated to acknowledge it.
 */

export const MAX_TOOL_PLANNER_CALLS = 3;

export type MoveResult =
  | { status: "committed"; messageId: string; requestIds: string[]; eventIds: string[]; revision: number }
  | { status: "stale"; detail: string }
  | { status: "failed"; detail: string };

export type ToolPlanningDeps = {
  model: ToolChatModel | null;
  timeoutMs: number;
  newId: () => string;
  now: () => Date;
  /** Re-reads the authoritative session; null when it changed since planning began (stale). */
  readContext: () => Promise<PlannerInput | null>;
  /** Stages the prepared record and executes it through the actor and the atomic commit. */
  executeMove: (prepared: PlanRecord) => Promise<MoveResult>;
  signal?: AbortSignal;
};

export type ToolPlanningResult = {
  record: PlanRecord;
  plannerCalls: number;
  /** "executed": the move ran (see move); otherwise no move was executed and nothing was committed. */
  outcome: { kind: "executed"; move: MoveResult } | { kind: "no_move" };
};

export const PLANNER_TOOLS: ToolSpec[] = [
  {
    name: "get_training_context",
    description: "Read the current practice session: observer handoff, server-computed eligible candidates, permitted facts and additions. Call this first, once.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "execute_training_move",
    description: "Execute exactly one eligible candidate move. The server validates it, writes the constrained opponent message and commits it atomically. Returns the committed ids or why it was rejected.",
    parameters: providerSchema(PlanSchema),
  },
];

const TOOL_INSTRUCTIONS = `
You run one opponent turn in a fictional, consent-based scam-awareness practice by calling tools.
1. Call get_training_context exactly once.
2. Choose ONE candidate from its "candidates" list and call execute_training_move with a plan for it
   (candidateId and basedOnRevision exactly as given; only permitted facts/additions; a short contentFocus).
Never invent candidates, facts, outcomes, or verification results. Do not write the opponent message yourself.
If execute_training_move returns "invalid", fix only the listed errors and call it once more.`;

const summarize = (value: unknown) => JSON.stringify(value).slice(0, 480);

export async function runToolPlanningTurn(turn: PlanningTurnInput, deps: ToolPlanningDeps): Promise<ToolPlanningResult> {
  const record: PlanRecord = { ...emptyRecord(turn, deps.newId(), deps.model?.modelId ?? "unconfigured", deps.now()), plannerProtocol: "tools", toolCalls: [] };
  let plannerCalls = 0;
  const finish = (status: PlanRecord["status"], failureReason: PlanRecord["failureReason"], outcome: ToolPlanningResult["outcome"] = { kind: "no_move" }): ToolPlanningResult => ({
    record: { ...record, status, failureReason },
    plannerCalls,
    outcome,
  });
  if (!deps.model) return finish("failed", "planner_unavailable");

  const messages: ChatMessage[] = [
    { role: "system", content: `${PLANNER_SYSTEM_PROMPT}\n${TOOL_INSTRUCTIONS}` },
    { role: "user", content: `A new ${turn.inputKind === "message" ? "user message" : "user action"} needs the opponent's next turn (attempt ${turn.attempt}). Use the tools.` },
  ];
  let context: PlannerInput | null = null;
  let contextReads = 0;
  let invalidMoves = 0;

  const respond = (call: ToolCall, id: string, content: unknown, status: NonNullable<PlanRecord["toolCalls"]>[number]["status"], summary: string) => {
    messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(content) });
    if (call.name === "get_training_context" || call.name === "execute_training_move") record.toolCalls!.push({ callId: id, name: call.name, status, summary: summary.slice(0, 480) });
  };

  while (plannerCalls < MAX_TOOL_PLANNER_CALLS) {
    plannerCalls++;
    const started = performance.now();
    const startedAt = deps.now();
    const result = await deps.model.chat({ messages, tools: PLANNER_TOOLS, timeoutMs: deps.timeoutMs, signal: deps.signal }).catch(() => ({ ok: false as const, failure: "http_error" as const, detail: "Adapter threw." }));
    const attempt: PlanAttempt = { stage: invalidMoves ? "planner_repair" : "planner", modelId: deps.model.modelId, startedAt: startedAt.toISOString(), latencyMs: Math.max(0, Math.round(performance.now() - started)), outcome: result.ok ? "ok" : result.failure, errors: [] };
    record.attempts.push(attempt);
    if (!result.ok) {
      if (result.failure === "malformed_output") return finish("rejected", "plan_invalid_after_repair");
      return finish("failed", ({ timeout: "planner_timeout", unavailable: "planner_unavailable", refusal: "planner_refusal", http_error: "planner_http_error" } as const)[result.failure]);
    }
    // One tool call per step keeps the bounded protocol simple; extra parallel calls are not executed.
    const call = result.toolCalls[0];
    if (!call) return finish("rejected", "plan_invalid_after_repair");
    const id = call.id || `call_${deps.newId()}`;
    messages.push({ role: "assistant", content: result.content || null, tool_calls: [{ id, type: "function", function: { name: call.name, arguments: call.arguments } }] });

    if (call.name === "get_training_context") {
      if (contextReads >= 1) {
        respond(call, id, { status: "rejected", error: "Context was already provided; execute one move." }, "rejected", "duplicate context read refused");
        continue;
      }
      contextReads++;
      context = await deps.readContext();
      if (!context) {
        respond(call, id, { status: "stale", error: "The session changed; this turn is abandoned." }, "rejected", "session changed before planning");
        return finish("stale", null);
      }
      respond(call, id, context, "ok", `context revision ${context.basedOnRevision}: ${context.candidates.map((c) => c.moveId).join(", ")}`);
      continue;
    }

    if (call.name === "execute_training_move") {
      if (!context) {
        respond(call, id, { status: "rejected", error: "Call get_training_context first." }, "rejected", "move before context refused");
        continue;
      }
      let args: unknown;
      try {
        args = JSON.parse(call.arguments);
      } catch {
        args = undefined;
      }
      const parsed = PlanSchema.safeParse(args);
      if (parsed.success) record.proposedPlan = parsed.data;
      const v = args === undefined ? { plan: null, errors: [{ code: "schema", field: "(root)", detail: "Arguments were not valid JSON." } satisfies PlanError] } : validatePlan(args, context, { sessionActive: turn.sessionActive });
      record.validationAttempts.push({ errors: v.errors });
      attempt.errors = v.errors;
      if (!v.plan) {
        invalidMoves++;
        record.repairAttempted = true;
        respond(call, id, { status: "invalid", errors: v.errors }, "invalid", v.errors.map((e) => `${e.field}: ${e.code}`).join("; "));
        if (invalidMoves > 1) return finish("rejected", "plan_invalid_after_repair");
        continue;
      }
      record.acceptedPlan = v.plan;
      const candidate = context.candidates.find((c) => c.id === v.plan!.candidateId)!;
      record.actorInstruction = buildActorInstruction(record.id, v.plan, candidate, context);
      record.toolCalls!.push({ callId: id, name: "execute_training_move", status: "executing", summary: `${candidate.moveId} (${candidate.id})` });
      const move = await deps.executeMove({ ...record, status: "prepared", failureReason: null });
      // The real execution result goes back into the model context under the same call id. The loop stops
      // here: no further model call, so no second visible message acknowledges the commit.
      messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(move) });
      record.toolCalls![record.toolCalls!.length - 1] = { callId: id, name: "execute_training_move", status: move.status === "committed" ? "ok" : "rejected", summary: summarize(move) };
      return finish("prepared", null, { kind: "executed", move });
    }

    respond(call, id, { status: "rejected", error: `Unknown tool ${call.name}.` }, "rejected", `unknown tool ${call.name}`.slice(0, 100));
  }
  return finish("rejected", "plan_invalid_after_repair");
}
