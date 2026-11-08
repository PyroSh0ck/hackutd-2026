import type { AssessmentRecord } from "@/contracts/observer";
import type { PlanRecord } from "@/contracts/planner";
import type { AppendResult, ApplyResult, CommitResult, InputChange, IssueChanges, PlanCommit, Receipt, SessionRow, Snapshot } from "@/server/observer/store/types";

/**
 * The training-state write rules as pure, synchronous operations over one session aggregate.
 *
 * These are the single implementation of the store invariants (revision CAS, receipts, claims, stale
 * assessments, plan commit guards). The in-memory store runs them directly; the SpacetimeDB module runs
 * them inside a transaction over its private tables. No I/O, no clocks, no randomness, no Node imports.
 */

export type SessionData = Omit<Snapshot, "session"> & { session: SessionRow; receipts: Receipt[] };

export const emptyData = (session: Omit<SessionRow, "claim">): SessionData => ({
  session: { ...session, claim: null },
  messages: [],
  requests: [],
  events: [],
  assessments: [],
  issues: [],
  additions: [],
  plans: [],
  receipts: [],
});

export const snapshotOf = ({ receipts: _receipts, ...snapshot }: SessionData): Snapshot => {
  void _receipts;
  return snapshot;
};

export const findReceipt = (data: SessionData, key: string): Receipt | null => data.receipts.find((r) => r.key === key) ?? null;

export function writeChange(data: SessionData, change: InputChange) {
  for (const row of change.messages ?? []) {
    if (data.messages.some((m) => m.id === row.id)) throw new Error("duplicate message id");
    data.messages.push(row);
  }
  data.requests.push(...(change.requests ?? []));
  for (const id of change.closeRequestIds ?? []) {
    const request = data.requests.find((r) => r.id === id);
    if (request) request.status = "closed";
  }
  data.events.push(...(change.events ?? []));
  data.additions.push(...(change.additions ?? []));
  for (const r of change.resolveIssues ?? []) {
    const issue = data.issues.find((i) => i.id === r.id);
    if (issue && issue.status !== "resolved") Object.assign(issue, { status: "resolved", resolutionEventId: r.resolutionEventId });
  }
  if (change.turn !== undefined) data.session.turn = change.turn;
  if (change.ended) data.session.ended = true;
  if (change.stage) data.session.stage = change.stage;
  if (change.outcome && data.session.outcome === null) data.session.outcome = change.outcome;
  if (change.receipt && !data.receipts.some((r) => r.key === change.receipt!.key)) data.receipts.push(change.receipt);
}

export function appendOp(data: SessionData, expectedRevision: number, change: InputChange): AppendResult {
  if (data.session.revision !== expectedRevision) return { ok: false, conflict: "revision" };
  if (change.receipt && data.receipts.some((r) => r.key === change.receipt!.key)) return { ok: false, conflict: "receipt" };
  data.session.revision += 1;
  if (change.messages?.length || change.requests?.length) data.session.conversationRevision = data.session.revision;
  writeChange(data, change);
  return { ok: true, revision: data.session.revision };
}

export function claimOp(data: SessionData, claimId: string, now: Date, leaseMs: number): boolean {
  const current = data.session.claim;
  if (current && current.id !== claimId && Date.parse(current.expiresAt) > now.getTime()) return false;
  data.session.claim = { id: claimId, expiresAt: new Date(now.getTime() + leaseMs).toISOString() };
  return true;
}

export function releaseOp(data: SessionData, claimId: string) {
  if (data.session.claim?.id === claimId) data.session.claim = null;
}

export function holdsClaim(data: SessionData, claimId: string, now: Date) {
  const claim = data.session.claim;
  return claim?.id === claimId && Date.parse(claim.expiresAt) > now.getTime();
}

export function applyAssessmentOp(data: SessionData, record: AssessmentRecord, claimId: string, now: Date, issues: IssueChanges): ApplyResult {
  const current = holdsClaim(data, claimId, now) && data.session.conversationRevision === record.basedOnRevision;
  if (current && data.assessments.some((a) => a.application === "applied" && a.requestId === record.requestId && a.currentMessageId === record.currentMessageId)) return "duplicate";
  data.assessments.push({ ...record, application: current ? "applied" : "stale" });
  if (!current) return "stale";
  for (const row of issues.create) if (!data.issues.some((i) => i.dedupeKey === row.dedupeKey)) data.issues.push(row);
  for (const r of issues.resolve) {
    const issue = data.issues.find((i) => i.id === r.id && i.status === "addressed");
    if (issue) Object.assign(issue, { status: "resolved", resolvedByAssessmentId: r.assessmentId });
  }
  data.session.revision += 1;
  return "applied";
}

export function savePlanOp(data: SessionData, record: PlanRecord) {
  if (record.status === "committed") throw new Error("Committed plans are written only by commitPlan.");
  const index = data.plans.findIndex((p) => p.id === record.id);
  if (index >= 0 && data.plans[index].status === "committed") return;
  if (index >= 0) data.plans[index] = record;
  else data.plans.push(record);
}

export function commitPlanOp(data: SessionData, commit: PlanCommit): CommitResult {
  const { record } = commit;
  const current = holdsClaim(data, commit.claimId, commit.now) && data.session.revision === record.basedOnRevision && data.session.stage === "active" && !data.session.ended;
  if (!current) {
    savePlanOp(data, { ...record, status: "stale", committedMessageId: null });
    return "stale";
  }
  if (data.plans.some((p) => p.inputId === record.inputId && p.status === "committed")) return "duplicate";
  data.session.revision += 1;
  data.session.conversationRevision = data.session.revision;
  writeChange(data, { messages: [commit.message], requests: commit.requests, events: commit.events });
  if (commit.addressIssueId) {
    const issue = data.issues.find((i) => i.id === commit.addressIssueId && i.status === "open");
    if (issue) Object.assign(issue, { status: "addressed", addressedMessageId: commit.message.id });
  }
  for (const id of commit.introduceAdditionIds) {
    const addition = data.additions.find((a) => a.id === id && a.introducedMessageId === null);
    if (addition) addition.introducedMessageId = commit.message.id;
  }
  const index = data.plans.findIndex((p) => p.id === record.id);
  if (index >= 0) data.plans[index] = record;
  else data.plans.push(record);
  return "committed";
}
