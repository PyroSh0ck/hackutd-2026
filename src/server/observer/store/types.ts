import type { AppEvent, AssessmentRecord, Message, SimulatedRequest } from "@/contracts/observer";

/**
 * Observer persistence contract (brief §4.8, §9). History is append-only; current views are derived.
 *
 * - Every input change (message, request, event, status change) is one atomic commit guarded by an
 *   optimistic revision check (CAS) and, for client submissions, an idempotency receipt.
 * - Processing is serialized per session by a durable, leased claim (works across instances).
 * - Assessments are applied only if the claim is still held AND the session revision still equals the
 *   revision the input was built from. Otherwise they are stored as `stale` for audit and change nothing.
 * - No transaction is ever held open across a model call: callers read, release, call the model, then commit.
 */

export type SessionRow = {
  id: string;
  ownerKey: string;
  threadId: string;
  /** Bumped by every append (CAS guard; also the explicit total order of all rows). */
  revision: number;
  /**
   * Revision of the last conversation change (message or request). Assessments are built from, and only
   * applied at, this revision: a newer message makes an in-flight result stale; an app event does not
   * (events are server facts the planner reads directly, never inputs the observer decides on).
   */
  conversationRevision: number;
  /** Number of user messages so far. */
  turn: number;
  ended: boolean;
  claim: { id: string; expiresAt: string } | null;
  createdAt: string;
};

/** Rows carry the revision that created them: a single explicit total order per session. */
export type MessageRow = Message & { revision: number };
export type RequestRow = SimulatedRequest & { revision: number };
export type EventRow = AppEvent & { revision: number; challengeId: string | null };

export type Snapshot = {
  session: SessionRow;
  messages: MessageRow[];
  requests: RequestRow[];
  events: EventRow[];
  /** Applied and stale records, in application order. */
  assessments: AssessmentRecord[];
};

export type Receipt = { key: string; kind: "message" | "event"; payloadHash: string; resultId: string; challengeId: string | null };

export type InputChange = {
  messages?: MessageRow[];
  requests?: RequestRow[];
  closeRequestIds?: string[];
  events?: EventRow[];
  turn?: number;
  ended?: boolean;
  receipt?: Receipt;
};

export type AppendResult = { ok: true; revision: number } | { ok: false; conflict: "revision" | "receipt" };
export type ApplyResult = "applied" | "stale" | "duplicate";

export interface ObserverStore {
  createSession(session: Omit<SessionRow, "claim">, change: InputChange): Promise<void>;
  load(sessionId: string): Promise<Snapshot | null>;
  findReceipt(sessionId: string, key: string): Promise<Receipt | null>;
  /** Atomic: revision must equal `expectedRevision`; bumps it by one; writes rows and receipt. */
  append(sessionId: string, expectedRevision: number, change: InputChange): Promise<AppendResult>;
  /** Takes the processing claim if free or expired. */
  claim(sessionId: string, claimId: string, now: Date, leaseMs: number): Promise<boolean>;
  release(sessionId: string, claimId: string): Promise<void>;
  /**
   * Atomic: applies the record only if `claimId` still holds an unexpired claim and the session's
   * conversationRevision equals `record.basedOnRevision`; otherwise stores it with application "stale".
   * A second record for the same (request, message) pair is a no-op ("duplicate").
   */
  applyAssessment(record: AssessmentRecord, claimId: string, now: Date): Promise<ApplyResult>;
}
