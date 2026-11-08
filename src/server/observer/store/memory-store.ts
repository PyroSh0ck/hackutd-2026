import type { AssessmentRecord } from "@/contracts/observer";
import type { PlanRecord } from "@/contracts/planner";
import { appendOp, applyAssessmentOp, claimOp, commitPlanOp, emptyData, findReceipt, releaseOp, savePlanOp, snapshotOf, writeChange, type SessionData } from "@/server/engine/ops";
import { compareSummaries, summaryOf, type SessionSummary } from "@/server/engine/history";
import type { AppendResult, ApplyResult, CommitResult, InputChange, IssueChanges, ObserverStore, PlanCommit, SessionRow, Snapshot } from "./types";

/**
 * In-memory store with the same invariants as the Postgres store. Development and tests only: it does
 * not survive process restarts. The invariants themselves live in `@/server/engine/ops` (shared with the
 * SpacetimeDB module). `failNext` injects write failures (e.g. a crash before commit).
 */
export class MemoryObserverStore implements ObserverStore {
  private readonly sessions = new Map<string, SessionData>();
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

  async createSession(session: Omit<SessionRow, "claim">, change: InputChange) {
    if (this.sessions.has(session.id)) throw new Error("duplicate session");
    const data = emptyData(session);
    writeChange(data, this.clone(change));
    this.sessions.set(session.id, data);
  }

  async listSessions(ownerKey: string): Promise<SessionSummary[]> {
    return [...this.sessions.values()]
      .filter((d) => d.session.ownerKey === ownerKey)
      .map((d) => summaryOf(d.session, d.events))
      .sort(compareSummaries)
      .slice(0, 500);
  }

  async load(sessionId: string): Promise<Snapshot | null> {
    const data = this.sessions.get(sessionId);
    return data ? this.clone(snapshotOf(data)) : null;
  }

  async findReceipt(sessionId: string, key: string) {
    const data = this.sessions.get(sessionId);
    return data ? this.clone(findReceipt(data, key)) : null;
  }

  async append(sessionId: string, expectedRevision: number, change: InputChange): Promise<AppendResult> {
    this.maybeFail("append");
    const data = this.sessions.get(sessionId);
    if (!data) return { ok: false, conflict: "revision" };
    return appendOp(data, expectedRevision, this.clone(change));
  }

  async claim(sessionId: string, claimId: string, now: Date, leaseMs: number) {
    const data = this.sessions.get(sessionId);
    return data ? claimOp(data, claimId, now, leaseMs) : false;
  }

  async release(sessionId: string, claimId: string) {
    const data = this.sessions.get(sessionId);
    if (data) releaseOp(data, claimId);
  }

  async applyAssessment(record: AssessmentRecord, claimId: string, now: Date, issues: IssueChanges): Promise<ApplyResult> {
    this.maybeFail("apply");
    const data = this.sessions.get(record.sessionId);
    if (!data) return "stale";
    return applyAssessmentOp(data, this.clone(record), claimId, now, this.clone(issues));
  }

  async savePlan(record: PlanRecord): Promise<void> {
    this.maybeFail("savePlan");
    const data = this.sessions.get(record.sessionId);
    if (data) savePlanOp(data, this.clone(record));
  }

  async commitPlan(commit: PlanCommit): Promise<CommitResult> {
    this.maybeFail("commit");
    const data = this.sessions.get(commit.record.sessionId);
    if (!data) return "stale";
    return commitPlanOp(data, this.clone(commit));
  }

  /** Test helper: forcibly expire a claim (simulates a crashed processor). */
  expireClaim(sessionId: string) {
    const data = this.sessions.get(sessionId);
    if (data?.session.claim) data.session.claim.expiresAt = new Date(0).toISOString();
  }
}
