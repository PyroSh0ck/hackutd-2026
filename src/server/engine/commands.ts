import type { AssessmentRecord, SubmitEventRequest } from "@/contracts/observer";
import type { PlanRecord } from "@/contracts/planner";
import type { InputChange } from "@/server/observer/store/types";
import type { CommitPreparedResult, EventResult, MessageResult, RetryResult } from "./backend";
import { decideAfterEnd, decideCommit, decideCreate, decideEvent, decideIssues, decideMessage, decideRetry, decideTechnicalFailure, decideTurnLimit, type Env } from "./decide";
import { appendOp, applyAssessmentOp, claimOp, commitPlanOp, emptyData, findReceipt, releaseOp, savePlanOp, snapshotOf, writeChange, type SessionData } from "./ops";

/**
 * Training commands executed synchronously against one session aggregate inside a single transaction.
 * This is what the SpacetimeDB module runs in its procedures; `StoreBackend` implements the same
 * semantics over an asynchronous store. Each command mutates `data` in place and returns a typed result.
 */

const commit = (data: SessionData, change: InputChange) => {
  const r = appendOp(data, data.session.revision, change);
  if (!r.ok) throw new Error(`unexpected ${r.conflict} conflict inside a transaction`);
};

const auditEnded = (data: SessionData, attempted: string, env: Env) => {
  commit(data, decideAfterEnd(snapshotOf(data), attempted, env));
  return { kind: "ended" as const };
};

export function cmdCreate(env: Env, ownerKey: string, sessionId: string, threadId: string, random: () => number): SessionData {
  const { session, change } = decideCreate(env, ownerKey, sessionId, threadId, random);
  const data = emptyData(session);
  writeChange(data, change);
  return data;
}

export function cmdSubmitMessage(data: SessionData, input: { key: string; content: string; payloadHash: string; messageId: string }, env: Env): MessageResult {
  const receipt = findReceipt(data, input.key);
  if (receipt) return { kind: "duplicate", receipt };
  if (data.session.ended) return auditEnded(data, "message", env);
  const d = decideMessage(snapshotOf(data), input, env);
  if (!d.ok) return { kind: "rejected", rejection: d };
  commit(data, d.change);
  return { kind: "committed", messageId: d.messageId, intent: d.intent, endedNow: d.endedNow };
}

export function cmdSubmitEvent(data: SessionData, request: SubmitEventRequest, payloadHash: string, env: Env): EventResult {
  const receipt = findReceipt(data, request.idempotencyKey);
  if (receipt) return { kind: "duplicate", receipt };
  if (data.session.ended) return auditEnded(data, request.type, env);
  const d = decideEvent(snapshotOf(data), request, payloadHash, env);
  if (!d.ok) return { kind: "rejected", rejection: d };
  commit(data, d.change);
  return { kind: "committed", eventId: d.primaryId, challengeId: d.challengeId };
}

export function cmdRetry(data: SessionData, input: { key: string; payloadHash: string; eventId: string }, env: Env): RetryResult {
  const receipt = findReceipt(data, input.key);
  if (receipt) return { kind: "duplicate", receipt };
  if (data.session.ended) return auditEnded(data, "retry", env);
  const d = decideRetry(snapshotOf(data), input, env);
  if (!d.ok) return { kind: "rejected", rejection: d };
  commit(data, d.change);
  return { kind: "committed", eventId: input.eventId };
}

export const cmdClaim = (data: SessionData, claimId: string, now: Date, leaseMs: number) => claimOp(data, claimId, now, leaseMs);
export const cmdRelease = (data: SessionData, claimId: string) => releaseOp(data, claimId);

export function cmdApplyAssessment(data: SessionData, record: AssessmentRecord, claimId: string, env: Env) {
  return applyAssessmentOp(data, record, claimId, env.now, decideIssues(snapshotOf(data), record, env.newId));
}

export function cmdSavePlan(data: SessionData, record: PlanRecord) {
  savePlanOp(data, record);
}

export function cmdCommitPrepared(data: SessionData, record: PlanRecord, claimId: string, env: Env): CommitPreparedResult {
  const plan = decideCommit(snapshotOf(data), record, claimId, env);
  if (!plan) {
    savePlanOp(data, { ...record, status: "stale" });
    return { kind: "stale", messageId: null };
  }
  const kind = commitPlanOp(data, plan);
  return { kind, messageId: kind === "committed" ? plan.message.id : null };
}

export function cmdConcludeTurnLimit(data: SessionData, env: Env) {
  commit(data, decideTurnLimit(snapshotOf(data), env));
}

export function cmdRecordTechnicalFailure(data: SessionData, record: PlanRecord, inputId: string, attempt: 1 | 2, env: Env) {
  savePlanOp(data, record);
  commit(data, decideTechnicalFailure(snapshotOf(data), inputId, attempt, env));
}
