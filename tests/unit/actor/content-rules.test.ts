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
    "A new monthly statement is available in the Cedar account portal.",
    "You can review it by opening the account portal independently.",
  ])("allows protective or neutral statement: %s", (text) => {
    expect(rules(text)).toEqual([]);
  });

  it("B18: a protective statement in the legitimate scenario is not a false positive", () => {
    expect(rules("No payment, password or verification code is requested in this conversation.")).toEqual([]);
  });

  it("the code request is scenario/candidate-specific; credentials and payments are never allowed", () => {
    expect(rules("Please share the six-digit code we texted to your phone.", fraudPresenting)).toEqual([]);
    expect(rules("Please share the six-digit code we texted to your phone.", strict)).toEqual(["CR2_code_request"]);
    expect(rules("Send your password and pay the $5 fee.", fraudPresenting)).toEqual(expect.arrayContaining(["CR1_credential_request", "CR3_payment_demand"]));
  });

  it("reports exact spans for the private audit", () => {
    const text = "Thanks. Please send your password now.";
    const [v] = contentViolations(text, strict);
    expect(text.slice(v.span[0], v.span[1])).toBe(v.excerpt);
  });

  // Manual testing: the sender narrated the app ("use the request card", "Verify independently control").
  it.each([
    "You can choose to Verify independently or End practice.",
    "The simulator shows a request card for the practice code.",
    "This is about the security check on your practice line.",
    "Please don't use the request card yet.",
    "Tap the button below to continue.",
    "You can check through the app's support check.",
    "Can you provide the six-digit code texted to your phone F03 F04",
  ])("CR6 flags out-of-character app/simulation references, negated or not: %s", (text) => {
    expect(rules(text, fraudPresenting)).toContain("CR6_breaks_character");
  });

  it.each(["Your mobile line ends in 0142.", "It's a routine security check and only takes a minute.", "I can't share more detail than that.", "Please share the six-digit code we texted to your phone."])(
    "CR6 leaves in-character dialogue alone: %s",
    (text) => {
      expect(rules(text, fraudPresenting)).not.toContain("CR6_breaks_character");
    },
  );
});
