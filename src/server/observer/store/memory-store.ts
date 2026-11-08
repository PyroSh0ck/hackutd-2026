import type { AssessmentRecord } from "@/contracts/observer";
import type { AppendResult, ApplyResult, InputChange, ObserverStore, Receipt, SessionRow, Snapshot } from "./types";

type Data = Omit<Snapshot, "session"> & { session: SessionRow; receipts: Map<string, Receipt> };

/**
 * In-memory store with the same invariants as the Postgres store. Development and tests only: it does
 * not survive process restarts. `failNext` injects write failures for tests.
 */
export class MemoryObserverStore implements ObserverStore {
  private readonly sessions = new Map<string, Data>();
  failNext: { op: "append" | "apply"; error: Error } | null = null;

  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  private maybeFail(op: "append" | "apply") {
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
    if (change.turn !== undefined) data.session.turn = change.turn;
    if (change.ended) data.session.ended = true;
    if (change.receipt) data.receipts.set(change.receipt.key, change.receipt);
  }

  async createSession(session: Omit<SessionRow, "claim">, change: InputChange) {
    if (this.sessions.has(session.id)) throw new Error("duplicate session");
    const data: Data = { session: { ...session, claim: null }, messages: [], requests: [], events: [], assessments: [], receipts: new Map() };
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

  async applyAssessment(record: AssessmentRecord, claimId: string, now: Date): Promise<ApplyResult> {
    this.maybeFail("apply");
    const data = this.sessions.get(record.sessionId);
    if (!data) return "stale";
    const claim = data.session.claim;
    const current = claim?.id === claimId && Date.parse(claim.expiresAt) > now.getTime() && data.session.conversationRevision === record.basedOnRevision;
    // At most one APPLIED record per (request, message) pair. Late or superseded results are kept as stale.
    if (current && data.assessments.some((a) => a.application === "applied" && a.requestId === record.requestId && a.currentMessageId === record.currentMessageId)) return "duplicate";
    data.assessments.push(this.clone({ ...record, application: current ? "applied" : "stale" }));
    return current ? "applied" : "stale";
  }

  /** Test helper: forcibly expire a claim (simulates a crashed processor). */
  expireClaim(sessionId: string) {
    const data = this.sessions.get(sessionId);
    if (data?.session.claim) data.session.claim.expiresAt = new Date(0).toISOString();
  }
}
