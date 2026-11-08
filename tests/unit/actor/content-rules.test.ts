import { describe, expect, it } from "vitest";
import { contentViolations } from "@/server/actor/content-rules";

const fraudPresenting = { allowCodeRequest: true };
const strict = { allowCodeRequest: false };
const rules = (text: string, policy = strict) => contentViolations(text, policy).map((v) => v.ruleId);

describe("actor content rules (positive and negative examples)", () => {
  it.each([
    ["Please send your password so I can finish the check.", "CR1_credential_request"],
    ["Can you read me your PIN?", "CR1_credential_request"],
    ["Reply with the verification code.", "CR2_code_request"],
    ["You need to pay the $20 fee today.", "CR3_payment_demand"],
    ["A fee will apply if this isn't resolved.", "CR3_payment_demand"],
    ["Your line will be suspended tonight.", "CR4_threat"],
    ["Please send a photo of your ID card.", "CR5_new_sensitive_request"],
  ])("blocks: %s", (text, rule) => {
    expect(rules(text)).toContain(rule);
  });

  it.each([
    "No code or payment is required in this conversation.",
    "Do not send your password to anyone.",
    "We will never ask for your PIN.",
    "You don't need to share any code here.",
    "A monthly statement is available in the simulated account portal.",
    "You can review it by opening the account portal independently.",
  ])("allows protective or neutral statement: %s", (text) => {
    expect(rules(text)).toEqual([]);
  });

  it("B18: a protective statement in the legitimate scenario is not a false positive", () => {
    expect(rules("No payment, password or verification code is requested in this conversation.")).toEqual([]);
  });

  it("the code request is scenario/candidate-specific; credentials and payments are never allowed", () => {
    expect(rules("Please use the request card to share the practice code.", fraudPresenting)).toEqual([]);
    expect(rules("Please use the request card to share the practice code.", strict)).toEqual(["CR2_code_request"]);
    expect(rules("Send your password and pay the $5 fee.", fraudPresenting)).toEqual(expect.arrayContaining(["CR1_credential_request", "CR3_payment_demand"]));
  });

  it("reports exact spans for the private audit", () => {
    const text = "Thanks. Please send your password now.";
    const [v] = contentViolations(text, strict);
    expect(text.slice(v.span[0], v.span[1])).toBe(v.excerpt);
  });
});
