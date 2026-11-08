import { createHash, randomUUID } from "node:crypto";
import {
  OBSERVER_SCHEMA_VERSION,
  type AssessmentRecord,
  type ObserverSessionResponse,
  type ObserverSessionView,
  type PlannerObservation,
  type RetryRequest,
  type ReviewPolicy,
  type SubmitEventRequest,
  type SubmitMessageRequest,
} from "@/contracts/observer";
import type { Eligibility, PlanRecord } from "@/contracts/planner";
import { HttpError, NotFoundError } from "@/server/http/errors";
import { derivePlanningContext, triggerOf } from "@/server/planner/context";
import { getEligibleCandidates } from "@/server/planner/eligibility";
import { buildPlannerInput } from "@/server/planner/input";
import { reusePlan, runPlanningTurn } from "@/server/planner/run";
import { commitActorResponse } from "@/server/actor/commit";
import { actorAudit, assembleActor, executionState, knownSecretsOf, reservedOf, StoreActorCommitPort } from "@/server/actor/controller";
import type { ActorModel } from "@/server/actor/model";
import { ACTOR_FAILURE_NOTICE, runActor } from "@/server/actor/run";
import { MOBILE_CODE_SCENARIO, TEAM_LABEL, type ScenarioDefinition } from "@/server/planner/scenario";
import { stopIntent } from "@/server/planner/stop-intent";
import type { StructuredModel } from "./model";
import { traced, type TraceInput, type TraceSink } from "./trace";
import { plannerObservation } from "./planner-input";
import { RUBRIC_VERSION } from "./rubric";
import { runObserver } from "./run";
import {
  buildObserverInput,
  eventChange,
  finalDecisionProceeded,
  issueChangesFor,
  pendingWork,
  planEvent,
  publicEvent,
  publicIssue,
  publicMessage,
  publicRequest,
  requestStates,
  requestStatusOf,
  stopConfirmationPending,
  verificationState,
} from "./state";
import type { AdditionRow, EventRow, InputChange, MessageRow, ObserverStore, RequestRow, Snapshot } from "./store/types";

/**
 * Practice-session service: ownership, idempotent inputs, event applicability, the session lifecycle, and
 * sequential processing (observer → turn limit → planner/actor) under one durable claim.
 *
 * Per user message: commit the message (CAS + receipt; a clear textual stop ends the session in the same
 * commit) → take the claim → observer pairs (models run with NO transaction open; apply atomically or
 * record stale) → turn-limit conclusion → planning for the latest input: eligibility (pure) → planner →
 * actor → save prepared → atomic commit (claim + revision + active stage) or stale → release → re-check.
 */

export type PlanningOptions = {
  models: () => { planner: StructuredModel | null; actor: StructuredModel | null };
  timeoutMs: number;
};

export type ObserverServiceOptions = {
  store: ObserverStore;
  models: () => { observer: StructuredModel | null; reviewer: StructuredModel | null };
  policy: ReviewPolicy;
  timeoutMs: number;
  /** Defaults to the MVP scenario (mobile-code-01). */
  scenario?: ScenarioDefinition;
  /** Planner/actor. When absent, sessions are observed but no opponent replies are generated. */
  planning?: PlanningOptions | null;
  newId?: () => string;
  now?: () => Date;
  leaseMs?: number;
  /** Developer trace (agent lab). Never changes behavior. */
  trace?: TraceSink;
};

export type ProcessingResult = { status: "processed" | "queued" | "idle"; assessed: number; stale: number };

const APPEND_ATTEMPTS = 5;
const PROCESS_PASSES = 3;
const MAX_STEPS_PER_PASS = 10;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
const hashOf = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const rejected = (reason: string, message: string) => new HttpError(422, "ACTION_REJECTED", message, { reason });

type PlanningWork =
  | { kind: "resume"; record: PlanRecord }
  | { kind: "plan"; trigger: NonNullable<ReturnType<typeof triggerOf>>; attempt: 1 | 2; eligibility: Extract<Eligibility, { kind: "candidates" }> };

export class ObserverService {
  private readonly newId: () => string;
  private readonly now: () => Date;
  private readonly leaseMs: number;
  readonly scenario: ScenarioDefinition;
  private readonly lastEligibility = new Map<string, string>();
  /** In-process cancellation of actor generation when the session changes (stop, verification, new input). */
  private readonly inflight = new Map<string, AbortController>();

  constructor(private readonly options: ObserverServiceOptions) {
    this.newId = options.newId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.scenario = options.scenario ?? MOBILE_CODE_SCENARIO;
    this.leaseMs = options.leaseMs ?? options.timeoutMs * 3 + (options.planning ? options.planning.timeoutMs * 4 : 0) + 30_000;
  }

  private emit(sessionId: string, entry: TraceInput) {
    try {
      this.options.trace?.emit(sessionId, entry);
    } catch {
      /* tracing must never affect processing */
    }
  }

  private get planningEnabled() {
    return Boolean(this.options.planning && this.scenario.request);
  }

  // ------------------------------------------------------------------ reads

  private async owned(ownerKey: string, sessionId: string): Promise<Snapshot> {
    const snapshot = await this.options.store.load(sessionId);
    if (!snapshot || snapshot.session.ownerKey !== ownerKey) throw new NotFoundError("Observer session");
    return snapshot;
  }

  /** Neutral technical notice for the latest input whose planning failed (planner brief §9). */
  technicalNotice(s: Snapshot): ObserverSessionView["technicalNotice"] {
    const trigger = triggerOf(s);
    if (!trigger) return null;
    const records = s.plans.filter((p) => p.inputId === trigger.id);
    if (records.some((p) => p.status === "committed")) return null;
    const failures = records.filter((p) => p.status === "failed" || p.status === "rejected").length;
    if (!failures) return null;
    const retried = s.events.some((e) => e.type === "planning_retry_requested" && e.detail === trigger.id);
    return { inputId: trigger.id, attempts: failures, canRetry: failures === 1 && !retried && !s.session.ended, message: ACTOR_FAILURE_NOTICE };
  }

  view(s: Snapshot): ObserverSessionView {
    const { request, status } = requestStatusOf(s);
    const verification = verificationState(s.events);
    const linkPlan = [...s.plans].reverse().find((p) => p.status === "committed" && p.acceptedPlan && p.candidateSnapshot.find((c) => c.id === p.acceptedPlan!.candidateId)?.moveId === "answer_procedure");
    const linkIssueId = linkPlan?.candidateSnapshot.find((c) => c.id === linkPlan.acceptedPlan!.candidateId)?.issueId ?? null;
    const linkIssue = linkIssueId ? s.issues.find((i) => i.id === linkIssueId && i.kind === "procedure_question" && i.status !== "resolved") : undefined;
    return {
      sessionId: s.session.id,
      threadId: s.session.threadId,
      scenario: { id: s.session.scenarioId, version: s.session.scenarioVersion, senderName: this.scenario.senderName, simulationNotice: this.scenario.simulationNotice },
      revision: s.session.revision,
      conversationRevision: s.session.conversationRevision,
      turn: s.session.turn,
      maxTurns: this.scenario.maxUserTurns,
      ended: s.session.ended,
      stage: s.session.stage,
      outcome: s.session.outcome,
      messages: s.messages.map(publicMessage),
      requests: s.requests.map(publicRequest),
      events: s.events.map(publicEvent),
      requestStates: requestStates(s),
      requestStatus: status,
      practiceCode: request && s.session.practiceCode ? s.session.practiceCode : null,
      verification: {
        status: verification.status,
        officialResult: verification.status === "in_progress" || verification.status === "completed" ? this.scenario.officialResult : null,
      },
      stopConfirmationPending: stopConfirmationPending(s.events),
      finalDecisionProceeded: finalDecisionProceeded(s.events),
      technicalNotice: this.technicalNotice(s),
      verificationLinkIssueId: linkIssue?.id ?? null,
      issues: s.issues.map(publicIssue),
    };
  }

  async getSession(ownerKey: string, sessionId: string): Promise<ObserverSessionResponse> {
    return { session: this.view(await this.owned(ownerKey, sessionId)) };
  }

  async assessments(ownerKey: string, sessionId: string): Promise<AssessmentRecord[]> {
    return (await this.owned(ownerKey, sessionId)).assessments;
  }

  async plans(ownerKey: string, sessionId: string): Promise<PlanRecord[]> {
    return (await this.owned(ownerKey, sessionId)).plans;
  }

  /** The planner handoff and the current deterministic eligibility (no model call). */
  async planner(ownerKey: string, sessionId: string): Promise<{ observation: PlannerObservation | null; eligibility: Eligibility }> {
    const s = await this.owned(ownerKey, sessionId);
    return { observation: plannerObservation(s, this.scenario.maxUserTurns), eligibility: getEligibleCandidates(derivePlanningContext(s, this.scenario.maxUserTurns)) };
  }

  // ------------------------------------------------------------------ writes

  async createSession(ownerKey: string): Promise<ObserverSessionResponse> {
    const id = this.newId();
    const at = this.now().toISOString();
    const opening: MessageRow = { id: this.newId(), sessionId: id, turn: 0, role: "assistant", content: this.scenario.opening, createdAt: at, revision: 1 };
    const requests: RequestRow[] = this.scenario.openingRequests.map((r) => ({ id: this.newId(), introducedByMessageId: opening.id, targetAction: r.targetAction, description: r.description, status: "open", revision: 1 }));
    const { practiceCode, caseReference } = this.scenario.reserve();
    const additions: AdditionRow[] = this.scenario.request
      ? [...(caseReference ? [{ id: "case_reference" as const, text: caseReference, introducedMessageId: null }] : []), { id: "team_label", text: TEAM_LABEL, introducedMessageId: null }]
      : [];
    await this.options.store.createSession(
      {
        id,
        ownerKey,
        threadId: this.newId(),
        scenarioId: this.scenario.id,
        scenarioVersion: this.scenario.version,
        revision: 1,
        conversationRevision: 1,
        turn: 0,
        ended: false,
        stage: "active",
        outcome: null,
        practiceCode,
        caseReference,
        createdAt: at,
      },
      { messages: [opening], requests, additions },
    );
    return this.getSession(ownerKey, id);
  }

  /** CAS append with a bounded re-read loop. Returns the committed snapshot or a receipt race. */
  private async append(sessionId: string, build: (s: Snapshot) => InputChange): Promise<{ ok: true; snapshot: Snapshot } | { ok: false; conflict: "receipt" }> {
    for (let i = 0; i < APPEND_ATTEMPTS; i++) {
      const snapshot = (await this.options.store.load(sessionId))!;
      const result = await this.options.store.append(sessionId, snapshot.session.revision, build(snapshot));
      if (result.ok) return { ok: true, snapshot: (await this.options.store.load(sessionId))! };
      if (result.conflict === "receipt") return { ok: false, conflict: "receipt" };
    }
    throw new HttpError(409, "VERSION_CONFLICT", "The conversation is busy. Try again.");
  }

  private serverEvent(s: Snapshot, type: EventRow["type"], detail: string | null, requestId: string | null = null): EventRow {
    return { id: this.newId(), sessionId: s.session.id, requestId, turn: s.session.turn, type, challengeId: null, detail, createdAt: this.now().toISOString(), revision: s.session.revision + 1 };
  }

  /** Inputs after termination are rejected and audited (planner brief §4). */
  private async auditAfterEnd(sessionId: string, attempted: string): Promise<never> {
    await this.append(sessionId, (s) => ({ events: [this.serverEvent(s, "event_rejected_after_end", attempted)] })).catch(() => undefined);
    throw rejected("SESSION_ENDED", "The practice conversation has ended.");
  }

  private async receiptDuplicate(sessionId: string, key: string, payloadHash: string) {
    const receipt = await this.options.store.findReceipt(sessionId, key);
    if (!receipt || receipt.payloadHash !== payloadHash) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "That idempotency key was used for a different submission.");
    return receipt;
  }

  private async processQuietly(sessionId: string): Promise<ProcessingResult> {
    // The input is durable. A processing failure must not fail the submission or imply anything about the
    // user's decision: work stays pending and resumes on the next request or POST …/process.
    return this.processPending(sessionId).catch(() => ({ status: "queued" as const, assessed: 0, stale: 0 }));
  }

  async submitMessage(ownerKey: string, sessionId: string, request: SubmitMessageRequest): Promise<ObserverSessionResponse> {
    const before = await this.owned(ownerKey, sessionId);
    const payloadHash = hashOf({ kind: "message", content: request.content });
    const duplicate = async () => {
      await this.receiptDuplicate(sessionId, request.idempotencyKey, payloadHash);
      // Resumes processing only if work is genuinely pending (e.g. after a crash); never re-assesses.
      const processing = await this.processQuietly(sessionId);
      return { session: this.view(await this.owned(ownerKey, sessionId)), processing, duplicate: true };
    };
    if (await this.options.store.findReceipt(sessionId, request.idempotencyKey)) return duplicate();
    const gate = (s: Snapshot) => {
      if (s.session.ended) return "ended" as const;
      if (s.session.stage === "verifying" || s.session.stage === "awaiting_final_decision") throw rejected("STAGE_PAUSED", "The conversation is paused while you verify or decide.");
      if (stopConfirmationPending(s.events)) throw rejected("STOP_CONFIRMATION_PENDING", "Confirm whether you want to end the practice first.");
      if (s.session.turn >= this.scenario.maxUserTurns) throw rejected("TURN_LIMIT", "This practice conversation has reached its turn limit.");
      return "ok" as const;
    };
    if (gate(before) === "ended") return this.auditAfterEnd(sessionId, "message");

    const messageId = this.newId();
    const intent = stopIntent(request.content);
    let endedNow = false;
    const committed = await this.append(sessionId, (s) => {
      if (gate(s) === "ended") throw rejected("SESSION_ENDED", "The practice conversation has ended.");
      const turn = s.session.turn + 1;
      const revision = s.session.revision + 1;
      const message: MessageRow = { id: messageId, sessionId, turn, role: "user", content: request.content, createdAt: this.now().toISOString(), revision };
      const receipt = { key: request.idempotencyKey, kind: "message" as const, payloadHash, resultId: messageId, challengeId: null };
      const at = this.now().toISOString();
      if (intent === "clear") {
        endedNow = true;
        // Explicit out-of-character stop: terminal in the same commit; no model work follows.
        return {
          messages: [message],
          turn,
          receipt,
          events: [{ id: this.newId(), sessionId, requestId: null, turn, type: "conversation_ended", challengeId: null, detail: "text_stop", createdAt: at, revision }],
          closeRequestIds: s.requests.filter((r) => r.status === "open").map((r) => r.id),
          stage: "ended",
          outcome: "safely_disengaged",
          ended: true,
        };
      }
      if (intent === "ambiguous") {
        return { messages: [message], turn, receipt, events: [{ id: this.newId(), sessionId, requestId: null, turn, type: "stop_confirmation_requested", challengeId: null, detail: null, createdAt: at, revision }] };
      }
      return { messages: [message], turn, receipt };
    });
    if (!committed.ok) return duplicate();
    this.inflight.get(sessionId)?.abort();
    this.emit(sessionId, { inputId: messageId, step: "input.received", agent: "server", title: "User message committed", status: "info", data: { content: request.content, stopIntent: intent, turn: committed.snapshot.session.turn } });
    if (endedNow) {
      this.emit(sessionId, { inputId: messageId, step: "session.event", agent: "server", title: "Clear textual stop: session ended (safely_disengaged); no model calls", status: "info", data: { outcome: "safely_disengaged" } });
      return { session: this.view(committed.snapshot), processing: { status: "idle", assessed: 0, stale: 0 } };
    }
    if (intent === "ambiguous") this.emit(sessionId, { inputId: messageId, step: "session.event", agent: "server", title: "Ambiguous stop: confirmation requested; opponent paused", status: "warn", data: {} });
    const processing = await this.processQuietly(sessionId);
    return { session: this.view(await this.owned(ownerKey, sessionId)), processing };
  }

  async process(ownerKey: string, sessionId: string): Promise<ObserverSessionResponse> {
    await this.owned(ownerKey, sessionId);
    const processing = await this.processPending(sessionId);
    return { session: this.view(await this.owned(ownerKey, sessionId)), processing };
  }

  /** One user-requested retry of a failed planning attempt for the same input (planner brief §9). */
  async retry(ownerKey: string, sessionId: string, request: RetryRequest): Promise<ObserverSessionResponse> {
    const before = await this.owned(ownerKey, sessionId);
    const payloadHash = hashOf({ kind: "retry" });
    if (await this.options.store.findReceipt(sessionId, request.idempotencyKey)) {
      await this.receiptDuplicate(sessionId, request.idempotencyKey, payloadHash);
      return { session: this.view(await this.owned(ownerKey, sessionId)), duplicate: true };
    }
    if (before.session.ended) return this.auditAfterEnd(sessionId, "retry");
    const eventId = this.newId();
    const committed = await this.append(sessionId, (s) => {
      const notice = this.technicalNotice(s);
      if (!notice?.canRetry) throw rejected("RETRY_NOT_AVAILABLE", "There is nothing to retry.");
      return { events: [{ ...this.serverEvent(s, "planning_retry_requested", notice.inputId), id: eventId }], receipt: { key: request.idempotencyKey, kind: "retry", payloadHash, resultId: eventId, challengeId: null } };
    });
    if (!committed.ok) return { session: this.view(await this.owned(ownerKey, sessionId)), duplicate: true };
    const processing = await this.processQuietly(sessionId);
    return { session: this.view(await this.owned(ownerKey, sessionId)), processing };
  }

  async submitEvent(ownerKey: string, sessionId: string, request: SubmitEventRequest): Promise<ObserverSessionResponse> {
    const before = await this.owned(ownerKey, sessionId);
    // The practice code is checked but never hashed or stored: the receipt binds only its presence.
    const payloadHash = hashOf({ kind: "event", type: request.type, requestId: request.requestId, challengeId: request.challengeId ?? null, code: Boolean(request.practiceCode), linkedIssueId: request.linkedIssueId ?? null });
    const duplicate = async () => {
      const receipt = await this.receiptDuplicate(sessionId, request.idempotencyKey, payloadHash);
      return { session: this.view(await this.owned(ownerKey, sessionId)), duplicate: true, ...(receipt.challengeId ? { challengeId: receipt.challengeId } : {}) };
    };
    if (await this.options.store.findReceipt(sessionId, request.idempotencyKey)) return duplicate();
    if (before.session.ended) return this.auditAfterEnd(sessionId, request.type);

    let challengeId: string | null = null;
    let issued = false;
    let eventId = "";
    const committed = await this.append(sessionId, (s) => {
      const plan = planEvent(s, request, this.scenario);
      if (!plan.ok) throw rejected(plan.reason, plan.message);
      issued = plan.issueChallenge;
      challengeId = plan.issueChallenge ? this.newId() : null;
      const { change, primaryId } = eventChange(plan, { sessionId, turn: s.session.turn, revision: s.session.revision + 1, at: this.now().toISOString(), ids: this.newId, challengeId });
      eventId = primaryId;
      return { ...change, receipt: { key: request.idempotencyKey, kind: "event", payloadHash, resultId: primaryId, challengeId } };
    });
    if (!committed.ok) return duplicate();
    // Stop, verification, rejection and any other event invalidate in-flight generation.
    this.inflight.get(sessionId)?.abort();
    this.emit(sessionId, { inputId: eventId, step: "input.received", agent: "server", title: `UI event: ${request.type}`, status: "info", data: { type: request.type, requestId: request.requestId, stage: committed.snapshot.session.stage, outcome: committed.snapshot.session.outcome } });
    // A rejection is a planning input (acknowledge the boundary); nothing else triggers opponent generation.
    const processing = request.type === "request_rejected" && !committed.snapshot.session.ended ? await this.processQuietly(sessionId) : undefined;
    const session = processing ? this.view(await this.owned(ownerKey, sessionId)) : this.view(committed.snapshot);
    return { session, ...(processing ? { processing } : {}), ...(issued && challengeId ? { challengeId } : {}) };
  }

  // ------------------------------------------------------------------ processing

  private turnLimitDue(s: Snapshot): boolean {
    if (s.session.ended || pendingWork(s)) return false;
    const last = [...s.messages].reverse().find((m) => m.role === "user");
    return Boolean(last && last.turn >= this.scenario.maxUserTurns);
  }

  /** What the planner should do next, if anything. Deterministic; wait/controller results need no record. */
  planningWork(s: Snapshot): PlanningWork | null {
    if (!this.planningEnabled || s.session.ended || pendingWork(s) || this.turnLimitDue(s)) return null;
    const trigger = triggerOf(s);
    if (!trigger) return null;
    if (trigger.kind === "message" && !s.assessments.some((a) => a.application === "applied" && a.currentMessageId === trigger.id)) return null;
    const records = s.plans.filter((p) => p.inputId === trigger.id);
    if (records.some((p) => p.status === "committed")) return null;
    const prepared = records.find((p) => p.status === "prepared");
    if (prepared) return { kind: "resume", record: prepared };
    // A stale attempt is audited and not rerun automatically (planner brief §10).
    if (records.some((p) => p.status === "stale")) return null;
    const failures = records.filter((p) => p.status === "failed" || p.status === "rejected").length;
    if (failures >= 2) return null;
    if (failures === 1 && !s.events.some((e) => e.type === "planning_retry_requested" && e.detail === trigger.id)) return null;
    const eligibility = getEligibleCandidates(derivePlanningContext(s, this.scenario.maxUserTurns));
    if (eligibility.kind !== "candidates") return null;
    return { kind: "plan", trigger, attempt: failures === 1 ? 2 : 1, eligibility };
  }

  /** Traces the deterministic eligibility decision once per input (the post-commit recheck is not repeated). */
  private traceEligibility(s: Snapshot) {
    if (!this.options.trace || !this.planningEnabled || s.session.ended) return;
    const trigger = triggerOf(s);
    if (!trigger) return;
    const key = trigger.id;
    if (this.lastEligibility.get(s.session.id) === key) return;
    this.lastEligibility.set(s.session.id, key);
    const e = getEligibleCandidates(derivePlanningContext(s, this.scenario.maxUserTurns));
    const title =
      e.kind === "candidates" ? `Eligible (${e.ruleId}): ${e.candidates.map((c) => c.moveId).join(", ")}` : `${e.kind === "wait" ? "Wait" : "Controller"} (${e.ruleId}): ${e.reason} — no planner call`;
    this.emit(s.session.id, { inputId: trigger.id, step: "planner.eligibility", agent: "planner", title, status: e.kind === "candidates" ? "ok" : "info", data: e });
  }

  private hasWork(s: Snapshot) {
    return Boolean(pendingWork(s) || this.turnLimitDue(s) || this.planningWork(s));
  }

  private async commitPrepared(s: Snapshot, record: PlanRecord, claimId: string): Promise<"committed" | "stale" | "duplicate"> {
    const candidate = record.candidateSnapshot.find((c) => c.id === record.acceptedPlan?.candidateId);
    if (!candidate || !record.actorOutput || !this.scenario.request) {
      await this.options.store.savePlan({ ...record, status: "stale" });
      return "stale";
    }
    const revision = record.basedOnRevision + 1;
    const at = this.now().toISOString();
    const message: MessageRow = { id: this.newId(), sessionId: s.session.id, turn: s.session.turn, role: "assistant", content: record.actorOutput.text, createdAt: at, revision };
    const requests: RequestRow[] =
      candidate.toolIntent === "present_practice_code_request"
        ? [{ id: this.newId(), introducedByMessageId: message.id, targetAction: this.scenario.request.targetAction, description: this.scenario.request.description, status: "open", revision }]
        : [];
    const events: EventRow[] = requests.map((r) => ({ id: this.newId(), sessionId: s.session.id, requestId: r.id, turn: s.session.turn, type: "request_presented", challengeId: null, detail: "planner", createdAt: at, revision }));
    const introduced = new Set(s.additions.filter((a) => a.introducedMessageId !== null).map((a) => a.id));
    return this.options.store.commitPlan({
      record: { ...record, status: "committed", committedMessageId: message.id },
      claimId,
      now: this.now(),
      message,
      requests,
      events,
      addressIssueId: candidate.issueId,
      introduceAdditionIds: record.actorOutput.introducedAdditionIds.filter((id) => !introduced.has(id)),
    });
  }

  /** Records a technical failure: neutral notice, no other mutation; the second failure ends the session. */
  private async technicalFailure(sessionId: string, record: PlanRecord, work: Extract<PlanningWork, { kind: "plan" }>): Promise<"failed"> {
    await this.options.store.savePlan(record);
    this.emit(sessionId, { inputId: work.trigger.id, step: "session.event", agent: "server", title: work.attempt < 2 ? "Technical notice shown; one retry available; no state changed" : "Second failure: session ended (technical_interruption)", status: "fail", data: { attempt: work.attempt, failureReason: record.failureReason } });
    await this.append(sessionId, (now) => {
      if (now.session.ended) return {};
      const notice = this.serverEvent(now, "planning_failed", `${work.trigger.id}:${work.attempt}`);
      if (work.attempt < 2) return { events: [notice] };
      return {
        events: [notice, this.serverEvent(now, "technical_interruption", work.trigger.id)],
        closeRequestIds: now.requests.filter((r) => r.status === "open").map((r) => r.id),
        stage: "ended",
        outcome: "technical_interruption",
        ended: true,
      };
    });
    return "failed";
  }

  private async planStep(s: Snapshot, work: PlanningWork, claimId: string): Promise<"committed" | "stale" | "failed"> {
    if (work.kind === "resume") {
      // Crash after a prepared response: commit it without new model calls if nothing changed; else audit
      // stale. A plan whose actor never finished is not resumed (no automatic rerun).
      if (!work.record.actorOutput || work.record.basedOnRevision !== s.session.revision || s.session.stage !== "active") {
        await this.options.store.savePlan({ ...work.record, status: "stale" });
        return "stale";
      }
      const result = await this.commitPrepared(s, work.record, claimId);
      return result === "committed" ? "committed" : "stale";
    }
    const sessionId = s.session.id;
    const inputId = work.trigger.id;
    const ctx = derivePlanningContext(s, this.scenario.maxUserTurns);
    const input = buildPlannerInput(s, ctx, work.eligibility.candidates, this.scenario.maxUserTurns);
    this.emit(sessionId, { inputId, step: "planner.input", agent: "planner", title: `Planner input (revision ${input.basedOnRevision}, ${input.candidates.length} candidates, attempt ${work.attempt})`, status: "info", data: input });
    const raw = this.options.planning!.models();
    const plannerModel = traced(raw.planner, this.options.trace, sessionId, inputId);
    const actorModel = traced(raw.actor, this.options.trace, sessionId, inputId);
    const turnInput = { input, inputId, inputKind: work.trigger.kind, attempt: work.attempt, ruleId: work.eligibility.ruleId, sessionActive: s.session.stage === "active" && !s.session.ended };

    // 1. Planner (≤2 calls). A durable retry reuses the earlier plan only if its candidate is still eligible.
    const previous = work.attempt === 2 ? [...s.plans].reverse().find((p) => p.inputId === inputId && p.acceptedPlan) : undefined;
    const reused = previous ? reusePlan(previous, turnInput, this.newId, this.now()) : null;
    const planned = reused ?? (await runPlanningTurn(turnInput, { planner: plannerModel, timeoutMs: this.options.planning!.timeoutMs, now: this.now, newId: this.newId }));
    this.emit(sessionId, {
      inputId,
      step: "planner.result",
      agent: "planner",
      title: reused ? `Plan reused from the failed attempt (candidate still eligible) · 0 planner calls` : `Plan ${planned.record.status === "prepared" ? "accepted" : planned.record.status}${planned.record.failureReason ? ` (${planned.record.failureReason})` : ""} · ${planned.plannerCalls} planner calls`,
      status: planned.record.status === "prepared" ? "ok" : "fail",
      data: planned.record,
    });
    if (planned.record.status !== "prepared") return this.technicalFailure(sessionId, planned.record, work);

    // 2. Actor v2 (≤2 calls). The plan is stored first so applicability can be checked against it.
    let record: PlanRecord = { ...planned.record, actorModelId: actorModel?.modelId ?? "unconfigured" };
    await this.options.store.savePlan(record);
    const candidate = record.candidateSnapshot.find((c) => c.id === record.acceptedPlan!.candidateId)!;
    const processingAttemptId = this.newId();
    const binding = { record, candidate, trigger: work.trigger, processingAttemptId, claimId, modelId: actorModel?.modelId ?? "unconfigured" };
    const fresh = async () => (await this.options.store.load(sessionId))!;
    let assembled: ReturnType<typeof assembleActor>;
    try {
      assembled = assembleActor(await fresh(), binding);
    } catch (error) {
      this.emit(sessionId, { inputId, step: "actor.input", agent: "actor", title: "Actor input could not be assembled", status: "fail", data: { error: error instanceof Error ? error.message : String(error) } });
      return this.technicalFailure(sessionId, { ...record, status: "failed", failureReason: "actor_input_invalid" }, work);
    }
    const { envelope, ...redacted } = { ...assembled, envelope: { ...assembled.envelope } };
    this.emit(sessionId, { inputId, step: "actor.input", agent: "actor", title: `Actor input (${candidate.moveId}, attempt ${work.attempt})`, status: "info", data: { input: redacted.input, envelope: { ...envelope, ownerKey: "[owner]", claimId: "[claim]" } } });
    const abort = new AbortController();
    this.inflight.set(sessionId, abort);
    let result: Awaited<ReturnType<typeof runActor>>;
    try {
      const snap = await fresh();
      result = await runActor(
        { input: assembled.input, envelope, reserved: reservedOf(snap), knownSecrets: knownSecretsOf(snap), signal: abort.signal },
        { model: actorModel as ActorModel | null, newId: this.newId, now: this.now, readState: async () => executionState(await fresh(), record, claimId, this.now(), this.scenario.maxUserTurns) },
      );
    } finally {
      if (this.inflight.get(sessionId) === abort) this.inflight.delete(sessionId);
    }
    const audit = actorAudit(processingAttemptId, work.attempt, result.attempts, result.kind === "prepared" ? result.styleMetrics : null);
    record = { ...record, actorAudit: audit, actorRepairAttempted: result.calls > 1 };
    this.emit(sessionId, {
      inputId,
      step: "actor.result",
      agent: "actor",
      title: result.kind === "prepared" ? `Actor draft valid · ${result.calls} call(s)` : result.kind === "discarded" ? `Actor output discarded (state changed or cancelled) · ${result.calls} call(s)` : `Actor failed (${result.reason}) · ${result.calls} call(s)`,
      status: result.kind === "prepared" ? "ok" : result.kind === "discarded" ? "warn" : "fail",
      data: { kind: result.kind, calls: result.calls, attempts: result.attempts, ...(result.kind === "prepared" ? { output: result.output, styleMetrics: result.styleMetrics } : {}), ...(result.kind === "failed" ? { reason: result.reason, notice: result.notice, endReason: result.endReason } : {}) },
    });
    if (result.kind === "discarded") {
      await this.options.store.savePlan({ ...record, status: "stale" });
      return "stale";
    }
    if (result.kind === "failed") {
      const reason = ({ timeout: "actor_timeout", refusal: "actor_refusal", unavailable: "actor_unavailable", http_error: "actor_http_error", invalid_after_repair: "actor_invalid_after_repair" } as const)[result.reason];
      return this.technicalFailure(sessionId, { ...record, status: result.reason === "invalid_after_repair" ? "rejected" : "failed", failureReason: reason }, work);
    }
    // 3. Prepared is server-only; it is delivered only after the atomic commit.
    record = { ...record, actorOutput: result.output };
    await this.options.store.savePlan(record);
    const port = new StoreActorCommitPort({ store: this.options.store, sessionId, claimId, now: this.now, newId: this.newId, scenario: this.scenario, record, candidate });
    const delivery = await commitActorResponse(result, port);
    this.emit(sessionId, {
      inputId,
      step: "commit",
      agent: "server",
      title: delivery.kind === "delivered" ? `${delivery.duplicate ? "Already committed (duplicate)" : "Committed: message sent"}` : delivery.kind === "discarded" ? "Not committed: state changed before commit" : "Commit failed",
      status: delivery.kind === "delivered" ? "ok" : delivery.kind === "discarded" ? "warn" : "fail",
      data: delivery,
    });
    if (delivery.kind === "delivered") return "committed";
    if (delivery.kind === "discarded") {
      await this.options.store.savePlan({ ...record, status: "stale" });
      return "stale";
    }
    return this.technicalFailure(sessionId, { ...record, status: "failed", failureReason: "actor_http_error" }, work);
  }

  private async observeStep(snapshot: Snapshot, work: NonNullable<ReturnType<typeof pendingWork>>, claimId: string): Promise<"applied" | "stale" | "duplicate"> {
    const sessionId = snapshot.session.id;
    const request = work.requests[0];
    const input = buildObserverInput(snapshot, work.message, request);
    this.emit(sessionId, { inputId: work.message.id, step: "observer.input", agent: "observer", title: `Observer input (${input.scope} scope${request ? `: ${request.targetAction}` : ""})`, status: "info", data: input });
    const raw = this.options.models();
    const models = { observer: traced(raw.observer, this.options.trace, sessionId, work.message.id), reviewer: traced(raw.reviewer, this.options.trace, sessionId, work.message.id) };
    const outcome = await runObserver(input, { ...models, policy: this.options.policy, timeoutMs: this.options.timeoutMs, now: this.now });
    const record: AssessmentRecord = {
      id: this.newId(),
      sessionId,
      requestId: request?.id ?? null,
      currentMessageId: work.message.id,
      basedOnRevision: input.basedOnRevision,
      observerModel: outcome.observerModel,
      reviewerModel: outcome.reviewerModel,
      rubricVersion: RUBRIC_VERSION,
      schemaVersion: OBSERVER_SCHEMA_VERSION,
      reviewPolicy: this.options.policy,
      proposedAssessment: outcome.proposedAssessment,
      finalAssessment: outcome.finalAssessment,
      validation: outcome.validation,
      repairAttempted: outcome.repairAttempted,
      reviewStatus: outcome.reviewStatus,
      reviewerResponse: outcome.reviewerResponse,
      resolution: outcome.resolution,
      failureReason: outcome.failureReason,
      attempts: outcome.attempts,
      application: "applied",
      createdAt: this.now().toISOString(),
    };
    const issues = issueChangesFor(snapshot, record, this.newId);
    const applied = await this.options.store.applyAssessment(record, claimId, this.now(), issues);
    this.emit(sessionId, {
      inputId: work.message.id,
      step: "observer.result",
      agent: "observer",
      title: `Observer output: ${record.finalAssessment.decision.label} · ${record.resolution} · review ${record.reviewStatus} · ${applied}`,
      status: applied !== "applied" ? "warn" : record.resolution === "unclear_fallback" ? "fail" : "ok",
      data: {
        application: applied,
        resolution: record.resolution,
        failureReason: record.failureReason,
        reviewStatus: record.reviewStatus,
        repairAttempted: record.repairAttempted,
        proposedAssessment: record.proposedAssessment,
        finalAssessment: record.finalAssessment,
        validation: record.validation,
        reviewerResponse: record.reviewerResponse,
        issueChanges: applied === "applied" ? issues : "none (not applied)",
        attempts: record.attempts,
      },
    });
    return applied;
  }

  /**
   * Processes pending work one step at a time under the durable claim. Bounded: at most PROCESS_PASSES
   * claim rounds × MAX_STEPS_PER_PASS steps; each observer pair runs at most once (stale records count);
   * each planning input runs at most twice (initial + one user retry).
   */
  async processPending(sessionId: string): Promise<ProcessingResult> {
    let assessed = 0;
    let stale = 0;
    for (let pass = 0; pass < PROCESS_PASSES; pass++) {
      const claimId = this.newId();
      if (!(await this.options.store.claim(sessionId, claimId, this.now(), this.leaseMs))) {
        return { status: pass === 0 && assessed + stale === 0 ? "queued" : "processed", assessed, stale };
      }
      try {
        for (let step = 0; step < MAX_STEPS_PER_PASS; step++) {
          const snapshot = await this.options.store.load(sessionId);
          if (!snapshot) break;
          const work = pendingWork(snapshot);
          if (work) {
            const applied = await this.observeStep(snapshot, work, claimId);
            if (applied === "applied") {
              assessed++;
              continue;
            }
            // Newer conversation input, or our claim lapsed: end this pass and re-claim. A duplicate means
            // another processor recorded this pair; stop rather than loop.
            if (applied === "stale") stale++;
            break;
          }
          if (this.turnLimitDue(snapshot)) {
            this.emit(sessionId, { inputId: triggerOf(snapshot)?.id ?? null, step: "session.event", agent: "server", title: "Turn limit reached: session concluded (inconclusive); no planner call", status: "info", data: {} });
            await this.append(sessionId, (s) =>
              s.session.ended || !this.turnLimitDue(s)
                ? {}
                : {
                    events: [this.serverEvent(s, "turn_limit_reached", null)],
                    closeRequestIds: s.requests.filter((r) => r.status === "open").map((r) => r.id),
                    stage: "ended",
                    outcome: "inconclusive",
                    ended: true,
                  },
            );
            continue;
          }
          this.traceEligibility(snapshot);
          const planning = this.planningWork(snapshot);
          if (!planning) break;
          const result = await this.planStep(snapshot, planning, claimId);
          if (result !== "committed") break;
        }
      } finally {
        await this.options.store.release(sessionId, claimId);
      }
      // Work that arrived while we held the claim: its submitter saw "queued" and relies on this re-check.
      const after = await this.options.store.load(sessionId);
      if (!after || !this.hasWork(after)) break;
    }
    return { status: assessed + stale > 0 ? "processed" : "idle", assessed, stale };
  }
}
