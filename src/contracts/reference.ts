import { z } from "zod";

/**
 * Fictional reference data (backend-completion brief §3). Three separate sources:
 *  1. public directory + practice profile (client-safe; projected by the server),
 *  2. private scenario records (kind, authoritative verification result; server/module only),
 *  3. session reservations (practice code, case reference, challenges) generated per session elsewhere.
 * All names and contacts are fictional; `.invalid` values and SIM-* labels are display-only and must never
 * become clickable links or dialable numbers.
 */

const Display = z.string().min(1).max(120);

export const DirectoryEntrySchema = z.strictObject({
  id: z.enum(["cedar-official-support", "cedar-account-portal"]),
  organizationId: z.literal("cedar-mobile"),
  label: Display,
  channel: z.enum(["in_app_simulated_support", "in_app_simulated_portal"]),
  websiteDisplay: Display.regex(/\.invalid$/),
  emailDisplay: Display.regex(/@[a-z0-9.-]+\.invalid$/).nullable(),
  phoneDisplay: Display.regex(/^SIM-[A-Z-]+$/).nullable(),
  destinationAction: z.enum(["open_official_support_check", "open_simulated_account"]),
});
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;

export const PracticeProfileSchema = z.strictObject({
  displayName: Display,
  organizationId: z.literal("cedar-mobile"),
  lineSuffix: z.string().regex(/^\d{4}$/),
  emailDisplay: Display.regex(/\.invalid$/),
  accountLabel: Display,
  realWorldValue: z.literal(false),
});

export const OrganizationSchema = z.strictObject({ id: z.literal("cedar-mobile"), displayName: Display, description: z.string().max(200) });

const PrivateBase = {
  id: z.string(),
  version: z.number().int().min(1),
  senderDisplay: Display,
  title: Display,
  officialContactId: z.literal("cedar-official-support"),
  verificationText: z.string().min(1).max(400),
  maxUserTurns: z.number().int().min(1).max(30),
};

export const PortalRecordSchema = z.strictObject({ id: z.string(), title: Display, summary: z.string().max(400), actionLabel: Display });

export const PrivateScenarioSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...PrivateBase,
    kind: z.literal("fraudulent"),
    requestKind: z.literal("practice_code"),
    practiceCodeSource: z.literal("existing_session_generator"),
    caseReferenceSource: z.literal("existing_session_generator"),
    verificationDisposition: z.literal("not_authorized"),
  }),
  z.strictObject({
    ...PrivateBase,
    kind: z.literal("legitimate"),
    requestKind: z.literal("notice_acknowledgment"),
    portalContactId: z.literal("cedar-account-portal"),
    opening: z.string().min(1).max(600),
    allowedFacts: z.array(z.string().min(1).max(200)).min(1).max(8),
    verificationDisposition: z.literal("authorized_notice"),
    portalRecord: PortalRecordSchema,
  }),
]);
export type PrivateScenario = z.infer<typeof PrivateScenarioSchema>;

export const ReferenceCatalogSchema = z.strictObject({
  schemaVersion: z.literal("scamper-reference-v1"),
  fictionalOnly: z.literal(true),
  organization: OrganizationSchema,
  publicDirectory: z.array(DirectoryEntrySchema).min(1),
  practiceProfileTemplate: PracticeProfileSchema,
  privateScenarios: z.array(PrivateScenarioSchema).min(1),
});
export type ReferenceCatalog = z.infer<typeof ReferenceCatalogSchema>;

/** The only reference data a browser receives: no scenario kinds, verification results or portal records. */
export const ReferenceDirectoryResponseSchema = z.strictObject({
  fictionalOnly: z.literal(true),
  organization: OrganizationSchema,
  directory: z.array(DirectoryEntrySchema),
  profile: PracticeProfileSchema,
});
export type ReferenceDirectoryResponse = z.infer<typeof ReferenceDirectoryResponseSchema>;
