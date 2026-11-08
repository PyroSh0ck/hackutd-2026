import { z } from "zod";
import { OutcomeSchema, SessionStageSchema } from "./observer";

/**
 * Server-side practice history and progress (backend-completion brief §5). Owner = signed player cookie:
 * history survives clearing browser storage while the cookie persists; it is not cross-device. Summaries
 * never name the scenario or its kind (an opaque session id and a neutral title only).
 */
/**
 * Optional POST /api/observer/sessions body. A missing body stays backward compatible. `scenarioId` is
 * accepted only behind server-side test/admin gating; players never pick legitimate vs fraudulent.
 */
export const CreateSessionRequestSchema = z.strictObject({
  selection: z.enum(["mixed", "recommended"]).optional(),
  scenarioId: z.enum(["mobile-code-01", "mobile-notice-01"]).optional(),
});

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

/** The trusted in-app account: fictional profile and the notices that exist for this session (if any). */
export const AccountResponseSchema = z.strictObject({
  profile: z.strictObject({ displayName: z.string(), organizationId: z.string(), lineSuffix: z.string(), emailDisplay: z.string(), accountLabel: z.string(), realWorldValue: z.literal(false) }),
  notices: z.array(
    z.strictObject({ id: z.string(), title: z.string(), summary: z.string().nullable(), actionLabel: z.string(), opened: z.boolean(), reviewed: z.boolean() }),
  ),
});
export type AccountResponse = z.infer<typeof AccountResponseSchema>;

export const ProgressResponseSchema = z.strictObject({
  completed: z.number().int().min(0),
  outcomes: z.partialRecord(OutcomeSchema, z.number().int().min(0)),
  /** Counts of ended sessions in which the action was recorded. Observations, not a skill score. */
  observations: z.strictObject({ verificationCompleted: z.number().int(), reported: z.number().int(), requestDeclined: z.number().int(), codeShared: z.number().int() }),
  nextPractice: z.strictObject({ available: z.boolean(), selection: z.enum(["mixed", "recommended"]) }),
});
export type ProgressResponse = z.infer<typeof ProgressResponseSchema>;
