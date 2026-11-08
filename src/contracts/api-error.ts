import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "INVALID_JSON",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "FORBIDDEN",
  // Game (Scamper) codes. 409: refresh the session view, then retry with a NEW actionId.
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  // 422: a valid request that the game rules reject; see `reason`.
  "ACTION_REJECTED",
]);

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
    formErrors: z.array(z.string()).optional(),
    /** Machine-readable rejection reason (game: GameRejectionReason). */
    reason: z.string().optional(),
    /** Present on VERSION_CONFLICT: the server's current session version. */
    currentVersion: z.number().int().optional(),
  }),
  requestId: z.string(),
});

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
