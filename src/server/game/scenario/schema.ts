import { z } from "zod";

/**
 * Server-only scenario fixture schema. Fields under `private*` and `verification` are NEVER sent to
 * the opponent model. The player view may show some of them only after the relevant player action
 * (see engine/view.ts). This module is pure (no server-only import) so unit tests can load it.
 */

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const Credits = z.number().int();

export const ScenarioSchema = z.strictObject({
  scenarioId: z.literal("bank-alert"),
  version: z.number().int().min(1),
  seed: z.number().int(),
  title: z.string(),
  premise: z.string(),
  fictionalNotice: z.string(),
  player: z.strictObject({ displayName: z.string() }),
  goal: z.strictObject({ label: z.string(), description: z.string(), targetCredits: Credits }),
  account: z.strictObject({
    accountLabel: z.string(),
    openingBalance: Credits.min(0),
    openingTransactions: z.array(
      z.strictObject({
        transactionId: Id,
        direction: z.enum(["debit", "credit"]),
        amount: Credits.min(1),
        counterparty: z.string(),
        description: z.string(),
        date: z.string(),
      }),
    ),
  }),
  opponentPersona: z.strictObject({ displayName: z.string(), senderLabel: z.string(), channel: z.literal("sms") }),
  /** Public pretext the opponent may use. Contains no private player data. */
  opponentBrief: z.string(),
  openingMessage: z.string(),
  recipients: z
    .array(
      z.strictObject({
        recipientId: Id,
        displayName: z.string(),
        claimedPurpose: z.string(),
        /** Revealed to the player on inspect. Not given to the opponent. */
        accountLabel: z.string(),
        savedPayee: z.boolean(),
        inspectionWarnings: z.array(z.string()).min(1),
      }),
    )
    .min(1),
  paymentLimits: z.strictObject({ min: Credits.min(1), max: Credits.min(1) }),
  contacts: z
    .array(z.strictObject({ contactId: Id, name: z.string(), phone: z.string(), source: z.string() }))
    .min(1),
  /** Authoritative facts revealed to the PLAYER by verify_trusted_contact. Never to the opponent. */
  verification: z.strictObject({
    contactId: Id,
    facts: z.array(z.strictObject({ factId: Id, text: z.string() })).min(1),
  }),
  /** Private sentinels: values that must never appear in any model payload. */
  privateSentinels: z.array(z.string().min(4)).min(1),
  warningSigns: z.array(z.strictObject({ signId: Id, label: z.string(), relevant: z.boolean() })).min(2),
  checkpoint: z.strictObject({ checkpointId: z.literal("before-payment-decision"), label: z.string() }),
  limits: z.strictObject({
    maxOpponentTurns: z.number().int().min(1).max(20),
    maxModelRequestsPerTurn: z.number().int().min(1).max(5),
    maxToolCallsPerTurn: z.number().int().min(1).max(8),
    maxOpenPaymentRequests: z.literal(1),
    turnDeadlineMs: z.number().int().min(1000).max(60000),
    maxOpponentMessageChars: z.number().int().min(50).max(600),
  }),
  debrief: z.strictObject({
    loss: z.strictObject({ headline: z.string(), explanation: z.string(), saferNextAction: z.string() }),
    protected: z.strictObject({ headline: z.string(), explanation: z.string(), saferNextAction: z.string() }),
    safe_exit: z.strictObject({ headline: z.string(), explanation: z.string(), saferNextAction: z.string() }),
  }),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
