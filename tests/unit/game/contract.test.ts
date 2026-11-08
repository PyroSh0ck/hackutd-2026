import { describe, expect, it } from "vitest";
import { ApiErrorResponseSchema } from "@/contracts/api-error";
import {
  ActionResponseSchema,
  CreateSessionRequestSchema,
  DebriefResponseSchema,
  DeveloperLogResponseSchema,
  ForkRequestSchema,
  PlayerViewSchema,
  ReplayResponseSchema,
  SubmitActionRequestSchema,
} from "@/contracts/game";
import * as fixtures from "@/contracts/game-fixtures";
import { bankAlertScenario } from "@/server/game/scenario/bank-alert";

const views = {
  fixtureInitialView: fixtures.fixtureInitialView,
  fixtureOpponentTypingView: fixtures.fixtureOpponentTypingView,
  fixturePaymentRequestedView: fixtures.fixturePaymentRequestedView,
  fixtureInspectedView: fixtures.fixtureInspectedView,
  fixtureVerifiedView: fixtures.fixtureVerifiedView,
  fixtureLossView: fixtures.fixtureLossView,
  fixtureForkActiveView: fixtures.fixtureForkActiveView,
  fixtureProtectedView: fixtures.fixtureProtectedView,
  fixtureFallbackView: fixtures.fixtureFallbackView,
};

describe("G0 contract: fixtures match schemas", () => {
  it.each(Object.entries(views))("%s parses as PlayerView", (_name, view) => {
    expect(() => PlayerViewSchema.parse(view)).not.toThrow();
  });

  it("action, replay, debrief, developer and error fixtures parse", () => {
    ActionResponseSchema.parse(fixtures.fixtureActionResponse);
    ReplayResponseSchema.parse(fixtures.fixtureLossReplay);
    DebriefResponseSchema.parse(fixtures.fixtureLossDebrief);
    DebriefResponseSchema.parse(fixtures.fixtureProtectedDebrief);
    DeveloperLogResponseSchema.parse(fixtures.fixtureDeveloperLog);
    for (const error of Object.values(fixtures.fixtureErrors)) ApiErrorResponseSchema.parse(error.body);
  });
});

describe("G0 contract: no private data before disclosure", () => {
  const serialized = (value: unknown) => JSON.stringify(value);
  const factTexts = bankAlertScenario.verification.facts.map((fact) => fact.text);

  it("never includes the opponent brief/prompt in any fixture", () => {
    expect(serialized(fixtures)).not.toContain(bankAlertScenario.opponentBrief.slice(0, 60));
  });

  it("unverified views carry no authoritative facts", () => {
    for (const view of Object.values(views).filter((v) => v.verification.status !== "verified")) {
      for (const text of factTexts) expect(serialized(view)).not.toContain(text);
    }
  });

  it("uninspected requests carry no recipient account details", () => {
    for (const view of Object.values(views)) {
      for (const request of view.paymentRequests.filter((r) => !r.inspected)) {
        expect(request.inspection).toBeNull();
      }
    }
    expect(serialized(fixtures.fixturePaymentRequestedView)).not.toContain("8812");
  });

  it("no fixture names an owner identity", () => {
    expect(serialized(fixtures)).not.toMatch(/ownerId|ownerKey|playerKey/);
  });
});

describe("G0 contract: requests reject unknown and reserved input", () => {
  const base = { actionId: "11111111-1111-4111-8111-111111111111", expectedVersion: 1 };

  it("accepts each valid player action", () => {
    for (const action of [
      { type: "send_message", text: "hello" },
      { type: "inspect_payment", requestId: "req-5" },
      { type: "verify_trusted_contact", contactId: "mrb-official" },
      { type: "approve_payment", requestId: "req-5" },
      { type: "reject_payment", requestId: "req-5" },
      { type: "end_encounter" },
      { type: "submit_reflection", warningSignIds: ["urgency"] },
    ]) {
      expect(SubmitActionRequestSchema.safeParse({ ...base, action }).success).toBe(true);
    }
  });

  it.each([
    ["ownerId at top level", { ...base, ownerId: "x", action: { type: "end_encounter" } }],
    ["balance in action", { ...base, action: { type: "approve_payment", requestId: "req-5", balance: 9999 } }],
    ["amount on approve", { ...base, action: { type: "approve_payment", requestId: "req-5", amount: 1 } }],
    ["client-submitted event", { ...base, action: { type: "ledger.debited", amount: 500 } }],
    ["missing actionId", { expectedVersion: 1, action: { type: "end_encounter" } }],
    ["non-uuid actionId", { ...base, actionId: "abc", action: { type: "end_encounter" } }],
    ["version 0", { ...base, expectedVersion: 0, action: { type: "end_encounter" } }],
    ["blank message", { ...base, action: { type: "send_message", text: "   " } }],
    ["oversized message", { ...base, action: { type: "send_message", text: "x".repeat(501) } }],
  ])("rejects %s", (_label, body) => {
    expect(SubmitActionRequestSchema.safeParse(body).success).toBe(false);
  });

  it("create/fork requests are strict", () => {
    expect(CreateSessionRequestSchema.parse({})).toEqual({ scenarioId: "bank-alert", opponentMode: "live" });
    expect(CreateSessionRequestSchema.safeParse({ ownerId: "x" }).success).toBe(false);
    expect(CreateSessionRequestSchema.safeParse({ scenarioId: "delivery-fee" }).success).toBe(false);
    expect(ForkRequestSchema.safeParse({ checkpointId: "before-payment-decision", sequence: 3 }).success).toBe(false);
    expect(ForkRequestSchema.safeParse({ checkpointId: "anything" }).success).toBe(false);
  });
});
