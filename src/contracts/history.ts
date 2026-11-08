import { z } from "zod";
import { OutcomeSchema, SessionStageSchema } from "./observer";

/**
 * Server-side practice history and progress (backend-completion brief §5). Owner = signed player cookie:
 * history survives clearing browser storage while the cookie persists; it is not cross-device. Summaries
 * never name the scenario or its kind (an opaque session id and a neutral title only).
 */
export const HistoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(300).optional(),
});

export const PublicSessionSummarySchema = z.strictObject({
  sessionId: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  ended: z.boolean(),
  stage: SessionStageSchema,
  outcome: OutcomeSchema.nullable(),
  turn: z.number().int().min(0),
});
export type PublicSessionSummary = z.infer<typeof PublicSessionSummarySchema>;

export const HistoryResponseSchema = z.strictObject({ sessions: z.array(PublicSessionSummarySchema), nextCursor: z.string().nullable() });
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

export const ProgressResponseSchema = z.strictObject({
  completed: z.number().int().min(0),
  outcomes: z.partialRecord(OutcomeSchema, z.number().int().min(0)),
  /** Counts of ended sessions in which the action was recorded. Observations, not a skill score. */
  observations: z.strictObject({ verificationCompleted: z.number().int(), reported: z.number().int(), requestDeclined: z.number().int(), codeShared: z.number().int() }),
  nextPractice: z.strictObject({ available: z.boolean(), selection: z.enum(["mixed", "recommended"]) }),
});
export type ProgressResponse = z.infer<typeof ProgressResponseSchema>;
