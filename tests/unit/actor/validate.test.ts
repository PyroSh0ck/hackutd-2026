import { describe, expect, it } from "vitest";
import { validateActorOutput, type ActorValidationContext } from "@/server/actor/validate";
import { wordCount, questionCount } from "@/server/actor/counts";
import { input, instruction, output } from "./fixtures";

const context = () => ({ reserved: [{ id: "case_reference", text: "CD-123456", introduced: false }, { id: "team_label", text: "Account Review", introduced: false }], knownSecrets: ["938201", "test-credential"], state: { stage: "active", ended: false, revision: 20 } } satisfies ActorValidationContext);
const check = (text: string, i = instruction()) => validateActorOutput(output(text), input(i), context());
describe("pure actor output validation", () => {
  it("rejects an exact repeated proof answer for the actor's bounded repair", () => {
    const s = { ...input().recentActorMessages[0], text: "This message alone can't prove who I am." };
    const a = input(instruction({ moveId: "address_doubt", action: "respond_to_objection" }));
    a.recentActorMessages = [s];
    a.contextMessages = [{ id: "m1", role: "user", text: "Prove it", turn: 1 }];
    expect(validateActorOutput(output("This message alone can't prove who I am."), a, context()).violations.map((v) => v.detail)).toContain("CR7_repeated_reply");
  });
  it("a request-presentation move cannot commit an acknowledgment without the request", () => {
    const i = instruction({ action: "present_simulated_request", moveId: "present_code_request", toolIntent: "present_practice_code_request", focusCode: "present_request" });
    expect(check("Understood.", i).valid).toBe(false);
    expect(check("Please share the six-digit code.", i).valid).toBe(true);
  });
  it("backing off cannot ask for a code even when an earlier request is pending", () => {
    const i = instruction({ action: "acknowledge_boundary", moveId: "back_off_doubt", facts: [], additions: [] });
    const a = input(i);
    a.instruction.target = { issueId: "i-1", requestId: "r-1", description: "Back off after the proof limit." };
    const draft = (text: string) => ({ text, usedFactIds: [], introducedAdditionIds: [] });
    expect(validateActorOutput(draft("I hear you. My answer hasn't changed, so I'll leave it there."), a, context()).valid).toBe(true);
    expect(validateActorOutput(draft("I hear you. Please share the six-digit code."), a, context()).violations.map((v) => v.code)).toContain("prohibited_content");
  });
  it("shares whitespace word counts and ASCII/fullwidth question counts", () => {
    expect(wordCount(" \n one\t two　three ")).toBe(3); expect(wordCount(" ")).toBe(0);
    expect(questionCount("One? Two？")).toBe(2);
    expect(check("word ".repeat(70)).valid).toBe(true); expect(check("word ".repeat(71)).violations.map((v) => v.code)).toContain("word_limit");
  });
  it.each(["clarify_response", "acknowledge_boundary"] as const)("clamps %s to 40 words even when candidate allows more", (action) => {
    expect(check("word ".repeat(40), instruction({ action })).valid).toBe(true);
    expect(check("word ".repeat(41), instruction({ action })).violations.map((v) => v.code)).toContain("word_limit");
  });
  it("enforces candidate-provided lower bounds and one hard question maximum", () => {
    const i = instruction(); i.constraints.maxWords = 3; i.constraints.maxQuestions = 0;
    expect(check("Four small words here", i).valid).toBe(false); expect(check("Why？", i).valid).toBe(false);
    i.constraints.maxQuestions = 3; expect(check("One? Two？", i).valid).toBe(false); expect(check("One？", i).valid).toBe(true);
  });
  it("rejects blanks, long text, malformed references, duplicates and extra keys", () => {
    expect(check("x".repeat(1200)).valid).toBe(true);
    for (const text of ["", " \n\t", "x".repeat(1201)]) expect(check(text).valid).toBe(false);
    for (const draft of [{ ...output(), usedFactIds: ["F06"] }, { ...output(), usedFactIds: ["F05", "F05"] }, { ...output(), introducedAdditionIds: ["unknown"] }, { ...output(), tool_calls: [] }]) expect(validateActorOutput(draft, input(), context()).valid).toBe(false);
    expect(validateActorOutput({ ...output(), usedFactIds: [] }, input(), context()).valid).toBe(true);
  });
  it("normalizes CRLF and preserves canonical text, rejecting other controls", () => {
    const draft = output("The check is quick.\r\nIt takes a minute."); const before = structuredClone(draft);
    expect(validateActorOutput(draft, input(), context()).output?.text).toBe("The check is quick.\nIt takes a minute."); expect(draft).toEqual(before);
    for (const char of ["\r", "\x00", "\x1b", "\x7f", "\u0085"]) expect(check(`Hello${char}there`).violations.map((v) => v.code)).toContain("forbidden_format");
    expect(check("Hello\nthere\tfriend").valid).toBe(true);
  });
  it.each(["<script>alert(1)</script>", "<b>Hi</b>", "[click](https://bad.example)", "![image](x)", "```json\n{}\n```", "~~~\ncode\n~~~"])("rejects unsafe rendering syntax: %s", (text) => {
    expect(check(text).violations.map((v) => v.code)).toContain("forbidden_format");
  });
  it.each(["https://example.com", "http://x.test", "www.example.org", "example.net", "help@cedar.test", "+1 (312) 555-0199", "312.555.0199", "5550199", "Call 01425550199", "Call 0142-555-0199", "ｅｘａｍｐｌｅ．ｃｏｍ", "example。com", "５５５０１９９"])("rejects external destinations: %s", (text) => {
    expect(check(text).violations.map((v) => v.code)).toContain("unapproved_destination");
  });
  it("allows only exact approved suffix/reference exemptions from numeric scanning", () => {
    const i = instruction({ facts: [{ id: "F02", kind: "public", text: "ignored" }] });
    expect(validateActorOutput({ text: "Your mobile line ends in 0142.", usedFactIds: ["F02"], introducedAdditionIds: [] }, input(i), context()).valid).toBe(true);
    expect(check("Your mobile line ends in 0142.").valid).toBe(false);
    i.additions = [context().reserved[0]];
    const draft = { text: "The case reference is CD-123456.", usedFactIds: [], introducedAdditionIds: ["case_reference"] };
    expect(validateActorOutput(draft, input(i), context()).valid).toBe(true);
    expect(validateActorOutput({ ...draft, text: `${draft.text} Call 555-0199.` }, input(i), context()).valid).toBe(false);
    expect(validateActorOutput({ ...draft, text: `${draft.text} 🌲` }, input(i), context()).valid).toBe(true);
  });
  it("enforces exact case literals, allowed membership and introduction symmetry", () => {
    const i = instruction({ additions: context().reserved });
    const base = { text: "Case CD-123456, Account Review.", usedFactIds: [], introducedAdditionIds: ["case_reference", "team_label"] };
    expect(validateActorOutput(base, input(i), context()).valid).toBe(true);
    for (const text of ["CD-999999", "cd-123456", "CD–123456", "CD-1234567", "CD-123456x", "ＣＤ－１２３４５６", "account review"]) expect(validateActorOutput({ ...base, text }, input(i), context()).valid).toBe(false);
    expect(validateActorOutput({ ...base, introducedAdditionIds: [] }, input(i), context()).valid).toBe(false);
    expect(validateActorOutput({ ...base, text: "Nothing reserved." }, input(i), context()).valid).toBe(false);
    expect(check("Account Review").valid).toBe(false);
  });
  it("allows already introduced additions only when supplied and never as new", () => {
    const ctx: ActorValidationContext = { ...context(), reserved: context().reserved.map((r, n) => ({ ...r, introduced: n === 0 })) };
    // Assemble against durable introduced state, not the untrusted instruction boolean.
    const actorInput = input(); actorInput.instruction.additions = [ctx.reserved[0]];
    const draft = { text: "Case CD-123456.", usedFactIds: [], introducedAdditionIds: [] };
    expect(validateActorOutput(draft, actorInput, ctx).valid).toBe(true);
    expect(validateActorOutput({ ...draft, introducedAdditionIds: ["case_reference"] }, actorInput, ctx).valid).toBe(false);
    expect(validateActorOutput(draft, input(), ctx).valid).toBe(false);
  });
  it("redacts secret violations and never embeds rejected payloads in errors", () => {
    for (const draft of [output("938201 test-credential"), { ...output(), "test-credential": "938201" }]) {
      const v = validateActorOutput(draft, input(), context()); expect(v.valid).toBe(false);
      expect(JSON.stringify(v.violations)).not.toMatch(/938201|test-credential/);
    }
  });
  it("reports stale/inactive gates even for schema-invalid drafts", () => {
    const ctx = context(); ctx.state.revision = 21;
    expect(validateActorOutput({}, input(), ctx).violations.map((v) => v.code)).toContain("stale_revision");
    ctx.state.stage = "verifying"; expect(validateActorOutput(output(), input(), ctx).violations.map((v) => v.code)).toContain("session_not_active");
  });
  it("does not pretend deterministic metadata proves semantic fidelity", () => {
    // An invented completed user action is a semantic error that structural checks still pass.
    expect(check("You have already completed independent verification.").valid).toBe(true);
    // An unauthorized code request on a non-request move is now caught by the content rules.
    expect(check("Please share the code.").violations.map((v) => v.code)).toEqual(["prohibited_content"]);
  });
});
