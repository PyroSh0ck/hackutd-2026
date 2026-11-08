import { z } from "zod";

/**
 * The ONLY shape the opponent model may receive about the game. Strict objects: an extra field
 * (e.g. a spread session object) fails parsing instead of reaching the provider.
 *
 * Allowed: the public pretext/persona, the player's display name, allowlisted recipients (id, name,
 * claimed purpose only), payment limits, the transcript between player and opponent (player text
 * redacted), the status of the opponent's OWN payment requests, and encounter progress.
 *
 * Never included: balance, transactions, account labels/numbers, recipient account details,
 * inspection results, trusted contacts, verification events or facts, owner identity, scoring.
 */
export const OpponentObservationSchema = z.strictObject({
  simulation: z.strictObject({
    notice: z.string(),
    brief: z.string(),
  }),
  persona: z.strictObject({ displayName: z.string(), channel: z.literal("sms") }),
  playerDisplayName: z.string(),
  allowedRecipients: z.array(z.strictObject({ recipientId: z.string(), displayName: z.string(), claimedPurpose: z.string() })),
  paymentLimits: z.strictObject({ min: z.number().int(), max: z.number().int() }),
  transcript: z.array(z.strictObject({ from: z.enum(["player", "you"]), text: z.string() })),
  yourPaymentRequests: z.array(
    z.strictObject({
      requestId: z.string(),
      recipientId: z.string(),
      amount: z.number().int(),
      status: z.enum(["pending", "approved", "rejected", "withdrawn"]),
    }),
  ),
  encounter: z.strictObject({
    status: z.enum(["active", "ended"]),
    turnNumber: z.number().int().min(1),
    turnsRemaining: z.number().int().min(0),
  }),
});

export type OpponentObservation = z.infer<typeof OpponentObservationSchema>;

/** Field names reported in the developer log ("observationFields"). */
export const OBSERVATION_FIELDS = Object.keys(OpponentObservationSchema.shape);
