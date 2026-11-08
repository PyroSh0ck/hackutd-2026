import { z } from "zod";
import { ActorInstructionSchema, ActorOutputSchema as SharedOutputSchema } from "@/contracts/planner";

export const ACTOR_SCHEMA_VERSION = "actor-v2" as const;
const Id = z.string().min(1).max(100);
const uniqueIds = z.array(Id).max(5).refine((ids) => new Set(ids).size === ids.length, "Duplicate IDs.");
export const ActorContextMessageSchema = z.strictObject({
  id: Id, role: z.enum(["user", "assistant"]), text: z.string().max(4000), turn: z.number().int().nonnegative(),
});
export type ActorContextMessage = z.infer<typeof ActorContextMessageSchema>;
export const ActorStyleProfileSchema = z.strictObject({
  version: z.literal("style-v1"), register: z.literal("conversational_professional"),
  lengthTarget: z.enum(["brief", "normal", "explanatory"]),
  targetWords: z.strictObject({ min: z.number().int().nonnegative(), max: z.number().int().positive() }),
  targetSentences: z.strictObject({ min: z.literal(1), max: z.literal(3) }),
  targetQuestions: z.union([z.literal(0), z.literal(1)]), acknowledgment: z.enum(["none", "optional_brief"]),
  contractions: z.literal("allowed"), detail: z.enum(["direct", "brief_explanation"]),
  formatting: z.literal("plain_text"), emojis: z.literal("avoid"),
}).refine((p) => p.targetWords.min <= p.targetWords.max, "Invalid word target.");
export type ActorStyleProfile = z.infer<typeof ActorStyleProfileSchema>;
export const ActorInputSchema = z.strictObject({
  schemaVersion: z.literal(ACTOR_SCHEMA_VERSION), styleProfile: ActorStyleProfileSchema,
  recentActorMessages: z.array(ActorContextMessageSchema).max(3), instruction: ActorInstructionSchema,
  persona: z.strictObject({ scenarioId: z.literal("mobile-code-01"), senderName: z.literal("Avery"),
    organization: z.literal("Cedar Account Support"), voice: z.literal("plain_professional") }),
  currentUserMessageId: Id.nullable(), contextMessages: z.array(ActorContextMessageSchema).max(12),
  visibleRequest: z.strictObject({ id: Id, description: z.string().min(1).max(4000), status: z.enum(["pending", "rejected"]) }).nullable(),
  controls: z.array(z.strictObject({ id: z.enum(["verify_independently", "end_practice", "share_practice_code"]), label: z.string().min(1).max(100) })).max(3),
}).superRefine((input, ctx) => {
  for (const key of ["contextMessages", "recentActorMessages", "controls"] as const) {
    if (new Set(input[key].map((m) => m.id)).size !== input[key].length) ctx.addIssue({ code: "custom", path: [key], message: "Duplicate IDs." });
  }
  if (input.recentActorMessages.some((m) => m.role !== "assistant")) ctx.addIssue({ code: "custom", path: ["recentActorMessages"], message: "Only committed actor messages are allowed." });
  if (input.currentUserMessageId && !input.contextMessages.some((m) => m.id === input.currentUserMessageId && m.role === "user")) ctx.addIssue({ code: "custom", path: ["currentUserMessageId"], message: "Current user message is missing." });
});
export type ActorInput = z.infer<typeof ActorInputSchema>;

// Local v2 boundary widens only raw ID parsing (1–100 characters, five entries). Membership is checked
// against the shared instruction; successful output is parsed back into the existing shared contract.
export const ActorOutputSchema = SharedOutputSchema.extend({
  usedFactIds: uniqueIds, introducedAdditionIds: uniqueIds,
});
export type ActorDraft = z.infer<typeof ActorOutputSchema>;
export const ActorViolationCodeSchema = z.enum([
  "schema_invalid", "blank_text", "text_too_long", "word_limit", "question_limit", "invalid_reference",
  "addition_mismatch", "unapproved_destination", "forbidden_format", "known_secret_in_output", "session_not_active", "stale_revision",
]);
export const ActorViolationSchema = z.strictObject({ code: ActorViolationCodeSchema, field: z.string(), detail: z.string(), offendingExcerpt: z.string().nullable() });
export type ActorViolation = z.infer<typeof ActorViolationSchema>;
export const ActorValidationSchema = z.strictObject({ valid: z.boolean(), violations: z.array(ActorViolationSchema) });
export type ActorValidation = z.infer<typeof ActorValidationSchema>;
export const ActorRepairInputSchema = z.strictObject({ originalInput: ActorInputSchema, invalidOutput: z.unknown(), violations: z.array(ActorViolationSchema) });
export type ActorRepairInput = z.infer<typeof ActorRepairInputSchema>;

export const ActorEnvelopeSchema = z.strictObject({
  sessionId: Id, inputEventId: Id, processingAttemptId: Id, processingAttempt: z.union([z.literal(1), z.literal(2)]),
  planId: Id, basedOnRevision: z.number().int().positive(), policyVersion: z.string().min(1),
  actorPromptVersion: z.string().min(1), modelId: z.string().min(1), claimId: Id, ownerKey: z.string().min(1),
});
export type ActorEnvelope = z.infer<typeof ActorEnvelopeSchema>;
export const ActorStyleWarningSchema = z.strictObject({ code: z.enum(["outside_length_target", "sentence_target", "question_target", "repeated_opening", "repeated_phrase", "stock_phrase", "list_or_heading", "emoji"]), relatedMessageIds: z.array(Id) });
export const ActorStyleMetricsSchema = z.strictObject({
  styleVersion: z.literal("style-v1"), wordCount: z.number().int().nonnegative(), estimatedSentenceCount: z.number().int().nonnegative(),
  questionMarkCount: z.number().int().nonnegative(), repeatedOpening: z.boolean(), repeatedPhraseCount: z.number().int().nonnegative(),
  stockPhraseCount: z.number().int().nonnegative(), warnings: z.array(ActorStyleWarningSchema),
});
export type ActorStyleMetrics = z.infer<typeof ActorStyleMetricsSchema>;
export type ActorStyleWarning = z.infer<typeof ActorStyleWarningSchema>;
export const ActorAttemptRecordSchema = z.strictObject({
  id: Id, sessionId: Id, inputEventId: Id, planId: Id, processingAttempt: z.union([z.literal(1), z.literal(2)]),
  basedOnRevision: z.number().int().positive(), modelId: z.string(), promptVersion: z.string(), callKind: z.enum(["initial", "repair"]),
  status: z.enum(["valid", "invalid", "provider_failed", "stale"]), violations: z.array(ActorViolationSchema),
  latencyMs: z.number().int().nonnegative(), committedMessageId: Id.nullable(), createdAt: z.iso.datetime(),
  styleProfileVersion: z.literal("style-v1"), styleMetrics: ActorStyleMetricsSchema.nullable(),
  analyticsFailed: z.boolean(), outputHash: z.string().nullable(),
});
export type ActorAttemptRecord = z.infer<typeof ActorAttemptRecordSchema>;
