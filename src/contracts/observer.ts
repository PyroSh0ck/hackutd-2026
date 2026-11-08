import { z } from "zod";

/**
 * Observer subsystem contracts (brief §4). Single source of truth for model-facing schemas, server-owned
 * records, the planner handoff, and HTTP shapes. Every object is strict: unknown keys are rejected, so a
 * model cannot set server-owned fields (action status, verification completion, ids it was not given).
 *
 * Length limits keep prompts and audit logs bounded; they are documented here and enforced at runtime.
 */

export const OBSERVER_SCHEMA_VERSION = "observer-schema-v1";

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

export const AppEventTypeSchema = z.enum([
  "simulated_link_opened",
  "practice_code_submitted",
  "practice_account_details_submitted",
  "simulated_payment_started",
  "simulated_payment_approved",
  "official_directory_opened",
  "official_verification_completed",
  "request_rejected",
  "conversation_reported",
  "conversation_ended",
]);
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

// ---------------------------------------------------------------- 4.4 observer output (model-facing)

export const ObserverAssessmentSchema = z.strictObject({
  requestId: Id,
  currentMessageId: Id,
  decision: z.strictObject({ label: DecisionLabelSchema, evidence: EvidenceList }),
  condition: z.strictObject({ description: NonEmpty(LIMITS.descriptionChars), evidence: EvidenceList }).nullable(),
  verificationObservations: z
    .array(
      z.strictObject({
        behavior: VerificationBehaviorSchema,
        channelProvenance: ChannelProvenanceSchema,
        channelDescription: NonEmpty(LIMITS.descriptionChars).nullable(),
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
});
export type ObserverAssessment = z.infer<typeof ObserverAssessmentSchema>;

// ---------------------------------------------------------------- 4.3 observer input

export const RubricSchema = z.strictObject({
  decisionDefinitions: z.record(DecisionLabelSchema, z.string().min(1)),
  verificationDefinitions: z.record(VerificationBehaviorSchema, z.string().min(1)),
  channelDefinitions: z.record(ChannelProvenanceSchema, z.string().min(1)),
  evidenceRules: z.array(z.string().min(1)).min(1),
  interpretationRules: z.array(z.string().min(1)).min(1),
});
export type Rubric = z.infer<typeof RubricSchema>;

export const ObserverInputSchema = z.strictObject({
  sessionId: Id,
  turn: z.number().int().min(0),
  basedOnRevision: z.number().int().min(1),
  currentMessageId: Id,
  request: SimulatedRequestSchema,
  relevantMessages: z.array(MessageSchema).min(1).max(LIMITS.relevantMessages + 1),
  previousAssessment: ObserverAssessmentSchema.nullable(),
  relevantEvents: z.array(AppEventSchema).max(LIMITS.relevantEvents),
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
export const REVIEW_FIELD_PATTERN = /^(overall|decision(\.label|\.evidence)?|condition|verificationObservations(\[\d{1,2}\])?|statedUnderstanding|ambiguities(\[\d{1,2}\])?)$/;

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

export const RequestStateSchema = z.strictObject({
  requestId: Id,
  latestAssessmentId: Id.nullable(),
  action: z.strictObject({ status: z.enum(["not_started", "started", "completed"]), eventIds: z.array(Id) }),
  inAppVerification: z.strictObject({ status: z.enum(["not_observed", "directory_opened", "completed"]), eventIds: z.array(Id) }),
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

export const AssessmentRecordSchema = z.strictObject({
  id: Id,
  sessionId: Id,
  requestId: Id,
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

// ---------------------------------------------------------------- 4.9 planner handoff

export const PlannerObservationSchema = z.strictObject({
  request: SimulatedRequestSchema,
  /** Model interpretation (possibly reviewed). Not a fact about actions. */
  assessment: ObserverAssessmentSchema,
  interpretationSource: z.literal("model_interpretation"),
  resolution: ResolutionSchema,
  reviewStatus: ReviewStatusSchema,
  /** Server-observed facts, from application events only. */
  action: RequestStateSchema.shape.action,
  inAppVerification: RequestStateSchema.shape.inAppVerification,
  previousAssessment: ObserverAssessmentSchema.nullable(),
  supportingMessages: z.array(MessageSchema),
  supportingEvents: z.array(AppEventSchema),
  unresolvedQuestions: z.array(z.string()),
  remainingTurns: z.number().int().min(0),
});
export type PlannerObservation = z.infer<typeof PlannerObservationSchema>;

// ---------------------------------------------------------------- HTTP

export const ObserverIdSchema = z.uuid();

export const SubmitMessageRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  content: NonEmpty(LIMITS.userMessageChars),
});
export type SubmitMessageRequest = z.infer<typeof SubmitMessageRequestSchema>;

/**
 * What a client may ask for. The server assigns id/turn/time, checks applicability, and never stores
 * submitted codes or account contents (there is no field for them). Verification completion must present
 * the challenge id issued when the official directory was opened.
 */
export const SubmitEventRequestSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  type: AppEventTypeSchema,
  requestId: Id.nullable(),
  challengeId: Id.optional(),
});
export type SubmitEventRequest = z.infer<typeof SubmitEventRequestSchema>;

export const ProcessingStatusSchema = z.enum(["processed", "queued", "idle"]);

export const ObserverSessionViewSchema = z.strictObject({
  sessionId: Id,
  threadId: Id,
  revision: z.number().int().min(1),
  conversationRevision: z.number().int().min(1),
  turn: z.number().int().min(0),
  ended: z.boolean(),
  messages: z.array(MessageSchema),
  requests: z.array(SimulatedRequestSchema),
  events: z.array(AppEventSchema),
  requestStates: z.array(RequestStateSchema),
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
export const PlannerResponseSchema = z.strictObject({ observations: z.array(PlannerObservationSchema) });
