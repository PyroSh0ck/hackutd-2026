import { describe, expect, it } from "vitest";
import { clearConversationDecisionEvidence, isBareGoAhead, issueSupported, pruneUnsupportedIssues } from "@/server/observer/issue-support";
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

  it("clears evidence only on an 'unclear' decision (conversation scope); other shapes are left for the validator", () => {
    const ev = [{ messageId: "m1", quote: "Alright, go ahead." }];
    expect(clearConversationDecisionEvidence({ requestId: null, decision: { label: "unclear", evidence: ev } })).toEqual({ requestId: null, decision: { label: "unclear", evidence: [] } });
    const other = { decision: { label: "rejection", evidence: ev } };
    expect(clearConversationDecisionEvidence(other)).toBe(other);
    expect(clearConversationDecisionEvidence("not an object")).toBe("not an object");
  });
});
