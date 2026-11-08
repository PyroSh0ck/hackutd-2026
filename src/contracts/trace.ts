import { z } from "zod";

/**
 * Agent debug trace (developer tool, opt-in). Each entry is one pipeline step for one input (user message
 * or UI event): what a model was sent, what it returned (raw), and what the server decided. Data is
 * arbitrary JSON by design; the trace is for inspection, not for any decision.
 */

export const TraceStepSchema = z.enum([
  "input.received",
  "observer.input",
  "model.call",
  "observer.result",
  "planner.eligibility",
  "planner.input",
  "planner.result",
  "actor.input",
  "actor.result",
  "commit",
  "session.event",
]);
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const TraceEntrySchema = z.strictObject({
  seq: z.number().int().min(0),
  at: z.iso.datetime(),
  sessionId: z.string(),
  /** The user message / UI event this step belongs to (null: session-level). */
  inputId: z.string().nullable(),
  step: TraceStepSchema,
  /** Which agent the step belongs to. */
  agent: z.enum(["observer", "reviewer", "planner", "actor", "server"]),
  title: z.string(),
  status: z.enum(["ok", "warn", "fail", "info"]),
  data: z.unknown(),
});
export type TraceEntry = z.infer<typeof TraceEntrySchema>;

export const TraceResponseSchema = z.strictObject({ entries: z.array(TraceEntrySchema) });
