import { ReferenceCatalogSchema, type PrivateScenario, type ReferenceDirectoryResponse } from "@/contracts/reference";
import { OFFICIAL_RESULT } from "./canonical";

/**
 * The fictional reference catalog, validated at load. Pure data (no server-only/Node imports) so the
 * SpacetimeDB module can hold the private scenario truth too. Never import this into client components;
 * browsers get `publicDirectory()` through GET /api/observer/reference-directory.
 *
 * mobile-code-01 v1 keeps the existing canonical F06 text (OFFICIAL_RESULT) — it takes precedence over the
 * brief's example wording; any wording change requires a new immutable scenario version.
 */
export const REFERENCE_CATALOG = ReferenceCatalogSchema.parse({
  schemaVersion: "scamper-reference-v1",
  fictionalOnly: true,
  organization: { id: "cedar-mobile", displayName: "Cedar Mobile", description: "Fictional mobile provider used only for practice" },
  publicDirectory: [
    {
      id: "cedar-official-support",
      organizationId: "cedar-mobile",
      label: "Cedar Mobile — Official support",
      channel: "in_app_simulated_support",
      websiteDisplay: "support.cedar-mobile.invalid",
      emailDisplay: "support@cedar-mobile.invalid",
      phoneDisplay: "SIM-CEDAR-SUPPORT",
      destinationAction: "open_official_support_check",
    },
    {
      id: "cedar-account-portal",
      organizationId: "cedar-mobile",
      label: "Cedar Mobile — Account portal",
      channel: "in_app_simulated_portal",
      websiteDisplay: "account.cedar-mobile.invalid",
      emailDisplay: null,
      phoneDisplay: null,
      destinationAction: "open_simulated_account",
    },
  ],
  practiceProfileTemplate: {
    displayName: "Jordan Lee",
    organizationId: "cedar-mobile",
    lineSuffix: "0142",
    emailDisplay: "jordan.lee@example.invalid",
    accountLabel: "Cedar Practice Account",
    realWorldValue: false,
  },
  privateScenarios: [
    {
      id: "mobile-code-01",
      version: 1,
      kind: "fraudulent",
      senderDisplay: "Avery from Cedar Account Support",
      title: "An account message",
      requestKind: "practice_code",
      practiceCodeSource: "existing_session_generator",
      caseReferenceSource: "existing_session_generator",
      officialContactId: "cedar-official-support",
      verificationDisposition: "not_authorized",
      verificationText: OFFICIAL_RESULT,
      maxUserTurns: 12,
    },
    {
      id: "mobile-notice-01",
      version: 1,
      kind: "legitimate",
      senderDisplay: "Avery from Cedar Account Support",
      title: "An account message",
      requestKind: "notice_acknowledgment",
      officialContactId: "cedar-official-support",
      portalContactId: "cedar-account-portal",
      opening: "Hi, this is Avery from Cedar Account Support. Your new monthly statement is ready. You can view it by signing in to your Cedar account portal directly. No reply or code is needed.",
      allowedFacts: [
        "Reason for contact: a new monthly statement is available in the Cedar account portal.",
        "Account mobile line: ends in 0142.",
        "No payment, password or verification code is requested in this conversation.",
        "How to view it: sign in to the Cedar account portal directly; replying to this message is not needed.",
      ],
      verificationDisposition: "authorized_notice",
      verificationText:
        "Cedar Mobile confirms that a monthly-statement notice was issued for this practice account. Open the simulated account portal independently to review it. No code or payment is required in this conversation.",
      portalRecord: {
        id: "monthly-statement-demo",
        title: "Practice monthly statement",
        summary: "This is a fictional statement for the practice account. No payment is due in this exercise.",
        actionLabel: "Mark notice reviewed",
      },
      maxUserTurns: 12,
    },
  ],
});

export function privateScenario(id: string, version: number): PrivateScenario | null {
  return REFERENCE_CATALOG.privateScenarios.find((s) => s.id === id && s.version === version) ?? null;
}

/** Client-safe projection: public directory and practice profile only. */
export function publicDirectory(): ReferenceDirectoryResponse {
  return {
    fictionalOnly: true,
    organization: REFERENCE_CATALOG.organization,
    directory: REFERENCE_CATALOG.publicDirectory,
    profile: REFERENCE_CATALOG.practiceProfileTemplate,
  };
}
