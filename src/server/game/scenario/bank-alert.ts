import { ScenarioSchema, type Scenario } from "./schema";

/**
 * The single P0 scenario: a false bank security alert. All names, numbers, and accounts are
 * fictional and non-routable. Amounts are scenario fixtures, not expected real-world losses.
 */
const bankAlert: Scenario = {
  scenarioId: "bank-alert",
  version: 1,
  seed: 7,
  title: "The urgent security alert",
  premise:
    "You've been saving toward a community garden plot. A message arrives that looks like it's from your bank. Decide what to trust.",
  fictionalNotice:
    "Training simulation. Every person, bank, number, and credit here is fictional. Never share real codes or passwords.",
  player: { displayName: "Alex" },
  goal: {
    label: "Community garden plot",
    description: "Seeds, tools, and a season's plot rental.",
    targetCredits: 1000,
  },
  account: {
    accountLabel: "Everyday checking ••••2290",
    openingBalance: 1500,
    openingTransactions: [
      { transactionId: "open-1", direction: "credit", amount: 1200, counterparty: "Paycheck", description: "Monthly pay", date: "Nov 1" },
      { transactionId: "open-2", direction: "debit", amount: 42, counterparty: "Green Thumb Supply", description: "Seed starter kit", date: "Nov 3" },
      { transactionId: "open-3", direction: "debit", amount: 18, counterparty: "Corner Café", description: "Breakfast", date: "Nov 5" },
    ],
  },
  opponentPersona: {
    displayName: "Jordan · Maple Ridge Security",
    senderLabel: "MRB-ALERT",
    channel: "sms",
  },
  opponentBrief: [
    "You play 'Jordan', a fictional caller pretending to be from Maple Ridge Bank's security team,",
    "inside a clearly labeled scam-awareness TRAINING SIMULATION. Your goal in the game is to persuade the player",
    "to approve a transfer to a so-called 'safe account' using the presentPaymentRequest tool.",
    "Pretext: you claim there was a suspicious login and that funds must be moved temporarily for protection.",
    "Use urgency and reassurance, but no threats of harm, no slurs, no real organizations, no real phone numbers or links.",
    "You do not know the player's balance, account number, or what they do in other apps. Do not invent knowledge as fact.",
    "If a request is rejected, adapt: try a different allowed recipient or amount, or a different persuasion angle, or end the encounter.",
  ].join(" "),
  openingMessage:
    "Maple Ridge Bank Security: We detected a sign-in to your account from a new device. To protect your savings, reply here so we can secure your funds right away.",
  recipients: [
    {
      recipientId: "mrb-secure-holding",
      displayName: "MRB Secure Holding",
      claimedPurpose: "Temporary safe account",
      accountLabel: "External account ••••8812",
      savedPayee: false,
      inspectionWarnings: [
        "New payee: you have never sent money here.",
        "External account at a different institution.",
        "Banks do not ask you to move money to keep it safe.",
      ],
    },
    {
      recipientId: "fraud-reversal-desk",
      displayName: "Fraud Reversal Desk",
      claimedPurpose: "Refundable verification deposit",
      accountLabel: "Prepaid wallet ••••5307",
      savedPayee: false,
      inspectionWarnings: [
        "New payee: you have never sent money here.",
        "Prepaid wallet: transfers are hard to reverse.",
        "A 'verification deposit' is not a normal bank procedure.",
      ],
    },
  ],
  paymentLimits: { min: 50, max: 1000 },
  contacts: [
    {
      contactId: "mrb-official",
      name: "Maple Ridge Bank (official line)",
      phone: "555-0100 (fictional)",
      source: "Printed on the back of your card",
    },
  ],
  verification: {
    contactId: "mrb-official",
    facts: [
      { factId: "no-suspicious-login", text: "The official line confirms there was no suspicious sign-in on your account (case VERIFY-4417)." },
      { factId: "no-safe-accounts", text: "Maple Ridge Bank never asks customers to move money to a 'safe account' or pay a verification deposit." },
      { factId: "message-not-from-bank", text: "The MRB-ALERT messages did not come from the bank. It's safe to decline and stop replying." },
    ],
  },
  privateSentinels: ["2290", "8812", "5307", "VERIFY-4417", "never asks customers to move money"],
  warningSigns: [
    { signId: "urgency", label: "Pressure to act right away", relevant: true },
    { signId: "safe-account", label: "Asked to move money to a 'safe account'", relevant: true },
    { signId: "unsolicited-contact", label: "They contacted me first, not through the bank's official line", relevant: true },
    { signId: "new-payee", label: "The payee was new and external", relevant: true },
    { signId: "polite-tone", label: "They were polite", relevant: false },
    { signId: "used-bank-name", label: "They knew my bank's name, so it must be real", relevant: false },
  ],
  checkpoint: { checkpointId: "before-payment-decision", label: "Just before you decided on the transfer" },
  limits: {
    maxOpponentTurns: 8,
    maxModelRequestsPerTurn: 3,
    maxToolCallsPerTurn: 4,
    maxOpenPaymentRequests: 1,
    turnDeadlineMs: 20000,
    maxOpponentMessageChars: 400,
  },
  debrief: {
    loss: {
      headline: "The transfer went through — and that's a lesson, not a failure.",
      explanation:
        "The message created urgency and asked you to move money to a 'safe account'. Real banks never do this, and the payee was a new external account.",
      saferNextAction: "Before acting on any security alert, contact your bank through a number you already trust, like the one on your card.",
    },
    protected: {
      headline: "You checked first and kept your garden fund safe.",
      explanation:
        "You used the bank's official line from your own contacts, learned the alert was false, and declined the transfer.",
      saferNextAction: "Keep doing exactly this: verify through a trusted channel before following financial instructions.",
    },
    safe_exit: {
      headline: "You stepped away and your money stayed put.",
      explanation:
        "Ending a pressured conversation is always allowed. You didn't confirm the claim, so you missed the chance to learn it was false.",
      saferNextAction: "Next time, also call the bank's official line from your contacts to confirm what's really going on.",
    },
  },
};

export const bankAlertScenario: Scenario = Object.freeze(ScenarioSchema.parse(bankAlert));

export function loadScenario(scenarioId: string, version?: number): Scenario {
  if (scenarioId !== bankAlertScenario.scenarioId || (version !== undefined && version !== bankAlertScenario.version)) {
    throw new Error(`Unknown scenario ${scenarioId}@${version ?? "latest"}`);
  }
  return bankAlertScenario;
}
