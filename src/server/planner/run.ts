import { PlanSchema, type Candidate, type PlanAttempt, type PlanError, type PlanFailure, type PlannerInput, type PlanRecord } from "@/contracts/planner";
import { providerSchema, type ModelStage, type StructuredModel, type StructuredResult } from "@/server/observer/model";
import { buildActorInstruction } from "./actor";
import { POLICY_VERSION } from "./eligibility";
import { PLANNER_SYSTEM_PROMPT, plannerRepairPrompt, plannerUserPrompt } from "./prompts";
import { validatePlan } from "./validate";

/**
 * Planner step of one planning turn (planner brief §9). Explicit state machine, no loops, no reviewer:
 *
 *   planner ─ valid ──────────────────────────▶ planned  (instruction built from the server candidate)
 *      ├─ invalid output ─ repair ─ valid ─────▶ planned
 *      │                    └─ invalid ─▶ rejected
 *      └─ timeout/refusal/unavailable/http ─▶ failed  (no hidden repair)
 *
 * At most 2 planner calls, enforced by a hard guard. The actor is a separate step (src/server/actor,
 * `runActor`), wired by the controller; this module never writes state.
 * A returned record with status "prepared" means: plan accepted, actor not yet run.
 */

export const MAX_PLANNER_CALLS = 2;
/** Actor budget lives in src/server/actor/run.ts (one call + one repair). Re-exported for reports. */
export const MAX_ACTOR_CALLS = 2;

const PLAN_JSON_SCHEMA = providerSchema(PlanSchema);

export type PlanningDeps = {
  planner: StructuredModel | null;
  timeoutMs: number;
  now?: () => Date;
  newId: () => string;
};

export type PlanningTurnInput = {
  input: PlannerInput;
  inputId: string;
  inputKind: "message" | "event";
  attempt: 1 | 2;
  ruleId: string;
  sessionActive: boolean;
};

export type PlanningTurnResult = { record: PlanRecord; plannerCalls: number };

type Transport = Exclude<Extract<StructuredResult, { ok: false }>["failure"], "malformed_output">;
const PLANNER_FAILURE: Record<Transport, PlanFailure> = { timeout: "planner_timeout", unavailable: "planner_unavailable", refusal: "planner_refusal", http_error: "planner_http_error" };

export function emptyRecord(turn: PlanningTurnInput, id: string, modelId: string, now: Date): PlanRecord {
  return {
    id,
    sessionId: turn.input.sessionId,
    inputId: turn.inputId,
    inputKind: turn.inputKind,
    attempt: turn.attempt,
    basedOnRevision: turn.input.basedOnRevision,
    policyVersion: POLICY_VERSION,
    scenarioVersion: turn.input.scenarioVersion,
    ruleId: turn.ruleId,
    candidateSnapshot: turn.input.candidates,
    proposedPlan: null,
    acceptedPlan: null,
    validationAttempts: [],
    repairAttempted: false,
    actorInstruction: null,
    actorOutput: null,
    actorValidationAttempts: [],
    actorRepairAttempted: false,
    attempts: [],
    status: "failed",
    failureReason: null,
    committedMessageId: null,
    modelId,
    actorModelId: null,
    createdAt: now.toISOString(),
    actorAudit: null,
    reusedPlanFrom: null,
  };
}

export async function runPlanningTurn(turn: PlanningTurnInput, deps: PlanningDeps): Promise<PlanningTurnResult> {
  const now = deps.now ?? (() => new Date());
  const { input } = turn;
  let plannerCalls = 0;
  const record = emptyRecord(turn, deps.newId(), deps.planner?.modelId ?? "unconfigured", now());
  const done = (status: PlanRecord["status"], failureReason: PlanFailure | null): PlanningTurnResult => ({ record: { ...record, status, failureReason }, plannerCalls });

  async function call(model: StructuredModel, stage: ModelStage, user: string) {
    if (plannerCalls >= MAX_PLANNER_CALLS) throw new Error("Planner model-call budget exceeded (bug).");
    plannerCalls++;
    const startedAt = now();
    const started = performance.now();
    let result: StructuredResult;
    try {
      result = await model.generate({ stage, schemaName: "submit_plan", schemaDescription: "Submit the plan.", jsonSchema: PLAN_JSON_SCHEMA, system: PLANNER_SYSTEM_PROMPT, user, timeoutMs: deps.timeoutMs });
    } catch {
      result = { ok: false, failure: "http_error", detail: "Adapter threw." };
    }
    const attempt: PlanAttempt = {
      stage: stage as PlanAttempt["stage"],
      modelId: model.modelId,
      startedAt: startedAt.toISOString(),
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      outcome: result.ok ? "ok" : result.failure,
      errors: [],
    };
    record.attempts.push(attempt);
    return { result, attempt };
  }

  if (!deps.planner) return done("failed", "planner_unavailable");
  const first = await call(deps.planner, "planner", plannerUserPrompt(input));
  if (!first.result.ok && first.result.failure !== "malformed_output") return done("failed", PLANNER_FAILURE[first.result.failure]);
  const checkPlan = (result: StructuredResult, attempt: PlanAttempt) => {
    const errors: PlanError[] = result.ok ? [] : [{ code: "schema", field: "(root)", detail: result.detail }];
    const v = result.ok ? validatePlan(result.output, input, { sessionActive: turn.sessionActive }) : { plan: null, errors };
    attempt.errors = v.errors;
    record.validationAttempts.push({ errors: v.errors });
    const parsed = result.ok ? PlanSchema.safeParse(result.output) : null;
    if (parsed?.success) record.proposedPlan = parsed.data;
    return { plan: v.plan, errors: v.errors, raw: result.ok ? result.output : (result.rawOutput ?? null) };
  };
  let planned = checkPlan(first.result, first.attempt);
  if (!planned.plan) {
    record.repairAttempted = true;
    const repair = await call(deps.planner, "planner_repair", plannerRepairPrompt(input, planned.raw, planned.errors));
    if (!repair.result.ok && repair.result.failure !== "malformed_output") return done("failed", PLANNER_FAILURE[repair.result.failure]);
    planned = checkPlan(repair.result, repair.attempt);
    if (!planned.plan) return done("rejected", "plan_invalid_after_repair");
  }
  record.acceptedPlan = planned.plan;
  const candidate = input.candidates.find((c) => c.id === planned.plan!.candidateId)!;
  record.actorInstruction = buildActorInstruction(record.id, planned.plan, candidate, input);
  return done("prepared", null);
}

const sameBinding = (a: Candidate, b: Candidate) =>
  a.moveId === b.moveId && a.requestId === b.requestId && a.issueId === b.issueId && a.focusCode === b.focusCode && a.toolIntent === b.toolIntent && JSON.stringify(a.constraints) === JSON.stringify(b.constraints);

/**
 * Durable retry (actor README): reuse the earlier accepted plan only if the same server candidate is still
 * eligible under current state. The plan is re-validated against the current input; otherwise null and the
 * caller plans afresh. No model call.
 */
export function reusePlan(previous: PlanRecord, turn: PlanningTurnInput, newId: () => string, now: Date): PlanningTurnResult | null {
  const old = previous.acceptedPlan && previous.candidateSnapshot.find((c) => c.id === previous.acceptedPlan!.candidateId);
  if (!old || !previous.acceptedPlan) return null;
  const current = turn.input.candidates.find((c) => sameBinding(c, old));
  if (!current) return null;
  const allowed = new Set(current.evidenceRefs.map((r) => `${r.kind}:${r.id}`));
  const plan = { ...previous.acceptedPlan, candidateId: current.id, basedOnRevision: turn.input.basedOnRevision, evidenceRefs: previous.acceptedPlan.evidenceRefs.filter((r) => allowed.has(`${r.kind}:${r.id}`)) };
  const v = validatePlan(plan, turn.input, { sessionActive: turn.sessionActive });
  if (!v.plan) return null;
  const record = emptyRecord(turn, newId(), previous.modelId, now);
  record.acceptedPlan = v.plan;
  record.proposedPlan = v.plan;
  record.validationAttempts = [{ errors: [] }];
  record.reusedPlanFrom = previous.id;
  record.actorInstruction = buildActorInstruction(record.id, v.plan, current, turn.input);
  return { record: { ...record, status: "prepared", failureReason: null }, plannerCalls: 0 };
}
