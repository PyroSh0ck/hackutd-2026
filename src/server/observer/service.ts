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
  type TurnStatus,
} from "@/contracts/observer";
import type { ExplainResponse } from "@/contracts/explain";
import type { AccountResponse, HistoryResponse, ProgressResponse } from "@/contracts/history";
import { publicDirectory } from "@/server/reference/catalog";
import { pageOf, progressOf, type Cursor } from "@/server/engine/history";
import type { Eligibility, PlanRecord } from "@/contracts/planner";
import { HttpError, NotFoundError } from "@/server/http/errors";
import { derivePlanningContext, triggerOf } from "@/server/planner/context";
import { getEligibleCandidates } from "@/server/planner/eligibility";
import { buildPlannerInput } from "@/server/planner/input";
import { reusePlan, runPlanningTurn } from "@/server/planner/run";
import { commitActorResponse } from "@/server/actor/commit";
import { actorAudit, assembleActor, executionState, knownSecretsOf, reservedOf, StoreActorCommitPort } from "@/server/actor/controller";
import type { ActorModel } from "@/server/actor/model";
import { runActor } from "@/server/actor/run";
import { runToolPlanningTurn, type MoveResult } from "@/server/planner/tool-run";
import type { ToolChatModel } from "@/server/planner/tool-model";
import { StoreBackend, VersionConflictError, type TrainingBackend } from "@/server/engine/backend";
import { decideIssues, technicalNotice, turnLimitDue, type Rejection } from "@/server/engine/decide";
import { MOBILE_CODE_SCENARIO, scenarioById, type ScenarioDefinition } from "@/server/planner/scenario";
import type { StructuredModel } from "./model";
import { traced, type TraceInput, type TraceSink } from "./trace";
import { plannerObservation } from "./planner-input";
import { RUBRIC_VERSION } from "./rubric";
import { runObserver } from "./run";
import {
  buildObserverInput,
  finalDecisionProceeded,
  pendingWork,
  publicEvent,
  publicIssue,
  publicMessage,
  publicRequest,
  requestStates,
  requestStatusOf,
  stopConfirmationPending,
  verificationState,
} from "./state";
import type { ObserverStore, Snapshot } from "./store/types";

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
  /**
   * Function-calling planner (Spacetime/Nemotron brief §7). When set, the planner reads context and
   * executes its move through tools backed by the training backend instead of returning a structured plan.
   */
  toolPlanner?: () => ToolChatModel | null;
};

export type ObserverServiceOptions = {
  /** Postgres/memory persistence (wrapped in a StoreBackend). Ignored when `backend` is given. */
  store?: ObserverStore;
  /** Authoritative training backend (e.g. SpacetimeDB). Defaults to a StoreBackend over `store`. */
  backend?: TrainingBackend;
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
  /** Scenario ids new sessions may use (selection among them). Unset: always the default scenario. */
  enabledScenarios?: readonly string[];
  /** Developer trace (agent lab). Never changes behavior. */
  trace?: TraceSink;
};

export type ProcessingResult = { status: "processed" | "queued" | "idle"; assessed: number; stale: number };

const STOPPING_EVENTS = new Set(["conversation_ended", "conversation_reported", "practice_code_submitted", "technical_interruption", "turn_limit_reached", "official_verification_started", "final_decision_proceed"]);

/**
 * Plain-language reason an input got no committed reply, for the post-session audit. Issue records keep no
 * status history, so this is derived from what is stored rather than replayed: a stale plan, an observer
 * fallback, a deliberate rule wait shown by the assessment, or what happened next (stop, verification,
 * the player's next message).
 */
export function noReplyReason(s: Snapshot, id: string, kind: "message" | "event", a: AssessmentRecord | undefined): string {
  const revision = (kind === "message" ? s.messages.find((m) => m.id === id)?.revision : s.events.find((e) => e.id === id)?.revision) ?? 0;
  const nextUser = s.messages.find((m) => m.role === "user" && m.revision > revision);
  const stop = s.events.find((e) => e.revision > revision && (!nextUser || e.revision < nextUser.revision) && STOPPING_EVENTS.has(e.type));
  const plans = s.plans.filter((p) => p.inputId === id);
  if (plans.some((p) => p.status === "stale")) return stop ? `Reply discarded: ${stop.type.replaceAll("_", " ")} happened before it was committed.` : "Reply discarded: the conversation changed before it was committed.";
  if (plans.some((p) => p.status === "failed" || p.status === "rejected")) return "Technical failure while generating the reply (a Retry reply control was offered).";
  if (kind === "message" && !a) return stop ? `Stopped (${stop.type.replaceAll("_", " ")}) before the message was assessed.` : nextUser ? "Superseded by your next message before it was assessed." : "Not assessed.";
  if (a?.resolution === "unclear_fallback") return `Observer processing fallback (${a.failureReason ?? "invalid output"}), not a reading of your message. With no pending request the rules wait (P2), so there was no reply.`;
  const f = a?.finalAssessment;
  if (f?.verificationObservations.some((o) => o.behavior === "expressed_verification_intent")) return "Intentional wait (P6): you said you would verify first, so the sender waited for you.";
  if (f?.decision.label === "explicit_acceptance") return "Intentional wait (P7): agreeing in chat is not an action; the rules waited for the request card.";
  if (f?.decision.label === "considering") return "Intentional wait (P9): you were still deciding.";
  if (stop) return `Stopped (${stop.type.replaceAll("_", " ")}) before a reply was generated.`;
  if (nextUser) return "Superseded by your next message before a reply was generated.";
  return "The training rules chose to wait; no reply was generated.";
}

/** Schedules work after the HTTP response (the route passes Next's `after`). */
export type Defer = (work: () => Promise<unknown>) => void;

/**
 * Player-facing wording for an intentional wait (eligibility `wait`). App guidance lives here, in app chrome,
 * never in the opponent's dialogue. P1 waits already have their own UI (verification banner, stop card).
 */
export function pauseMessage(ruleId: string, reason: string, sender: string): string | null {
  if (/repetition exclusions emptied/.test(reason)) return `${sender} has nothing new to add to that. Send another message or make your choice.`;
  switch (ruleId) {
    case "P1":
      return null;
    case "P2":
      return `Your last message couldn't be processed, so ${sender} didn't reply. Try rewording it.`;
    case "P4":
      return `${sender} is waiting while you check with official support. Use "Check official support" when you're ready, or keep chatting.`;
    case "P6":
      return /intent/i.test(reason)
        ? `${sender} is waiting while you check with official support. Use "Check official support" when you're ready, or keep chatting.`
        : `${sender} is waiting for your decision.`;
    case "P7":
      return "Waiting for your choice on the request card.";
    case "P8":
      return `Your reply didn't clearly accept or decline the request, so ${sender} is waiting. Choose on the request card, or say more.`;
    case "P9":
      return `${sender} is waiting for your decision.`;
    default:
      return `${sender} is waiting for your reply.`;
  }
}

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
const fromRejection = (r: Rejection) => new HttpError(r.status, r.code, r.message, { reason: r.reason });
const idempotencyConflict = () => new HttpError(409, "IDEMPOTENCY_CONFLICT", "That idempotency key was used for a different submission.");

type PlanningWork =
  | { kind: "resume"; record: PlanRecord }
  | { kind: "plan"; trigger: NonNullable<ReturnType<typeof triggerOf>>; attempt: 1 | 2; eligibility: Extract<Eligibility, { kind: "candidates" }> };

export class ObserverService {
  private readonly newId: () => string;
  private readonly now: () => Date;
  private readonly leaseMs: number;
  readonly scenario: ScenarioDefinition;
  readonly backend: TrainingBackend;
  private readonly lastEligibility = new Map<string, string>();
  /** In-process cancellation of actor generation when the session changes (stop, verification, new input). */
  private readonly inflight = new Map<string, AbortController>();

  constructor(private readonly options: ObserverServiceOptions) {
    this.newId = options.newId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.scenario = options.scenario ?? MOBILE_CODE_SCENARIO;
    this.leaseMs = options.leaseMs ?? options.timeoutMs * 3 + (options.planning ? options.planning.timeoutMs * 4 : 0) + 30_000;
    if (!options.backend && !options.store) throw new Error("ObserverService needs a store or a backend.");
    this.backend = options.backend ?? new StoreBackend(options.store!, { scenario: this.scenario, newId: this.newId, now: this.now });
  }

  private emit(sessionId: string, entry: TraceInput) {
    try {
      this.options.trace?.emit(sessionId, entry);
    } catch {
      /* tracing must never affect processing */
    }
  }

  /** The session's own scenario (stored at creation); the configured default only for unknown legacy ids. */
  scenarioOf(s: Snapshot): ScenarioDefinition {
    return scenarioById(s.session.scenarioId, s.session.scenarioVersion, [this.scenario]) ?? this.scenario;
  }

  /** Opponent replies need planning models and a scenario with something to plan (a request or legitimate moves). */
  private planningEnabled(s: Snapshot) {
    const scenario = this.scenarioOf(s);
    return Boolean(this.options.planning && (scenario.request || scenario.moves));
  }

  // ------------------------------------------------------------------ reads

  private async owned(ownerKey: string, sessionId: string): Promise<Snapshot> {
    const snapshot = await this.backend.load(sessionId);
    if (!snapshot || snapshot.session.ownerKey !== ownerKey) throw new NotFoundError("Observer session");
    return snapshot;
  }

  /** Neutral technical notice for the latest input whose planning failed (planner brief §9). */
  technicalNotice(s: Snapshot): ObserverSessionView["technicalNotice"] {
    return technicalNotice(s);
  }

  /**
   * State of the latest player input, derived from the authoritative snapshot (the same deterministic rules
   * the processor runs), so a reload recovers it: still generating, an intentional rule-based pause (with the
   * rule as the reason), a technical failure (the existing notice), or idle (answered / nothing to answer).
   */
  turnStatus(s: Snapshot): TurnStatus {
    const idle: TurnStatus = { state: "idle", reason: null, message: null };
    if (s.session.ended) return idle;
    if (technicalNotice(s)) return { state: "failed", reason: "planning_failed", message: null };
    if (this.hasWork(s)) return { state: "generating", reason: pendingWork(s) ? "observing" : "planning", message: null };
    const trigger = triggerOf(s);
    if (!trigger || !this.planningEnabled(s)) return idle;
    if (s.plans.some((p) => p.inputId === trigger.id && p.status === "committed")) return idle;
    const sender = this.scenarioOf(s).senderName;
    if (s.plans.some((p) => p.inputId === trigger.id && p.status === "stale")) {
      return { state: "paused", reason: "superseded", message: "That reply was cancelled because the conversation changed before it was sent. Send another message to continue." };
    }
    const e = getEligibleCandidates(derivePlanningContext(s, this.scenarioOf(s).maxUserTurns));
    if (e.kind !== "wait") return idle;
    return { state: "paused", reason: e.ruleId, message: pauseMessage(e.ruleId, e.reason, sender) };
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
      // The scenario id names its kind, so it stays opaque until the session has ended (review).
      scenario: { id: s.session.ended ? s.session.scenarioId : "practice", version: s.session.ended ? s.session.scenarioVersion : 0, senderName: this.scenarioOf(s).senderName, simulationNotice: this.scenarioOf(s).simulationNotice },
      revision: s.session.revision,
      conversationRevision: s.session.conversationRevision,
      turn: s.session.turn,
      maxTurns: this.scenarioOf(s).maxUserTurns,
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
        officialResult: verification.status === "in_progress" || verification.status === "completed" ? this.scenarioOf(s).officialResult : null,
        activeChallengeId: verification.status === "in_progress" && s.session.stage === "verifying" ? verification.activeChallengeId : null,
        attemptId: verification.status === "in_progress" && s.session.stage === "verifying" ? ([...s.events].reverse().find((e) => e.type === "official_verification_started" && e.challengeId === verification.activeChallengeId)?.id ?? null) : null,
      },
      stopConfirmationPending: stopConfirmationPending(s.events),
      finalDecisionProceeded: finalDecisionProceeded(s.events),
      technicalNotice: this.technicalNotice(s),
      turnStatus: this.turnStatus(s),
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

  /**
   * "How this session worked" (brief §9): concise decision summaries from stored audit records, for ended
   * sessions only. Never prompts, raw model output, or reasoning.
   */
  async explain(ownerKey: string, sessionId: string): Promise<ExplainResponse> {
    const s = await this.owned(ownerKey, sessionId);
    if (!s.session.ended) throw rejected("SESSION_ACTIVE", "The technical summary is available after the practice ends.");
    const inputs = [
      ...s.messages.filter((m) => m.role === "user").map((m) => ({ id: m.id, kind: "message" as const })),
      ...s.events.filter((e) => s.plans.some((p) => p.inputId === e.id)).map((e) => ({ id: e.id, kind: "event" as const })),
    ];
    const turns = inputs.map(({ id, kind }) => {
      const a = [...s.assessments].reverse().find((x) => x.currentMessageId === id && x.application === "applied");
      const plan = [...s.plans].reverse().find((p) => p.inputId === id && p.status === "committed") ?? [...s.plans].reverse().find((p) => p.inputId === id);
      const candidate = plan?.candidateSnapshot.find((c) => c.id === plan.acceptedPlan?.candidateId);
      return {
        inputId: id,
        inputKind: kind,
        observer: a
          ? {
              model: a.observerModel,
              scope: a.requestId ? ("request" as const) : ("conversation" as const),
              decision: a.finalAssessment.decision.label,
              proposedDecision: a.proposedAssessment?.decision.label ?? null,
              resolution: a.resolution,
              reviewStatus: a.reviewStatus,
              evidenceCount: a.finalAssessment.decision.evidence.length,
              validationErrors: a.validation.errors.length,
            }
          : null,
        planner: plan
          ? {
              protocol: plan.plannerProtocol ?? ("structured" as const),
              model: plan.modelId,
              ruleId: plan.ruleId,
              move: candidate?.moveId ?? null,
              status: plan.status,
              failureReason: plan.failureReason,
              toolCalls: plan.toolCalls ?? [],
              committedMessageId: plan.committedMessageId,
              requestIds: plan.committedMessageId ? s.requests.filter((r) => r.introducedByMessageId === plan.committedMessageId).map((r) => r.id) : [],
              actorModel: plan.actorModelId,
            }
          : null,
        noReply: s.plans.some((p) => p.inputId === id && p.status === "committed") ? null : noReplyReason(s, id, kind, a),
      };
    });
    const outcomeRevision = s.events.find((e) => ["conversation_ended", "conversation_reported", "request_rejected", "practice_code_submitted", "turn_limit_reached", "technical_interruption"].includes(e.type) && s.session.ended)?.revision;
    return {
      backend: this.backend.name,
      revision: s.session.revision,
      outcome: s.session.outcome,
      outcomeEventIds: s.events.filter((e) => e.revision === outcomeRevision).map((e) => e.id),
      turns,
    };
  }

  /**
   * The trusted in-app account (brief §3): the fictional practice profile plus the notices that genuinely
   * exist for this session's scenario. A fraud scenario has none. Opened/reviewed state comes from events.
   */
  async account(ownerKey: string, sessionId: string): Promise<AccountResponse> {
    const s = await this.owned(ownerKey, sessionId);
    const portal = this.scenarioOf(s).portal;
    const opened = (id: string) => s.events.some((e) => e.type === "portal_record_opened" && e.detail === id);
    return {
      profile: publicDirectory().profile,
      notices: portal ? [{ id: portal.id, title: portal.title, summary: opened(portal.id) ? portal.summary : null, actionLabel: portal.actionLabel, opened: opened(portal.id), reviewed: s.events.some((e) => e.type === "portal_notice_reviewed" && e.detail === portal.id) }] : [],
    };
  }

  /** Owner-scoped history from the authoritative backend, newest first, with an opaque cursor. */
  async history(ownerKey: string, limit: number, cursor: string | undefined): Promise<HistoryResponse> {
    let decoded: Cursor | null = null;
    if (cursor) {
      try {
        const c = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
        if (typeof c?.createdAt !== "string" || typeof c?.id !== "string") throw new Error("bad cursor");
        decoded = c;
      } catch {
        throw new HttpError(422, "VALIDATION_ERROR", "Invalid cursor.");
      }
    }
    const { items, next } = pageOf(await this.backend.listSessions(ownerKey), limit, decoded);
    return {
      sessions: items.map((s) => ({ sessionId: s.id, title: "An account message", createdAt: s.createdAt, endedAt: s.endedAt, ended: s.ended, stage: s.stage, outcome: s.outcome, turn: s.turn })),
      nextCursor: next ? Buffer.from(JSON.stringify(next)).toString("base64url") : null,
    };
  }

  async progress(ownerKey: string): Promise<ProgressResponse> {
    const p = progressOf(await this.backend.listSessions(ownerKey));
    return { completed: p.completed, outcomes: p.outcomes, observations: p.observations, nextPractice: { available: true, selection: p.completed > 0 ? "recommended" : "mixed" } };
  }

  /** The planner handoff and the current deterministic eligibility (no model call). */
  async planner(ownerKey: string, sessionId: string): Promise<{ observation: PlannerObservation | null; eligibility: Eligibility }> {
    const s = await this.owned(ownerKey, sessionId);
    return { observation: plannerObservation(s, this.scenarioOf(s).maxUserTurns), eligibility: getEligibleCandidates(derivePlanningContext(s, this.scenarioOf(s).maxUserTurns)) };
  }

  // ------------------------------------------------------------------ writes

  /**
   * New session. Without options the configured default scenario is used (backward compatible). With
   * `enabledScenarios` configured, `selection` picks among them (default mixed); an explicit `scenarioId`
   * must already have been authorized by the caller (test/admin gating in the route).
   */
  async createSession(ownerKey: string, options: { selection?: "mixed" | "recommended"; scenarioId?: string } = {}): Promise<ObserverSessionResponse> {
    const enabled = this.options.enabledScenarios;
    const id = await this.backend.createSession(ownerKey, enabled?.length ? { enabled, selection: options.selection ?? "mixed", ...(options.scenarioId ? { scenarioId: options.scenarioId } : {}) } : undefined);
    return this.getSession(ownerKey, id);
  }

  private async processQuietly(sessionId: string): Promise<ProcessingResult> {
    // The input is durable. A processing failure must not fail the submission or imply anything about the
    // user's decision: work stays pending and resumes on the next request or POST …/process.
    return this.processPending(sessionId).catch(() => ({ status: "queued" as const, assessed: 0, stale: 0 }));
  }

  /** Runs processing now, or hands it to `defer` (after the response) and reports it as queued. */
  private async processOrDefer(sessionId: string, defer: Defer | undefined): Promise<ProcessingResult> {
    if (!defer) return this.processQuietly(sessionId);
    defer(() => this.processQuietly(sessionId));
    return { status: "queued", assessed: 0, stale: 0 };
  }

  /** Maps a backend outcome that is not a fresh commit to the HTTP contract. */
  private settle(result: { kind: "ended" } | { kind: "rejected"; rejection: Rejection }): never {
    if (result.kind === "ended") throw rejected("SESSION_ENDED", "The practice conversation has ended.");
    throw fromRejection(result.rejection);
  }

  private async write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof VersionConflictError) throw new HttpError(409, "VERSION_CONFLICT", error.message);
      throw error;
    }
  }

  /**
   * With `defer`, processing is handed to `defer` (the route's `after()`), so the response confirms only
   * that the input is durable; the browser follows `turnStatus`. Without it, the response waits for the reply.
   */
  async submitMessage(ownerKey: string, sessionId: string, request: SubmitMessageRequest, defer?: Defer): Promise<ObserverSessionResponse> {
    await this.owned(ownerKey, sessionId);
    const payloadHash = hashOf({ kind: "message", content: request.content });
    const result = await this.write(() => this.backend.submitMessage(sessionId, { key: request.idempotencyKey, content: request.content, payloadHash }));
    if (result.kind === "duplicate") {
      if (result.receipt.payloadHash !== payloadHash) throw idempotencyConflict();
      // Resumes processing only if work is genuinely pending (e.g. after a crash); never re-assesses.
      const processing = await this.processOrDefer(sessionId, defer);
      return { session: this.view(await this.owned(ownerKey, sessionId)), processing, duplicate: true };
    }
    if (result.kind !== "committed") this.settle(result);
    const { messageId, intent, endedNow } = result;
    this.inflight.get(sessionId)?.abort();
    const committed = await this.owned(ownerKey, sessionId);
    this.emit(sessionId, { inputId: messageId, step: "input.received", agent: "server", title: `User message committed (${this.backend.name})`, status: "info", data: { content: request.content, stopIntent: intent, turn: committed.session.turn, backend: this.backend.name } });
    if (endedNow) {
      this.emit(sessionId, { inputId: messageId, step: "session.event", agent: "server", title: "Clear textual stop: session ended (safely_disengaged); no model calls", status: "info", data: { outcome: "safely_disengaged" } });
      return { session: this.view(committed), processing: { status: "idle", assessed: 0, stale: 0 } };
    }
    if (intent === "ambiguous") this.emit(sessionId, { inputId: messageId, step: "session.event", agent: "server", title: "Ambiguous stop: confirmation requested; opponent paused", status: "warn", data: {} });
    const processing = await this.processOrDefer(sessionId, defer);
    return { session: this.view(await this.owned(ownerKey, sessionId)), processing };
  }

  async process(ownerKey: string, sessionId: string): Promise<ObserverSessionResponse> {
    await this.owned(ownerKey, sessionId);
    const processing = await this.processPending(sessionId);
    return { session: this.view(await this.owned(ownerKey, sessionId)), processing };
  }

  /** One user-requested retry of a failed planning attempt for the same input (planner brief §9). */
  async retry(ownerKey: string, sessionId: string, request: RetryRequest, defer?: Defer): Promise<ObserverSessionResponse> {
    await this.owned(ownerKey, sessionId);
    const payloadHash = hashOf({ kind: "retry" });
    const result = await this.write(() => this.backend.retry(sessionId, { key: request.idempotencyKey, payloadHash }));
    if (result.kind === "duplicate") {
      if (result.receipt.payloadHash !== payloadHash) throw idempotencyConflict();
      return { session: this.view(await this.owned(ownerKey, sessionId)), duplicate: true };
    }
    if (result.kind !== "committed") this.settle(result);
    const processing = await this.processOrDefer(sessionId, defer);
    return { session: this.view(await this.owned(ownerKey, sessionId)), processing };
  }

  async submitEvent(ownerKey: string, sessionId: string, request: SubmitEventRequest): Promise<ObserverSessionResponse> {
    await this.owned(ownerKey, sessionId);
    // The practice code is checked but never hashed or stored: the receipt binds only its presence.
    const payloadHash = hashOf({ kind: "event", type: request.type, requestId: request.requestId, challengeId: request.challengeId ?? null, code: Boolean(request.practiceCode), linkedIssueId: request.linkedIssueId ?? null, recordId: request.recordId ?? null });
    const result = await this.write(() => this.backend.submitEvent(sessionId, request, payloadHash));
    if (result.kind === "duplicate") {
      if (result.receipt.payloadHash !== payloadHash) throw idempotencyConflict();
      return { session: this.view(await this.owned(ownerKey, sessionId)), duplicate: true, ...(result.receipt.challengeId ? { challengeId: result.receipt.challengeId } : {}) };
    }
    if (result.kind !== "committed") this.settle(result);
    // Stop, verification, rejection and any other event invalidate in-flight generation.
    this.inflight.get(sessionId)?.abort();
    const committed = await this.owned(ownerKey, sessionId);
    this.emit(sessionId, { inputId: result.eventId, step: "input.received", agent: "server", title: `UI event: ${request.type} (${this.backend.name})`, status: "info", data: { type: request.type, requestId: request.requestId, stage: committed.session.stage, outcome: committed.session.outcome, backend: this.backend.name } });
    // A rejection is a planning input (acknowledge the boundary); nothing else triggers opponent generation.
    const processing = request.type === "request_rejected" && !committed.session.ended ? await this.processQuietly(sessionId) : undefined;
    const session = processing ? this.view(await this.owned(ownerKey, sessionId)) : this.view(committed);
    return { session, ...(processing ? { processing } : {}), ...(result.challengeId ? { challengeId: result.challengeId } : {}) };
  }

  // ------------------------------------------------------------------ processing

  private turnLimitDue(s: Snapshot): boolean {
    return turnLimitDue(s, this.scenarioOf(s));
  }

  /** What the planner should do next, if anything. Deterministic; wait/controller results need no record. */
  planningWork(s: Snapshot): PlanningWork | null {
    if (!this.planningEnabled(s) || s.session.ended || pendingWork(s) || this.turnLimitDue(s)) return null;
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
    const eligibility = getEligibleCandidates(derivePlanningContext(s, this.scenarioOf(s).maxUserTurns));
    if (eligibility.kind !== "candidates") return null;
    return { kind: "plan", trigger, attempt: failures === 1 ? 2 : 1, eligibility };
  }

  /** Traces the deterministic eligibility decision once per input (the post-commit recheck is not repeated). */
  private traceEligibility(s: Snapshot) {
    if (!this.options.trace || !this.planningEnabled(s) || s.session.ended) return;
    const trigger = triggerOf(s);
    if (!trigger) return;
    const key = trigger.id;
    if (this.lastEligibility.get(s.session.id) === key) return;
    this.lastEligibility.set(s.session.id, key);
    const e = getEligibleCandidates(derivePlanningContext(s, this.scenarioOf(s).maxUserTurns));
    const title =
      e.kind === "candidates" ? `Eligible (${e.ruleId}): ${e.candidates.map((c) => c.moveId).join(", ")}` : `${e.kind === "wait" ? "Wait" : "Controller"} (${e.ruleId}): ${e.reason} — no planner call`;
    this.emit(s.session.id, { inputId: trigger.id, step: "planner.eligibility", agent: "planner", title, status: e.kind === "candidates" ? "ok" : "info", data: e });
  }

  private hasWork(s: Snapshot) {
    return Boolean(pendingWork(s) || this.turnLimitDue(s) || this.planningWork(s));
  }

  private async commitPrepared(s: Snapshot, record: PlanRecord, claimId: string): Promise<"committed" | "stale" | "duplicate"> {
    return (await this.backend.commitPrepared(s.session.id, record, claimId)).kind;
  }

  /** Records a technical failure: neutral notice, no other mutation; the second failure ends the session. */
  private async technicalFailure(sessionId: string, record: PlanRecord, work: Extract<PlanningWork, { kind: "plan" }>): Promise<"failed"> {
    this.emit(sessionId, { inputId: work.trigger.id, step: "session.event", agent: "server", title: work.attempt < 2 ? "Technical notice shown; one retry available; no state changed" : "Second failure: session ended (technical_interruption)", status: "fail", data: { attempt: work.attempt, failureReason: record.failureReason } });
    await this.backend.recordTechnicalFailure(sessionId, record, work.trigger.id, work.attempt);
    return "failed";
  }

  private async planStep(s: Snapshot, work: PlanningWork, claimId: string): Promise<"committed" | "stale" | "failed"> {
    if (work.kind === "resume") {
      // Crash after a prepared response: commit it without new model calls if nothing changed; else audit
      // stale. A plan whose actor never finished is not resumed (no automatic rerun).
      if (!work.record.actorOutput || work.record.basedOnRevision !== s.session.revision || s.session.stage !== "active") {
        await this.backend.savePlan({ ...work.record, status: "stale" });
        return "stale";
      }
      const result = await this.commitPrepared(s, work.record, claimId);
      return result === "committed" ? "committed" : "stale";
    }
    const sessionId = s.session.id;
    const inputId = work.trigger.id;
    const ctx = derivePlanningContext(s, this.scenarioOf(s).maxUserTurns);
    const input = buildPlannerInput(s, ctx, work.eligibility.candidates, this.scenarioOf(s).maxUserTurns);
    this.emit(sessionId, { inputId, step: "planner.input", agent: "planner", title: `Planner input (revision ${input.basedOnRevision}, ${input.candidates.length} candidates, attempt ${work.attempt})`, status: "info", data: input });
    const raw = this.options.planning!.models();
    const plannerModel = traced(raw.planner, this.options.trace, sessionId, inputId);
    const actorModel = traced(raw.actor, this.options.trace, sessionId, inputId);
    const turnInput = { input, inputId, inputKind: work.trigger.kind, attempt: work.attempt, ruleId: work.eligibility.ruleId, sessionActive: s.session.stage === "active" && !s.session.ended };

    if (this.options.planning!.toolPlanner && !(work.attempt === 2 && s.plans.some((p) => p.inputId === inputId && p.acceptedPlan))) {
      return this.toolPlanStep(s, work, claimId, turnInput, actorModel);
    }

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
    return (await this.executePrepared(planned.record, work, claimId, actorModel)).step;
  }

  /**
   * The planner as a tool-calling agent: get_training_context re-reads the authoritative backend;
   * execute_training_move runs `executePrepared` (actor + atomic backend commit) and returns real ids.
   */
  private async toolPlanStep(s: Snapshot, work: Extract<PlanningWork, { kind: "plan" }>, claimId: string, turnInput: Parameters<typeof runPlanningTurn>[0], actorModel: ReturnType<typeof traced>): Promise<"committed" | "stale" | "failed"> {
    const sessionId = s.session.id;
    const inputId = work.trigger.id;
    const model = this.options.planning!.toolPlanner!();
    let step: "committed" | "stale" | "failed" = "stale";
    const result = await runToolPlanningTurn(turnInput, {
      model,
      timeoutMs: this.options.planning!.timeoutMs,
      newId: this.newId,
      now: this.now,
      readContext: async () => {
        // A real read of the authoritative service; any change since planning began abandons the turn.
        const fresh = await this.backend.load(sessionId);
        if (!fresh || fresh.session.revision !== turnInput.input.basedOnRevision || fresh.session.ended) return null;
        const eligibility = getEligibleCandidates(derivePlanningContext(fresh, this.scenarioOf(fresh).maxUserTurns));
        if (eligibility.kind !== "candidates") return null;
        return buildPlannerInput(fresh, derivePlanningContext(fresh, this.scenarioOf(fresh).maxUserTurns), eligibility.candidates, this.scenarioOf(fresh).maxUserTurns);
      },
      executeMove: async (prepared) => {
        const executed = await this.executePrepared(prepared, work, claimId, actorModel);
        step = executed.step;
        return executed.move;
      },
    });
    this.emit(sessionId, {
      inputId,
      step: "planner.result",
      agent: "planner",
      title: `Tool planner (${model?.modelId ?? "unconfigured"}): ${result.record.toolCalls?.map((c) => `${c.name}→${c.status}`).join(", ") || "no tool call"} · ${result.plannerCalls} model calls`,
      status: result.outcome.kind === "executed" && result.outcome.move.status === "committed" ? "ok" : "fail",
      data: { toolCalls: result.record.toolCalls, outcome: result.outcome, record: result.record },
    });
    if (result.outcome.kind === "executed") return step;
    if (result.record.status === "stale") {
      await this.backend.savePlan(result.record);
      return "stale";
    }
    return this.technicalFailure(sessionId, result.record, work);
  }

  /** Actor (≤2 calls) and the atomic backend commit for a prepared plan. Shared by both planner protocols. */
  private async executePrepared(prepared: PlanRecord, work: Extract<PlanningWork, { kind: "plan" }>, claimId: string, actorModel: ReturnType<typeof traced>): Promise<{ step: "committed" | "stale" | "failed"; move: MoveResult }> {
    const sessionId = prepared.sessionId;
    const inputId = work.trigger.id;
    const failed = async (record: PlanRecord, detail: string) => ({ step: await this.technicalFailure(sessionId, record, work), move: { status: "failed" as const, detail } });
    const stale = (detail: string) => ({ step: "stale" as const, move: { status: "stale" as const, detail } });

    // 2. Actor v2 (≤2 calls). The plan is stored first so applicability can be checked against it.
    let record: PlanRecord = { ...prepared, actorModelId: actorModel?.modelId ?? "unconfigured" };
    await this.backend.savePlan(record);
    const candidate = record.candidateSnapshot.find((c) => c.id === record.acceptedPlan!.candidateId)!;
    const processingAttemptId = this.newId();
    const binding = { record, candidate, trigger: work.trigger, processingAttemptId, claimId, modelId: actorModel?.modelId ?? "unconfigured" };
    const fresh = async () => (await this.backend.load(sessionId))!;
    let assembled: ReturnType<typeof assembleActor>;
    try {
      assembled = assembleActor(await fresh(), binding);
    } catch (error) {
      // The session moved on (stop, verification, new input) before the actor started: that is a stale
      // turn, not a technical failure. Only a genuinely unbuildable input on a current session fails.
      const now = await fresh();
      if (now.session.ended || now.session.stage !== "active" || now.session.revision !== record.basedOnRevision) {
        await this.backend.savePlan({ ...record, status: "stale" });
        this.emit(sessionId, { inputId, step: "actor.input", agent: "actor", title: "Session changed before the actor ran: turn discarded (stale)", status: "warn", data: { stage: now.session.stage, ended: now.session.ended } });
        return stale("the session changed before the actor ran");
      }
      this.emit(sessionId, { inputId, step: "actor.input", agent: "actor", title: "Actor input could not be assembled", status: "fail", data: { error: error instanceof Error ? error.message : String(error) } });
      return failed({ ...record, status: "failed", failureReason: "actor_input_invalid" }, "actor input could not be assembled");
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
        { model: actorModel as ActorModel | null, newId: this.newId, now: this.now, readState: async () => {
          const now = await fresh();
          return executionState(now, record, claimId, this.now(), this.scenarioOf(now).maxUserTurns);
        } },
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
      await this.backend.savePlan({ ...record, status: "stale" });
      return stale("state changed while the actor was writing");
    }
    if (result.kind === "failed") {
      const reason = ({ timeout: "actor_timeout", refusal: "actor_refusal", unavailable: "actor_unavailable", http_error: "actor_http_error", invalid_after_repair: "actor_invalid_after_repair" } as const)[result.reason];
      return failed({ ...record, status: result.reason === "invalid_after_repair" ? "rejected" : "failed", failureReason: reason }, reason);
    }
    // 3. Prepared is server-only; it is delivered only after the atomic commit.
    record = { ...record, actorOutput: result.output };
    await this.backend.savePlan(record);
    const port = new StoreActorCommitPort({ backend: this.backend, sessionId, claimId, now: this.now, newId: this.newId, scenario: this.scenarioOf(await fresh()), record, candidate });
    const delivery = await commitActorResponse(result, port);
    this.emit(sessionId, {
      inputId,
      step: "commit",
      agent: "server",
      title: delivery.kind === "delivered" ? `${delivery.duplicate ? "Already committed (duplicate)" : "Committed: message sent"}` : delivery.kind === "discarded" ? "Not committed: state changed before commit" : "Commit failed",
      status: delivery.kind === "delivered" ? "ok" : delivery.kind === "discarded" ? "warn" : "fail",
      data: delivery,
    });
    if (delivery.kind === "delivered") {
      const after = (await this.backend.load(sessionId))!;
      const requestIds = after.requests.filter((r) => r.introducedByMessageId === delivery.messageId).map((r) => r.id);
      const eventIds = after.events.filter((e) => e.requestId !== null && requestIds.includes(e.requestId) && e.type === "request_presented").map((e) => e.id);
      return { step: "committed", move: { status: "committed", messageId: delivery.messageId, requestIds, eventIds, revision: after.session.revision } };
    }
    if (delivery.kind === "discarded") {
      await this.backend.savePlan({ ...record, status: "stale" });
      return stale("the authoritative state changed before commit");
    }
    return failed({ ...record, status: "failed", failureReason: "actor_http_error" }, "commit failed");
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
    const applied = await this.backend.applyAssessment(record, claimId);
    // Issue changes are derived by the backend from its own state; this preview is for the trace only.
    const issues = decideIssues(snapshot, record, () => "(assigned by backend)");
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
      if (!(await this.backend.claim(sessionId, claimId, this.leaseMs))) {
        return { status: pass === 0 && assessed + stale === 0 ? "queued" : "processed", assessed, stale };
      }
      try {
        for (let step = 0; step < MAX_STEPS_PER_PASS; step++) {
          const snapshot = await this.backend.load(sessionId);
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
            await this.backend.concludeTurnLimit(sessionId);
            continue;
          }
          this.traceEligibility(snapshot);
          const planning = this.planningWork(snapshot);
          if (!planning) break;
          const result = await this.planStep(snapshot, planning, claimId);
          if (result !== "committed") break;
        }
      } finally {
        await this.backend.release(sessionId, claimId);
      }
      // Work that arrived while we held the claim: its submitter saw "queued" and relies on this re-check.
      const after = await this.backend.load(sessionId);
      if (!after || !this.hasWork(after)) break;
    }
    return { status: assessed + stale > 0 ? "processed" : "idle", assessed, stale };
  }
}
