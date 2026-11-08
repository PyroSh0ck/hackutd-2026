import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssessmentRecord, SubmitEventRequest } from "@/contracts/observer";
import type { PlanRecord } from "@/contracts/planner";
import type { ApplyResult, Snapshot } from "@/server/observer/store/types";
import type { SessionSummary } from "./history";
import type { CommitPreparedResult, CreateChoice, EventResult, MessageResult, RetryResult, TrainingBackend } from "./backend";

/**
 * TrainingBackend over the SCAMPER SpacetimeDB module (`spacetime/`). Every command is one procedure call;
 * the module loads its private tables, runs the shared training rules, and commits atomically. This
 * process never decides a state transition when this backend is active.
 *
 * Credentials: a restricted worker identity token, server-side only (never sent to browsers). Read from
 * SPACETIME_URL / SPACETIME_DATABASE / SPACETIME_TOKEN, or from `.spacetime/worker.json` written by
 * `pnpm spacetime:setup` (gitignored; SPACETIME_WORKER_FILE selects another file, e.g. .spacetime/maincloud.json).
 */

export type SpacetimeConfig = { url: string; database: string; token: string };

export class SpacetimeUnavailableError extends Error {}

export function spacetimeConfigFromEnv(): SpacetimeConfig | null {
  const { SPACETIME_URL, SPACETIME_DATABASE, SPACETIME_TOKEN } = process.env;
  if (SPACETIME_URL && SPACETIME_DATABASE && SPACETIME_TOKEN) return { url: SPACETIME_URL, database: SPACETIME_DATABASE, token: SPACETIME_TOKEN };
  try {
    const file = JSON.parse(readFileSync(join(process.cwd(), process.env.SPACETIME_WORKER_FILE ?? join(".spacetime", "worker.json")), "utf8")) as Partial<SpacetimeConfig>;
    if (file.url && file.database && file.token) return { url: file.url, database: file.database, token: file.token };
  } catch {
    /* not configured */
  }
  return null;
}

/** SATS-JSON encoding of an `option<T>` argument. */
const option = <T>(value: T | null | undefined) => (value === null || value === undefined ? { none: [] } : { some: value });

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

type Envelope = { ok: true; result: unknown } | { ok: false; error: "unauthorized" | "not_found" | "invalid_input" | "failed"; detail: string };

/** Per-attempt bound on one procedure call (hosted servers can stall a connection). */
const CALL_TIMEOUT_MS = 15_000;
/** Safe to send twice: reads, and user writes deduplicated by the module (idempotency key + payload hash). */
const RETRY_SAFE = new Set(["loadSession", "listSessions", "getProgress", "submitUserMessage", "submitTrainingEvent", "requestRetry"]);

export class SpacetimeBackend implements TrainingBackend {
  readonly name = "spacetime" as const;

  constructor(
    private readonly config: SpacetimeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Calls one module procedure. Throws on transport failure, authorization or module errors.
   * Each attempt is bounded by CALL_TIMEOUT_MS. Procedures in RETRY_SAFE (reads, and user writes the module
   * dedupes by idempotency key + payload hash) get one retry after a transport error, timeout or 5xx: a
   * single dropped request to a hosted server (Maincloud) must not fail a player's request. Session creation
   * and agent-turn operations are never retried here.
   */
  async call<T>(procedure: string, args: Record<string, unknown>): Promise<{ found: true; value: T } | { found: false }> {
    const body = JSON.stringify(Object.fromEntries(Object.entries(args).map(([k, v]) => [snake(k), v === undefined ? null : v])));
    const attempts = RETRY_SAFE.has(procedure) ? 2 : 1;
    let text = "";
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.config.url}/v1/database/${encodeURIComponent(this.config.database)}/call/${snake(procedure)}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.config.token}` },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
      } catch (error) {
        if (attempt < attempts) continue;
        throw new SpacetimeUnavailableError(`SpacetimeDB unreachable: ${error instanceof Error ? error.message : String(error)}`);
      }
      text = await response.text();
      if (response.ok) break;
      if (response.status >= 500 && attempt < attempts) continue;
      throw new SpacetimeUnavailableError(`SpacetimeDB ${procedure} failed (${response.status}): ${text.slice(0, 200)}`);
    }
    // Procedures return a string; the HTTP body is that string JSON-encoded.
    const envelope = JSON.parse(JSON.parse(text) as string) as Envelope;
    if (envelope.ok) return { found: true, value: envelope.result as T };
    if (envelope.error === "not_found") return { found: false };
    throw new Error(`SpacetimeDB ${procedure} ${envelope.error}: ${envelope.detail}`);
  }

  private async must<T>(procedure: string, args: Record<string, unknown>): Promise<T> {
    const r = await this.call<T>(procedure, args);
    if (!r.found) throw new Error(`SpacetimeDB ${procedure}: session not found`);
    return r.value;
  }

  async load(sessionId: string): Promise<Snapshot | null> {
    const r = await this.call<{ snapshot: Snapshot }>("loadSession", { sessionId });
    return r.found ? r.value.snapshot : null;
  }

  async listSessions(ownerKey: string) {
    return this.must<SessionSummary[]>("listSessions", { ownerKey });
  }

  async createSession(ownerKey: string, choice?: CreateChoice) {
    return (
      await this.must<{ sessionId: string }>("startSession", {
        ownerKey,
        enabled: (choice?.enabled ?? ["mobile-code-01"]).join(","),
        selection: choice?.selection ?? "mixed",
        scenarioId: option(choice?.scenarioId),
      })
    ).sessionId;
  }

  submitMessage(sessionId: string, input: { key: string; content: string; payloadHash: string }) {
    return this.must<MessageResult>("submitUserMessage", { sessionId, idempotencyKey: input.key, content: input.content, payloadHash: input.payloadHash });
  }

  submitEvent(sessionId: string, request: SubmitEventRequest, payloadHash: string) {
    return this.must<EventResult>("submitTrainingEvent", {
      sessionId,
      idempotencyKey: request.idempotencyKey,
      type: request.type,
      requestId: option(request.requestId),
      challengeId: option(request.challengeId),
      practiceCode: option(request.practiceCode),
      linkedIssueId: option(request.linkedIssueId),
      recordId: option(request.recordId),
      payloadHash,
    });
  }

  retry(sessionId: string, input: { key: string; payloadHash: string }) {
    return this.must<RetryResult>("requestRetry", { sessionId, idempotencyKey: input.key, payloadHash: input.payloadHash });
  }

  claim(sessionId: string, claimId: string, leaseMs: number) {
    return this.must<boolean>("claimAgentTurn", { sessionId, claimId, leaseMs: Math.min(Math.round(leaseMs), 4_294_967_295) });
  }

  async release(sessionId: string, claimId: string) {
    await this.must<null>("releaseAgentTurn", { sessionId, claimId });
  }

  applyAssessment(record: AssessmentRecord, claimId: string) {
    return this.must<ApplyResult>("recordAssessment", { sessionId: record.sessionId, claimId, recordJson: JSON.stringify(record) });
  }

  async savePlan(record: PlanRecord) {
    await this.must<null>("savePlan", { sessionId: record.sessionId, recordJson: JSON.stringify(record) });
  }

  commitPrepared(sessionId: string, record: PlanRecord, claimId: string) {
    return this.must<CommitPreparedResult>("commitAgentTurn", { sessionId, claimId, recordJson: JSON.stringify(record) });
  }

  async concludeTurnLimit(sessionId: string) {
    await this.must<null>("concludeTurnLimit", { sessionId });
  }

  async recordTechnicalFailure(sessionId: string, record: PlanRecord, inputId: string, attempt: 1 | 2) {
    await this.must<null>("recordAgentFailure", { sessionId, recordJson: JSON.stringify(record), inputId, attempt });
  }

  async progress(ownerKey: string) {
    return (await this.call<Record<string, unknown> | null>("getProgress", { ownerKey })) as { found: true; value: Record<string, unknown> | null };
  }
}
