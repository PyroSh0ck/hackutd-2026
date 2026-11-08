import { describe, expect, it } from "vitest";
import { ReferenceDirectoryResponseSchema } from "@/contracts/reference";
import { privateScenario, publicDirectory, REFERENCE_CATALOG } from "@/server/reference/catalog";
import { MOBILE_CODE_SCENARIO, OFFICIAL_RESULT } from "@/server/planner/scenario";
import { DETERMINISTIC_TEST_RESERVATIONS, fixedReservationRandom } from "../../fixtures/reference";

describe("fictional reference catalog", () => {
  it("validates, and keeps the canonical v1 official result for mobile-code-01", () => {
    expect(REFERENCE_CATALOG.fictionalOnly).toBe(true);
    expect(privateScenario("mobile-code-01", 1)?.verificationText).toBe(OFFICIAL_RESULT);
    expect(MOBILE_CODE_SCENARIO.officialResult).toBe(OFFICIAL_RESULT);
  });

  it("the public projection carries no scenario kind, verification result or portal record", () => {
    const pub = publicDirectory();
    expect(ReferenceDirectoryResponseSchema.parse(pub)).toEqual(pub);
    const text = JSON.stringify(pub);
    for (const secret of ["fraudulent", "legitimate", "not_authorized", "authorized_notice", OFFICIAL_RESULT, "monthly-statement-demo", "privateScenarios"]) expect(text).not.toContain(secret);
  });

  it("contacts are display-only fictional labels (no http, mailto or tel)", () => {
    const text = JSON.stringify(publicDirectory());
    expect(text).not.toMatch(/https?:|mailto:|tel:/);
    for (const e of publicDirectory().directory) expect(e.websiteDisplay.endsWith(".invalid")).toBe(true);
  });

  it("deterministic test reservations reproduce through the existing generator's injectable random source", () => {
    expect(MOBILE_CODE_SCENARIO.reserve(fixedReservationRandom())).toEqual({ practiceCode: DETERMINISTIC_TEST_RESERVATIONS.practiceCode, caseReference: DETERMINISTIC_TEST_RESERVATIONS.caseReference });
  });
});
