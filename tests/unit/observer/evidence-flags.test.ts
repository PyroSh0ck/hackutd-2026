import { describe, expect, it } from "vitest";
import type { ObserverAssessment, ReviewFlag } from "@/contracts/observer";
import { contextFor, validateCandidate } from "@/server/observer/evidence";
import { contradictionFlags, normalizeForScan, PATTERNS, policyFlags, reviewFlags } from "@/server/observer/flags";
import { assessment, deepFreeze, INTRO, inputFor, msg } from "./fixtures";

const codesOf = (flags: ReviewFlag[]) => flags.map((f) => f.code).sort();

describe("Stage 2: evidence references", () => {
  const history = [msg("m-1", "user", "Who is this?", 1), msg("m-2", "assistant", "Security desk. Yes, send the code now.", 1)];
  const input = inputFor("I won’t send the code. Sí, lo enviaré 👍 if needed, send send.", { history });
  const ctx = contextFor(input);
  const withEvidence = (messageId: string, quote: string, label: ObserverAssessment["decision"]["label"] = "refused"): ObserverAssessment => ({
    ...assessment(input, label, null),
    decision: { label, evidence: [{ messageId, quote }] },
  });
  const run = (a: unknown) => validateCandidate(a, ctx);

  it("accepts an exact substring with the original curly apostrophe", () => {
    expect(run(withEvidence("m-cur", "I won’t send the code")).errors).toEqual([]);
  });
  it("rejects a quote whose apostrophe was normalized (no rewriting to pass)", () => {
    expect(run(withEvidence("m-cur", "I won't send the code")).errors).toContainEqual(expect.objectContaining({ code: "quote_not_found" }));
  });
  it("is case-preserving", () => {
    expect(run(withEvidence("m-cur", "i won’t send the code")).errors).toContainEqual(expect.objectContaining({ code: "quote_not_found" }));
  });
  it("handles Unicode and emoji exactly", () => {
    expect(run(withEvidence("m-cur", "Sí, lo enviaré 👍")).errors).toEqual([]);
    expect(run(withEvidence("m-cur", "Si, lo enviare")).errors).toContainEqual(expect.objectContaining({ code: "quote_not_found" }));
  });
  it("accepts a quote occurring multiple times", () => {
    expect(run(withEvidence("m-cur", "send")).errors).toEqual([]);
  });
  it("rejects invented quotations", () => {
    expect(run(withEvidence("m-cur", "Here is my code: 123456")).errors).toContainEqual(expect.objectContaining({ code: "quote_not_found", field: "decision.evidence[0]" }));
  });
  it("rejects blank-but-nonempty quotes", () => {
    expect(run(withEvidence("m-cur", "   ")).errors).toContainEqual(expect.objectContaining({ code: "quote_not_found" }));
  });
  it("rejects assistant messages disguised as user evidence", () => {
    const result = run(withEvidence("m-2", "Yes, send the code now.", "explicit_acceptance"));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "non_user_evidence" }));
    expect(result.evidenceReferencesValid).toBe(false);
    expect(run(withEvidence(INTRO.id, "Security desk here")).errors).toContainEqual(expect.objectContaining({ code: "non_user_evidence" }));
  });
  it("rejects unknown message ids and messages outside the supplied context", () => {
    expect(run(withEvidence("m-404", "send")).errors).toContainEqual(expect.objectContaining({ code: "invalid_message_reference" }));
  });
  it("rejects messages from another session even if supplied", () => {
    const foreign = msg("m-x", "user", "Yes, I'll send the code.", 1, "sess-other");
    const result = validateCandidate(
      { ...assessment(input, "explicit_acceptance", null), decision: { label: "explicit_acceptance", evidence: [{ messageId: "m-x", quote: "Yes" }] } },
      { ...ctx, messages: [...ctx.messages, foreign] },
    );
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_message_reference", detail: expect.stringContaining("another session") }));
  });
  it("checks evidence in every field, reporting each failing span", () => {
    const a: ObserverAssessment = {
      ...assessment(input, "unclear", null),
      verificationObservations: [{ behavior: "requested_sender_proof", channelProvenance: "unspecified", channelDescription: null, claimedResult: "unspecified", evidence: [{ messageId: "m-1", quote: "Who is this?" }, { messageId: "m-1", quote: "Who are you?" }] }],
      statedUnderstanding: { description: "x", evidence: [{ messageId: "m-2", quote: "Security desk." }] },
      ambiguities: [{ field: "decision", description: "x", evidence: [{ messageId: "m-404", quote: "x" }] }],
    };
    const fields = run(a).errors.map((e) => `${e.field}:${e.code}`);
    expect(fields).toEqual(["verificationObservations[0].evidence[1]:quote_not_found", "statedUnderstanding.evidence[0]:non_user_evidence", "ambiguities[0].evidence[0]:invalid_message_reference"]);
  });
  it("a real quote with the wrong interpretation is still structurally valid; flags catch it, validation does not", () => {
    const wrong = withEvidence("m-cur", "send the code", "explicit_acceptance");
    expect(run(wrong).errors).toEqual([]);
    expect(codesOf(contradictionFlags(wrong, input))).toContain("acceptance_with_refusal_language");
  });
});

describe("Stage 2: contradiction flags on the required edge cases", () => {
  type Case = [string, string, ObserverAssessment["decision"]["label"], string, string[]];
  const conditionFor = (reply: string, quote: string) =>
    ({ description: "Stated condition", evidence: [{ messageId: "m-cur", quote: reply.includes("after I check") ? "after I check" : quote }] });
  const cases: Case[] = [
    ["negation-like wording does not imply refusal", "No problem, I'll send it.", "explicit_acceptance", "No problem, I'll send it.", []],
    ["different request target, acceptance of the code", "I won't send money, but I'll send the code.", "explicit_acceptance", "I'll send the code", ["acceptance_with_refusal_language"]],
    ["double negation", "I won't refuse to send it.", "explicit_acceptance", "I won't refuse to send it.", ["acceptance_with_refusal_language"]],
    ["historical quoted refusal", "I said 'I won't send the code' earlier, but now I agree.", "explicit_acceptance", "now I agree", ["acceptance_with_refusal_language"]],
    ["condition labeled as unconditional acceptance", "I'll send it after I check.", "explicit_acceptance", "I'll send it after I check.", ["acceptance_with_conditional_language"]],
    ["condition labeled correctly", "I'll send it after I check.", "conditional_acceptance", "I'll send it after I check.", []],
    ["hypothetical labeled unclear", "If I sent it, what would happen?", "unclear", "If I sent it", []],
    ["hypothetical mislabeled as acceptance", "If I sent it, what would happen?", "explicit_acceptance", "If I sent it", ["acceptance_with_conditional_language"]],
    ["refusal without negation keywords, labeled refused", "Find someone else to ask.", "refused", "Find someone else to ask.", []],
    ["refusal without negation keywords, mislabeled acceptance", "Find someone else to ask.", "explicit_acceptance", "Find someone else to ask.", ["acceptance_with_refusal_language"]],
    ["polite refusal", "Thanks, but I will not share that code.", "refused", "I will not share that code", []],
    ["refusal with 'I'm not going to'", "Sorry, I'm going to not do that. I'll never send it.", "refused", "I'll never send it.", []],
    ["refusal that also says yes", "Yes I got it, but I will not send it.", "refused", "I will not send it.", ["refusal_with_acceptance_language"]],
    ["angry acceptance", "This is ridiculous. Fine, I'll send the code.", "explicit_acceptance", "Fine, I'll send the code.", []],
    ["refusal of payment with acceptance of code elsewhere", "I won't send money, but I'll send the code.", "refused", "I won't send money", ["refusal_with_acceptance_language"]],
    ["curly apostrophe refusal is still scanned", "I won’t send it. Fine.", "explicit_acceptance", "Fine.", ["acceptance_with_refusal_language"]],
    ["sentence-initial no", "No. Okay, I'll send it.", "explicit_acceptance", "Okay, I'll send it.", ["acceptance_with_refusal_language"]],
  ];
  it.each(cases)("%s", (_name, reply, label, quote, expected) => {
    const input = inputFor(reply);
    const a = assessment(input, label, quote, label === "conditional_acceptance" ? { condition: conditionFor(reply, quote) } : {});
    expect(validateCandidate(a, contextFor(input)).errors).toEqual([]);
    expect(codesOf(contradictionFlags(a, input))).toEqual(expected.sort());
  });

  it("flags never mutate the assessment, input, or labels", () => {
    const input = deepFreeze(inputFor("I won't send money, but I'll send the code."));
    const a = deepFreeze(assessment(input, "explicit_acceptance", "I'll send the code"));
    const before = JSON.stringify([input, a]);
    const flags = reviewFlags(a, input, "consequential_and_flagged");
    expect(flags.length).toBeGreaterThan(0);
    expect(JSON.stringify([input, a])).toBe(before);
    expect(a.decision.label).toBe("explicit_acceptance");
  });

  it("flags carry the message ids and matched text they came from", () => {
    const input = inputFor("I won't send money, but I'll send the code.");
    const [flag] = contradictionFlags(assessment(input, "explicit_acceptance", "I'll send the code"), input);
    expect(flag).toMatchObject({ field: "decision.label", messageIds: ["m-cur"], matchedText: "won't" });
  });

  it("a changed decision versus the previous assessment is flagged as conflicting evidence", () => {
    const first = inputFor("I won't send the code.");
    const previous = assessment(first, "refused", "I won't send the code.");
    const input = inputFor("Actually yes, I'll send the code.", { previous });
    expect(codesOf(contradictionFlags(assessment(input, "explicit_acceptance", "yes, I'll send the code"), input))).toEqual(["conflicting_evidence"]);
    expect(contradictionFlags(assessment(input, "unclear", null), input)).toEqual([]);
  });

  it("the same span as decision evidence and ambiguity evidence is conflicting", () => {
    const input = inputFor("Okay.");
    const a = assessment(input, "explicit_acceptance", "Okay.", { ambiguities: [{ field: "decision", description: "Okay may only acknowledge.", evidence: [{ messageId: "m-cur", quote: "Okay." }] }] });
    expect(codesOf(contradictionFlags(a, input))).toEqual(["conflicting_evidence"]);
  });

  it("scans prior cited user messages too, and ignores assistant text", () => {
    const history = [msg("m-1", "user", "I will never send it.", 1), msg("m-2", "assistant", "No? Okay, fine.", 1)];
    const input = inputFor("Sending now.", { history });
    const accept = { ...assessment(input, "explicit_acceptance", null), decision: { label: "explicit_acceptance" as const, evidence: [{ messageId: "m-cur", quote: "Sending now." }] } };
    expect(contradictionFlags(accept, input)).toEqual([]);
    const citing = { ...accept, decision: { ...accept.decision, evidence: [...accept.decision.evidence, { messageId: "m-1", quote: "I will never send it." }] } };
    expect(contradictionFlags(citing, input)[0]).toMatchObject({ code: "acceptance_with_refusal_language", messageIds: ["m-1"] });
  });
});

describe("Stage 2: review policy", () => {
  const input = inputFor("Yes, I'll send the code.");
  it("default policy selects explicit_acceptance and refused, nothing else", () => {
    expect(codesOf(policyFlags(assessment(input, "explicit_acceptance", "Yes"), "consequential_and_flagged"))).toEqual(["consequential_classification"]);
    expect(codesOf(policyFlags(assessment(input, "refused", "Yes"), "consequential_and_flagged"))).toEqual(["consequential_classification"]);
    for (const label of ["considering", "unclear"] as const) expect(policyFlags(assessment(input, label, label === "unclear" ? null : "Yes"), "consequential_and_flagged")).toEqual([]);
  });
  it("flag-only policy adds nothing", () => {
    expect(policyFlags(assessment(input, "explicit_acceptance", "Yes"), "flagged_only")).toEqual([]);
  });
});

describe("Stage 2: scanning is bounded and normalization is temporary", () => {
  it("patterns stay linear on adversarial input at the length limit", () => {
    const evil = `${"if i ".repeat(150)}${"n".repeat(1200)}`;
    const started = performance.now();
    for (const p of Object.values(PATTERNS)) p.test(normalizeForScan(evil));
    expect(performance.now() - started).toBeLessThan(50);
  });
  it("normalization maps curly quotes and case without touching the source", () => {
    const original = "I Won’t “send”";
    expect(normalizeForScan(original)).toBe("i won't \"send\"");
    expect(original).toBe("I Won’t “send”");
  });
});
