import "server-only";
import { createHash } from "node:crypto";
import { executionViolations, ACTOR_FAILURE_NOTICE, type ActorExecutionState, type PreparedActorResponse } from "./run";
import { validateActorOutput, type ActorValidationContext } from "./validate";
import type { ActorEnvelope } from "./schemas";

/** Local persistence adapter: the existing ObserverStore cannot persist v2 actor attempt/style metadata.
 * Claude's controller implements this port with its final transaction. This module opens no DB transaction.
 *
 * commitValidated MUST atomically:
 * - check owner/session/input/attempt/plan/policy/prompt/model/claim identity and claim expiry;
 * - recheck active stage, revision, plan applicability and reserved additions;
 * - enforce UNIQUE(sessionId,inputEventId) across all attempts and return any existing response first;
 * - write message + committed plan + authorized request/event + literal new additions + selected issue
 *   addressed (never resolved) + revision/linkage + attempt/style metadata, or roll everything back.
 * No network/model calls inside that transaction. A duplicate returns the persisted message, not this draft.
 */
export interface ActorCommitPort {
  readValidationState(): Promise<{ execution: ActorExecutionState; validation: ActorValidationContext }>;
  /** Owner-scoped replay lookup, independent of claim expiry/current revision. No new state effects. */
  findCommitted(envelope: ActorEnvelope): Promise<{ messageId: string; text: string } | null>;
  commitValidated(response: PreparedActorResponse): Promise<
    { kind: "committed" | "duplicate"; messageId: string; text: string } | { kind: "stale" }
  >;
}
export type ActorDelivery = { kind: "delivered"; messageId: string; text: string; duplicate: boolean } |
  { kind: "discarded" } | { kind: "failed"; notice: string };

/** Only this post-commit result is suitable for the ordinary chat endpoint. */
export async function commitActorResponse(response: PreparedActorResponse, port: ActorCommitPort): Promise<ActorDelivery> {
  const current = await port.readValidationState();
  if (current.execution.sessionId !== response.envelope.sessionId || current.execution.ownerKey !== response.envelope.ownerKey) return { kind: "discarded" };
  const existing = await port.findCommitted(response.envelope);
  if (existing) return { kind: "delivered", ...existing, duplicate: true };
  if (executionViolations(current.execution, response.envelope).length) return { kind: "discarded" };
  const validation = validateActorOutput(response.output, response.input, current.validation);
  const audit = response.attempts.at(-1);
  const hash = createHash("sha256").update(JSON.stringify(response.output)).digest("hex");
  if (!validation.valid || audit?.status !== "valid" || audit.outputHash !== hash) return { kind: "discarded" };
  try {
    const committed = await port.commitValidated(structuredClone(response));
    if (committed.kind === "stale") return { kind: "discarded" };
    return { kind: "delivered", messageId: committed.messageId, text: committed.text, duplicate: committed.kind === "duplicate" };
  } catch {
    const latest = await port.readValidationState();
    return executionViolations(latest.execution, response.envelope).length ? { kind: "discarded" } : { kind: "failed", notice: ACTOR_FAILURE_NOTICE };
  }
}
