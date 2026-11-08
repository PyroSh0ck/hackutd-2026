import { describe, expect, it } from "vitest";
import { collapseDuplicateIssues, normalizeConversationDecision, isBareGoAhead, issueSupported, pruneUnsupportedIssues } from "@/server/observer/issue-support";
import type { ObserverAssessment } from "@/contracts/observer";

type Draft = ObserverAssessment["openIssues"][number];
const draft = (kind: Draft["kind"], summary: string, quote: string): Draft => ({ kind, summary, evidence: [{ messageId: "m1", quote }] }) as Draft;

describe("observer open-issue support (drafts observed from live Nemotron)", () => {
  it("drops a question issue whose only evidence is a bare go-ahead", () => {
    expect(issueSupported(draft("procedure_question", "The user wants the sender to continue", "Sure, go on."))).toBe(false);
    expect(issueSupported(draft("scenario_fact_question", "Asks to continue", "Alright, go ahead."))).toBe(false);
  });

  it("drops an issue whose summary asserts there is no issue, even with a question quote", () => {
    expect(issueSupported(draft("procedure_question", "No procedure questions were raised in the current message", "Who is this?"))).toBe(false);
    expect(issueSupported(draft("identity_question", "There are no identity questions", "Who is this?"))).toBe(false);
  });

  it("keeps genuine questions and objections (statements can be identity issues)", () => {
    expect(issueSupported(draft("identity_question", "The user asks who the sender is", "Who is this?"))).toBe(true);
    expect(issueSupported(draft("procedure_question", "The user asks what is needed", "Okay, what do you need from me?"))).toBe(true);
    expect(issueSupported(draft("scenario_fact_question", "Asks which line", "which line is this about"))).toBe(true);
    expect(issueSupported(draft("identity_question", "The user doubts the sender", "This is a scam, you're not from Cedar."))).toBe(true);
    expect(isBareGoAhead("Okay, go ahead?")).toBe(false);
    expect(isBareGoAhead("Fine, what's next?")).toBe(false);
  });

  it("keeps clarification kinds (ambiguity is not phrased as a question)", () => {
    expect(issueSupported(draft("decision_needs_clarification", "The user's intent is ambiguous", "maybe later"))).toBe(true);
  });

  it("prunes only unsupported drafts and leaves an already-valid assessment untouched", () => {
    const a = { openIssues: [draft("identity_question", "Asks who", "Who is this?"), draft("procedure_question", "No procedure questions", "Sure, go on.")] } as ObserverAssessment;
    expect(pruneUnsupportedIssues(a).openIssues.map((d) => d.kind)).toEqual(["identity_question"]);
    const clean = { openIssues: [draft("identity_question", "Asks who", "Who is this?")] } as ObserverAssessment;
    expect(pruneUnsupportedIssues(clean)).toBe(clean);
  });

  it("normalizes a conversation-scope decision to unclear with no evidence or condition; clean output is returned as is", () => {
    const ev = [{ messageId: "m1", quote: "No, I won't send you the code" }];
    expect(normalizeConversationDecision({ requestId: null, decision: { label: "unclear", evidence: ev }, condition: null })).toEqual({ requestId: null, decision: { label: "unclear", evidence: [] }, condition: null });
    // A pre-request boundary labeled "refused" (observed live) no longer fails the whole assessment.
    expect(normalizeConversationDecision({ requestId: null, decision: { label: "refused", evidence: ev }, condition: null })).toEqual({ requestId: null, decision: { label: "unclear", evidence: [] }, condition: null });
    const condition = { kind: "independent_verification", description: "verify first", evidence: ev };
    expect(normalizeConversationDecision({ requestId: null, decision: { label: "conditional_acceptance", evidence: ev }, condition })).toEqual({ requestId: null, decision: { label: "unclear", evidence: [] }, condition: null });
    const clean = { requestId: null, decision: { label: "unclear", evidence: [] }, condition: null };
    expect(normalizeConversationDecision(clean)).toBe(clean);
    // Other fields (including a wrong requestId) are left for the validator.
    expect(normalizeConversationDecision({ requestId: "r1", decision: { label: "unclear", evidence: [] }, condition: null })).toEqual({ requestId: "r1", decision: { label: "unclear", evidence: [] }, condition: null });
    expect(normalizeConversationDecision("not an object")).toBe("not an object");
  });

  it("drops an identity issue that only re-labels another question's words with no identity cue (observed live)", () => {
    const what = "What do you need from me?";
    const a = { openIssues: [draft("procedure_question", "Asks what is needed", what), draft("identity_question", "Asks about the sender", what)] } as ObserverAssessment;
    expect(pruneUnsupportedIssues(a).openIssues.map((d) => d.kind)).toEqual(["procedure_question"]);
  });

  it("keeps identity issues that carry an identity/trust cue, stand alone, or quote different words", () => {
    const multi = "Who are you, and what do you need from me?";
    const both = { openIssues: [draft("procedure_question", "Asks what is needed", multi), draft("identity_question", "Asks who", multi)] } as ObserverAssessment;
    expect(pruneUnsupportedIssues(both)).toBe(both);
    const alone = { openIssues: [draft("identity_question", "Asks what they want", "What do you need from me?")] } as ObserverAssessment;
    expect(pruneUnsupportedIssues(alone)).toBe(alone);
    const objection = { openIssues: [draft("procedure_question", "Asks how", "liar, how does this work?"), draft("identity_question", "Calls them a liar", "liar, how does this work?")] } as ObserverAssessment;
    expect(pruneUnsupportedIssues(objection)).toBe(objection);
    const separate = { openIssues: [draft("procedure_question", "Asks what", "What now?"), draft("identity_question", "Asks", "Hmm, really?")] } as ObserverAssessment;
    expect(pruneUnsupportedIssues(separate).openIssues).toHaveLength(2);
  });

  it("collapses only exact duplicate issue drafts (same kind and evidence), as observed live", () => {
    const lying = draft("identity_question", "The user questions the sender's truthfulness.", "you're lying");
    const raw = { requestId: null, openIssues: [lying, { ...lying }, { ...lying, summary: "Reworded" }] };
    expect((collapseDuplicateIssues(raw) as { openIssues: unknown[] }).openIssues).toEqual([lying]);
    const distinct = { openIssues: [draft("identity_question", "Asks who", "Who and why?"), draft("procedure_question", "Asks why", "Who and why?")] };
    expect(collapseDuplicateIssues(distinct)).toBe(distinct);
    expect(collapseDuplicateIssues({ openIssues: "nope" })).toEqual({ openIssues: "nope" });
  });
});
