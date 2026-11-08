import { describe, expect, it } from "vitest";
import { buildStyleProfile, computeStyleMetrics } from "@/server/actor/style";
import { validateActorOutput } from "@/server/actor/validate";
import { input, instruction, output } from "./fixtures";

describe("controller-owned style and warning-only metrics", () => {
  it.each([
    ["answer_question", "concise_professional", "brief", 0, "none", "direct"],
    ["answer_question", "plain_explanatory", "explanatory", 0, "none", "brief_explanation"],
    ["clarify_response", "concise_professional", "brief", 1, "none", "direct"],
    ["continue_scenario", "concise_professional", "brief", 0, "none", "direct"],
    ["continue_scenario", "plain_explanatory", "normal", 0, "none", "brief_explanation"],
    ["present_simulated_request", "concise_professional", "normal", 1, "none", "direct"],
    ["present_simulated_request", "plain_explanatory", "normal", 1, "none", "direct"],
    ["respond_to_objection", "concise_professional", "brief", 0, "optional_brief", "direct"],
    ["respond_to_objection", "plain_explanatory", "normal", 0, "optional_brief", "brief_explanation"],
    ["acknowledge_boundary", "concise_professional", "brief", 0, "optional_brief", "direct"],
  ] as const)("maps %s/%s deterministically", (action, style, lengthTarget, targetQuestions, acknowledgment, detail) => {
    expect(buildStyleProfile(instruction({ action, style }))).toMatchObject({ lengthTarget, targetQuestions, acknowledgment, detail, register: "conversational_professional", contractions: "allowed", formatting: "plain_text", emojis: "avoid" });
  });
  it("clamps soft bounds to the lower candidate maximum without padding", () => {
    const i = instruction({ style: "plain_explanatory" }); i.constraints.maxWords = 5;
    const actorInput = input(i); expect(actorInput.styleProfile.targetWords).toEqual({ min: 5, max: 5 });
    expect(validateActorOutput(output("Understood."), actorInput, { reserved: [], knownSecrets: [], state: { stage: "active", ended: false, revision: 20 } }).valid).toBe(true);
    expect(computeStyleMetrics("Understood.", actorInput).warnings.map((w) => w.code)).toContain("outside_length_target");
  });
  it("treats zero-question style target versus hard maximum one as a soft mismatch", () => {
    const actorInput = input(); expect(computeStyleMetrics("One？", actorInput).warnings.map((w) => w.code)).toContain("question_target");
    expect(validateActorOutput(output("One？"), actorInput, { reserved: [], knownSecrets: [], state: { stage: "active", ended: false, revision: 20 } }).valid).toBe(true);
  });
  it("counts sentence estimates/fullwidth punctuation and stock phrases without hard rejection", () => {
    const metrics = computeStyleMetrics("I understand your concern. Thank you\tfor clarifying！ I'm here to help？ Next． Last.", input());
    expect(metrics.estimatedSentenceCount).toBe(5); expect(metrics.questionMarkCount).toBe(1); expect(metrics.stockPhraseCount).toBe(3);
    expect(metrics.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["sentence_target", "question_target", "stock_phrase"]));
    expect(computeStyleMetrics("I understand, your concern.", input()).stockPhraseCount).toBe(0);
  });
  it("compares exact first four normalized tokens and distinct shared five-grams", () => {
    const actorInput = input(); actorInput.recentActorMessages = [{ id: "r1", role: "assistant", text: "I’m following up about the practice line today.", turn: 0 }];
    const metrics = computeStyleMetrics("Ｉ'm following up about the practice line tomorrow.", actorInput);
    expect(metrics.repeatedOpening).toBe(true); expect(metrics.repeatedPhraseCount).toBe(3);
    expect(metrics.warnings.find((w) => w.code === "repeated_opening")?.relatedMessageIds).toEqual(["r1"]);
    actorInput.recentActorMessages[0].text = "I'm following up";
    expect(computeStyleMetrics("I'm following up", actorInput).repeatedOpening).toBe(false);
  });
  it("exempts whole exact UI-label/quoted spans but not mere scenario-word overlap", () => {
    const actorInput = input(); actorInput.controls[0].label = "Use the Verify independently control";
    actorInput.recentActorMessages = [{ id: "r1", role: "assistant", text: "Use the Verify independently control", turn: 0 }];
    expect(computeStyleMetrics("Use the Verify independently control", actorInput).repeatedPhraseCount).toBe(0);
    actorInput.recentActorMessages[0].text = "Please use the Verify independently control";
    expect(computeStyleMetrics("Please use the Verify independently control", actorInput).repeatedPhraseCount).toBe(1);
    actorInput.contextMessages[0].text = 'I said "I will check this myself today"';
    actorInput.recentActorMessages[0].text = "I will check this myself today";
    expect(computeStyleMetrics("I will check this myself today", actorInput).repeatedPhraseCount).toBe(0);
  });
  it("does not multiply a distinct shared window by message count", () => {
    const actorInput = input(); actorInput.recentActorMessages = [1, 2, 3].map((n) => ({ id: `r${n}`, role: "assistant", text: "These five ordinary words repeat", turn: n }));
    const metrics = computeStyleMetrics("These five ordinary words repeat", actorInput);
    expect(metrics.repeatedPhraseCount).toBe(1); expect(metrics.warnings.find((w) => w.code === "repeated_phrase")?.relatedMessageIds).toEqual(["r1", "r2", "r3"]);
  });
  it("flags headings, lists and Unicode emoji softly", () => {
    expect(computeStyleMetrics("# A heading\n- A bullet 🌲", input()).warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["list_or_heading", "emoji"]));
    expect(computeStyleMetrics("1. Check here", input()).warnings.map((w) => w.code)).toContain("list_or_heading");
  });
});
