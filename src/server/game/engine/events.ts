import { z } from "zod";
import { EndedReasonSchema, GameEventTypeSchema, OutcomeKindSchema } from "@/contracts/game";

/**
 * Domain events: immutable, ordered, validated. `evolve` is the only code that applies them, for
 * live play and for reconstruction alike. Speech (`message.sent`) is a non-mutating variant: it
 * appends to the transcript and never touches the ledger, verification, or outcome.
 *
 * IDs inside payloads (messageId, requestId, transactionId) are derived deterministically from the
 * event's sequence by `decide`, so a fork that copies the prefix keeps identical payload ids.
 * Envelope ids (eventId, createdAt) are assigned at commit time, never inside the reducer.
 */

const Id = z.string().min(1).max(100);
const Origin = z.enum(["player", "scenario", "live_model", "scripted_fallback"]);
const OpponentOrigin = z.enum(["live_model", "scripted_fallback"]);

export const EventPayloadSchemas = {
  "encounter.started": z.strictObject({ scenarioId: z.literal("bank-alert"), scenarioVersion: z.number().int() }),
  "branch.started": z.strictObject({
    parentSessionId: z.string(),
    checkpointId: z.literal("before-payment-decision"),
    checkpointEventId: Id,
    inheritedEventCount: z.number().int().min(0),
  }),
  "message.sent": z.strictObject({
    messageId: Id,
    from: z.enum(["player", "opponent"]),
    text: z.string(),
    origin: Origin,
    turnId: Id.nullable(),
  }),
  "payment.requested": z.strictObject({
    requestId: Id,
    recipientId: Id,
    amount: z.number().int(),
    origin: OpponentOrigin,
    turnId: Id,
  }),
  "payment.inspected": z.strictObject({ requestId: Id }),
  "verification.completed": z.strictObject({ contactId: Id, factIds: z.array(Id) }),
  "payment.approved": z.strictObject({ requestId: Id }),
  "ledger.debited": z.strictObject({ transactionId: Id, requestId: Id, recipientId: Id, amount: z.number().int().min(1) }),
  "payment.rejected": z.strictObject({ requestId: Id }),
  "payment.withdrawn": z.strictObject({ requestId: Id, reason: z.enum(["encounter_ended", "opponent_finished"]) }),
  "encounter.ended": z.strictObject({
    reason: EndedReasonSchema,
    outcome: OutcomeKindSchema,
    turnId: Id.nullable(),
  }),
  "reflection.submitted": z.strictObject({ warningSignIds: z.array(Id) }),
} satisfies Record<z.infer<typeof GameEventTypeSchema>, z.ZodType>;

export type EventType = keyof typeof EventPayloadSchemas;
export type EventPayload<T extends EventType> = z.infer<(typeof EventPayloadSchemas)[T]>;
export type Actor = "player" | "opponent" | "system";

/** What `decide` produces: no ids/timestamps yet. */
export type EventDraft = { [T in EventType]: { type: T; actor: Actor; payload: EventPayload<T> } }[EventType];

/** A committed event. */
export type GameEvent = EventDraft & {
  eventId: string;
  sessionId: string;
  sequence: number;
  /** Triggering command id: player actionId, `turn:<turnId>:<callId>`, or `system:<...>`. */
  actionId: string | null;
  /** For events copied into a fork: the parent event id. */
  sourceEventId: string | null;
  createdAt: string;
};

/** Validates a stored event (DB row -> domain). Throws on schema drift. */
export function parseStoredEvent(row: {
  eventId: string;
  sessionId: string;
  sequence: number;
  type: string;
  actor: string;
  payload: unknown;
  actionId: string | null;
  sourceEventId: string | null;
  createdAt: Date | string;
}): GameEvent {
  const type = GameEventTypeSchema.parse(row.type);
  const payload = EventPayloadSchemas[type].parse(row.payload);
  const actor = z.enum(["player", "opponent", "system"]).parse(row.actor);
  return {
    eventId: row.eventId,
    sessionId: row.sessionId,
    sequence: row.sequence,
    type,
    actor,
    payload,
    actionId: row.actionId,
    sourceEventId: row.sourceEventId,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  } as GameEvent;
}
