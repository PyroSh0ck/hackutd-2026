import type { AssessmentRecord } from "@/contracts/observer";
import type { PlanRecord } from "@/contracts/planner";
import type { AppendResult, ApplyResult, CommitResult, InputChange, IssueChanges, ObserverStore, PlanCommit, Receipt, SessionRow, Snapshot } from "./types";

type Data = Omit<Snapshot, "session"> & { session: SessionRow; receipts: Map<string, Receipt> };

/**
 * In-memory store with the same invariants as the Postgres store. Development and tests only: it does
 * not survive process restarts. `failNext` injects write failures (e.g. a crash before commit).
 */
export class MemoryObserverStore implements ObserverStore {
  private readonly sessions = new Map<string, Data>();
  failNext: { op: "append" | "apply" | "commit" | "savePlan"; error: Error } | null = null;

  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  private maybeFail(op: "append" | "apply" | "commit" | "savePlan") {
    if (this.failNext?.op === op) {
      const { error } = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  private write(data: Data, change: InputChange) {
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
    if (change.receipt) data.receipts.set(change.receipt.key, change.receipt);
  }

  async createSession(session: Omit<SessionRow, "claim">, change: InputChange) {
    if (this.sessions.has(session.id)) throw new Error("duplicate session");
    const data: Data = { session: { ...session, claim: null }, messages: [], requests: [], events: [], assessments: [], issues: [], additions: [], plans: [], receipts: new Map() };
    this.write(data, this.clone(change));
    this.sessions.set(session.id, data);
  }

  async load(sessionId: string): Promise<Snapshot | null> {
    const data = this.sessions.get(sessionId);
    if (!data) return null;
    const { receipts: _receipts, ...snapshot } = data;
    void _receipts;
    return this.clone(snapshot);
  }

  async findReceipt(sessionId: string, key: string) {
    return this.clone(this.sessions.get(sessionId)?.receipts.get(key) ?? null);
  }

  async append(sessionId: string, expectedRevision: number, change: InputChange): Promise<AppendResult> {
    this.maybeFail("append");
    const data = this.sessions.get(sessionId);
    if (!data || data.session.revision !== expectedRevision) return { ok: false, conflict: "revision" };
    if (change.receipt && data.receipts.has(change.receipt.key)) return { ok: false, conflict: "receipt" };
    data.session.revision += 1;
    if (change.messages?.length || change.requests?.length) data.session.conversationRevision = data.session.revision;
    this.write(data, this.clone(change));
    return { ok: true, revision: data.session.revision };
  }

  async claim(sessionId: string, claimId: string, now: Date, leaseMs: number) {
    const data = this.sessions.get(sessionId);
    if (!data) return false;
    const current = data.session.claim;
    if (current && current.id !== claimId && Date.parse(current.expiresAt) > now.getTime()) return false;
    data.session.claim = { id: claimId, expiresAt: new Date(now.getTime() + leaseMs).toISOString() };
    return true;
  }

  async release(sessionId: string, claimId: string) {
    const data = this.sessions.get(sessionId);
    if (data?.session.claim?.id === claimId) data.session.claim = null;
  }

  private holds(data: Data, claimId: string, now: Date) {
    const claim = data.session.claim;
    return claim?.id === claimId && Date.parse(claim.expiresAt) > now.getTime();
  }

  async applyAssessment(record: AssessmentRecord, claimId: string, now: Date, issues: IssueChanges): Promise<ApplyResult> {
    this.maybeFail("apply");
    const data = this.sessions.get(record.sessionId);
    if (!data) return "stale";
    const current = this.holds(data, claimId, now) && data.session.conversationRevision === record.basedOnRevision;
    // At most one APPLIED record per (scope/request, message) pair. Late or superseded results are kept as stale.
    if (current && data.assessments.some((a) => a.application === "applied" && a.requestId === record.requestId && a.currentMessageId === record.currentMessageId)) return "duplicate";
    data.assessments.push(this.clone({ ...record, application: current ? "applied" : "stale" }));
    if (!current) return "stale";
    // Issue lifecycle commits with the assessment (no lifecycle change from stale output).
    for (const row of issues.create) if (!data.issues.some((i) => i.dedupeKey === row.dedupeKey)) data.issues.push(this.clone(row));
    for (const r of issues.resolve) {
      const issue = data.issues.find((i) => i.id === r.id && i.status === "addressed");
      if (issue) Object.assign(issue, { status: "resolved", resolvedByAssessmentId: r.assessmentId });
    }
    data.session.revision += 1;
    return "applied";
  }

  async savePlan(record: PlanRecord): Promise<void> {
    this.maybeFail("savePlan");
    const data = this.sessions.get(record.sessionId);
    if (!data) return;
    if (record.status === "committed") throw new Error("Committed plans are written only by commitPlan.");
    const index = data.plans.findIndex((p) => p.id === record.id);
    if (index >= 0 && data.plans[index].status === "committed") return;
    if (index >= 0) data.plans[index] = this.clone(record);
    else data.plans.push(this.clone(record));
  }

  async commitPlan(commit: PlanCommit): Promise<CommitResult> {
    this.maybeFail("commit");
    const { record } = commit;
    const data = this.sessions.get(record.sessionId);
    if (!data) return "stale";
    const current = this.holds(data, commit.claimId, commit.now) && data.session.revision === record.basedOnRevision && data.session.stage === "active" && !data.session.ended;
    if (!current) {
      await this.savePlan({ ...record, status: "stale", committedMessageId: null });
      return "stale";
    }
    if (data.plans.some((p) => p.inputId === record.inputId && p.status === "committed")) return "duplicate";
    data.session.revision += 1;
    data.session.conversationRevision = data.session.revision;
    this.write(data, this.clone({ messages: [commit.message], requests: commit.requests, events: commit.events }));
    if (commit.addressIssueId) {
      const issue = data.issues.find((i) => i.id === commit.addressIssueId && i.status === "open");
      if (issue) Object.assign(issue, { status: "addressed", addressedMessageId: commit.message.id });
    }
    for (const id of commit.introduceAdditionIds) {
      const addition = data.additions.find((a) => a.id === id && a.introducedMessageId === null);
      if (addition) addition.introducedMessageId = commit.message.id;
    }
    const index = data.plans.findIndex((p) => p.id === record.id);
    if (index >= 0) data.plans[index] = this.clone(record);
    else data.plans.push(this.clone(record));
    return "committed";
  }

  /** Test helper: forcibly expire a claim (simulates a crashed processor). */
  expireClaim(sessionId: string) {
    const data = this.sessions.get(sessionId);
    if (data?.session.claim) data.session.claim.expiresAt = new Date(0).toISOString();
  }
}
