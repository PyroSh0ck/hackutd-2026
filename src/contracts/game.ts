import { z } from "zod";

/**
 * Scamper game contract (client + server). Single source of truth for request/response shapes.
 *
 * Version semantics
 * - `version`: integer, 1 right after session creation, +1 per accepted command (a player action,
 *   one accepted opponent tool effect, or a system recovery). Mutating requests send it back as
 *   `expectedVersion`; a mismatch is 409 VERSION_CONFLICT with `currentVersion`.
 * - `sequence`: per-event, contiguous from 1 within a session. One command may append several
 *   events (e.g. approve -> payment.approved, ledger.debited, encounter.ended).
 * - `actionId`: client-generated UUID, unique per session. Retrying the same id with the same body
 *   returns the current view without repeating effects (`result.status = "duplicate"`); the same id
 *   with a different body is 409 IDEMPOTENCY_CONFLICT.
 *
 * Nothing in this file may describe private server state (hidden facts before disclosure,
 * opponent prompt, owner identity). The browser never sends ownerId, balances, or events.
 */

export const GAME_CONTRACT_VERSION = 1;

// ---------- identifiers ----------

const Id = z.string().min(1).max(100);
export const SessionIdSchema = z.uuid();
export const ActionIdSchema = z.uuid();
export const ScenarioIdSchema = z.enum(["bank-alert"]);
export const CheckpointIdSchema = z.enum(["before-payment-decision"]);
export const OpponentModeSchema = z.enum(["live", "scripted"]);

// ---------- player actions ----------

export const MESSAGE_MAX_CHARS = 500;

export const PlayerActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("send_message"), text: z.string().trim().min(1, "Write a message first.").max(MESSAGE_MAX_CHARS) }),
  z.strictObject({ type: z.literal("inspect_payment"), requestId: Id }),
  z.strictObject({ type: z.literal("verify_trusted_contact"), contactId: Id }),
  z.strictObject({ type: z.literal("approve_payment"), requestId: Id }),
  z.strictObject({ type: z.literal("reject_payment"), requestId: Id }),
  z.strictObject({ type: z.literal("end_encounter") }),
  /** Only after the encounter ended; at most once. Optional "explains reasoning" credit. */
  z.strictObject({ type: z.literal("submit_reflection"), warningSignIds: z.array(Id).min(1).max(8) }),
]);
export type PlayerAction = z.infer<typeof PlayerActionSchema>;
export type PlayerActionType = PlayerAction["type"];

export const SubmitActionRequestSchema = z.strictObject({
  actionId: ActionIdSchema,
  expectedVersion: z.number().int().min(1),
  action: PlayerActionSchema,
});
export type SubmitActionRequest = z.infer<typeof SubmitActionRequestSchema>;

export const CreateSessionRequestSchema = z.strictObject({
  scenarioId: ScenarioIdSchema.default("bank-alert"),
  /** "scripted" is the explicit, labeled demo/offline setting. "live" falls back (labeled) on failure. */
  opponentMode: OpponentModeSchema.default("live"),
});
export type CreateSessionRequest = z.input<typeof CreateSessionRequestSchema>;

export const ForkRequestSchema = z.strictObject({
  checkpointId: CheckpointIdSchema,
});
export type ForkRequest = z.infer<typeof ForkRequestSchema>;

// ---------- typed rejections (ApiErrorResponse.error.reason) ----------

export const GameRejectionReasonSchema = z.enum([
  "ENCOUNTER_ENDED",
  "ENCOUNTER_ACTIVE",
  "PAYMENT_REQUEST_NOT_FOUND",
  "PAYMENT_REQUEST_NOT_PENDING",
  "PAYMENT_NOT_INSPECTED",
  "INSUFFICIENT_FUNDS",
  "CONTACT_NOT_FOUND",
  "ALREADY_VERIFIED",
  "TURN_PENDING",
  "REFLECTION_ALREADY_SUBMITTED",
  "UNKNOWN_WARNING_SIGN",
  "CHECKPOINT_UNAVAILABLE",
]);
export type GameRejectionReason = z.infer<typeof GameRejectionReasonSchema>;

// ---------- public player view ----------

export const MessageOriginSchema = z.enum(["player", "scenario", "live_model", "scripted_fallback"]);
export type MessageOrigin = z.infer<typeof MessageOriginSchema>;

export const MessageViewSchema = z.object({
  messageId: Id,
  eventId: Id,
  sequence: z.number().int().min(1),
  from: z.enum(["player", "opponent"]),
  text: z.string(),
  /** Always render a label for scripted_fallback; never present it as live model output. */
  origin: MessageOriginSchema,
  createdAt: z.iso.datetime(),
});
export type MessageView = z.infer<typeof MessageViewSchema>;

export const PaymentRequestStatusSchema = z.enum(["pending", "approved", "rejected", "withdrawn"]);

export const PaymentRequestViewSchema = z.object({
  requestId: Id,
  eventId: Id,
  amount: z.number().int(),
  status: PaymentRequestStatusSchema,
  recipient: z.object({ recipientId: Id, displayName: z.string(), claimedPurpose: z.string() }),
  inspected: z.boolean(),
  /** Present only after inspect_payment. Approve requires inspection first. */
  inspection: z
    .object({
      accountLabel: z.string(),
      savedPayee: z.boolean(),
      warnings: z.array(z.string()),
    })
    .nullable(),
  origin: MessageOriginSchema.exclude(["player", "scenario"]),
});
export type PaymentRequestView = z.infer<typeof PaymentRequestViewSchema>;

export const TransactionViewSchema = z.object({
  transactionId: Id,
  /** null for opening-history transactions that are part of the scenario fixture. */
  eventId: Id.nullable(),
  direction: z.enum(["debit", "credit"]),
  amount: z.number().int().min(1),
  counterparty: z.string(),
  description: z.string(),
  date: z.string(),
});
export type TransactionView = z.infer<typeof TransactionViewSchema>;

export const AllowedActionSchema = z.object({
  type: z.enum(["send_message", "inspect_payment", "verify_trusted_contact", "approve_payment", "reject_payment", "end_encounter", "submit_reflection"]),
  requestId: Id.optional(),
  contactId: Id.optional(),
});
export type AllowedAction = z.infer<typeof AllowedActionSchema>;

export const OutcomeKindSchema = z.enum(["loss", "protected", "safe_exit"]);
export type OutcomeKind = z.infer<typeof OutcomeKindSchema>;

export const EndedReasonSchema = z.enum(["payment_approved", "player_ended", "opponent_finished", "turn_cap_reached"]);

export const OutcomeViewSchema = z.object({
  kind: OutcomeKindSchema,
  fundsLost: z.boolean(),
  amountLost: z.number().int().min(0),
  /** P1 (fictional OTP) is not implemented; always false in v1 but kept visible as a separate flag. */
  secretDisclosed: z.boolean(),
  verified: z.boolean(),
  endedReason: EndedReasonSchema,
  /** The event that determined the outcome (e.g. payment.approved or the ending event). */
  decisiveEventId: Id,
});
export type OutcomeView = z.infer<typeof OutcomeViewSchema>;

export const CheckpointViewSchema = z.object({
  checkpointId: CheckpointIdSchema,
  label: z.string(),
  /** True once this run has a payment decision to branch before. */
  available: z.boolean(),
  /** Last event kept in a fork (the event just before the decision). */
  sequence: z.number().int().min(1).nullable(),
  eventId: Id.nullable(),
});
export type CheckpointView = z.infer<typeof CheckpointViewSchema>;

export const LineageViewSchema = z.object({
  parentSessionId: SessionIdSchema.nullable(),
  checkpointId: CheckpointIdSchema.nullable(),
  /** Event id in the PARENT session the fork branched after. */
  checkpointEventId: Id.nullable(),
  /** Number of events copied from the parent (inherited prefix length). */
  inheritedEventCount: z.number().int().min(0),
  forkSessionIds: z.array(SessionIdSchema),
});
export type LineageView = z.infer<typeof LineageViewSchema>;

export const TurnFallbackReasonSchema = z.enum([
  "scripted_mode",
  "provider_unconfigured",
  "provider_error",
  "timeout",
  "invalid_output",
  "expired_turn",
]);

export const OpponentStatusSchema = z.object({
  mode: OpponentModeSchema,
  /** Present while an opponent turn is in flight (show a typing indicator). */
  pendingTurn: z.object({ turnId: Id, startedAt: z.iso.datetime(), expiresAt: z.iso.datetime() }).nullable(),
  lastTurn: z
    .object({
      turnId: Id,
      origin: MessageOriginSchema.exclude(["player", "scenario"]),
      fallbackReason: TurnFallbackReasonSchema.nullable(),
    })
    .nullable(),
  turnsUsed: z.number().int().min(0),
  turnLimit: z.number().int().min(1),
});
export type OpponentStatus = z.infer<typeof OpponentStatusSchema>;

export const PlayerViewSchema = z.object({
  contractVersion: z.literal(GAME_CONTRACT_VERSION),
  sessionId: SessionIdSchema,
  scenario: z.object({
    scenarioId: ScenarioIdSchema,
    version: z.number().int().min(1),
    title: z.string(),
    premise: z.string(),
    fictionalNotice: z.string(),
  }),
  version: z.number().int().min(1),
  lastSequence: z.number().int().min(1),
  status: z.enum(["active", "ended"]),
  player: z.object({ displayName: z.string() }),
  goal: z.object({ label: z.string(), description: z.string(), targetCredits: z.number().int() }),
  opponentPersona: z.object({ displayName: z.string(), senderLabel: z.string(), channel: z.literal("sms") }),
  opponent: OpponentStatusSchema,
  messages: z.array(MessageViewSchema),
  bank: z.object({
    accountLabel: z.string(),
    currency: z.literal("credits"),
    balance: z.number().int(),
    transactions: z.array(TransactionViewSchema),
  }),
  paymentRequests: z.array(PaymentRequestViewSchema),
  contacts: z.array(z.object({ contactId: Id, name: z.string(), phone: z.string(), source: z.string(), trusted: z.literal(true) })),
  verification: z.object({
    status: z.enum(["not_started", "verified"]),
    eventId: Id.nullable(),
    /** Authoritative facts; empty until verify_trusted_contact succeeds. */
    facts: z.array(z.object({ factId: Id, text: z.string() })),
  }),
  allowedActions: z.array(AllowedActionSchema),
  outcome: OutcomeViewSchema.nullable(),
  reflectionSubmitted: z.boolean(),
  checkpoint: CheckpointViewSchema,
  lineage: LineageViewSchema,
});
export type PlayerView = z.infer<typeof PlayerViewSchema>;

// ---------- responses ----------

export const SessionResponseSchema = z.object({ session: PlayerViewSchema });
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const OpponentTurnSummarySchema = z.object({
  turnId: Id,
  origin: MessageOriginSchema.exclude(["player", "scenario"]),
  fallbackReason: TurnFallbackReasonSchema.nullable(),
  appliedToolCalls: z.number().int().min(0),
  rejectedToolCalls: z.number().int().min(0),
});

export const ActionResponseSchema = z.object({
  session: PlayerViewSchema,
  result: z.object({
    status: z.enum(["applied", "duplicate"]),
    /** Events appended by the player action itself (not the opponent turn). */
    eventIds: z.array(Id),
    /** The opponent turn this action triggered, if any (null for duplicates and non-triggering actions). */
    opponentTurn: OpponentTurnSummarySchema.nullable(),
  }),
});
export type ActionResponse = z.infer<typeof ActionResponseSchema>;

// ---------- events / replay ----------

export const GameEventTypeSchema = z.enum([
  "encounter.started",
  "branch.started",
  "message.sent",
  "payment.requested",
  "payment.inspected",
  "verification.completed",
  "payment.approved",
  "ledger.debited",
  "payment.rejected",
  "payment.withdrawn",
  "encounter.ended",
  "reflection.submitted",
]);
export type GameEventType = z.infer<typeof GameEventTypeSchema>;

export const EventActorSchema = z.enum(["player", "opponent", "system"]);

export const ReplaySnapshotSchema = z.object({
  balance: z.number().int(),
  verified: z.boolean(),
  pendingRequestIds: z.array(Id),
  status: z.enum(["active", "ended"]),
  outcomeKind: OutcomeKindSchema.nullable(),
});

export const ReplayEventSchema = z.object({
  eventId: Id,
  sequence: z.number().int().min(1),
  type: GameEventTypeSchema,
  actor: EventActorSchema,
  /** Human-readable, already public (no hidden data). */
  summary: z.string(),
  /** Validated domain payload, owner-visible only. Speech events never change the ledger. */
  payload: z.record(z.string(), z.unknown()),
  actionId: z.string().nullable(),
  /** True for events copied from the parent session's prefix (fork). */
  inherited: z.boolean(),
  /** The parent event this one was copied from (fork prefix), else null. */
  sourceEventId: Id.nullable(),
  createdAt: z.iso.datetime(),
  /** State after this event, reconstructed by folding events 1..sequence. */
  snapshot: ReplaySnapshotSchema,
});
export type ReplayEvent = z.infer<typeof ReplayEventSchema>;

export const ReplayResponseSchema = z.object({
  sessionId: SessionIdSchema,
  scenarioVersion: z.number().int(),
  events: z.array(ReplayEventSchema),
  decisiveEventId: Id.nullable(),
  checkpoint: CheckpointViewSchema,
  lineage: LineageViewSchema,
  /** Server folded the stored events from the initial state and compared with the saved state. */
  reconstruction: z.object({ matchesStoredState: z.boolean(), eventCount: z.number().int(), version: z.number().int() }),
});
export type ReplayResponse = z.infer<typeof ReplayResponseSchema>;

// ---------- debrief / scoring ----------

export const ScoreItemSchema = z.object({
  skillId: z.enum(["independent_verification", "protects_funds", "disengages_safely", "explains_reasoning"]),
  label: z.string(),
  points: z.number().int().min(0),
  maxPoints: z.number().int().min(1),
  earned: z.boolean(),
  explanation: z.string(),
  /** Event ids (this session) that justify the decision. May be empty when credit is withheld for absence. */
  evidenceEventIds: z.array(Id),
});
export type ScoreItem = z.infer<typeof ScoreItemSchema>;

export const DebriefResponseSchema = z.object({
  sessionId: SessionIdSchema,
  outcome: OutcomeViewSchema,
  score: z.object({ total: z.number().int(), max: z.number().int(), items: z.array(ScoreItemSchema) }),
  decisiveEvent: z.object({ eventId: Id, sequence: z.number().int(), type: GameEventTypeSchema, summary: z.string() }),
  headline: z.string(),
  explanation: z.string(),
  saferNextAction: z.string(),
  warningSignOptions: z.array(z.object({ signId: Id, label: z.string() })),
  reflection: z.object({ submitted: z.boolean(), selectedSignIds: z.array(Id), relevantSignIds: z.array(Id) }),
  checkpoint: CheckpointViewSchema,
  lineage: LineageViewSchema,
  /** A fork is coached practice; its score is separate from the original run. */
  isPracticeBranch: z.boolean(),
});
export type DebriefResponse = z.infer<typeof DebriefResponseSchema>;

// ---------- developer evidence (tool calls, no chain-of-thought, no secrets) ----------

export const ToolCallLogSchema = z.object({
  callId: z.string(),
  name: z.string(),
  arguments: z.unknown(),
  status: z.enum(["applied", "rejected", "duplicate"]),
  rejectionReason: z.string().nullable(),
  eventIds: z.array(Id),
});

export const TurnLogSchema = z.object({
  turnId: Id,
  triggerActionId: z.string(),
  status: z.enum(["pending", "completed", "failed", "expired"]),
  origin: MessageOriginSchema.exclude(["player", "scenario"]).nullable(),
  fallbackReason: TurnFallbackReasonSchema.nullable(),
  modelId: z.string().nullable(),
  modelRequests: z.number().int().min(0),
  latencyMs: z.number().int().min(0).nullable(),
  /** Top-level observation fields that were serialized into the provider request. */
  observationFields: z.array(z.string()),
  toolCalls: z.array(ToolCallLogSchema),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type TurnLog = z.infer<typeof TurnLogSchema>;

export const DeveloperLogResponseSchema = z.object({
  sessionId: SessionIdSchema,
  turns: z.array(TurnLogSchema),
});
export type DeveloperLogResponse = z.infer<typeof DeveloperLogResponseSchema>;
