import type { AppEvent, AssessmentRecord, IssueRecord, Message, Outcome, SessionStage, SimulatedRequest } from "@/contracts/observer";
import type { PlanRecord } from "@/contracts/planner";

/**
 * Session persistence contract (observer brief §4.8/§9, planner brief §10). History is append-only
 * (messages, requests, events, assessments, plans); `stage`, `outcome`, issue status and addition
 * introduction are current views updated in the same transactions.
 *
 * - Every input change is one atomic commit guarded by an optimistic revision check (CAS) and, for client
 *   submissions, an idempotency receipt.
 * - Processing is serialized per session by a durable, leased claim (works across instances).
 * - Assessments apply only if the claim is still held AND conversationRevision is unchanged; planner
 *   output commits only if the claim is held AND the full revision is unchanged AND the stage is active.
 *   Otherwise results are stored as `stale` for audit and change nothing.
 * - No transaction is ever held open across a model call.
 */

export type SessionRow = {
  id: string;
  ownerKey: string;
  threadId: string;
  scenarioId: string;
  scenarioVersion: number;
  /** Bumped by every append, applied assessment, and committed plan (CAS guard; total order). */
  revision: number;
  /**
   * Revision of the last conversation change (message or request). Assessments are built from, and only
   * applied at, this revision: a newer message makes an in-flight result stale; an app event does not.
   */
  conversationRevision: number;
  /** Number of user messages so far. */
  turn: number;
  ended: boolean;
  stage: SessionStage;
  outcome: Outcome | null;
  /** Server-generated fictional practice code (never given to planner/actor models). */
  practiceCode: string | null;
  /** Reserved fictional case reference (introduced only by a committed message). */
  caseReference: string | null;
  claim: { id: string; expiresAt: string } | null;
  createdAt: string;
};

/** Rows carry the revision that created them: a single explicit total order per session. */
export type MessageRow = Message & { revision: number };
export type RequestRow = SimulatedRequest & { revision: number };
/** `detail` is server-only (verification result code, text-stop source, audit target). Never sent to models. */
export type EventRow = AppEvent & { revision: number; challengeId: string | null; detail: string | null };
export type IssueRow = IssueRecord & { dedupeKey: string };
export type AdditionRow = { id: "case_reference" | "team_label"; text: string; introducedMessageId: string | null };

export type Snapshot = {
  session: SessionRow;
  messages: MessageRow[];
  requests: RequestRow[];
  events: EventRow[];
  /** Applied and stale records, in application order. */
  assessments: AssessmentRecord[];
  issues: IssueRow[];
  additions: AdditionRow[];
  /** Planner records (all statuses), in creation order. */
  plans: PlanRecord[];
};

export type Receipt = { key: string; kind: "message" | "event" | "retry"; payloadHash: string; resultId: string; challengeId: string | null };

export type InputChange = {
  messages?: MessageRow[];
  requests?: RequestRow[];
  closeRequestIds?: string[];
  events?: EventRow[];
  turn?: number;
  ended?: boolean;
  stage?: SessionStage;
  outcome?: Outcome;
  /** Server rule only (addendum §4): resolves a narrowly linked procedure issue. Applies only if not resolved. */
  resolveIssues?: Array<{ id: string; resolutionEventId: string }>;
  receipt?: Receipt;
  additions?: AdditionRow[];
};

/** Lifecycle changes that commit with an applied assessment (addendum §4). */
export type IssueChanges = {
  create: IssueRow[];
  /** Applied only to issues still `addressed` at commit time. */
  resolve: Array<{ id: string; assessmentId: string }>;
};

export type PlanCommit = {
  record: PlanRecord;
  claimId: string;
  now: Date;
  message: MessageRow;
  requests: RequestRow[];
  events: EventRow[];
  /** Marked addressed only if still open. */
  addressIssueId: string | null;
  introduceAdditionIds: Array<AdditionRow["id"]>;
};

export type AppendResult = { ok: true; revision: number } | { ok: false; conflict: "revision" | "receipt" };
export type ApplyResult = "applied" | "stale" | "duplicate";
export type CommitResult = "committed" | "stale" | "duplicate";

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
   * Atomic: applies the record (and its issue changes, bumping the revision) only if `claimId` still holds
   * an unexpired claim and conversationRevision equals `record.basedOnRevision`; otherwise stores it as
   * "stale". A second applied record for the same (scope/request, message) pair is a no-op ("duplicate").
   */
  applyAssessment(record: AssessmentRecord, claimId: string, now: Date, issues: IssueChanges): Promise<ApplyResult>;
  /** Inserts or replaces a non-committed plan record (prepared, failed, rejected, stale). */
  savePlan(record: PlanRecord): Promise<void>;
  /**
   * Atomic commit of an actor response (planner brief §10): requires the claim, revision ===
   * record.basedOnRevision, an active stage, and no committed record for the same input. Writes message,
   * request, events, issue-addressed update, addition introductions and the committed record, and bumps
   * the revision; otherwise stores the record as stale.
   */
  commitPlan(commit: PlanCommit): Promise<CommitResult>;
}
