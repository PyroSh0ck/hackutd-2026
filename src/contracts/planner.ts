import { z } from "zod";
import { MessageSchema, PlannerObservationSchema } from "./observer";

/**
 * Planner and actor contracts (planner brief §7). Strict: unknown model keys are rejected. Candidates are
 * server-owned: a plan names a candidate id and the controller reads action, target, move, tool intent
 * and constraints from that candidate, never from the model.
 */

export const PLANNER_SCHEMA_VERSION = "planner-schema-v1";
export const SCENARIO_ID = "mobile-code-01" as const;
export const SCENARIO_VERSION = 1 as const;

export const PLAN_LIMITS = {
  idChars: 80,
  focusChars: 240,
  justificationChars: 240,
  perPlanList: 5,
  candidates: 5,
  actorTextChars: 1200,
  messageChars: 4000,
  relevantMessages: 6,
} as const;

const Id = z.string().min(1).max(PLAN_LIMITS.idChars).regex(/^[A-Za-z0-9_-]+$/, "Ids are server-generated tokens.");
const Bounded = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, "Must not be blank.");

export const ActionSchema = z.enum(["answer_question", "clarify_response", "continue_scenario", "present_simulated_request", "respond_to_objection", "acknowledge_boundary"]);
export type Action = z.infer<typeof ActionSchema>;

export const MoveIdSchema = z.enum([
  "answer_identity",
  "answer_procedure",
  "answer_scenario_fact",
  "clarify_decision",
  "clarify_condition",
  "clarify_claimed_check",
  "continue_premise",
  "present_code_request",
  "address_doubt",
  "back_off_doubt",
  "acknowledge_refusal",
]);
export type MoveId = z.infer<typeof MoveIdSchema>;

export const StyleSchema = z.enum(["concise_professional", "plain_explanatory"]);
export type Style = z.infer<typeof StyleSchema>;

export const EvidenceRefSchema = z.strictObject({ kind: z.enum(["message", "assessment", "event"]), id: Id });
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const ForbiddenClaimCodeSchema = z.enum([
  "invented_user_action",
  "authoritative_verification_override",
  "new_threat",
  "real_contact_destination",
  "new_request_type",
  "personal_vulnerability_inference",
]);
export type ForbiddenClaimCode = z.infer<typeof ForbiddenClaimCodeSchema>;

/** F01–F05: mobile-code-01 (fraudulent). L01–L04: mobile-notice-01 (legitimate). Never shared across scenarios. */
export const FactIdSchema = z.enum(["F01", "F02", "F03", "F04", "F05", "L01", "L02", "L03", "L04"]);
export const AdditionIdSchema = z.enum(["case_reference", "team_label"]);
export type AdditionId = z.infer<typeof AdditionIdSchema>;

export const ConstraintsSchema = z.strictObject({
  maxWords: z.number().int().min(1).max(200),
  maxQuestions: z.number().int().min(0).max(3),
  allowedStyles: z.array(StyleSchema).min(1),
  allowedFactIds: z.array(FactIdSchema),
  allowedAdditionIds: z.array(AdditionIdSchema),
  forbiddenClaimCodes: z.array(ForbiddenClaimCodeSchema),
});
export type Constraints = z.infer<typeof ConstraintsSchema>;

export const FocusCodeSchema = z.enum(["answer_target", "clarify_target", "continue_premise", "present_request", "acknowledge_boundary", "acknowledge_unknown"]);
export type FocusCode = z.infer<typeof FocusCodeSchema>;

export const ToolIntentSchema = z.enum(["none", "present_practice_code_request"]);
export type ToolIntent = z.infer<typeof ToolIntentSchema>;

export const CandidateSchema = z.strictObject({
  id: Id,
  revision: z.number().int().min(1),
  action: ActionSchema,
  moveId: MoveIdSchema,
  requestId: Id.nullable(),
  issueId: Id.nullable(),
  ruleId: z.string().min(1).max(40),
  evidenceRefs: z.array(EvidenceRefSchema).max(8),
  focusCode: FocusCodeSchema,
  toolIntent: ToolIntentSchema,
  constraints: ConstraintsSchema,
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const PlannerFactSchema = z.strictObject({ id: FactIdSchema, kind: z.enum(["sender_claim", "public"]), text: z.string().min(1) });
export type PlannerFact = z.infer<typeof PlannerFactSchema>;
export const PlannerAdditionSchema = z.strictObject({ id: AdditionIdSchema, text: z.string().min(1), introduced: z.boolean() });
export type PlannerAddition = z.infer<typeof PlannerAdditionSchema>;

export const PlannerInputSchema = z.strictObject({
  sessionId: Id,
  scenarioId: z.enum([SCENARIO_ID, "mobile-notice-01"]),
  scenarioVersion: z.number().int().min(1),
  basedOnRevision: z.number().int().min(1),
  policyVersion: z.string().min(1),
  observer: PlannerObservationSchema,
  relevantMessages: z.array(MessageSchema),
  candidates: z.array(CandidateSchema).min(1).max(PLAN_LIMITS.candidates + 2),
  facts: z.array(PlannerFactSchema),
  additions: z.array(PlannerAdditionSchema),
  recentPlans: z.array(z.strictObject({ action: ActionSchema, moveId: MoveIdSchema, targetId: Id.nullable() })).max(2),
  remainingTurns: z.number().int().min(0),
});
export type PlannerInput = z.infer<typeof PlannerInputSchema>;

/** Model-facing plan. It selects; it never sets action, target, move, tool, or constraints. */
export const PlanSchema = z.strictObject({
  candidateId: Id,
  basedOnRevision: z.number().int().min(1),
  selectedFactIds: z.array(FactIdSchema).max(PLAN_LIMITS.perPlanList),
  selectedAdditionIds: z.array(AdditionIdSchema).max(PLAN_LIMITS.perPlanList),
  style: StyleSchema,
  contentFocus: Bounded(PLAN_LIMITS.focusChars),
  evidenceRefs: z.array(EvidenceRefSchema).max(PLAN_LIMITS.perPlanList),
  briefJustification: Bounded(PLAN_LIMITS.justificationChars),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PlanErrorCodeSchema = z.enum([
  "schema",
  "unknown_candidate",
  "stale_revision",
  "invalid_reference",
  "disallowed_fact",
  "disallowed_addition",
  "disallowed_style",
  "invalid_focus",
  "session_not_active",
]);
export const PlanErrorSchema = z.strictObject({ code: PlanErrorCodeSchema, field: z.string(), detail: z.string() });
export type PlanError = z.infer<typeof PlanErrorSchema>;

export const ActorInstructionSchema = z.strictObject({
  planId: Id,
  basedOnRevision: z.number().int().min(1),
  action: ActionSchema,
  moveId: MoveIdSchema,
  target: z.strictObject({ requestId: Id.nullable(), issueId: Id.nullable(), description: z.string().min(1).max(600) }),
  facts: z.array(PlannerFactSchema),
  additions: z.array(PlannerAdditionSchema),
  style: StyleSchema,
  contentFocus: Bounded(PLAN_LIMITS.focusChars),
  /** Fixed by the candidate's focus code; overrides contentFocus. */
  focusCode: FocusCodeSchema,
  constraints: ConstraintsSchema,
  toolIntent: ToolIntentSchema,
});
export type ActorInstruction = z.infer<typeof ActorInstructionSchema>;

/** Model-facing actor output. */
export const ActorOutputSchema = z.strictObject({
  text: Bounded(PLAN_LIMITS.actorTextChars),
  usedFactIds: z.array(FactIdSchema).max(PLAN_LIMITS.perPlanList),
  introducedAdditionIds: z.array(AdditionIdSchema).max(2),
});
export type ActorOutput = z.infer<typeof ActorOutputSchema>;

export const ActorErrorCodeSchema = z.enum(["schema", "disallowed_fact", "disallowed_addition", "addition_mismatch", "length", "questions", "forbidden_content", "unauthorized_request"]);
export const ActorErrorSchema = z.strictObject({ code: ActorErrorCodeSchema, field: z.string(), detail: z.string() });
export type ActorError = z.infer<typeof ActorErrorSchema>;

export const PlanStageSchema = z.enum(["planner", "planner_repair", "actor", "actor_repair"]);
export const PlanAttemptSchema = z.strictObject({
  stage: PlanStageSchema,
  modelId: z.string(),
  startedAt: z.iso.datetime(),
  latencyMs: z.number().int().min(0),
  outcome: z.enum(["ok", "timeout", "unavailable", "refusal", "http_error", "malformed_output"]),
  errors: z.array(z.strictObject({ code: z.string(), field: z.string(), detail: z.string() })),
});
export type PlanAttempt = z.infer<typeof PlanAttemptSchema>;

export const PlanFailureSchema = z.enum([
  "planner_unavailable",
  "planner_timeout",
  "planner_refusal",
  "planner_http_error",
  "plan_invalid_after_repair",
  "actor_unavailable",
  "actor_timeout",
  "actor_refusal",
  "actor_http_error",
  "actor_invalid_after_repair",
  "actor_input_invalid",
]);
export type PlanFailure = z.infer<typeof PlanFailureSchema>;

/**
 * Brief §7 PlanRecord, plus audit fields (input binding, attempts, actor instruction/output, failure). The
 * actor's draft is persisted only for audit and resume-after-crash; it is never shown unless committed.
 */
export const PlanRecordSchema = z.strictObject({
  id: Id,
  sessionId: Id,
  /** The user message or UI event this attempt responds to. */
  inputId: Id,
  inputKind: z.enum(["message", "event"]),
  attempt: z.number().int().min(1).max(2),
  basedOnRevision: z.number().int().min(1),
  policyVersion: z.string(),
  scenarioVersion: z.number().int(),
  ruleId: z.string(),
  candidateSnapshot: z.array(CandidateSchema),
  proposedPlan: PlanSchema.nullable(),
  acceptedPlan: PlanSchema.nullable(),
  validationAttempts: z.array(z.strictObject({ errors: z.array(PlanErrorSchema) })),
  repairAttempted: z.boolean(),
  actorInstruction: ActorInstructionSchema.nullable(),
  actorOutput: ActorOutputSchema.nullable(),
  actorValidationAttempts: z.array(z.strictObject({ errors: z.array(ActorErrorSchema) })),
  actorRepairAttempted: z.boolean(),
  attempts: z.array(PlanAttemptSchema).max(4),
  status: z.enum(["prepared", "committed", "rejected", "stale", "failed"]),
  failureReason: PlanFailureSchema.nullable(),
  committedMessageId: Id.nullable(),
  modelId: z.string(),
  actorModelId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /**
   * Actor v2 audit (src/server/actor): versions, processing attempt id, privacy-safe attempt records and
   * style metrics. Validated with ActorAttemptRecordSchema on the server; never contains the model-bound
   * input or rejected drafts. Absent on records written before actor v2.
   */
  actorAudit: z
    .strictObject({
      schemaVersion: z.string(),
      promptVersion: z.string(),
      processingAttemptId: Id,
      processingAttempt: z.number().int().min(1).max(2),
      attempts: z.array(z.record(z.string(), z.unknown())).max(2),
      styleMetrics: z.record(z.string(), z.unknown()).nullable(),
    })
    .nullable()
    .optional(),
  /** Set when a durable retry reused an earlier still-applicable plan instead of calling the planner. */
  reusedPlanFrom: Id.nullable().optional(),
  /** "tools": the planner ran as a function-calling agent over the training service (brief §7). */
  plannerProtocol: z.enum(["structured", "tools"]).optional(),
  /** Executed tool calls with the provider's call ids. Summaries only; never model reasoning. */
  toolCalls: z
    .array(
      z.strictObject({
        callId: z.string().min(1).max(200),
        name: z.enum(["get_training_context", "execute_training_move"]),
        status: z.enum(["ok", "invalid", "rejected", "executing"]),
        summary: z.string().max(500),
      }),
    )
    .max(4)
    .optional(),
});
export type PlanRecord = z.infer<typeof PlanRecordSchema>;

// ---------------------------------------------------------------- HTTP

export const EligibilitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("controller"), ruleId: z.string(), reason: z.string() }),
  z.strictObject({ kind: z.literal("wait"), ruleId: z.string(), reason: z.string(), excluded: z.array(z.strictObject({ moveId: MoveIdSchema, issueId: Id.nullable(), reason: z.string() })) }),
  z.strictObject({ kind: z.literal("candidates"), ruleId: z.string(), candidates: z.array(CandidateSchema), excluded: z.array(z.strictObject({ moveId: MoveIdSchema, issueId: Id.nullable(), reason: z.string() })) }),
]);
export type Eligibility = z.infer<typeof EligibilitySchema>;

export const PlannerResponseSchema = z.strictObject({ observation: PlannerObservationSchema.nullable(), eligibility: EligibilitySchema });
export const PlansResponseSchema = z.strictObject({ plans: z.array(PlanRecordSchema) });
