import "server-only";
import type { Candidate, PlanRecord } from "@/contracts/planner";
import type { ObserverStore, Snapshot } from "@/server/observer/store/types";
import { derivePlanningContext } from "@/server/planner/context";
import { getEligibleCandidates, POLICY_VERSION } from "@/server/planner/eligibility";
import { additionsFor, type ScenarioDefinition } from "@/server/planner/scenario";
import type { ActorCommitPort } from "./commit";
import { buildActorInput } from "./input";
import { ACTOR_PROMPT_VERSION } from "./prompts";
import type { ActorExecutionState, PreparedActorResponse } from "./run";
import { ACTOR_SCHEMA_VERSION, ActorAttemptRecordSchema, type ActorAttemptRecord, type ActorEnvelope, type ActorInput } from "./schemas";
import type { ActorValidationContext } from "./validate";

/**
 * Controller side of the actor v2 boundary (actor README "Claude's transaction and controller
 * requirements"). Builds the controller-owned input and envelope, answers fresh execution-state reads,
 * and implements ActorCommitPort over the existing atomic `ObserverStore.commitPlan` transaction, which
 * checks claim + expiry, revision (⇒ plan applicability), active stage, and one committed response per
 * input, and writes message, request + request_presented, newly introduced additions, the selected issue
 * (addressed only), the committed plan and its actor audit metadata, or nothing.
 */

/** Local UI-control registry: the labels actually rendered by /practice (no invented controls). */
export const UI_CONTROLS = {
  verify_independently: "Verify independently",
  end_practice: "End practice",
  share_practice_code: "Share practice code",
} as const;

export type ActorBinding = {
  record: PlanRecord;
  candidate: Candidate;
  trigger: { kind: "message" | "event"; id: string };
  processingAttemptId: string;
  claimId: string;
  modelId: string;
};

/** Message ids behind the plan's evidence: message refs directly; assessment refs → their current message. */
export function evidenceMessageIds(s: Snapshot, record: PlanRecord, candidate: Candidate): string[] {
  const refs = [...(record.acceptedPlan?.evidenceRefs ?? []), ...candidate.evidenceRefs];
  const ids = new Set<string>();
  for (const r of refs) {
    if (r.kind === "message") ids.add(r.id);
    else if (r.kind === "assessment") {
      const a = s.assessments.find((x) => x.id === r.id);
      if (a) ids.add(a.currentMessageId);
    }
  }
  return [...ids];
}

export function controlsFor(s: Snapshot, creatingRequest: boolean, pendingRequest: boolean): ActorInput["controls"] {
  const out: ActorInput["controls"] = [];
  if (s.session.stage === "active" && !s.session.ended) {
    out.push({ id: "verify_independently", label: UI_CONTROLS.verify_independently }, { id: "end_practice", label: UI_CONTROLS.end_practice });
    if (pendingRequest || creatingRequest) out.push({ id: "share_practice_code", label: UI_CONTROLS.share_practice_code });
  }
  return out;
}

export function assembleActor(s: Snapshot, b: ActorBinding): { input: ActorInput; envelope: ActorEnvelope } {
  if (!b.record.actorInstruction) throw new Error("No actor instruction on the plan.");
  const creatingRequest = b.candidate.toolIntent === "present_practice_code_request";
  const pending = s.requests.at(-1)?.status === "open";
  const input = buildActorInput({
    snapshot: s,
    instruction: structuredClone(b.record.actorInstruction),
    currentUserMessageId: b.trigger.kind === "message" ? b.trigger.id : null,
    evidenceMessageIds: evidenceMessageIds(s, b.record, b.candidate),
    controls: controlsFor(s, creatingRequest, pending),
    creatingRequest,
    knownSecrets: [],
  });
  const envelope: ActorEnvelope = {
    sessionId: s.session.id,
    inputEventId: b.trigger.id,
    processingAttemptId: b.processingAttemptId,
    processingAttempt: b.record.attempt as 1 | 2,
    planId: b.record.id,
    basedOnRevision: b.record.basedOnRevision,
    policyVersion: POLICY_VERSION,
    actorPromptVersion: ACTOR_PROMPT_VERSION,
    modelId: b.modelId,
    claimId: b.claimId,
    ownerKey: s.session.ownerKey,
  };
  return { input, envelope };
}

/** Plan applicability: same revision, the stored plan record is still pending, and its candidate is still eligible. */
export function planApplicable(s: Snapshot, record: PlanRecord, maxUserTurns: number): boolean {
  if (s.session.revision !== record.basedOnRevision || !record.acceptedPlan) return false;
  if (!s.plans.some((p) => p.id === record.id && p.status === "prepared")) return false;
  const e = getEligibleCandidates(derivePlanningContext(s, maxUserTurns));
  return e.kind === "candidates" && e.candidates.some((c) => c.id === record.acceptedPlan!.candidateId);
}

export function executionState(s: Snapshot, record: PlanRecord, claimId: string, now: Date, maxUserTurns: number): ActorExecutionState {
  const claim = s.session.claim;
  return {
    stage: s.session.stage,
    ended: s.session.ended,
    revision: s.session.revision,
    sessionId: s.session.id,
    ownerKey: s.session.ownerKey,
    claimId: claim?.id ?? null,
    claimValid: claim?.id === claimId && Date.parse(claim.expiresAt) > now.getTime(),
    policyVersion: POLICY_VERSION,
    planApplicable: planApplicable(s, record, maxUserTurns),
  };
}

export const reservedOf = (s: Snapshot) => additionsFor(s.session.caseReference, new Set(s.additions.filter((a) => a.introducedMessageId !== null).map((a) => a.id)));
export const knownSecretsOf = (s: Snapshot) => (s.session.practiceCode ? [s.session.practiceCode] : []);

/** Privacy-safe audit stored on the plan record (no model-bound input, no drafts, no owner/claim). */
export function actorAudit(processingAttemptId: string, processingAttempt: 1 | 2, attempts: ActorAttemptRecord[], styleMetrics: unknown): NonNullable<PlanRecord["actorAudit"]> {
  return {
    schemaVersion: ACTOR_SCHEMA_VERSION,
    promptVersion: ACTOR_PROMPT_VERSION,
    processingAttemptId,
    processingAttempt,
    attempts: attempts.map((a) => ActorAttemptRecordSchema.parse(a) as unknown as Record<string, unknown>),
    styleMetrics: (styleMetrics ?? null) as Record<string, unknown> | null,
  };
}

export type PortDeps = {
  store: ObserverStore;
  sessionId: string;
  claimId: string;
  now: () => Date;
  newId: () => string;
  scenario: ScenarioDefinition;
  record: PlanRecord;
  candidate: Candidate;
};

export class StoreActorCommitPort implements ActorCommitPort {
  constructor(private readonly d: PortDeps) {}

  private async snapshot() {
    const s = await this.d.store.load(this.d.sessionId);
    if (!s) throw new Error("Session disappeared.");
    return s;
  }

  async readValidationState(): Promise<{ execution: ActorExecutionState; validation: ActorValidationContext }> {
    const s = await this.snapshot();
    return {
      execution: executionState(s, this.d.record, this.d.claimId, this.d.now(), this.d.scenario.maxUserTurns),
      validation: { reserved: reservedOf(s), knownSecrets: knownSecretsOf(s), state: { stage: s.session.stage, ended: s.session.ended, revision: s.session.revision } },
    };
  }

  async findCommitted(envelope: ActorEnvelope) {
    const s = await this.snapshot();
    if (s.session.ownerKey !== envelope.ownerKey) return null;
    const committed = s.plans.find((p) => p.status === "committed" && p.inputId === envelope.inputEventId && p.committedMessageId);
    const message = committed && s.messages.find((m) => m.id === committed.committedMessageId);
    return message ? { messageId: message.id, text: message.content } : null;
  }

  async commitValidated(response: PreparedActorResponse) {
    const s = await this.snapshot();
    if (s.session.ownerKey !== response.envelope.ownerKey || !this.d.scenario.request) return { kind: "stale" as const };
    const revision = this.d.record.basedOnRevision + 1;
    const at = this.d.now().toISOString();
    const message = { id: this.d.newId(), sessionId: s.session.id, turn: s.session.turn, role: "assistant" as const, content: response.output.text, createdAt: at, revision };
    const requests =
      this.d.candidate.toolIntent === "present_practice_code_request"
        ? [{ id: this.d.newId(), introducedByMessageId: message.id, targetAction: this.d.scenario.request.targetAction, description: this.d.scenario.request.description, status: "open" as const, revision }]
        : [];
    const events = requests.map((r) => ({ id: this.d.newId(), sessionId: s.session.id, requestId: r.id, turn: s.session.turn, type: "request_presented" as const, challengeId: null, detail: "planner", createdAt: at, revision }));
    const attempts = response.attempts.map((a) => (a.status === "valid" ? { ...a, committedMessageId: message.id } : a));
    const introduced = new Set(s.additions.filter((a) => a.introducedMessageId !== null).map((a) => a.id));
    const record: PlanRecord = {
      ...this.d.record,
      status: "committed",
      committedMessageId: message.id,
      actorOutput: response.output,
      actorAudit: actorAudit(response.envelope.processingAttemptId, response.envelope.processingAttempt, attempts, response.styleMetrics),
    };
    const result = await this.d.store.commitPlan({
      record,
      claimId: this.d.claimId,
      now: this.d.now(),
      message,
      requests,
      events,
      addressIssueId: this.d.candidate.issueId,
      introduceAdditionIds: response.output.introducedAdditionIds.filter((id) => !introduced.has(id)),
    });
    if (result === "committed") return { kind: "committed" as const, messageId: message.id, text: message.content };
    if (result === "duplicate") {
      const existing = await this.findCommitted(response.envelope);
      return existing ? { kind: "duplicate" as const, ...existing } : { kind: "stale" as const };
    }
    return { kind: "stale" as const };
  }
}
