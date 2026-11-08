import type { ApiErrorResponse } from "./api-error";
import type {
  ActionResponse,
  DebriefResponse,
  DeveloperLogResponse,
  MessageView,
  PaymentRequestView,
  PlayerView,
  ReplayEvent,
  ReplayResponse,
} from "./game";

export type ApiErrorFixture = { status: number; body: ApiErrorResponse };

/**
 * Representative PUBLIC player-facing payloads for UI work against fixtures (no server needed).
 * Every fixture is validated against the contract schemas in tests/unit/game/contract.test.ts,
 * which also asserts no private server value (opponent prompt, hidden facts before verification,
 * recipient account details before inspection) appears where the player could not yet see it.
 *
 * Story: Alex gets a fake security alert, the opponent requests 500 credits to "MRB Secure Holding".
 * - fixtureInitialView: opening message only.
 * - fixturePaymentRequestedView: live opponent asked for the transfer (not yet inspected).
 * - fixtureInspectedView: request inspected (warnings visible), approve now allowed.
 * - fixtureVerifiedView: player called the official line; authoritative facts revealed.
 * - fixtureLossView: approved -> 500 debited -> encounter ended (loss). Checkpoint available.
 * - fixtureForkActiveView: fork of the loss run at the checkpoint; request pending again.
 * - fixtureProtectedView: fork after verify + reject + end (protected).
 * - fixtureFallbackView: provider unavailable; labeled scripted fallback reply.
 */

export const FIXTURE_SESSION_ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
export const FIXTURE_FORK_SESSION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const t = (minute: number, second = 0) => `2026-11-07T15:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`;

const opening: MessageView = {
  messageId: "msg-2",
  eventId: "evt-0002",
  sequence: 2,
  from: "opponent",
  text: "Maple Ridge Bank Security: We detected a sign-in to your account from a new device. To protect your savings, reply here so we can secure your funds right away.",
  origin: "scenario",
  createdAt: t(0),
};
const playerReply: MessageView = {
  messageId: "msg-3",
  eventId: "evt-0003",
  sequence: 3,
  from: "player",
  text: "Oh no. What do I need to do?",
  origin: "player",
  createdAt: t(1),
};
const opponentAsk: MessageView = {
  messageId: "msg-4",
  eventId: "evt-0004",
  sequence: 4,
  from: "opponent",
  text: "Thanks for responding quickly, Alex. I've prepared a transfer of 500 credits to our temporary safe account. Please approve it in your banking app within 10 minutes.",
  origin: "live_model",
  createdAt: t(1, 6),
};

const requestPending: PaymentRequestView = {
  requestId: "req-5",
  eventId: "evt-0005",
  amount: 500,
  status: "pending",
  recipient: { recipientId: "mrb-secure-holding", displayName: "MRB Secure Holding", claimedPurpose: "Temporary safe account" },
  inspected: false,
  inspection: null,
  origin: "live_model",
};
const inspection = {
  accountLabel: "External account ••••8812",
  savedPayee: false,
  warnings: [
    "New payee: you have never sent money here.",
    "External account at a different institution.",
    "Banks do not ask you to move money to keep it safe.",
  ],
};

const facts = [
  { factId: "no-suspicious-login", text: "The official line confirms there was no suspicious sign-in on your account (case VERIFY-4417)." },
  { factId: "no-safe-accounts", text: "Maple Ridge Bank never asks customers to move money to a 'safe account' or pay a verification deposit." },
  { factId: "message-not-from-bank", text: "The MRB-ALERT messages did not come from the bank. It's safe to decline and stop replying." },
];

const openingTransactions = [
  { transactionId: "open-1", eventId: null, direction: "credit" as const, amount: 1200, counterparty: "Paycheck", description: "Monthly pay", date: "Nov 1" },
  { transactionId: "open-2", eventId: null, direction: "debit" as const, amount: 42, counterparty: "Green Thumb Supply", description: "Seed starter kit", date: "Nov 3" },
  { transactionId: "open-3", eventId: null, direction: "debit" as const, amount: 18, counterparty: "Corner Café", description: "Breakfast", date: "Nov 5" },
];

const checkpointUnavailable = { checkpointId: "before-payment-decision" as const, label: "Just before you decided on the transfer", available: false, sequence: null, eventId: null };
const noLineage = { parentSessionId: null, checkpointId: null, checkpointEventId: null, inheritedEventCount: 0, forkSessionIds: [] };

export const fixtureInitialView: PlayerView = {
  contractVersion: 1,
  sessionId: FIXTURE_SESSION_ID,
  scenario: {
    scenarioId: "bank-alert",
    version: 1,
    title: "The urgent security alert",
    premise: "You've been saving toward a community garden plot. A message arrives that looks like it's from your bank. Decide what to trust.",
    fictionalNotice: "Training simulation. Every person, bank, number, and credit here is fictional. Never share real codes or passwords.",
  },
  version: 1,
  lastSequence: 2,
  status: "active",
  player: { displayName: "Alex" },
  goal: { label: "Community garden plot", description: "Seeds, tools, and a season's plot rental.", targetCredits: 1000 },
  opponentPersona: { displayName: "Jordan · Maple Ridge Security", senderLabel: "MRB-ALERT", channel: "sms" },
  opponent: { mode: "live", pendingTurn: null, lastTurn: null, turnsUsed: 0, turnLimit: 8 },
  messages: [opening],
  bank: { accountLabel: "Everyday checking ••••2290", currency: "credits", balance: 1500, transactions: openingTransactions },
  paymentRequests: [],
  contacts: [{ contactId: "mrb-official", name: "Maple Ridge Bank (official line)", phone: "555-0100 (fictional)", source: "Printed on the back of your card", trusted: true }],
  verification: { status: "not_started", eventId: null, facts: [] },
  allowedActions: [{ type: "send_message" }, { type: "verify_trusted_contact", contactId: "mrb-official" }, { type: "end_encounter" }],
  outcome: null,
  reflectionSubmitted: false,
  checkpoint: checkpointUnavailable,
  lineage: noLineage,
};

/** Shown while the opponent turn is in flight (typing indicator; keep bank/contacts usable). */
export const fixtureOpponentTypingView: PlayerView = {
  ...fixtureInitialView,
  version: 2,
  lastSequence: 3,
  messages: [opening, playerReply],
  opponent: {
    ...fixtureInitialView.opponent,
    pendingTurn: { turnId: "turn-1", startedAt: t(1), expiresAt: t(1, 20) },
  },
  allowedActions: [{ type: "verify_trusted_contact", contactId: "mrb-official" }, { type: "end_encounter" }],
};

export const fixturePaymentRequestedView: PlayerView = {
  ...fixtureInitialView,
  version: 4,
  lastSequence: 5,
  messages: [opening, playerReply, opponentAsk],
  opponent: { ...fixtureInitialView.opponent, lastTurn: { turnId: "turn-1", origin: "live_model", fallbackReason: null }, turnsUsed: 1 },
  paymentRequests: [requestPending],
  allowedActions: [
    { type: "send_message" },
    { type: "inspect_payment", requestId: "req-5" },
    { type: "verify_trusted_contact", contactId: "mrb-official" },
    { type: "reject_payment", requestId: "req-5" },
    { type: "end_encounter" },
  ],
};

export const fixtureInspectedView: PlayerView = {
  ...fixturePaymentRequestedView,
  version: 5,
  lastSequence: 6,
  paymentRequests: [{ ...requestPending, inspected: true, inspection }],
  allowedActions: [
    { type: "send_message" },
    { type: "verify_trusted_contact", contactId: "mrb-official" },
    { type: "approve_payment", requestId: "req-5" },
    { type: "reject_payment", requestId: "req-5" },
    { type: "end_encounter" },
  ],
};

export const fixtureVerifiedView: PlayerView = {
  ...fixtureInspectedView,
  version: 6,
  lastSequence: 7,
  verification: { status: "verified", eventId: "evt-0007", facts },
  allowedActions: [
    { type: "send_message" },
    { type: "approve_payment", requestId: "req-5" },
    { type: "reject_payment", requestId: "req-5" },
    { type: "end_encounter" },
  ],
};

export const fixtureLossView: PlayerView = {
  ...fixtureInspectedView,
  version: 6,
  lastSequence: 9,
  status: "ended",
  bank: {
    ...fixtureInitialView.bank,
    balance: 1000,
    transactions: [
      { transactionId: "txn-8", eventId: "evt-0008", direction: "debit", amount: 500, counterparty: "MRB Secure Holding", description: "Transfer you approved", date: "Today" },
      ...openingTransactions,
    ],
  },
  paymentRequests: [{ ...requestPending, inspected: true, inspection, status: "approved" }],
  allowedActions: [{ type: "submit_reflection" }],
  outcome: { kind: "loss", fundsLost: true, amountLost: 500, secretDisclosed: false, verified: false, endedReason: "payment_approved", decisiveEventId: "evt-0007" },
  checkpoint: { ...checkpointUnavailable, available: true, sequence: 6, eventId: "evt-0006" },
  lineage: { ...noLineage, forkSessionIds: [] },
};

/** Fork of the loss run: events 1..6 copied (fresh ids), then branch.started at 7. */
export const fixtureForkActiveView: PlayerView = {
  ...fixtureInspectedView,
  sessionId: FIXTURE_FORK_SESSION_ID,
  version: 1,
  lastSequence: 7,
  lineage: { parentSessionId: FIXTURE_SESSION_ID, checkpointId: "before-payment-decision", checkpointEventId: "evt-0006", inheritedEventCount: 6, forkSessionIds: [] },
};

/** Fork continued: verify (8), reject (9), opponent adapts (10), player ends (11). */
export const fixtureProtectedView: PlayerView = {
  ...fixtureForkActiveView,
  version: 5,
  lastSequence: 11,
  messages: [
    ...fixtureForkActiveView.messages,
    { messageId: "msg-10", eventId: "evt-f010", sequence: 10, from: "opponent", text: "I understand the hesitation. If the full amount feels like a lot, a smaller 200-credit verification deposit works too.", origin: "live_model", createdAt: t(6) },
  ],
  opponent: { ...fixtureForkActiveView.opponent, lastTurn: { turnId: "turn-f1", origin: "live_model", fallbackReason: null }, turnsUsed: 2 },
  status: "ended",
  verification: { status: "verified", eventId: "evt-f008", facts },
  paymentRequests: [{ ...requestPending, inspected: true, inspection, status: "rejected" }],
  allowedActions: [{ type: "submit_reflection" }],
  outcome: { kind: "protected", fundsLost: false, amountLost: 0, secretDisclosed: false, verified: true, endedReason: "player_ended", decisiveEventId: "evt-f011" },
  checkpoint: { ...checkpointUnavailable, available: true, sequence: 8, eventId: "evt-f008" },
};

/** Provider down: reply is a clearly labeled scripted fallback. UI must label it as such. */
export const fixtureFallbackView: PlayerView = {
  ...fixturePaymentRequestedView,
  messages: [opening, playerReply, { ...opponentAsk, origin: "scripted_fallback", text: "Thank you, Alex. To keep your savings protected, approve the 500-credit transfer to our temporary safe account now." }],
  paymentRequests: [{ ...requestPending, origin: "scripted_fallback" }],
  opponent: { ...fixturePaymentRequestedView.opponent, lastTurn: { turnId: "turn-1", origin: "scripted_fallback", fallbackReason: "provider_unconfigured" } },
};

export const fixtureActionResponse: ActionResponse = {
  session: fixturePaymentRequestedView,
  result: {
    status: "applied",
    eventIds: ["evt-0003"],
    opponentTurn: { turnId: "turn-1", origin: "live_model", fallbackReason: null, appliedToolCalls: 2, rejectedToolCalls: 0 },
  },
};

const snapshot = (balance: number, pending: string[], status: "active" | "ended" = "active", outcomeKind: "loss" | "protected" | "safe_exit" | null = null, verified = false) => ({
  balance,
  verified,
  pendingRequestIds: pending,
  status,
  outcomeKind,
});

const lossEvents: ReplayEvent[] = [
  { eventId: "evt-0001", sequence: 1, type: "encounter.started", actor: "system", summary: "Encounter started (bank-alert v1).", payload: { scenarioId: "bank-alert", scenarioVersion: 1 }, actionId: null, inherited: false, sourceEventId: null, createdAt: t(0), snapshot: snapshot(1500, []) },
  { eventId: "evt-0002", sequence: 2, type: "message.sent", actor: "opponent", summary: "Opening alert from MRB-ALERT.", payload: { messageId: "msg-2", from: "opponent", origin: "scenario" }, actionId: null, inherited: false, sourceEventId: null, createdAt: t(0), snapshot: snapshot(1500, []) },
  { eventId: "evt-0003", sequence: 3, type: "message.sent", actor: "player", summary: "You replied.", payload: { messageId: "msg-3", from: "player", origin: "player" }, actionId: "11111111-1111-4111-8111-111111111111", inherited: false, sourceEventId: null, createdAt: t(1), snapshot: snapshot(1500, []) },
  { eventId: "evt-0004", sequence: 4, type: "message.sent", actor: "opponent", summary: "Opponent message (live model).", payload: { messageId: "msg-4", from: "opponent", origin: "live_model" }, actionId: "turn:turn-1:call-a", inherited: false, sourceEventId: null, createdAt: t(1, 6), snapshot: snapshot(1500, []) },
  { eventId: "evt-0005", sequence: 5, type: "payment.requested", actor: "opponent", summary: "Opponent requested 500 credits to MRB Secure Holding.", payload: { requestId: "req-5", recipientId: "mrb-secure-holding", amount: 500, origin: "live_model" }, actionId: "turn:turn-1:call-b", inherited: false, sourceEventId: null, createdAt: t(1, 6), snapshot: snapshot(1500, ["req-5"]) },
  { eventId: "evt-0006", sequence: 6, type: "payment.inspected", actor: "player", summary: "You inspected the payment request.", payload: { requestId: "req-5" }, actionId: "22222222-2222-4222-8222-222222222222", inherited: false, sourceEventId: null, createdAt: t(2), snapshot: snapshot(1500, ["req-5"]) },
  { eventId: "evt-0007", sequence: 7, type: "payment.approved", actor: "player", summary: "You approved the transfer.", payload: { requestId: "req-5" }, actionId: "33333333-3333-4333-8333-333333333333", inherited: false, sourceEventId: null, createdAt: t(3), snapshot: snapshot(1500, []) },
  { eventId: "evt-0008", sequence: 8, type: "ledger.debited", actor: "system", summary: "500 credits left your checking account.", payload: { transactionId: "txn-8", requestId: "req-5", recipientId: "mrb-secure-holding", amount: 500 }, actionId: "33333333-3333-4333-8333-333333333333", inherited: false, sourceEventId: null, createdAt: t(3), snapshot: snapshot(1000, []) },
  { eventId: "evt-0009", sequence: 9, type: "encounter.ended", actor: "system", summary: "Encounter ended: loss.", payload: { reason: "payment_approved", outcome: "loss" }, actionId: "33333333-3333-4333-8333-333333333333", inherited: false, sourceEventId: null, createdAt: t(3), snapshot: snapshot(1000, [], "ended", "loss") },
];

export const fixtureLossReplay: ReplayResponse = {
  sessionId: FIXTURE_SESSION_ID,
  scenarioVersion: 1,
  events: lossEvents,
  decisiveEventId: "evt-0007",
  checkpoint: fixtureLossView.checkpoint,
  lineage: fixtureLossView.lineage,
  reconstruction: { matchesStoredState: true, eventCount: 9, version: 6 },
};

const warningSignOptions = [
  { signId: "urgency", label: "Pressure to act right away" },
  { signId: "safe-account", label: "Asked to move money to a 'safe account'" },
  { signId: "unsolicited-contact", label: "They contacted me first, not through the bank's official line" },
  { signId: "new-payee", label: "The payee was new and external" },
  { signId: "polite-tone", label: "They were polite" },
  { signId: "used-bank-name", label: "They knew my bank's name, so it must be real" },
];

export const fixtureLossDebrief: DebriefResponse = {
  sessionId: FIXTURE_SESSION_ID,
  outcome: fixtureLossView.outcome!,
  score: {
    total: 0,
    max: 100,
    items: [
      { skillId: "independent_verification", label: "Independent verification", points: 0, maxPoints: 40, earned: false, explanation: "You didn't contact the bank through your trusted contacts before the transfer.", evidenceEventIds: ["evt-0007"] },
      { skillId: "protects_funds", label: "Protects funds", points: 0, maxPoints: 30, earned: false, explanation: "500 credits were transferred to MRB Secure Holding.", evidenceEventIds: ["evt-0008"] },
      { skillId: "disengages_safely", label: "Disengages safely", points: 0, maxPoints: 20, earned: false, explanation: "The request was approved before you declined or ended the conversation.", evidenceEventIds: ["evt-0007"] },
      { skillId: "explains_reasoning", label: "Explains reasoning", points: 0, maxPoints: 10, earned: false, explanation: "Optional: pick the warning signs you noticed.", evidenceEventIds: [] },
    ],
  },
  decisiveEvent: { eventId: "evt-0007", sequence: 7, type: "payment.approved", summary: "You approved the transfer." },
  headline: "The transfer went through — and that's a lesson, not a failure.",
  explanation: "The message created urgency and asked you to move money to a 'safe account'. Real banks never do this, and the payee was a new external account.",
  saferNextAction: "Before acting on any security alert, contact your bank through a number you already trust, like the one on your card.",
  warningSignOptions,
  reflection: { submitted: false, selectedSignIds: [], relevantSignIds: [] },
  checkpoint: fixtureLossView.checkpoint,
  lineage: fixtureLossView.lineage,
  isPracticeBranch: false,
};

export const fixtureProtectedDebrief: DebriefResponse = {
  sessionId: FIXTURE_FORK_SESSION_ID,
  outcome: fixtureProtectedView.outcome!,
  score: {
    total: 90,
    max: 100,
    items: [
      { skillId: "independent_verification", label: "Independent verification", points: 40, maxPoints: 40, earned: true, explanation: "You called the official line from your contacts before deciding.", evidenceEventIds: ["evt-f008"] },
      { skillId: "protects_funds", label: "Protects funds", points: 30, maxPoints: 30, earned: true, explanation: "No transfer left your account.", evidenceEventIds: [] },
      { skillId: "disengages_safely", label: "Disengages safely", points: 20, maxPoints: 20, earned: true, explanation: "You declined the request.", evidenceEventIds: ["evt-f009"] },
      { skillId: "explains_reasoning", label: "Explains reasoning", points: 0, maxPoints: 10, earned: false, explanation: "Optional: pick the warning signs you noticed.", evidenceEventIds: [] },
    ],
  },
  decisiveEvent: { eventId: "evt-f011", sequence: 11, type: "encounter.ended", summary: "Encounter ended: protected." },
  headline: "You checked first and kept your garden fund safe.",
  explanation: "You used the bank's official line from your own contacts, learned the alert was false, and declined the transfer.",
  saferNextAction: "Keep doing exactly this: verify through a trusted channel before following financial instructions.",
  warningSignOptions,
  reflection: { submitted: false, selectedSignIds: [], relevantSignIds: [] },
  checkpoint: fixtureProtectedView.checkpoint,
  lineage: fixtureProtectedView.lineage,
  isPracticeBranch: true,
};

export const fixtureDeveloperLog: DeveloperLogResponse = {
  sessionId: FIXTURE_SESSION_ID,
  turns: [
    {
      turnId: "turn-1",
      triggerActionId: "11111111-1111-4111-8111-111111111111",
      status: "completed",
      origin: "live_model",
      fallbackReason: null,
      modelId: "example/model-id",
      modelRequests: 2,
      latencyMs: 2140,
      observationFields: ["simulation", "persona", "playerDisplayName", "allowedRecipients", "paymentLimits", "transcript", "yourPaymentRequests", "encounter"],
      toolCalls: [
        { callId: "call-a", name: "sendSimulatedMessage", arguments: { text: "Thanks for responding quickly, Alex…" }, status: "applied", rejectionReason: null, eventIds: ["evt-0004"] },
        { callId: "call-b", name: "presentPaymentRequest", arguments: { recipientId: "mrb-secure-holding", amount: 500 }, status: "applied", rejectionReason: null, eventIds: ["evt-0005"] },
      ],
      startedAt: t(1),
      completedAt: t(1, 6),
    },
  ],
};

/** Error envelope examples the UI must handle. */
export const fixtureErrors: Record<"versionConflict" | "rejected" | "idempotencyConflict" | "notFound", ApiErrorFixture> = {
  versionConflict: { status: 409, body: { error: { code: "VERSION_CONFLICT", message: "This session changed. Refresh and try again.", currentVersion: 5 }, requestId: "req-fixture-1" } },
  rejected: { status: 422, body: { error: { code: "ACTION_REJECTED", message: "Inspect the payment request before approving it.", reason: "PAYMENT_NOT_INSPECTED" }, requestId: "req-fixture-2" } },
  idempotencyConflict: { status: 409, body: { error: { code: "IDEMPOTENCY_CONFLICT", message: "This action id was already used for a different action." }, requestId: "req-fixture-3" } },
  notFound: { status: 404, body: { error: { code: "NOT_FOUND", message: "Game session not found." }, requestId: "req-fixture-4" } },
};
