import "server-only";
import { createHash } from "node:crypto";
import type { ActorOutput, PlannerAddition } from "@/contracts/planner";
import { providerSchema, type StructuredResult } from "@/server/observer/model";
import { ACTOR_TIMEOUT_MS, type ActorModel } from "./model";
import { ActorEnvelopeSchema, ActorInputSchema, ActorOutputSchema, type ActorAttemptRecord, type ActorEnvelope, type ActorInput, type ActorStyleMetrics, type ActorViolation } from "./schemas";
import { ACTOR_PROMPT_VERSION, ACTOR_SYSTEM_PROMPT, actorRepairPrompt, actorUserPrompt } from "./prompts";
import { redactModelData } from "./input";
import { buildStyleProfile, computeStyleMetrics } from "./style";
import { gateViolations, validateActorOutput, type ActorGate } from "./validate";

export const ACTOR_FAILURE_NOTICE = "The practice response couldn't be generated. You can retry or end this session.";
export type ActorExecutionState = ActorGate & {
  sessionId: string; ownerKey: string; claimId: string | null; claimValid: boolean;
  policyVersion: string; planApplicable: boolean;
};
export function executionViolations(state: ActorExecutionState, envelope: ActorEnvelope): ActorViolation[] {
  const violations = gateViolations(state, envelope.basedOnRevision);
  if (state.sessionId !== envelope.sessionId || state.ownerKey !== envelope.ownerKey || state.claimId !== envelope.claimId || !state.claimValid || state.policyVersion !== envelope.policyVersion || !state.planApplicable) violations.push({ code: "stale_revision", field: "envelope", detail: "Execution binding is no longer current.", offendingExcerpt: null });
  return violations;
}
export type PreparedActorResponse = {
  kind: "prepared"; envelope: ActorEnvelope; input: ActorInput; output: ActorOutput;
  attempts: ActorAttemptRecord[]; calls: number; styleMetrics: ActorStyleMetrics | null;
};
export type ActorRunResult = PreparedActorResponse | { kind: "discarded"; calls: number; attempts: ActorAttemptRecord[] } |
  { kind: "failed"; calls: number; attempts: ActorAttemptRecord[]; reason: "invalid_after_repair" | "timeout" | "refusal" | "unavailable" | "http_error"; notice: string; endReason: "technical_interruption" | null };
export type ActorRunDeps = {
  model: ActorModel | null; readState: () => Promise<ActorExecutionState>; newId: () => string;
  now?: () => Date; monotonicNow?: () => number; metrics?: typeof computeStyleMetrics;
};
export type ActorRunOptions = {
  input: ActorInput; envelope: ActorEnvelope; reserved: readonly PlannerAddition[];
  knownSecrets: readonly string[]; signal?: AbortSignal;
};

/** Buffered, side-effect-free preparation. The result is server-only and MUST NOT be delivered before
 * atomic commit. Explicit durable retry authorization is owned by the controller, never this runner. */
export async function runActor(options: ActorRunOptions, deps: ActorRunDeps): Promise<ActorRunResult> {
  const envelope = ActorEnvelopeSchema.parse(options.envelope);
  const input = ActorInputSchema.parse(redactModelData(options.input, options.knownSecrets));
  if (envelope.planId !== input.instruction.planId || envelope.basedOnRevision !== input.instruction.basedOnRevision || envelope.actorPromptVersion !== ACTOR_PROMPT_VERSION || envelope.modelId !== (deps.model?.modelId ?? "unconfigured") || JSON.stringify(input.styleProfile) !== JSON.stringify(buildStyleProfile(input.instruction))) throw new Error("Invalid actor execution binding.");
  const now = deps.now ?? (() => new Date());
  const monotonicNow = deps.monotonicNow ?? (() => performance.now());
  const attempts: ActorAttemptRecord[] = [];
  let calls = 0;
  const discarded = (): ActorRunResult => ({ kind: "discarded", calls, attempts });
  const stale = async () => {
    if (options.signal?.aborted) return true;
    const state = await deps.readState();
    return !!options.signal?.aborted || executionViolations(state, envelope).length > 0;
  };
  const fail = (reason: Extract<ActorRunResult, { kind: "failed" }>["reason"]): ActorRunResult => ({ kind: "failed", calls, attempts, reason, notice: ACTOR_FAILURE_NOTICE, endReason: envelope.processingAttempt === 2 ? "technical_interruption" : null });
  if (await stale()) return discarded();
  if (!deps.model) return fail("unavailable");
  const model = deps.model;

  const call = async (callKind: "initial" | "repair", user: string) => {
    calls++;
    const started = monotonicNow();
    const record: ActorAttemptRecord = { id: deps.newId(), sessionId: envelope.sessionId, inputEventId: envelope.inputEventId, planId: envelope.planId,
      processingAttempt: envelope.processingAttempt, basedOnRevision: envelope.basedOnRevision, modelId: model.modelId, promptVersion: ACTOR_PROMPT_VERSION,
      callKind, status: "provider_failed", violations: [], latencyMs: 0, committedMessageId: null, createdAt: now().toISOString(),
      styleProfileVersion: input.styleProfile.version, styleMetrics: null, analyticsFailed: false, outputHash: null };
    const controller = new AbortController();
    let cancel: () => void = () => {};
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<StructuredResult>((resolve) => {
      cancel = () => { controller.abort(); resolve({ ok: false, failure: "timeout", detail: "Actor canceled." }); };
      timeout = setTimeout(cancel, ACTOR_TIMEOUT_MS);
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
    });
    let result: StructuredResult;
    try {
      result = await Promise.race([model.generate({ stage: callKind === "initial" ? "actor" : "actor_repair", schemaName: "actor_output", schemaDescription: "Return the next fictional character message.", jsonSchema: providerSchema(ActorOutputSchema), system: ACTOR_SYSTEM_PROMPT, user, timeoutMs: ACTOR_TIMEOUT_MS }, controller.signal), deadline]);
    } catch { result = { ok: false, failure: "http_error", detail: "Actor adapter failed." }; }
    finally { clearTimeout(timeout); options.signal?.removeEventListener("abort", cancel); }
    record.latencyMs = Math.max(0, Math.round(monotonicNow() - started));
    attempts.push(record);
    return { result, record };
  };

  let invalidOutput: unknown = null;
  let violations: ActorViolation[] = [];
  for (const kind of ["initial", "repair"] as const) {
    if (await stale()) return discarded();
    if (options.signal?.aborted) return discarded();
    const user = kind === "initial" ? actorUserPrompt(input) : actorRepairPrompt({ originalInput: input, invalidOutput, violations });
    const { result, record } = await call(kind, user);
    const state = await deps.readState();
    if (options.signal?.aborted || executionViolations(state, envelope).length) { record.status = "stale"; record.violations = executionViolations(state, envelope); return discarded(); }
    if (!result.ok && result.failure !== "malformed_output") return fail(result.failure);
    const check = validateActorOutput(result.ok ? result.output : null, input, { reserved: options.reserved, knownSecrets: options.knownSecrets, state });
    record.violations = check.violations;
    if (!check.output) {
      record.status = "invalid";
      violations = check.violations;
      // Only a bounded redacted copy enters repair. No rejected draft is retained in audit metadata.
      try { invalidOutput = String(JSON.stringify(redactModelData(result.ok ? result.output : result.rawOutput ?? null, options.knownSecrets))).slice(0, 4000); }
      catch { invalidOutput = "[unserializable invalid output]"; }
      if (kind === "repair") return fail("invalid_after_repair");
      continue;
    }
    record.status = "valid";
    record.outputHash = createHash("sha256").update(JSON.stringify(check.output)).digest("hex");
    try { record.styleMetrics = (deps.metrics ?? computeStyleMetrics)(check.output.text, input); }
    catch { record.analyticsFailed = true; }
    return { kind: "prepared", envelope, input, output: check.output, calls, attempts, styleMetrics: record.styleMetrics };
  }
  throw new Error("Unreachable actor budget state.");
}
