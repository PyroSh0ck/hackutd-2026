import { createHash, randomUUID } from "node:crypto";
import {
  OBSERVER_SCHEMA_VERSION,
  type AssessmentRecord,
  type ObserverSessionResponse,
  type ObserverSessionView,
  type PlannerObservation,
  type ReviewPolicy,
  type SubmitEventRequest,
  type SubmitMessageRequest,
  type TargetAction,
} from "@/contracts/observer";
import { HttpError, NotFoundError } from "@/server/http/errors";
import type { StructuredModel } from "./model";
import { MAX_USER_TURNS, plannerObservations } from "./planner-input";
import { RUBRIC_VERSION } from "./rubric";
import { runObserver } from "./run";
import { buildObserverInput, pendingWork, planEvent, publicEvent, publicMessage, publicRequest, requestStates } from "./state";
import type { InputChange, ObserverStore, RequestRow, Snapshot } from "./store/types";

/**
 * Observer service: ownership, idempotent inputs, event applicability, and sequential processing.
 *
 * Order of operations for a user message: commit the message (CAS + receipt) → take the durable
 * processing claim → for each pending request: read snapshot, release nothing-held, call the models with
 * NO transaction open → apply atomically (claim + conversationRevision check) or record as stale →
 * notify the planner only for applied results → release → re-check for work that arrived meanwhile.
 */

export type PlannerNotice = { sessionId: string; trigger: "assessment" | "event"; observations: PlannerObservation[] };
export type PlannerSink = (notice: PlannerNotice) => void | Promise<void>;

export type ObserverServiceOptions = {
  store: ObserverStore;
  models: () => { observer: StructuredModel | null; reviewer: StructuredModel | null };
  policy: ReviewPolicy;
  timeoutMs: number;
  planner?: PlannerSink;
  newId?: () => string;
  now?: () => Date;
  leaseMs?: number;
};

const APPEND_ATTEMPTS = 5;
const PROCESS_PASSES = 3;
const MAX_PAIRS_PER_PASS = 8;

/** The fictional opening: one assistant message introducing two practice requests. */
export const OPENING = {
  content:
    "[Practice scenario — fictional] Maple Ridge Bank security desk here. We stopped a suspicious 200-credit transfer on your practice account. To confirm it's really you, read me the 6-digit practice code we just texted you, then approve a 200-credit holding transfer so your funds stay safe. You can call us back at 555-0142 if you want to check.",
  requests: [
    { targetAction: "share_fictional_code", description: "Read the 6-digit practice code texted to the user back to the sender." },
    { targetAction: "approve_simulated_payment", description: "Approve a 200-credit 'holding' transfer requested by the sender." },
  ] as Array<{ targetAction: TargetAction; description: string }>,
};

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

export class ObserverService {
  private readonly newId: () => string;
  private readonly now: () => Date;
  private readonly leaseMs: number;

  constructor(private readonly options: ObserverServiceOptions) {
    this.newId = options.newId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? options.timeoutMs * 3 + 30_000;
  }

  // ------------------------------------------------------------------ reads

  private async owned(ownerKey: string, sessionId: string): Promise<Snapshot> {
    const snapshot = await this.options.store.load(sessionId);
    if (!snapshot || snapshot.session.ownerKey !== ownerKey) throw new NotFoundError("Observer session");
    return snapshot;
  }

  view(s: Snapshot): ObserverSessionView {
    return {
      sessionId: s.session.id,
      threadId: s.session.threadId,
      revision: s.session.revision,
      conversationRevision: s.session.conversationRevision,
      turn: s.session.turn,
      ended: s.session.ended,
      messages: s.messages.map(publicMessage),
      requests: s.requests.map(publicRequest),
      events: s.events.map(publicEvent),
      requestStates: requestStates(s),
    };
  }

  async getSession(ownerKey: string, sessionId: string): Promise<ObserverSessionResponse> {
    return { session: this.view(await this.owned(ownerKey, sessionId)) };
  }

  async assessments(ownerKey: string, sessionId: string): Promise<AssessmentRecord[]> {
    return (await this.owned(ownerKey, sessionId)).assessments;
  }

  async planner(ownerKey: string, sessionId: string): Promise<PlannerObservation[]> {
    return plannerObservations(await this.owned(ownerKey, sessionId));
  }

  // ------------------------------------------------------------------ writes

  async createSession(ownerKey: string): Promise<ObserverSessionResponse> {
    const id = this.newId();
    const at = this.now().toISOString();
    const opening = { id: this.newId(), sessionId: id, turn: 0, role: "assistant" as const, content: OPENING.content, createdAt: at, revision: 1 };
    const requests: RequestRow[] = OPENING.requests.map((r) => ({ id: this.newId(), introducedByMessageId: opening.id, targetAction: r.targetAction, description: r.description, status: "open", revision: 1 }));
    await this.options.store.createSession(
      { id, ownerKey, threadId: this.newId(), revision: 1, conversationRevision: 1, turn: 0, ended: false, createdAt: at },
      { messages: [opening], requests },
    );
    return this.getSession(ownerKey, id);
  }

  /** CAS append with a bounded re-read loop. Returns the committed revision or a receipt race. */
  private async append(sessionId: string, build: (s: Snapshot) => InputChange): Promise<{ ok: true; snapshot: Snapshot } | { ok: false; conflict: "receipt" }> {
    for (let i = 0; i < APPEND_ATTEMPTS; i++) {
      const snapshot = (await this.options.store.load(sessionId))!;
      const result = await this.options.store.append(sessionId, snapshot.session.revision, build(snapshot));
      if (result.ok) return { ok: true, snapshot: (await this.options.store.load(sessionId))! };
      if (result.conflict === "receipt") return { ok: false, conflict: "receipt" };
    }
    throw new HttpError(409, "VERSION_CONFLICT", "The conversation is busy. Try again.");
  }

  async submitMessage(ownerKey: string, sessionId: string, request: SubmitMessageRequest): Promise<ObserverSessionResponse> {
    const before = await this.owned(ownerKey, sessionId);
    const payloadHash = hashOf({ kind: "message", content: request.content });
    const duplicate = async () => {
      const receipt = await this.options.store.findReceipt(sessionId, request.idempotencyKey);
      if (!receipt || receipt.payloadHash !== payloadHash) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "That idempotency key was used for a different submission.");
      // Resumes processing only if work is genuinely pending (e.g. after a crash); never re-assesses.
      const processing = await this.processPending(sessionId).catch(() => ({ status: "queued" as const, assessed: 0, stale: 0 }));
      return { session: this.view(await this.owned(ownerKey, sessionId)), processing, duplicate: true };
    };
    if (await this.options.store.findReceipt(sessionId, request.idempotencyKey)) return duplicate();
    if (before.session.ended) throw new HttpError(422, "ACTION_REJECTED", "The practice conversation has ended.", { reason: "SESSION_ENDED" });
    if (before.session.turn >= MAX_USER_TURNS) throw new HttpError(422, "ACTION_REJECTED", "This practice conversation has reached its turn limit.", { reason: "TURN_LIMIT" });

    const messageId = this.newId();
    const committed = await this.append(sessionId, (s) => {
      if (s.session.ended) throw new HttpError(422, "ACTION_REJECTED", "The practice conversation has ended.", { reason: "SESSION_ENDED" });
      const turn = s.session.turn + 1;
      return {
        messages: [{ id: messageId, sessionId, turn, role: "user", content: request.content, createdAt: this.now().toISOString(), revision: s.session.revision + 1 }],
        turn,
        receipt: { key: request.idempotencyKey, kind: "message", payloadHash, resultId: messageId, challengeId: null },
      };
    });
    if (!committed.ok) return duplicate();
    // The message is durable. A processing failure must not fail the submission or imply anything about
    // the user's decision: the pair stays pending and is resumed by the next request or POST …/process.
    const processing = await this.processPending(sessionId).catch(() => ({ status: "queued" as const, assessed: 0, stale: 0 }));
    return { session: this.view(await this.owned(ownerKey, sessionId)), processing };
  }

  async process(ownerKey: string, sessionId: string): Promise<ObserverSessionResponse> {
    await this.owned(ownerKey, sessionId);
    const processing = await this.processPending(sessionId);
    return { session: this.view(await this.owned(ownerKey, sessionId)), processing };
  }

  async submitEvent(ownerKey: string, sessionId: string, request: SubmitEventRequest): Promise<ObserverSessionResponse> {
    await this.owned(ownerKey, sessionId);
    const payloadHash = hashOf({ kind: "event", type: request.type, requestId: request.requestId, challengeId: request.challengeId ?? null });
    const duplicate = async () => {
      const receipt = await this.options.store.findReceipt(sessionId, request.idempotencyKey);
      if (!receipt || receipt.payloadHash !== payloadHash) throw new HttpError(409, "IDEMPOTENCY_CONFLICT", "That idempotency key was used for a different submission.");
      return { session: this.view(await this.owned(ownerKey, sessionId)), duplicate: true, ...(receipt.challengeId ? { challengeId: receipt.challengeId } : {}) };
    };
    if (await this.options.store.findReceipt(sessionId, request.idempotencyKey)) return duplicate();

    const eventId = this.newId();
    let challengeId: string | null = null;
    const committed = await this.append(sessionId, (s) => {
      const plan = planEvent(s, request);
      if (!plan.ok) throw new HttpError(422, "ACTION_REJECTED", plan.message, { reason: plan.reason });
      challengeId = plan.issueChallenge ? this.newId() : plan.event.challengeId;
      return {
        events: [{ ...plan.event, challengeId, id: eventId, sessionId, turn: s.session.turn, createdAt: this.now().toISOString(), revision: s.session.revision + 1 }],
        closeRequestIds: plan.closeRequestIds,
        ended: plan.ended || undefined,
        receipt: { key: request.idempotencyKey, kind: "event", payloadHash, resultId: eventId, challengeId: plan.issueChallenge ? challengeId : null },
      };
    });
    if (!committed.ok) return duplicate();
    // Deterministic reduction only; no model call is needed to recognize an event.
    const affected = committed.snapshot.requests.filter((r) => request.requestId === null || r.id === request.requestId).map((r) => r.id);
    await this.notify(sessionId, "event", committed.snapshot, affected);
    const issued = request.type === "official_directory_opened" ? challengeId : null;
    return { session: this.view(committed.snapshot), ...(issued ? { challengeId: issued } : {}) };
  }

  /** Trusted server path for the planner/actor (never exposed to clients). */
  async recordAssistantMessage(sessionId: string, input: { content: string; introduces?: Array<{ targetAction: TargetAction; description: string }> }): Promise<Snapshot> {
    const messageId = this.newId();
    const committed = await this.append(sessionId, (s) => {
      if (s.session.ended) throw new HttpError(422, "ACTION_REJECTED", "The practice conversation has ended.", { reason: "SESSION_ENDED" });
      const revision = s.session.revision + 1;
      return {
        messages: [{ id: messageId, sessionId, turn: s.session.turn, role: "assistant", content: input.content, createdAt: this.now().toISOString(), revision }],
        requests: (input.introduces ?? []).map((r) => ({ id: this.newId(), introducedByMessageId: messageId, targetAction: r.targetAction, description: r.description, status: "open" as const, revision })),
      };
    });
    if (!committed.ok) throw new Error("unreachable: assistant messages carry no receipt");
    return committed.snapshot;
  }

  // ------------------------------------------------------------------ processing

  private async notify(sessionId: string, trigger: PlannerNotice["trigger"], snapshot: Snapshot, requestIds: string[]) {
    if (!this.options.planner) return;
    const observations = plannerObservations(snapshot, requestIds);
    if (observations.length) await this.options.planner({ sessionId, trigger, observations });
  }

  /**
   * Processes pending message/request pairs one at a time under the durable claim. Bounded: at most
   * PROCESS_PASSES claim rounds; each pair runs the pipeline at most once (stale records count).
   */
  async processPending(sessionId: string): Promise<{ status: "processed" | "queued" | "idle"; assessed: number; stale: number }> {
    let assessed = 0;
    let stale = 0;
    const models = this.options.models();
    for (let pass = 0; pass < PROCESS_PASSES; pass++) {
      const claimId = this.newId();
      if (!(await this.options.store.claim(sessionId, claimId, this.now(), this.leaseMs))) {
        return { status: pass === 0 && assessed + stale === 0 ? "queued" : "processed", assessed, stale };
      }
      try {
        for (let step = 0; step < MAX_PAIRS_PER_PASS; step++) {
          const snapshot = await this.options.store.load(sessionId);
          const work = snapshot && pendingWork(snapshot);
          if (!snapshot || !work) break;
          const request = work.requests[0];
          const input = buildObserverInput(snapshot, work.message, request);
          const outcome = await runObserver(input, { ...models, policy: this.options.policy, timeoutMs: this.options.timeoutMs, now: this.now });
          const record: AssessmentRecord = {
            id: this.newId(),
            sessionId,
            requestId: request.id,
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
          const applied = await this.options.store.applyAssessment(record, claimId, this.now());
          if (applied === "applied") {
            assessed++;
            await this.notify(sessionId, "assessment", (await this.options.store.load(sessionId))!, [request.id]);
          } else if (applied === "stale") {
            // Newer conversation input, or our claim lapsed. End this pass and re-claim rather than keep
            // calling models under a claim we may no longer hold.
            stale++;
            break;
          } else {
            break; // Another processor recorded this pair; stop rather than loop.
          }
        }
      } finally {
        await this.options.store.release(sessionId, claimId);
      }
      // Work that arrived while we held the claim: its submitter saw "queued" and relies on this re-check.
      const after = await this.options.store.load(sessionId);
      if (!after || !pendingWork(after)) break;
    }
    return { status: assessed + stale > 0 ? "processed" : "idle", assessed, stale };
  }
}
