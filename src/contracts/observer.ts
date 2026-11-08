import { z } from "zod";

/**
 * Observer subsystem contracts (brief §4). Single source of truth for model-facing schemas, server-owned
 * records, the planner handoff, and HTTP shapes. Every object is strict: unknown keys are rejected, so a
 * model cannot set server-owned fields (action status, verification completion, ids it was not given).
 *
 * Length limits keep prompts and audit logs bounded; they are documented here and enforced at runtime.
 */

/** v2 (planner handoff addendum): issues, condition kinds, claimed verification results, conversation scope. */
export const OBSERVER_SCHEMA_VERSION = "observer-schema-v2";
/** Historical records written before the addendum. Normalized on read only (see `upgradeAssessmentRecord`). */
export const OBSERVER_SCHEMA_V1 = "observer-schema-v1";

export const LIMITS = {
  idChars: 80,
  userMessageChars: 1000,
  assistantMessageChars: 2000,
  quoteChars: 400,
  descriptionChars: 300,
  fieldPathChars: 80,
  evidencePerField: 6,
  verificationObservations: 6,
  ambiguities: 6,
  reviewerFindings: 10,
  explanationChars: 400,
  relevantMessages: 12,
  relevantEvents: 20,
  openRequests: 4,
  issueSummaryChars: 240,
  issueEvidence: 3,
  openIssues: 5,
  issueAcknowledgments: 5,
  knownIssues: 20,
} as const;

const Id = z.string().min(1).max(LIMITS.idChars).regex(/^[A-Za-z0-9_-]+$/, "Ids are server-generated tokens.");
const Timestamp = z.iso.datetime();
const NonEmpty = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, "Must not be blank.");

// ---------------------------------------------------------------- 4.1 messages, requests, app events

export const MessageRoleSchema = z.enum(["user", "assistant"]);
export const MessageSchema = z.strictObject({
  id: Id,
  sessionId: Id,
  turn: z.number().int().min(0),
  role: MessageRoleSchema,
  content: NonEmpty(LIMITS.assistantMessageChars),
  createdAt: Timestamp,
});
export type Message = z.infer<typeof MessageSchema>;

export const TargetActionSchema = z.enum([
  "share_fictional_code",
  "share_fictional_account_details",
  "open_simulated_link",
  "approve_simulated_payment",
]);
export type TargetAction = z.infer<typeof TargetActionSchema>;

export const SimulatedRequestSchema = z.strictObject({
  id: Id,
  introducedByMessageId: Id,
  targetAction: TargetActionSchema,
  description: NonEmpty(LIMITS.descriptionChars),
  status: z.enum(["open", "closed"]),
});
export type SimulatedRequest = z.infer<typeof SimulatedRequestSchema>;

/** Events a client may ask the server to record (the server still decides applicability). */
export const ClientEventTypeSchema = z.enum([
  "simulated_link_opened",
  "practice_code_submitted",
  "practice_account_details_submitted",
  "simulated_payment_started",
  "simulated_payment_approved",
  "official_verification_started",
  "official_verification_cancelled",
  "official_verification_completed",
  "final_decision_proceed",
  "stop_confirmation_dismissed",
  "request_rejected",
  "conversation_reported",
  "conversation_ended",
  "portal_record_opened",
  "portal_notice_reviewed",
]);
export type ClientEventType = z.infer<typeof ClientEventTypeSchema>;

/** Written only by server code (never accepted from a client). `official_directory_opened` is v1 history. */
export const ServerEventTypeSchema = z.enum([
  "official_directory_opened",
  "request_presented",
  "stop_confirmation_requested",
  "turn_limit_reached",
  "planning_failed",
  "planning_retry_requested",
  "technical_interruption",
  "event_rejected_after_end",
]);

export const AppEventTypeSchema = z.enum([...ClientEventTypeSchema.options, ...ServerEventTypeSchema.options]);
export type AppEventType = z.infer<typeof AppEventTypeSchema>;

/** Created only by trusted server handlers. Never contains submitted code or account contents. */
export const AppEventSchema = z.strictObject({
  id: Id,
  sessionId: Id,
  requestId: Id.nullable(),
  turn: z.number().int().min(0),
  type: AppEventTypeSchema,
  createdAt: Timestamp,
});
export type AppEvent = z.infer<typeof AppEventSchema>;

// ---------------------------------------------------------------- 4.2 categories and evidence

export const EvidenceSchema = z.strictObject({
  messageId: Id,
  /** Exact, case-preserving substring of the referenced user message. */
  quote: z.string().min(1).max(LIMITS.quoteChars),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
const EvidenceList = z.array(EvidenceSchema).max(LIMITS.evidencePerField);

export const DecisionLabelSchema = z.enum(["refused", "considering", "conditional_acceptance", "explicit_acceptance", "unclear"]);
export type DecisionLabel = z.infer<typeof DecisionLabelSchema>;
export const DECISION_LABELS = DecisionLabelSchema.options;

export const VerificationBehaviorSchema = z.enum(["requested_sender_proof", "expressed_verification_intent", "claimed_verification_completed"]);
export type VerificationBehavior = z.infer<typeof VerificationBehaviorSchema>;

export const ChannelProvenanceSchema = z.enum(["sender_supplied", "user_claimed_independent", "unspecified"]);
export type ChannelProvenance = z.infer<typeof ChannelProvenanceSchema>;

// ---------------------------------------------------------------- addendum §2 issues, condition kinds, claimed results

export const IssueKindSchema = z.enum(["identity_question", "procedure_question", "scenario_fact_question", "condition_needs_clarification", "decision_needs_clarification"]);
export type IssueKind = z.infer<typeof IssueKindSchema>;

export const ConditionKindSchema = z.enum(["independent_verification", "sender_proof", "procedure_answer", "other", "unspecified"]);
export type ConditionKind = z.infer<typeof ConditionKindSchema>;

export const ClaimedResultSchema = z.enum(["supports_request", "contradicts_request", "inconclusive", "unspecified"]);
export type ClaimedResult = z.infer<typeof ClaimedResultSchema>;

const IssueEvidence = z.array(EvidenceSchema).min(1).max(LIMITS.issueEvidence);

export const IssueDraftSchema = z.strictObject({
  kind: IssueKindSchema,
  /** Describes the question or ambiguity. Never an answer. */
  summary: NonEmpty(LIMITS.issueSummaryChars),
  evidence: IssueEvidence,
});
export type IssueDraft = z.infer<typeof IssueDraftSchema>;

export const IssueAcknowledgmentSchema = z.strictObject({
  /** Must be an ADDRESSED issue supplied in input.knownIssues. */
  issueId: Id,
  /** The user's explicit acknowledgment that this issue was answered. */
  evidence: IssueEvidence,
});
export type IssueAcknowledgment = z.infer<typeof IssueAcknowledgmentSchema>;

// ---------------------------------------------------------------- 4.4 observer output (model-facing)

export const ObserverAssessmentSchema = z.strictObject({
  /** Null only in conversation scope (no request presented yet). */
  requestId: Id.nullable(),
  currentMessageId: Id,
  decision: z.strictObject({ label: DecisionLabelSchema, evidence: EvidenceList }),
  condition: z.strictObject({ kind: ConditionKindSchema, description: NonEmpty(LIMITS.descriptionChars), evidence: EvidenceList }).nullable(),
  verificationObservations: z
    .array(
      z.strictObject({
        behavior: VerificationBehaviorSchema,
        channelProvenance: ChannelProvenanceSchema,
        channelDescription: NonEmpty(LIMITS.descriptionChars).nullable(),
        /** The user's TEXTUAL claim about what a check showed. Never a server verification result. */
        claimedResult: ClaimedResultSchema,
        evidence: EvidenceList,
      }),
    )
    .max(LIMITS.verificationObservations),
  statedUnderstanding: z.strictObject({ description: NonEmpty(LIMITS.descriptionChars), evidence: EvidenceList }).nullable(),
  ambiguities: z
    .array(
      z.strictObject({
        field: NonEmpty(LIMITS.fieldPathChars),
        description: NonEmpty(LIMITS.descriptionChars),
        evidence: EvidenceList,
      }),
    )
    .max(LIMITS.ambiguities),
  openIssues: z.array(IssueDraftSchema).max(LIMITS.openIssues),
  issueAcknowledgments: z.array(IssueAcknowledgmentSchema).max(LIMITS.issueAcknowledgments),
});
export type ObserverAssessment = z.infer<typeof ObserverAssessmentSchema>;

/** Issues given to the observer: unresolved or addressed only, with server ids. */
export const KnownIssueSchema = z.strictObject({
  id: Id,
  kind: IssueKindSchema,
  summary: NonEmpty(LIMITS.issueSummaryChars),
  evidence: IssueEvidence,
  status: z.enum(["open", "addressed"]),
  addressedMessageId: Id.nullable(),
});
export type KnownIssue = z.infer<typeof KnownIssueSchema>;

export const AssessmentScopeSchema = z.enum(["conversation", "request"]);
export type AssessmentScope = z.infer<typeof AssessmentScopeSchema>;

// ---------------------------------------------------------------- 4.3 observer input

export const RubricSchema = z.strictObject({
  decisionDefinitions: z.record(DecisionLabelSchema, z.string().min(1)),
  verificationDefinitions: z.record(VerificationBehaviorSchema, z.string().min(1)),
  channelDefinitions: z.record(ChannelProvenanceSchema, z.string().min(1)),
  conditionKindDefinitions: z.record(ConditionKindSchema, z.string().min(1)),
  claimedResultDefinitions: z.record(ClaimedResultSchema, z.string().min(1)),
  issueDefinitions: z.record(IssueKindSchema, z.string().min(1)),
  evidenceRules: z.array(z.string().min(1)).min(1),
  interpretationRules: z.array(z.string().min(1)).min(1),
  issueRules: z.array(z.string().min(1)).min(1),
  scopeRules: z.array(z.string().min(1)).min(1),
});
export type Rubric = z.infer<typeof RubricSchema>;

export const ObserverInputSchema = z.strictObject({
  sessionId: Id,
  turn: z.number().int().min(0),
  basedOnRevision: z.number().int().min(1),
  currentMessageId: Id,
  /** "conversation" iff request is null (no request presented yet). */
  scope: AssessmentScopeSchema,
  request: SimulatedRequestSchema.nullable(),
  relevantMessages: z.array(MessageSchema).min(1).max(LIMITS.relevantMessages + 1),
  previousAssessment: ObserverAssessmentSchema.nullable(),
  relevantEvents: z.array(AppEventSchema).max(LIMITS.relevantEvents),
  knownIssues: z.array(KnownIssueSchema).max(LIMITS.knownIssues),
  rubricVersion: z.string().min(1),
  rubric: RubricSchema,
});
export type ObserverInput = z.infer<typeof ObserverInputSchema>;

// ---------------------------------------------------------------- 4.5 validation and review flags

export const ValidationErrorCodeSchema = z.enum([
  "invalid_structure",
  "invalid_category",
  "invalid_request_reference",
  "invalid_message_reference",
  "non_user_evidence",
  "quote_not_found",
  "missing_evidence",
  "missing_condition",
  "inconsistent_fields",
  "invalid_issue_reference",
  "invalid_scope",
]);
export const ValidationErrorSchema = z.strictObject({ field: z.string(), code: ValidationErrorCodeSchema, detail: z.string() });
export type ValidationError = z.infer<typeof ValidationErrorSchema>;

export const ReviewFlagCodeSchema = z.enum([
  "acceptance_with_refusal_language",
  "acceptance_with_conditional_language",
  "refusal_with_acceptance_language",
  "conflicting_evidence",
  "consequential_classification",
]);
export type ReviewFlagCode = z.infer<typeof ReviewFlagCodeSchema>;
export const ReviewFlagSchema = z.strictObject({
  field: z.string(),
  code: ReviewFlagCodeSchema,
  messageIds: z.array(Id),
  matchedText: z.string().nullable(),
  detail: z.string(),
});
export type ReviewFlag = z.infer<typeof ReviewFlagSchema>;

export const ValidationResultSchema = z.strictObject({
  structurallyValid: z.boolean(),
  evidenceReferencesValid: z.boolean(),
  errors: z.array(ValidationErrorSchema),
  reviewFlags: z.array(ReviewFlagSchema),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// ---------------------------------------------------------------- 4.6 / 4.7 repair and reviewer

export const REPAIR_INSTRUCTION = "Return a corrected assessment using only supplied evidence; use unclear when unsupported." as const;

export const ReviewVerdictSchema = z.enum(["supported", "contradicted", "ambiguous"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

/** Field paths a reviewer finding may reference (validated against this allowlist). */
export const REVIEW_FIELD_PATTERN =
  /^(overall|decision(\.label|\.evidence)?|condition(\.kind)?|verificationObservations(\[\d{1,2}\](\.claimedResult)?)?|statedUnderstanding|ambiguities(\[\d{1,2}\])?|openIssues(\[\d{1,2}\])?|issueAcknowledgments(\[\d{1,2}\])?)$/;

export const ReviewerResponseSchema = z.strictObject({
  verdict: ReviewVerdictSchema,
  findings: z
    .array(
      z.strictObject({
        field: z.string().max(LIMITS.fieldPathChars),
        verdict: ReviewVerdictSchema,
        explanation: NonEmpty(LIMITS.explanationChars),
        evidence: EvidenceList,
      }),
    )
    .min(1)
    .max(LIMITS.reviewerFindings),
  correctedAssessment: ObserverAssessmentSchema.nullable(),
});
export type ReviewerResponse = z.infer<typeof ReviewerResponseSchema>;

// ---------------------------------------------------------------- 4.8 server-owned state and audit

/** Addendum §5. Cancellation returns to directory_opened; history is kept. */
export const VerificationStatusSchema = z.enum(["not_observed", "directory_opened", "in_progress", "completed"]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const RequestStateSchema = z.strictObject({
  requestId: Id,
  latestAssessmentId: Id.nullable(),
  action: z.strictObject({ status: z.enum(["not_started", "started", "completed"]), eventIds: z.array(Id) }),
  inAppVerification: z.strictObject({ status: VerificationStatusSchema, eventIds: z.array(Id) }),
});
export type RequestState = z.infer<typeof RequestStateSchema>;

export const ReviewPolicySchema = z.enum(["consequential_and_flagged", "flagged_only"]);
export type ReviewPolicy = z.infer<typeof ReviewPolicySchema>;

export const ModelStageSchema = z.enum(["observer", "repair", "reviewer"]);
export const ModelFailureSchema = z.enum(["timeout", "unavailable", "refusal", "http_error", "malformed_output"]);
export type ModelFailure = z.infer<typeof ModelFailureSchema>;

/** One model invocation. Validation errors per attempt are kept so a repair never erases earlier errors. */
export const ModelAttemptSchema = z.strictObject({
  stage: ModelStageSchema,
  modelId: z.string(),
  startedAt: Timestamp,
  latencyMs: z.number().int().min(0),
  outcome: z.union([z.literal("ok"), ModelFailureSchema]),
  validationErrors: z.array(ValidationErrorSchema),
  reviewFlags: z.array(ReviewFlagSchema),
});
export type ModelAttempt = z.infer<typeof ModelAttemptSchema>;

export const FailureReasonSchema = z.enum([
  "model_unavailable",
  "model_timeout",
  "model_refusal",
  "model_http_error",
  "invalid_after_repair",
  "review_failed",
  "review_invalid",
  "review_ambiguous",
  "review_unresolved_flags",
  "correction_flagged",
]);
export type FailureReason = z.infer<typeof FailureReasonSchema>;

export const ReviewStatusSchema = z.enum(["not_requested", "supported", "corrected", "ambiguous", "failed"]);
export const ResolutionSchema = z.enum(["accepted", "corrected", "unclear_fallback"]);
export type Resolution = z.infer<typeof ResolutionSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const AssessmentRecordSchema = z.strictObject({
  id: Id,
  sessionId: Id,
  /** Null for a conversation-scope assessment. */
  requestId: Id.nullable(),
  currentMessageId: Id,
  basedOnRevision: z.number().int().min(1),
  observerModel: z.string(),
  reviewerModel: z.string().nullable(),
  rubricVersion: z.string(),
  schemaVersion: z.string(),
  reviewPolicy: ReviewPolicySchema,
  proposedAssessment: ObserverAssessmentSchema.nullable(),
  /** Always labeled as a model interpretation, even after review. */
  finalAssessment: ObserverAssessmentSchema,
  validation: ValidationResultSchema,
  repairAttempted: z.boolean(),
  reviewStatus: ReviewStatusSchema,
  reviewerResponse: ReviewerResponseSchema.nullable(),
  resolution: ResolutionSchema,
  failureReason: FailureReasonSchema.nullable(),
  attempts: z.array(ModelAttemptSchema).max(3),
  /** `stale` results are kept for audit and never change state or reach the planner. */
  application: z.enum(["applied", "stale"]),
  createdAt: Timestamp,
});
export type AssessmentRecord = z.infer<typeof AssessmentRecordSchema>;

// ---------------------------------------------------------------- session lifecycle (planner brief §4)

export const SessionStageSchema = z.enum(["active", "verifying", "awaiting_final_decision", "ended"]);
export type SessionStage = z.infer<typeof SessionStageSchema>;

/**
 * Original meanings are unchanged. The last three apply only to the legitimate notice scenario:
 * legitimate_task_completed (verified with official support, then reviewed the trusted portal notice),
 * benign_task_completed_unverified (reviewed the trusted portal notice without completing the support check),
 * legitimate_request_declined (reported/declined a genuine notice: no harm, but a benign message misjudged).
 */
export const OutcomeSchema = z.enum([
  "defense_demonstrated",
  "safely_disengaged",
  "simulated_exposure",
  "inconclusive",
  "technical_interruption",
  "legitimate_task_completed",
  "benign_task_completed_unverified",
  "legitimate_request_declined",
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** Planner-facing request status (adapter over the observer's open/closed request + events). */
export const PlannerRequestStatusSchema = z.enum(["not_presented", "pending", "rejected", "completed"]);
export type PlannerRequestStatus = z.infer<typeof PlannerRequestStatusSchema>;

// ---------------------------------------------------------------- addendum §4 server-owned issue lifecycle

export const IssueStatusSchema = z.enum(["open", "addressed", "resolved"]);
export const IssueRecordSchema = z.strictObject({
  id: Id,
  sessionId: Id,
  requestId: Id.nullable(),
  kind: IssueKindSchema,
  summary: NonEmpty(LIMITS.issueSummaryChars),
  evidence: IssueEvidence,
  status: IssueStatusSchema,
  originAssessmentId: Id,
  /** A response was delivered for it. Says nothing about adequacy. */
  addressedMessageId: Id.nullable(),
  resolvedByAssessmentId: Id.nullable(),
  resolutionEventId: Id.nullable(),
});
export type IssueRecord = z.infer<typeof IssueRecordSchema>;

// ---------------------------------------------------------------- 4.9 + addendum §5 planner handoff

export const RecentPlanSchema = z.strictObject({ action: z.string(), moveId: z.string(), targetId: Id.nullable() });

export const PlannerObservationSchema = z.strictObject({
  sessionId: Id,
  assessmentId: Id,
  scope: AssessmentScopeSchema,
  /** conversationRevision the assessment was built from. */
  basedOnRevision: z.number().int().min(1),
  /** Session revision when this observation was assembled (the planner's optimistic-check revision). */
  currentRevision: z.number().int().min(1),
  sessionStage: SessionStageSchema,
  /** Null before the request is presented. */
  request: SimulatedRequestSchema.nullable(),
  requestStatus: PlannerRequestStatusSchema,
  /** Model interpretation (possibly reviewed). Not a fact about actions. */
  assessment: ObserverAssessmentSchema,
  interpretationSource: z.literal("model_interpretation"),
  resolution: ResolutionSchema,
  reviewStatus: ReviewStatusSchema,
  previousAssessment: ObserverAssessmentSchema.nullable(),
  /** Open and addressed issues (server-owned lifecycle). */
  issues: z.array(IssueRecordSchema),
  /** Server-observed facts, from application events only. Null before a request exists. */
  action: RequestStateSchema.shape.action.nullable(),
  /** Server verification state. The result itself is never part of the planner handoff. */
  verification: z.strictObject({ status: VerificationStatusSchema, eventIds: z.array(Id) }),
  recentPlans: z.array(RecentPlanSchema).max(2),
  supportingMessages: z.array(MessageSchema),
  supportingEvents: z.array(AppEventSchema),
  /** Derived for display only; never a policy input. */
  unresolvedQuestions: z.array(z.string()),
  remainingTurns: z.number().int().min(0),
});
export type PlannerObservation = z.infer<typeof PlannerObservationSchema>;

// ---------------------------------------------------------------- HTTP

export const ObserverIdSchema = z.uuid();

/**
 * `respond`: "after_reply" (default) answers once the opponent's reply is processed; "after_save" answers as
 * soon as the message is durably recorded and generates the reply in the background (the client follows
 * `turnStatus`). Idempotency covers only the content: both modes are the same submission.
 */
export const RespondModeSchema = z.enum(["after_reply", "after_save"]);
export const SubmitMessageRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  content: NonEmpty(LIMITS.userMessageChars),
  respond: RespondModeSchema.optional(),
});
export type SubmitMessageRequest = z.infer<typeof SubmitMessageRequestSchema>;

/**
 * What a client may ask for. The server assigns id/turn/time, checks applicability, and never stores
 * submitted codes or account contents (there is no field for them). Verification completion must present
 * the challenge id issued when the official directory was opened.
 */
export const SubmitEventRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  type: ClientEventTypeSchema,
  requestId: Id.nullable(),
  challengeId: Id.optional(),
  /** The server-issued fictional practice code shown on the request card (checked, never stored). */
  practiceCode: z.string().regex(/^\d{6}$/).optional(),
  /** Optional procedure issue explicitly linked to launching the official verification interface. */
  linkedIssueId: Id.optional(),
  /** Trusted in-app account record (portal events). The server verifies it exists for this session. */
  recordId: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
});
export type SubmitEventRequest = z.infer<typeof SubmitEventRequestSchema>;

export const ProcessingStatusSchema = z.enum(["processed", "queued", "idle"]);

export const TurnStatusSchema = z.strictObject({
  state: z.enum(["idle", "generating", "paused", "failed"]),
  reason: z.string().max(80).nullable(),
  message: z.string().max(300).nullable(),
});
export type TurnStatus = z.infer<typeof TurnStatusSchema>;

export const ObserverSessionViewSchema = z.strictObject({
  sessionId: Id,
  threadId: Id,
  scenario: z.strictObject({ id: z.string(), version: z.number().int().min(0), senderName: z.string(), simulationNotice: z.string() }),
  revision: z.number().int().min(1),
  conversationRevision: z.number().int().min(1),
  turn: z.number().int().min(0),
  maxTurns: z.number().int().min(1),
  ended: z.boolean(),
  stage: SessionStageSchema,
  outcome: OutcomeSchema.nullable(),
  messages: z.array(MessageSchema),
  requests: z.array(SimulatedRequestSchema),
  events: z.array(AppEventSchema),
  requestStates: z.array(RequestStateSchema),
  requestStatus: PlannerRequestStatusSchema,
  /** The fictional practice code for the request card. Present only once the request has been presented. */
  practiceCode: z.string().regex(/^\d{6}$/).nullable(),
  verification: z.strictObject({
    status: VerificationStatusSchema,
    /** Official simulated support result, shown only inside the trusted verification interface. */
    officialResult: z.string().nullable(),
    /**
     * Recovery after reload (owner-only GET, no-store): the challenge of the ACTIVE attempt, present only
     * while the check is in progress. Cancelling invalidates it; a new attempt issues a new challenge.
     */
    activeChallengeId: Id.nullable(),
    /** The started-event id of the active attempt. */
    attemptId: Id.nullable(),
  }),
  stopConfirmationPending: z.boolean(),
  finalDecisionProceeded: z.boolean(),
  /** Neutral technical notice: the latest input could not be answered. `canRetry` allows exactly one retry. */
  technicalNotice: z.strictObject({ inputId: Id, attempts: z.number().int().min(1), canRetry: z.boolean(), message: z.string() }).nullable(),
  /**
   * Server-derived state of the latest player input (never inferred by the browser): `generating` while the
   * observer/planner/actor still has work, `paused` when the rules intentionally wait (with the rule as
   * `reason` and plain-language `message`), `failed` when a technical notice is shown, otherwise `idle`.
   */
  turnStatus: TurnStatusSchema,
  /** Procedure issue the verification launch may be linked to (server rule, addendum §4). */
  verificationLinkIssueId: Id.nullable(),
  issues: z.array(IssueRecordSchema),
});
export type ObserverSessionView = z.infer<typeof ObserverSessionViewSchema>;

export const ObserverSessionResponseSchema = z.strictObject({
  session: ObserverSessionViewSchema,
  processing: z.strictObject({ status: ProcessingStatusSchema, assessed: z.number().int().min(0), stale: z.number().int().min(0) }).optional(),
  duplicate: z.boolean().optional(),
  /** Returned when the official directory is opened; required to complete verification. */
  challengeId: Id.optional(),
});
export type ObserverSessionResponse = z.infer<typeof ObserverSessionResponseSchema>;

export const AssessmentsResponseSchema = z.strictObject({ assessments: z.array(AssessmentRecordSchema) });

export const RetryRequestSchema = z.strictObject({ idempotencyKey: z.uuid(), respond: RespondModeSchema.optional() });
export type RetryRequest = z.infer<typeof RetryRequestSchema>;
