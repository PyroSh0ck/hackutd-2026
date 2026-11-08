/**
 * SCAMPER training engine: the authoritative SpacetimeDB module.
 *
 * Owns session state, messages, requests, events, verification, assessments, plan audit records, agent-turn
 * claims, deterministic outcomes and per-owner progress. Every mutation runs the shared training rules
 * (`src/server/engine/*`, the same code the app's tests exercise) inside one transaction over private
 * tables. External model calls never happen here; the Node orchestrator calls these procedures with a
 * worker identity that an admin has authorized.
 *
 * All tables are private. Procedures return a JSON result envelope and never throw for rule rejections
 * (a throw inside a transaction rolls it back; we catch outside the transaction and report it).
 */
import { schema, table, t, SenderError, type InferSchema } from 'spacetimedb/server';
import type { ProcedureCtx, TransactionCtx } from 'spacetimedb/server';
import { AssessmentRecordSchema, ClientEventTypeSchema, type ClientEventType, type SubmitEventRequest } from '@/contracts/observer';
import { PlanRecordSchema } from '@/contracts/planner';
import {
  cmdApplyAssessment,
  cmdClaim,
  cmdCommitPrepared,
  cmdConcludeTurnLimit,
  cmdCreate,
  cmdRecordTechnicalFailure,
  cmdRelease,
  cmdRetry,
  cmdSavePlan,
  cmdSubmitEvent,
  cmdSubmitMessage,
} from '@/server/engine/commands';
import type { Env } from '@/server/engine/decide';
import { snapshotOf, type SessionData } from '@/server/engine/ops';
import { compareSummaries, summaryOf } from '@/server/engine/history';
import { MOBILE_CODE_SCENARIO, SCENARIOS, scenarioById, type ScenarioDefinition } from '@/server/planner/scenario';
import { selectScenario } from '@/server/engine/selection';

// ---------------------------------------------------------------------------------------------- tables

const worker = table({ name: 'worker' }, { identity: t.identity().primaryKey(), role: t.string(), addedAt: t.timestamp() });

const trainingSession = table(
  { name: 'training_session' },
  {
    id: t.string().primaryKey(),
    ownerKey: t.string().index('btree'),
    threadId: t.string(),
    scenarioId: t.string(),
    scenarioVersion: t.u32(),
    revision: t.u32(),
    conversationRevision: t.u32(),
    turn: t.u32(),
    ended: t.bool(),
    stage: t.string(),
    outcome: t.option(t.string()),
    practiceCode: t.option(t.string()),
    caseReference: t.option(t.string()),
    claimId: t.option(t.string()),
    claimExpiresAt: t.option(t.string()),
    createdAt: t.string(),
  }
);

const message = table(
  { name: 'message' },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    seq: t.u32(),
    turn: t.u32(),
    role: t.string(),
    content: t.string(),
    createdAt: t.string(),
    revision: t.u32(),
  }
);

const trainingRequest = table(
  { name: 'training_request' },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    seq: t.u32(),
    introducedByMessageId: t.string(),
    targetAction: t.string(),
    description: t.string(),
    status: t.string(),
    revision: t.u32(),
  }
);

const trainingEvent = table(
  { name: 'training_event' },
  {
    id: t.string().primaryKey(),
    sessionId: t.string().index('btree'),
    seq: t.u32(),
    requestId: t.option(t.string()),
    turn: t.u32(),
    type: t.string(),
    challengeId: t.option(t.string()),
    detail: t.option(t.string()),
    createdAt: t.string(),
    revision: t.u32(),
  }
);

/** Nested records (validated with the shared zod schemas) keyed by id, with queryable key columns. */
const recordColumns = { id: t.string().primaryKey(), sessionId: t.string().index('btree'), seq: t.u32(), status: t.string(), json: t.string() };
const agentAssessment = table({ name: 'agent_assessment' }, recordColumns);
const agentTurn = table({ name: 'agent_turn' }, { ...recordColumns, inputId: t.string() });
const trainingIssue = table({ name: 'training_issue' }, recordColumns);
const trainingAddition = table({ name: 'training_addition' }, recordColumns);
const inputReceipt = table({ name: 'input_receipt' }, recordColumns);

const trainingOutcome = table(
  { name: 'training_outcome' },
  { sessionId: t.string().primaryKey(), ownerKey: t.string().index('btree'), outcome: t.string(), decidedAt: t.timestamp(), evidenceEventIds: t.string() }
);

const practiceProgress = table(
  { name: 'practice_progress' },
  {
    ownerKey: t.string().primaryKey(),
    completed: t.u32(),
    defenseDemonstrated: t.u32(),
    safelyDisengaged: t.u32(),
    simulatedExposure: t.u32(),
    inconclusive: t.u32(),
    technicalInterruption: t.u32(),
    updatedAt: t.timestamp(),
    // Appended (migration-safe defaults) for the legitimate notice scenario.
    legitimateTaskCompleted: t.u32().default(0),
    benignTaskCompletedUnverified: t.u32().default(0),
    legitimateRequestDeclined: t.u32().default(0),
  }
);

/** Monotonic id sequence: makes every generated id unique across transactions (ctx.random is deterministic). */
const idSequence = table({ name: 'id_sequence' }, { id: t.u32().primaryKey(), next: t.u64() });

const spacetimedb = schema({
  idSequence,
  worker,
  trainingSession,
  message,
  trainingRequest,
  trainingEvent,
  agentAssessment,
  agentTurn,
  trainingIssue,
  trainingAddition,
  inputReceipt,
  trainingOutcome,
  practiceProgress,
});
export default spacetimedb;

type Tx = TransactionCtx<InferSchema<typeof spacetimedb>>;
type Proc = ProcedureCtx<InferSchema<typeof spacetimedb>>;

// ---------------------------------------------------------------------------------------------- authorization

export const init = spacetimedb.init((ctx) => {
  // The publisher is the module admin; it authorizes the backend worker identity.
  ctx.db.worker.insert({ identity: ctx.sender, role: 'admin', addedAt: ctx.timestamp });
});

export const authorizeWorker = spacetimedb.reducer({ worker: t.identity() }, (ctx, { worker: id }) => {
  const caller = ctx.db.worker.identity.find(ctx.sender);
  if (!caller || caller.role !== 'admin') throw new SenderError('Only the module admin can authorize workers.');
  if (!ctx.db.worker.identity.find(id)) ctx.db.worker.insert({ identity: id, role: 'worker', addedAt: ctx.timestamp });
});

export const revokeWorker = spacetimedb.reducer({ worker: t.identity() }, (ctx, { worker: id }) => {
  const caller = ctx.db.worker.identity.find(ctx.sender);
  if (!caller || caller.role !== 'admin') throw new SenderError('Only the module admin can revoke workers.');
  const row = ctx.db.worker.identity.find(id);
  if (row && row.role === 'worker') ctx.db.worker.identity.delete(id);
});

// ---------------------------------------------------------------------------------------------- environment

const idState = new WeakMap<object, { next: bigint }>();

/**
 * UUID-shaped ids: 56 bits from the module's persistent sequence (unique by construction) plus random
 * bits. `ctx.random` alone is deterministic per transaction seed, so it cannot guarantee uniqueness.
 */
function uuid(tx: Tx): string {
  let state = idState.get(tx);
  if (!state) {
    state = { next: tx.db.idSequence.id.find(0)?.next ?? 1n };
    idState.set(tx, state);
  }
  const n = state.next++;
  const b = tx.random.fill(new Uint8Array(16));
  for (let i = 0; i < 7; i++) b[9 + i] = Number((n >> BigInt(48 - 8 * i)) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function flushIds(tx: Tx) {
  const state = idState.get(tx);
  if (!state) return;
  if (tx.db.idSequence.id.find(0)) tx.db.idSequence.id.update({ id: 0, next: state.next });
  else tx.db.idSequence.insert({ id: 0, next: state.next });
}

const dateOf = (tx: Tx) => new Date(Number(tx.timestamp.microsSinceUnixEpoch / 1000n));

/** The rule environment for a session: its own stored scenario (module-held private truth included). */
const envOf = (tx: Tx, data?: SessionData): Env => ({
  scenario: (data && scenarioById(data.session.scenarioId, data.session.scenarioVersion)) || MOBILE_CODE_SCENARIO,
  newId: () => uuid(tx),
  now: dateOf(tx),
});

// ---------------------------------------------------------------------------------------------- load / persist

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
const bySeq = <R extends { seq: number }>(rows: Iterable<R>) => [...rows].sort((a, b) => a.seq - b.seq);

function load(tx: Tx, sessionId: string): SessionData | null {
  const s = tx.db.trainingSession.id.find(sessionId);
  if (!s) return null;
  const parse = <T>(rows: Iterable<{ seq: number; json: string }>) => bySeq(rows).map((r) => JSON.parse(r.json) as T);
  return {
    session: {
      id: s.id,
      ownerKey: s.ownerKey,
      threadId: s.threadId,
      scenarioId: s.scenarioId,
      scenarioVersion: s.scenarioVersion,
      revision: s.revision,
      conversationRevision: s.conversationRevision,
      turn: s.turn,
      ended: s.ended,
      stage: s.stage as SessionData['session']['stage'],
      outcome: nul(s.outcome) as SessionData['session']['outcome'],
      practiceCode: nul(s.practiceCode),
      caseReference: nul(s.caseReference),
      claim: s.claimId && s.claimExpiresAt ? { id: s.claimId, expiresAt: s.claimExpiresAt } : null,
      createdAt: s.createdAt,
    },
    messages: bySeq(tx.db.message.sessionId.filter(sessionId)).map((m) => ({ id: m.id, sessionId: m.sessionId, turn: m.turn, role: m.role as 'user' | 'assistant', content: m.content, createdAt: m.createdAt, revision: m.revision })),
    requests: bySeq(tx.db.trainingRequest.sessionId.filter(sessionId)).map((r) => ({
      id: r.id,
      introducedByMessageId: r.introducedByMessageId,
      targetAction: r.targetAction as SessionData['requests'][number]['targetAction'],
      description: r.description,
      status: r.status as 'open' | 'closed',
      revision: r.revision,
    })),
    events: bySeq(tx.db.trainingEvent.sessionId.filter(sessionId)).map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      requestId: nul(e.requestId),
      turn: e.turn,
      type: e.type as SessionData['events'][number]['type'],
      challengeId: nul(e.challengeId),
      detail: nul(e.detail),
      createdAt: e.createdAt,
      revision: e.revision,
    })),
    assessments: parse(tx.db.agentAssessment.sessionId.filter(sessionId)),
    issues: parse(tx.db.trainingIssue.sessionId.filter(sessionId)),
    additions: parse(tx.db.trainingAddition.sessionId.filter(sessionId)),
    plans: parse(tx.db.agentTurn.sessionId.filter(sessionId)),
    receipts: parse(tx.db.inputReceipt.sessionId.filter(sessionId)),
  };
}

/** Writes the difference between the loaded aggregate and its mutated state. Rows are never deleted. */
function persist(tx: Tx, before: SessionData | null, after: SessionData) {
  const sid = after.session.id;
  const s = after.session;
  const sessionRow = {
    id: s.id,
    ownerKey: s.ownerKey,
    threadId: s.threadId,
    scenarioId: s.scenarioId,
    scenarioVersion: s.scenarioVersion,
    revision: s.revision,
    conversationRevision: s.conversationRevision,
    turn: s.turn,
    ended: s.ended,
    stage: s.stage,
    outcome: opt(s.outcome),
    practiceCode: opt(s.practiceCode),
    caseReference: opt(s.caseReference),
    claimId: opt(s.claim?.id ?? null),
    claimExpiresAt: opt(s.claim?.expiresAt ?? null),
    createdAt: s.createdAt,
  };
  if (!before) tx.db.trainingSession.insert(sessionRow);
  else if (JSON.stringify(before.session) !== JSON.stringify(after.session)) tx.db.trainingSession.id.update(sessionRow);

  const sync = <R extends { id: string }>(prev: R[] | undefined, next: R[], insert: (row: R, seq: number) => void, update: (row: R, seq: number) => void) => {
    const old = new Map((prev ?? []).map((r) => [r.id, JSON.stringify(r)]));
    next.forEach((row, seq) => {
      const was = old.get(row.id);
      if (was === undefined) insert(row, seq);
      else if (was !== JSON.stringify(row)) update(row, seq);
    });
  };

  sync(before?.messages, after.messages, (m, seq) => tx.db.message.insert({ ...m, seq }), () => {
    throw new Error('messages are immutable');
  });
  const req = (r: SessionData['requests'][number], seq: number) => ({ ...r, sessionId: sid, seq });
  sync(before?.requests, after.requests, (r, seq) => tx.db.trainingRequest.insert(req(r, seq)), (r, seq) => tx.db.trainingRequest.id.update(req(r, seq)));
  sync(before?.events, after.events, (e, seq) => tx.db.trainingEvent.insert({ ...e, seq, requestId: opt(e.requestId), challengeId: opt(e.challengeId), detail: opt(e.detail) }), () => {
    throw new Error('events are immutable');
  });

  const rec = <R extends { id: string }>(statusOf: (r: R) => string) => (r: R, seq: number) => ({ id: r.id, sessionId: sid, seq, status: statusOf(r), json: JSON.stringify(r) });
  const assessment = rec<SessionData['assessments'][number]>((a) => a.application);
  sync(before?.assessments, after.assessments, (r, seq) => tx.db.agentAssessment.insert(assessment(r, seq)), () => {
    throw new Error('assessments are immutable');
  });
  const plan = (r: SessionData['plans'][number], seq: number) => ({ ...rec<SessionData['plans'][number]>((p) => p.status)(r, seq), inputId: r.inputId });
  sync(before?.plans, after.plans, (r, seq) => tx.db.agentTurn.insert(plan(r, seq)), (r, seq) => tx.db.agentTurn.id.update(plan(r, seq)));
  const issue = rec<SessionData['issues'][number]>((i) => i.status);
  sync(before?.issues, after.issues, (r, seq) => tx.db.trainingIssue.insert(issue(r, seq)), (r, seq) => tx.db.trainingIssue.id.update(issue(r, seq)));
  // Additions and receipts are keyed per session (their natural ids repeat across sessions).
  const keyed = <R>(idOf: (r: R) => string, statusOf: (r: R) => string) => (r: R, seq: number) => ({ id: `${sid}:${idOf(r)}`, sessionId: sid, seq, status: statusOf(r), json: JSON.stringify(r) });
  const addition = keyed<SessionData['additions'][number]>((a) => a.id, (a) => (a.introducedMessageId ? 'introduced' : 'reserved'));
  sync(
    before?.additions.map((a) => ({ ...a, id: a.id })),
    after.additions,
    (r, seq) => tx.db.trainingAddition.insert(addition(r, seq)),
    (r, seq) => tx.db.trainingAddition.id.update(addition(r, seq))
  );
  const receipt = keyed<SessionData['receipts'][number]>((r) => r.key, (r) => r.kind);
  sync(
    before?.receipts.map((r) => ({ ...r, id: r.key })),
    after.receipts.map((r) => ({ ...r, id: r.key })),
    (r, seq) => tx.db.inputReceipt.insert(receipt(r, seq)),
    () => {
      throw new Error('receipts are immutable');
    }
  );

  // Deterministic outcome and progression: recorded exactly once, when the outcome is first decided.
  if (!before?.session.outcome && s.outcome) recordOutcome(tx, after);
}

const PROGRESS_FIELD = {
  defense_demonstrated: 'defenseDemonstrated',
  safely_disengaged: 'safelyDisengaged',
  simulated_exposure: 'simulatedExposure',
  inconclusive: 'inconclusive',
  technical_interruption: 'technicalInterruption',
  legitimate_task_completed: 'legitimateTaskCompleted',
  benign_task_completed_unverified: 'benignTaskCompletedUnverified',
  legitimate_request_declined: 'legitimateRequestDeclined',
} as const;

function recordOutcome(tx: Tx, data: SessionData) {
  const outcome = data.session.outcome!;
  if (tx.db.trainingOutcome.sessionId.find(data.session.id)) return;
  const evidence = data.events.filter((e) => e.revision === data.session.revision).map((e) => e.id);
  tx.db.trainingOutcome.insert({ sessionId: data.session.id, ownerKey: data.session.ownerKey, outcome, decidedAt: tx.timestamp, evidenceEventIds: JSON.stringify(evidence) });
  const prev = tx.db.practiceProgress.ownerKey.find(data.session.ownerKey);
  const base = prev ?? { ownerKey: data.session.ownerKey, completed: 0, defenseDemonstrated: 0, safelyDisengaged: 0, simulatedExposure: 0, inconclusive: 0, technicalInterruption: 0, legitimateTaskCompleted: 0, benignTaskCompletedUnverified: 0, legitimateRequestDeclined: 0, updatedAt: tx.timestamp };
  const field = PROGRESS_FIELD[outcome];
  const next = { ...base, completed: base.completed + 1, [field]: base[field] + 1, updatedAt: tx.timestamp };
  if (prev) tx.db.practiceProgress.ownerKey.update(next);
  else tx.db.practiceProgress.insert(next);
}

// ---------------------------------------------------------------------------------------------- procedure plumbing

type Result = { ok: true; result: unknown } | { ok: false; error: 'unauthorized' | 'not_found' | 'invalid_input' | 'failed'; detail: string };

/**
 * Runs `body` in one transaction for an authorized worker. Rule rejections are values; any thrown error
 * (including a failed write) aborts the whole transaction and is reported, never partially committed.
 */
function run(ctx: Proc, body: (tx: Tx) => Result): string {
  try {
    return JSON.stringify(
      ctx.withTx((tx) => {
        if (!tx.db.worker.identity.find(ctx.sender)) return { ok: false, error: 'unauthorized', detail: 'caller is not an authorized worker' } as Result;
        const result = body(tx);
        flushIds(tx);
        return result;
      })
    );
  } catch (error) {
    return JSON.stringify({ ok: false, error: 'failed', detail: error instanceof Error ? error.message : String(error) } satisfies Result);
  }
}

/** Load → command → persist for one existing session. */
function withSession(ctx: Proc, sessionId: string, command: (data: SessionData, tx: Tx) => unknown): string {
  return run(ctx, (tx) => {
    const before = load(tx, sessionId);
    if (!before) return { ok: false, error: 'not_found', detail: 'no such session' };
    const after = JSON.parse(JSON.stringify(before)) as SessionData;
    const result = command(after, tx);
    persist(tx, before, after);
    return { ok: true, result };
  });
}

const invalid = (detail: string): Result => ({ ok: false, error: 'invalid_input', detail });

// ---------------------------------------------------------------------------------------------- procedures

/** The owner's session summaries from the module's own tables. */
function ownerSummaries(tx: Tx, ownerKey: string) {
  return [...tx.db.trainingSession.ownerKey.filter(ownerKey)]
    .map((s) =>
      summaryOf(
        { id: s.id, scenarioId: s.scenarioId, scenarioVersion: s.scenarioVersion, createdAt: s.createdAt, ended: s.ended, stage: s.stage as SessionData['session']['stage'], outcome: nul(s.outcome) as SessionData['session']['outcome'], turn: s.turn },
        bySeq(tx.db.trainingEvent.sessionId.filter(s.id)).map((e) => ({ type: e.type as SessionData['events'][number]['type'], createdAt: e.createdAt }))
      )
    )
    .sort(compareSummaries);
}

/**
 * Starts a session. The module chooses the scenario among the enabled ids (mixed: its own randomness;
 * recommended: the owner's completions it holds); `scenarioId` is a caller-authorized test/admin override.
 */
export const startSession = spacetimedb.procedure(
  { ownerKey: t.string(), enabled: t.string(), selection: t.string(), scenarioId: t.option(t.string()) },
  t.string(),
  (ctx, { ownerKey, enabled, selection, scenarioId }) =>
  run(ctx, (tx) => {
    if (!ownerKey) return invalid('ownerKey is required');
    if (selection !== 'mixed' && selection !== 'recommended') return invalid('selection must be mixed or recommended');
    const latest = (id: string) => SCENARIOS.filter((s) => s.id === id).sort((a, b) => b.version - a.version)[0] ?? null;
    const scenarios = enabled.split(',').map((id) => latest(id.trim())).filter((s): s is ScenarioDefinition => s !== null);
    if (!scenarios.length) return invalid('no enabled scenario is known to this module');
    const forced = scenarioId ? scenarios.find((s) => s.id === scenarioId) : undefined;
    if (scenarioId && !forced) return invalid(`scenario ${scenarioId} is not enabled`);
    const scenario = forced ?? selectScenario(selection, scenarios, ownerSummaries(tx, ownerKey), () => tx.random());
    const env = { ...envOf(tx), scenario };
    const data = cmdCreate(env, ownerKey, uuid(tx), uuid(tx), () => tx.random());
    persist(tx, null, data);
    return { ok: true, result: { sessionId: data.session.id } };
  })
);

/** Worker-only read of the full aggregate (includes server-held secrets; never forwarded to browsers). */
export const loadSession = spacetimedb.procedure({ sessionId: t.string() }, t.string(), (ctx, { sessionId }) =>
  run(ctx, (tx) => {
    const data = load(tx, sessionId);
    return data ? { ok: true, result: { snapshot: snapshotOf(data), receipts: data.receipts } } : { ok: false, error: 'not_found', detail: 'no such session' };
  })
);

export const submitUserMessage = spacetimedb.procedure(
  { sessionId: t.string(), idempotencyKey: t.string(), content: t.string(), payloadHash: t.string() },
  t.string(),
  (ctx, a) =>
    withSession(ctx, a.sessionId, (data, tx) =>
      cmdSubmitMessage(data, { key: a.idempotencyKey, content: a.content, payloadHash: a.payloadHash, messageId: uuid(tx) }, envOf(tx, data))
    )
);

export const submitTrainingEvent = spacetimedb.procedure(
  {
    sessionId: t.string(),
    idempotencyKey: t.string(),
    type: t.string(),
    requestId: t.option(t.string()),
    challengeId: t.option(t.string()),
    practiceCode: t.option(t.string()),
    linkedIssueId: t.option(t.string()),
    recordId: t.option(t.string()),
    payloadHash: t.string(),
  },
  t.string(),
  (ctx, a) => {
    const type = ClientEventTypeSchema.safeParse(a.type);
    if (!type.success) return JSON.stringify(invalid(`unknown event type ${a.type}`));
    const request: SubmitEventRequest = {
      idempotencyKey: a.idempotencyKey,
      type: type.data as ClientEventType,
      requestId: nul(a.requestId),
      ...(a.challengeId ? { challengeId: a.challengeId } : {}),
      ...(a.practiceCode ? { practiceCode: a.practiceCode } : {}),
      ...(a.linkedIssueId ? { linkedIssueId: a.linkedIssueId } : {}),
      ...(a.recordId ? { recordId: a.recordId } : {}),
    };
    return withSession(ctx, a.sessionId, (data, tx) => cmdSubmitEvent(data, request, a.payloadHash, envOf(tx, data)));
  }
);

export const requestRetry = spacetimedb.procedure({ sessionId: t.string(), idempotencyKey: t.string(), payloadHash: t.string() }, t.string(), (ctx, a) =>
  withSession(ctx, a.sessionId, (data, tx) => cmdRetry(data, { key: a.idempotencyKey, payloadHash: a.payloadHash, eventId: uuid(tx) }, envOf(tx, data)))
);

export const claimAgentTurn = spacetimedb.procedure({ sessionId: t.string(), claimId: t.string(), leaseMs: t.u32() }, t.string(), (ctx, a) =>
  withSession(ctx, a.sessionId, (data, tx) => cmdClaim(data, a.claimId, dateOf(tx), a.leaseMs))
);

export const releaseAgentTurn = spacetimedb.procedure({ sessionId: t.string(), claimId: t.string() }, t.string(), (ctx, a) =>
  withSession(ctx, a.sessionId, (data) => cmdRelease(data, a.claimId))
);

export const recordAssessment = spacetimedb.procedure({ sessionId: t.string(), claimId: t.string(), recordJson: t.string() }, t.string(), (ctx, a) => {
  const parsed = AssessmentRecordSchema.safeParse(JSON.parse(a.recordJson));
  if (!parsed.success || parsed.data.sessionId !== a.sessionId) return JSON.stringify(invalid('assessment record failed validation'));
  return withSession(ctx, a.sessionId, (data, tx) => cmdApplyAssessment(data, parsed.data, a.claimId, envOf(tx, data)));
});

export const savePlan = spacetimedb.procedure({ sessionId: t.string(), recordJson: t.string() }, t.string(), (ctx, a) => {
  const parsed = PlanRecordSchema.safeParse(JSON.parse(a.recordJson));
  if (!parsed.success || parsed.data.sessionId !== a.sessionId) return JSON.stringify(invalid('plan record failed validation'));
  if (parsed.data.status === 'committed') return JSON.stringify(invalid('committed plans are written only by commit_agent_turn'));
  return withSession(ctx, a.sessionId, (data) => cmdSavePlan(data, parsed.data));
});

/** The atomic commit: revalidates claim, revision, stage and the server-built candidate inside the module. */
export const commitAgentTurn = spacetimedb.procedure({ sessionId: t.string(), claimId: t.string(), recordJson: t.string() }, t.string(), (ctx, a) => {
  const parsed = PlanRecordSchema.safeParse(JSON.parse(a.recordJson));
  if (!parsed.success || parsed.data.sessionId !== a.sessionId) return JSON.stringify(invalid('plan record failed validation'));
  return withSession(ctx, a.sessionId, (data, tx) => cmdCommitPrepared(data, parsed.data, a.claimId, envOf(tx, data)));
});

export const concludeTurnLimit = spacetimedb.procedure({ sessionId: t.string() }, t.string(), (ctx, a) =>
  withSession(ctx, a.sessionId, (data, tx) => cmdConcludeTurnLimit(data, envOf(tx, data)))
);

export const recordAgentFailure = spacetimedb.procedure(
  { sessionId: t.string(), recordJson: t.string(), inputId: t.string(), attempt: t.u8() },
  t.string(),
  (ctx, a) => {
    const parsed = PlanRecordSchema.safeParse(JSON.parse(a.recordJson));
    if (!parsed.success || parsed.data.sessionId !== a.sessionId) return JSON.stringify(invalid('plan record failed validation'));
    if (a.attempt !== 1 && a.attempt !== 2) return JSON.stringify(invalid('attempt must be 1 or 2'));
    return withSession(ctx, a.sessionId, (data, tx) => cmdRecordTechnicalFailure(data, parsed.data, a.inputId, a.attempt as 1 | 2, envOf(tx, data)));
  }
);

/** The owner's sessions as summaries, from the module's own tables (owner index). */
export const listSessions = spacetimedb.procedure({ ownerKey: t.string() }, t.string(), (ctx, { ownerKey }) =>
  run(ctx, (tx) => {
    return { ok: true, result: ownerSummaries(tx, ownerKey).slice(0, 500) };
  })
);

export const getProgress = spacetimedb.procedure({ ownerKey: t.string() }, t.string(), (ctx, { ownerKey }) =>
  run(ctx, (tx) => {
    const p = tx.db.practiceProgress.ownerKey.find(ownerKey);
    return { ok: true, result: p ? { ...p, updatedAt: new Date(Number(p.updatedAt.microsSinceUnixEpoch / 1000n)).toISOString() } : null };
  })
);
