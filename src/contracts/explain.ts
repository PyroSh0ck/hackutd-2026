import { z } from "zod";
import { OutcomeSchema } from "./observer";

/**
 * "How this session worked": a concise, post-session technical trace for judges and curious users.
 * Decision summaries only, from stored audit records; never model reasoning, prompts, or credentials.
 * Available only after the session has ended, so it cannot reveal anything during practice.
 */
export const ExplainTurnSchema = z.strictObject({
  inputId: z.string(),
  inputKind: z.enum(["message", "event"]),
  observer: z
    .strictObject({
      model: z.string(),
      decision: z.string(),
      resolution: z.string(),
      reviewStatus: z.string(),
      evidenceCount: z.number().int().min(0),
      validationErrors: z.number().int().min(0),
    })
    .nullable(),
  planner: z
    .strictObject({
      protocol: z.enum(["structured", "tools"]),
      model: z.string(),
      ruleId: z.string(),
      move: z.string().nullable(),
      status: z.string(),
      failureReason: z.string().nullable(),
      toolCalls: z.array(z.strictObject({ callId: z.string(), name: z.string(), status: z.string(), summary: z.string() })),
      committedMessageId: z.string().nullable(),
      requestIds: z.array(z.string()),
      actorModel: z.string().nullable(),
    })
    .nullable(),
});

export const ExplainResponseSchema = z.strictObject({
  backend: z.enum(["postgres", "memory", "spacetime"]),
  revision: z.number().int(),
  outcome: OutcomeSchema.nullable(),
  outcomeEventIds: z.array(z.string()),
  turns: z.array(ExplainTurnSchema),
});
export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;
