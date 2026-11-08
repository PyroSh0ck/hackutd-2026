import type { AssessmentRecord, SubmitEventRequest } from "@/contracts/observer";
import type { PlanRecord } from "@/contracts/planner";
import { SCENARIOS, scenarioById, secureRandom, type ScenarioDefinition } from "@/server/planner/scenario";
import type { StopIntent } from "@/server/planner/stop-intent";
import type { ApplyResult, CommitResult, InputChange, ObserverStore, Receipt, Snapshot } from "@/server/observer/store/types";
import type { SessionSummary } from "./history";
import { selectScenario, type Selection } from "./selection";
import { decideAfterEnd, decideCommit, decideCreate, decideEvent, decideIssues, decideMessage, decideRetry, decideTechnicalFailure, decideTurnLimit, type Env, type Rejection } from "./decide";

/**
 * Command-level boundary for authoritative training state. The service never computes a state change
 * itself: it sends commands, and the backend decides (with the shared rules in `./decide`) and applies them
 * atomically. Two implementations: `StoreBackend` (Postgres/memory) and `SpacetimeBackend` (the module).
 */

export type Committed<T> = { kind: "committed" } & T;
export type Duplicate = { kind: "duplicate"; receipt: Receipt };
/** The session had already ended; the attempt was audited (`event_rejected_after_end`). */
export type Ended = { kind: "ended" };
export type Rejected = { kind: "rejected"; rejection: Rejection };

export type MessageResult = Committed<{ messageId: string; intent: StopIntent; endedNow: boolean }> | Duplicate | Ended | Rejected;
export type EventResult = Committed<{ eventId: string; challengeId: string | null }> | Duplicate | Ended | Rejected;
export type RetryResult = Committed<{ eventId: string }> | Duplicate | Ended | Rejected;
export type CommitPreparedResult = { kind: CommitResult; messageId: string | null };

export interface TrainingBackend {
  readonly name: "postgres" | "memory" | "spacetime";
  load(sessionId: string): Promise<Snapshot | null>;
  /** The owner's sessions from the authoritative backend (never from browser storage). */
  listSessions(ownerKey: string): Promise<SessionSummary[]>;
  /**
   * Creates a session for one enabled scenario, chosen by the backend (mixed: its randomness; recommended:
   * the owner's history it holds). `scenarioId` is an already-authorized test/admin override.
   */
  createSession(ownerKey: string, choice?: CreateChoice): Promise<string>;
  submitMessage(sessionId: string, input: { key: string; content: string; payloadHash: string }): Promise<MessageResult>;
  submitEvent(sessionId: string, request: SubmitEventRequest, payloadHash: string): Promise<EventResult>;
  retry(sessionId: string, input: { key: string; payloadHash: string }): Promise<RetryResult>;
  claim(sessionId: string, claimId: string, leaseMs: number): Promise<boolean>;
  release(sessionId: string, claimId: string): Promise<void>;
  /** Issue changes are derived by the backend from its own snapshot, never supplied by the caller. */
  applyAssessment(record: AssessmentRecord, claimId: string): Promise<ApplyResult>;
  savePlan(record: PlanRecord): Promise<void>;
  /** Atomic commit of a prepared plan (message, authorized request, events, issue, additions). */
  commitPrepared(sessionId: string, record: PlanRecord, claimId: string): Promise<CommitPreparedResult>;
  concludeTurnLimit(sessionId: string): Promise<void>;
  recordTechnicalFailure(sessionId: string, record: PlanRecord, inputId: string, attempt: 1 | 2): Promise<void>;
}

export type CreateChoice = { enabled: readonly string[]; selection: Selection; scenarioId?: string };

export class VersionConflictError extends Error {
  constructor() {
    super("The conversation is busy. Try again.");
  }
}

const APPEND_ATTEMPTS = 5;
const fail = (message: string): never => {
  throw new Error(message);
};
/** Highest registered version of a scenario id (new sessions always use the latest immutable version). */
export const latestVersion = (id: string) => Math.max(1, ...SCENARIOS.filter((s) => s.id === id).map((s) => s.version));

/** Postgres or in-memory persistence; the shared rules run in this process. */
export class StoreBackend implements TrainingBackend {
  constructor(
    private readonly store: ObserverStore,
    private readonly deps: { scenario: ScenarioDefinition; newId: () => string; now: () => Date; random?: () => number },
    readonly name: "postgres" | "memory" = "postgres",
  ) {}

  /** The rules run with the session's own scenario (stored at creation), never a global default. */
  private env(s?: Snapshot | null): Env {
    const scenario = s ? (scenarioById(s.session.scenarioId, s.session.scenarioVersion, [this.deps.scenario]) ?? this.deps.scenario) : this.deps.scenario;
    return { scenario, newId: this.deps.newId, now: this.deps.now() };
  }

  load(sessionId: string) {
    return this.store.load(sessionId);
  }

  listSessions(ownerKey: string) {
    return this.store.listSessions(ownerKey);
  }

  /** CAS append with a bounded re-read loop; `build` may return a rejection to abort without writing. */
  private async append<T extends { change: InputChange }>(sessionId: string, build: (s: Snapshot) => T | Rejection): Promise<{ ok: true; value: T } | { ok: false; conflict: "receipt" } | Rejection> {
    for (let i = 0; i < APPEND_ATTEMPTS; i++) {
      const snapshot = (await this.store.load(sessionId))!;
      const value = build(snapshot);
      if ("ok" in value && value.ok === false) return value;
      const result = await this.store.append(sessionId, snapshot.session.revision, (value as T).change);
      if (result.ok) return { ok: true, value: value as T };
      if (result.conflict === "receipt") return { ok: false, conflict: "receipt" };
    }
    throw new VersionConflictError();
  }

  private async duplicateOf(sessionId: string, key: string): Promise<Duplicate | null> {
    const receipt = await this.store.findReceipt(sessionId, key);
    return receipt ? { kind: "duplicate", receipt } : null;
  }

  private async audit(sessionId: string, attempted: string): Promise<Ended> {
    await this.append(sessionId, (s) => ({ change: decideAfterEnd(s, attempted, this.env(s)) })).catch(() => undefined);
    return { kind: "ended" };
  }

  async createSession(ownerKey: string, choice?: CreateChoice) {
    const id = this.deps.newId();
    const random = this.deps.random ?? secureRandom;
    let scenario = this.deps.scenario;
    if (choice) {
      const enabled = choice.enabled.map((sid) => scenarioById(sid, latestVersion(sid), [this.deps.scenario])).filter((s): s is ScenarioDefinition => s !== null);
      scenario = choice.scenarioId ? (enabled.find((s) => s.id === choice.scenarioId) ?? fail(`Scenario ${choice.scenarioId} is not enabled.`)) : selectScenario(choice.selection, enabled, await this.store.listSessions(ownerKey), random);
    }
    const { session, change } = decideCreate({ ...this.env(), scenario }, ownerKey, id, this.deps.newId(), random);
    await this.store.createSession(session, change);
    return id;
  }

  async submitMessage(sessionId: string, input: { key: string; content: string; payloadHash: string }): Promise<MessageResult> {
    const dup = await this.duplicateOf(sessionId, input.key);
    if (dup) return dup;
    if ((await this.store.load(sessionId))?.session.ended) return this.audit(sessionId, "message");
    const messageId = this.deps.newId();
    const r = await this.append(sessionId, (s) => decideMessage(s, { ...input, messageId }, this.env(s)));
    if ("value" in r) return { kind: "committed", messageId, intent: r.value.intent, endedNow: r.value.endedNow };
    if ("conflict" in r) return (await this.duplicateOf(sessionId, input.key))!;
    return { kind: "rejected", rejection: r };
  }

  async submitEvent(sessionId: string, request: SubmitEventRequest, payloadHash: string): Promise<EventResult> {
    const dup = await this.duplicateOf(sessionId, request.idempotencyKey);
    if (dup) return dup;
    if ((await this.store.load(sessionId))?.session.ended) return this.audit(sessionId, request.type);
    const r = await this.append(sessionId, (s) => decideEvent(s, request, payloadHash, this.env(s)));
    if ("value" in r) return { kind: "committed", eventId: r.value.primaryId, challengeId: r.value.challengeId };
    if ("conflict" in r) return (await this.duplicateOf(sessionId, request.idempotencyKey))!;
    return { kind: "rejected", rejection: r };
  }

  async retry(sessionId: string, input: { key: string; payloadHash: string }): Promise<RetryResult> {
    const dup = await this.duplicateOf(sessionId, input.key);
    if (dup) return dup;
    if ((await this.store.load(sessionId))?.session.ended) return this.audit(sessionId, "retry");
    const eventId = this.deps.newId();
    const r = await this.append(sessionId, (s) => decideRetry(s, { ...input, eventId }, this.env(s)));
    if ("value" in r) return { kind: "committed", eventId };
    if ("conflict" in r) return (await this.duplicateOf(sessionId, input.key))!;
    return { kind: "rejected", rejection: r };
  }

  claim(sessionId: string, claimId: string, leaseMs: number) {
    return this.store.claim(sessionId, claimId, this.deps.now(), leaseMs);
  }

  release(sessionId: string, claimId: string) {
    return this.store.release(sessionId, claimId);
  }

  async applyAssessment(record: AssessmentRecord, claimId: string) {
    const snapshot = await this.store.load(record.sessionId);
    if (!snapshot) return "stale" as const;
    return this.store.applyAssessment(record, claimId, this.deps.now(), decideIssues(snapshot, record, this.deps.newId));
  }

  savePlan(record: PlanRecord) {
    return this.store.savePlan(record);
  }

  async commitPrepared(sessionId: string, record: PlanRecord, claimId: string): Promise<CommitPreparedResult> {
    const snapshot = await this.store.load(sessionId);
    const commit = snapshot && decideCommit(snapshot, record, claimId, this.env(snapshot));
    if (!commit) {
      await this.store.savePlan({ ...record, status: "stale" });
      return { kind: "stale", messageId: null };
    }
    const kind = await this.store.commitPlan(commit);
    return { kind, messageId: kind === "committed" ? commit.message.id : null };
  }

  async concludeTurnLimit(sessionId: string) {
    await this.append(sessionId, (s) => ({ change: decideTurnLimit(s, this.env(s)) }));
  }

  async recordTechnicalFailure(sessionId: string, record: PlanRecord, inputId: string, attempt: 1 | 2) {
    await this.store.savePlan(record);
    await this.append(sessionId, (s) => ({ change: decideTechnicalFailure(s, inputId, attempt, this.env(s)) }));
  }
}
