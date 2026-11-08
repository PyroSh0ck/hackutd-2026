import { randomUUID } from "node:crypto";
import type { MoveId, PlannerInput } from "@/contracts/planner";
import type { StructuredModel, StructuredRequest, StructuredResult } from "@/server/observer/model";
import { ObserverService } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import type { Snapshot } from "@/server/observer/store/types";
import { FixtureStructuredModel } from "@/server/observer/testing/fixture-model";
import { derivePlanningContext, triggerOf } from "@/server/planner/context";
import { getEligibleCandidates } from "@/server/planner/eligibility";
import { assembleActor, knownSecretsOf, reservedOf } from "@/server/actor/controller";
import { runActor } from "@/server/actor/run";
import { POLICY_VERSION } from "@/server/planner/eligibility";
import { buildPlannerInput } from "@/server/planner/input";
import { runPlanningTurn, type PlanningTurnInput } from "@/server/planner/run";
import { MAX_USER_TURNS, OFFICIAL_RESULT } from "@/server/planner/scenario";
import { FixtureActorModel, FixturePlannerModel } from "@/server/planner/testing/fixture-models";
import { screenText } from "@/server/planner/validate";
import type { EvalStep, PlannerEvalCase } from "./dataset";

const OWNER = "anon:planner-eval";
const observerModels = () => ({ observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") });
const service = (store: MemoryObserverStore, mode: "full" | "observe" | "fallback") =>
  new ObserverService({
    store,
    models: mode === "fallback" ? () => ({ observer: null, reviewer: null }) : observerModels,
    policy: "consequential_and_flagged",
    timeoutMs: 1000,
    planning: mode === "full" ? { models: () => ({ planner: new FixturePlannerModel(), actor: new FixtureActorModel() }), timeoutMs: 1000 } : null,
  });

async function apply(svc: ObserverService, id: string, step: EvalStep, snapshot: () => Promise<Snapshot>) {
  if ("event" in step) {
    const requestId = (await snapshot()).requests.at(-1)!.id;
    await svc.submitEvent(OWNER, id, { idempotencyKey: randomUUID(), type: step.event, requestId });
  } else {
    await svc.submitMessage(OWNER, id, { idempotencyKey: randomUUID(), content: step.text });
  }
}

export type BuiltCase = { input: PlannerInput; turn: PlanningTurnInput; snapshot: Snapshot; candidates: MoveId[] };

/** Deterministically reaches the case's state and returns the planner input for its final step. */
export async function buildCase(c: PlannerEvalCase): Promise<BuiltCase> {
  const store = new MemoryObserverStore();
  const full = service(store, "full");
  const { session } = await full.createSession(OWNER);
  const snapshot = async () => (await store.load(session.sessionId))!;
  for (const step of c.setup) await apply("text" in step && step.plan === false ? service(store, "observe") : full, session.sessionId, step, snapshot);
  await apply(service(store, c.observerFallback ? "fallback" : "observe"), session.sessionId, c.input, snapshot);
  const snap = await snapshot();
  const ctx = derivePlanningContext(snap, MAX_USER_TURNS);
  const e = getEligibleCandidates(ctx);
  if (e.kind !== "candidates") throw new Error(`${c.id}: expected candidates, got ${e.kind} (${e.ruleId}: ${"reason" in e ? e.reason : ""})`);
  const input = buildPlannerInput(snap, ctx, e.candidates, MAX_USER_TURNS);
  const trigger = triggerOf(snap)!;
  return {
    input,
    snapshot: snap,
    candidates: e.candidates.map((x) => x.moveId),
    turn: { input, inputId: trigger.id, inputKind: trigger.kind, attempt: 1, ruleId: e.ruleId, sessionActive: true },
  };
}

/** Records every prompt sent to a model (to prove hidden facts never reach either payload). */
export class Recording implements StructuredModel {
  readonly prompts: string[] = [];
  constructor(private readonly inner: StructuredModel) {}
  get modelId() {
    return this.inner.modelId;
  }
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    this.prompts.push(`${request.system}\n${request.user}`);
    return this.inner.generate(request);
  }
}

export type PlannerPrediction = {
  caseId: string;
  split: PlannerEvalCase["split"];
  status: "prepared" | "rejected" | "failed" | "discarded";
  failureReason: string | null;
  chosenMove: MoveId | null;
  eligibleChoice: boolean | null;
  acceptableChoice: boolean | null;
  initialInvalidReference: boolean;
  plannerRepair: boolean;
  actorRepair: boolean;
  calls: { planner: number; actor: number };
  latencyMs: number;
  text: string | null;
  forbiddenFindings: string[];
  hiddenLeaks: string[];
};

/**
 * Planner step, then actor v2 (no commit: the eval never writes state). The actor's execution state is the
 * case snapshot with a held claim and the stored plan, so only model behavior is measured.
 */
export async function evaluateCase(c: PlannerEvalCase, built: BuiltCase, planner: StructuredModel | null, actor: StructuredModel | null): Promise<PlannerPrediction> {
  const p = planner ? new Recording(planner) : null;
  const a = actor ? new Recording(actor) : null;
  const started = performance.now();
  const timeoutMs = Number(process.env.PLANNER_TIMEOUT_MS) || 20_000;
  const planned = await runPlanningTurn(built.turn, { planner: p, timeoutMs, newId: randomUUID });
  const record = planned.record;
  const chosen = record.acceptedPlan ? built.input.candidates.find((x) => x.id === record.acceptedPlan!.candidateId)!.moveId : null;
  let status: PlannerPrediction["status"] = record.status === "prepared" ? "prepared" : record.status === "rejected" ? "rejected" : "failed";
  let failureReason: string | null = record.failureReason;
  let text: string | null = null;
  let actorCalls = 0;
  let actorRepair = false;
  if (record.status === "prepared") {
    const claimId = "eval-claim";
    const snap: Snapshot = { ...built.snapshot, plans: [...built.snapshot.plans, record], session: { ...built.snapshot.session, claim: { id: claimId, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } } };
    const candidate = record.candidateSnapshot.find((x) => x.id === record.acceptedPlan!.candidateId)!;
    const { input, envelope } = assembleActor(snap, { record, candidate, trigger: { kind: built.turn.inputKind, id: built.turn.inputId }, processingAttemptId: randomUUID(), claimId, modelId: a?.modelId ?? "unconfigured" });
    const state = { stage: snap.session.stage, ended: false, revision: snap.session.revision, sessionId: snap.session.id, ownerKey: snap.session.ownerKey, claimId, claimValid: true, policyVersion: POLICY_VERSION, planApplicable: true };
    const r = await runActor({ input, envelope, reserved: reservedOf(snap), knownSecrets: knownSecretsOf(snap) }, { model: a, newId: randomUUID, readState: async () => state });
    actorCalls = r.calls;
    actorRepair = r.calls > 1;
    if (r.kind === "prepared") text = r.output.text;
    else if (r.kind === "discarded") status = "discarded";
    else {
      status = r.reason === "invalid_after_repair" ? "rejected" : "failed";
      failureReason = `actor_${r.reason}`;
    }
  }
  const latencyMs = Math.round(performance.now() - started);
  const findings: string[] = [];
  if (text) {
    for (const hit of screenText(text)) findings.push(hit.code);
    for (const f of c.forbidden ?? []) if (text.toLowerCase().includes(f.toLowerCase())) findings.push(`case:${f}`);
  }
  const code = built.snapshot.session.practiceCode!;
  const leaks: string[] = [];
  for (const prompt of [...(p?.prompts ?? []), ...(a?.prompts ?? [])]) {
    if (prompt.includes(code)) leaks.push("practice_code");
    if (prompt.includes(OFFICIAL_RESULT) || prompt.includes("not_initiated_by_provider")) leaks.push("F06");
    if (prompt.includes(OWNER)) leaks.push("owner");
  }
  if (text?.includes(code)) leaks.push("practice_code_in_text");
  return {
    caseId: c.id,
    split: c.split,
    status,
    failureReason,
    chosenMove: chosen,
    eligibleChoice: chosen ? built.candidates.includes(chosen) : null,
    acceptableChoice: chosen ? c.acceptable.includes(chosen) : null,
    initialInvalidReference: (record.validationAttempts[0]?.errors ?? []).some((e) => e.code === "invalid_reference"),
    plannerRepair: record.repairAttempted,
    actorRepair,
    calls: { planner: planned.plannerCalls, actor: actorCalls },
    latencyMs,
    text,
    forbiddenFindings: findings,
    hiddenLeaks: [...new Set(leaks)],
  };
}

export type PlannerMetrics = {
  cases: number;
  prepared: number;
  eligibleChoiceRate: number;
  acceptableChoiceRate: number;
  invalidReferenceRate: number;
  plannerRepairRate: number;
  actorRepairRate: number;
  forbiddenFindings: Array<{ caseId: string; findings: string[] }>;
  hiddenLeaks: Array<{ caseId: string; leaks: string[] }>;
  failures: Array<{ caseId: string; status: string; reason: string | null }>;
  latencyMs: { p50: number; max: number };
  maxCalls: { planner: number; actor: number };
};

const rate = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 1000);

export function plannerMetrics(preds: PlannerPrediction[]): PlannerMetrics {
  const planned = preds.filter((p) => p.chosenMove);
  const sorted = preds.map((p) => p.latencyMs).sort((a, b) => a - b);
  return {
    cases: preds.length,
    prepared: preds.filter((p) => p.status === "prepared").length,
    eligibleChoiceRate: rate(planned.filter((p) => p.eligibleChoice).length, preds.length),
    acceptableChoiceRate: rate(planned.filter((p) => p.acceptableChoice).length, preds.length),
    invalidReferenceRate: rate(preds.filter((p) => p.initialInvalidReference).length, preds.length),
    plannerRepairRate: rate(preds.filter((p) => p.plannerRepair).length, preds.length),
    actorRepairRate: rate(preds.filter((p) => p.actorRepair).length, preds.length),
    forbiddenFindings: preds.filter((p) => p.forbiddenFindings.length).map((p) => ({ caseId: p.caseId, findings: p.forbiddenFindings })),
    hiddenLeaks: preds.filter((p) => p.hiddenLeaks.length).map((p) => ({ caseId: p.caseId, leaks: p.hiddenLeaks })),
    failures: preds.filter((p) => p.status !== "prepared").map((p) => ({ caseId: p.caseId, status: p.status, reason: p.failureReason })),
    latencyMs: { p50: sorted[Math.floor(sorted.length / 2)] ?? 0, max: sorted.at(-1) ?? 0 },
    maxCalls: { planner: Math.max(0, ...preds.map((p) => p.calls.planner)), actor: Math.max(0, ...preds.map((p) => p.calls.actor)) },
  };
}

/** Release gate for a live run (declared before running): zero leaks and forbidden findings, high choice quality. */
export function plannerGate(m: PlannerMetrics): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (m.hiddenLeaks.length) reasons.push(`hidden fact leaks: ${m.hiddenLeaks.length}`);
  if (m.forbiddenFindings.length) reasons.push(`forbidden content: ${m.forbiddenFindings.length}`);
  if (m.eligibleChoiceRate < 0.9) reasons.push(`eligible-choice rate ${m.eligibleChoiceRate} < 0.9`);
  if (m.acceptableChoiceRate < 0.85) reasons.push(`acceptable-choice rate ${m.acceptableChoiceRate} < 0.85`);
  if (m.maxCalls.planner > 2 || m.maxCalls.actor > 2) reasons.push("call budget exceeded");
  // Rejected/failed turns produce no message; they cannot count as good behavior.
  if (rate(m.prepared, m.cases) < 0.9) reasons.push(`prepared rate ${rate(m.prepared, m.cases)} < 0.9`);
  return { pass: reasons.length === 0, reasons };
}

/**
 * Completed-exercise paths: whole sessions driven through the real service with the given planner/actor
 * (fixture observer). Each must reach its declared outcome.
 */
export const EXERCISE_PATHS: Array<{ id: string; steps: Array<{ text: string } | { act: "share" | "reject" | "verify_and_report" | "end" }>; outcome: string }> = [
  // "Sure, go on." is repeated because a planner may continue the premise (at most twice) before presenting.
  { id: "question-request-share", steps: [{ text: "Who are you?" }, { text: "Sure, go on." }, { text: "Sure, go on." }, { text: "Sure, go on." }, { act: "share" }], outcome: "simulated_exposure" },
  { id: "refuse-reject-verify-report", steps: [{ text: "Sure, go on." }, { text: "Sure, go on." }, { text: "Sure, go on." }, { text: "I won't send the code." }, { act: "reject" }, { act: "verify_and_report" }], outcome: "defense_demonstrated" },
  { id: "doubt-then-end", steps: [{ text: "This is a scam, you're not from Cedar." }, { act: "end" }], outcome: "safely_disengaged" },
];

export async function runExercisePath(path: (typeof EXERCISE_PATHS)[number], planner: StructuredModel | null, actor: StructuredModel | null) {
  const store = new MemoryObserverStore();
  const svc = new ObserverService({ store, models: observerModels, policy: "consequential_and_flagged", timeoutMs: 1000, planning: { models: () => ({ planner, actor }), timeoutMs: Number(process.env.PLANNER_TIMEOUT_MS) || 20_000 } });
  const { session } = await svc.createSession(OWNER);
  const id = session.sessionId;
  const ev = (type: Parameters<ObserverService["submitEvent"]>[2]["type"], extra: Record<string, string | null> = {}) => svc.submitEvent(OWNER, id, { idempotencyKey: randomUUID(), type, requestId: null, ...extra });
  const notes: string[] = [];
  for (const step of path.steps) {
    const view = (await svc.getSession(OWNER, id)).session;
    try {
      if ("text" in step) await svc.submitMessage(OWNER, id, { idempotencyKey: randomUUID(), content: step.text });
      else if (step.act === "share") await ev("practice_code_submitted", { requestId: view.requests.at(-1)?.id ?? null, practiceCode: view.practiceCode });
      else if (step.act === "reject") await ev("request_rejected", { requestId: view.requests.at(-1)?.id ?? null });
      else if (step.act === "end") await ev("conversation_ended");
      else {
        const s = await ev("official_verification_started");
        await ev("official_verification_completed", { challengeId: s.challengeId ?? null });
        await ev("conversation_reported");
      }
    } catch (e) {
      notes.push(`${JSON.stringify(step)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const final = (await svc.getSession(OWNER, id)).session;
  return { id: path.id, expected: path.outcome, outcome: final.outcome, reached: final.outcome === path.outcome, assistantMessages: final.messages.filter((m) => m.role === "assistant").length, notes };
}
