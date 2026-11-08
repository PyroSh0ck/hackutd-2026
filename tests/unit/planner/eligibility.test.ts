import { describe, expect, it } from "vitest";
import { ForbiddenClaimCodeSchema, type Candidate, type Eligibility } from "@/contracts/planner";
import { candidateId, getEligibleCandidates, MAX_ISSUE_CANDIDATES } from "@/server/planner/eligibility";
import { ctx, ev, issue, past, PENDING } from "./helpers";

const moves = (e: Eligibility) => (e.kind === "candidates" ? e.candidates.map((c) => c.moveId) : []);
const only = (e: Eligibility): Candidate[] => {
  expect(e.kind).toBe("candidates");
  return e.kind === "candidates" ? e.candidates : [];
};

describe("Stage 2: priority gates (planner brief §6)", () => {
  it.each([
    ["ended", ctx({ ended: true, stage: "ended" })],
    ["turn limit", ctx({ userTurns: 12 })],
    ["ended state with an apparent open question", ctx({ ended: true, stage: "ended", issues: [issue("identity_question", "Who are you?")] })],
  ])("P0 %s → controller outcome, no planner", (_n, c) => {
    expect(getEligibleCandidates(c)).toMatchObject({ kind: "controller", ruleId: "P0" });
  });

  it.each([
    ["verifying", ctx({ stage: "verifying", request: PENDING, issues: [issue("identity_question", "Who?")] })],
    ["awaiting_final_decision", ctx({ stage: "awaiting_final_decision", request: PENDING })],
    ["stop confirmation pending", ctx({ stopConfirmationPending: true })],
  ])("P1 %s → wait, no opponent candidates", (_n, c) => {
    expect(getEligibleCandidates(c)).toMatchObject({ kind: "wait", ruleId: "P1" });
  });

  it("P2 fallback with a pending request → one safe clarification only; no new request", () => {
    const [c] = only(getEligibleCandidates(ctx({ resolution: "unclear_fallback", request: PENDING, issues: [issue("identity_question", "Who?")] })));
    expect(getEligibleCandidates(ctx({ resolution: "unclear_fallback", request: PENDING }))).toMatchObject({ ruleId: "P2" });
    expect(c).toMatchObject({ moveId: "clarify_decision", requestId: "r-1", toolIntent: "none", ruleId: "P2" });
  });

  it("P2 fallback with no request → wait (fallback grants no permissions)", () => {
    expect(getEligibleCandidates(ctx({ resolution: "unclear_fallback" }))).toMatchObject({ kind: "wait", ruleId: "P2" });
  });

  it("acknowledges a clear decline of the opening invitation once instead of continuing the premise", () => {
    const declined = ctx({ conversationDeclined: true });
    expect(moves(getEligibleCandidates(declined))).toEqual(["acknowledge_refusal"]);
    const after = ctx({ history: [past("acknowledge_refusal")], conversationDeclined: true });
    expect(getEligibleCandidates(after)).toMatchObject({ kind: "wait" });
  });

  it("P3 issue kinds map to answer/clarify moves with their catalog facts", () => {
    const issues = [
      issue("identity_question", "Who are you?"),
      issue("procedure_question", "Where do I check independently?"),
      issue("scenario_fact_question", "What security check?"),
      issue("condition_needs_clarification", "if that happens"),
      issue("decision_needs_clarification", "Okay."),
    ];
    const cs = only(getEligibleCandidates(ctx({ issues })));
    expect(cs.map((c) => [c.moveId, c.issueId])).toEqual(issues.map((i, n) => [["answer_identity", "answer_procedure", "answer_scenario_fact", "clarify_condition", "clarify_decision"][n], i.id]));
    expect(cs[0].constraints.allowedFactIds).toEqual(["F01", "F02", "F03"]);
    expect(cs[1].constraints.allowedFactIds).toEqual(["F04", "F05"]);
    expect(cs[2]).toMatchObject({ focusCode: "answer_target", constraints: { allowedFactIds: ["F01", "F02", "F03", "F04"], allowedAdditionIds: ["case_reference"] } });
    expect(cs.every((c) => c.ruleId === "P3")).toBe(true);
  });

  it("P3 a fact question with no supported topic → answer_scenario_fact constrained to acknowledge_unknown, no facts", () => {
    const [c] = only(getEligibleCandidates(ctx({ issues: [issue("scenario_fact_question", "What's your favourite colour?")] })));
    expect(c).toMatchObject({ moveId: "answer_scenario_fact", focusCode: "acknowledge_unknown", constraints: { allowedFactIds: [], allowedAdditionIds: [] } });
  });

  it("P3 an explicit objection adds address_doubt next to the answer; a plain question does not", () => {
    expect(moves(getEligibleCandidates(ctx({ issues: [issue("identity_question", "This is a scam, you're not from Cedar.")] })))).toEqual(["answer_identity", "address_doubt"]);
    expect(moves(getEligibleCandidates(ctx({ issues: [issue("identity_question", "Who are you?")] })))).toEqual(["answer_identity"]);
  });

  it("P3 caps at five candidates, oldest issues first; the rest are reported as excluded", () => {
    const issues = Array.from({ length: 7 }, (_, i) => issue("procedure_question", `How does step ${i} work?`));
    const e = getEligibleCandidates(ctx({ issues }));
    expect(only(e).map((c) => c.issueId)).toEqual(issues.slice(0, MAX_ISSUE_CANDIDATES).map((i) => i.id));
    expect(e.kind === "candidates" && e.excluded.filter((x) => x.reason === "candidate limit reached")).toHaveLength(2);
  });

  it("overlap: refusal with a procedure question → only the question is answered this turn", () => {
    const c = ctx({ request: PENDING, a: { decision: { label: "refused", evidence: [ev("No.")] } }, issues: [issue("procedure_question", "How would I even send it?")] });
    expect(moves(getEligibleCandidates(c))).toEqual(["answer_procedure"]);
  });

  it("overlap: conditional acceptance with an identity question → the question first, no request pressure", () => {
    const c = ctx({
      request: PENDING,
      a: { decision: { label: "conditional_acceptance", evidence: [ev("once you prove it")] }, condition: { kind: "sender_proof", description: "proof", evidence: [ev("once you prove it")] } },
      issues: [issue("identity_question", "Who are you really?")],
    });
    const cs = only(getEligibleCandidates(c));
    expect(cs.map((x) => [x.moveId, x.ruleId])).toEqual([["answer_identity", "P3"]]);
  });

  describe("P4 conditional table", () => {
    const conditional = (kind: "independent_verification" | "sender_proof" | "procedure_answer" | "other" | "unspecified", quote = "I'll do it once that's sorted") =>
      ({ decision: { label: "conditional_acceptance" as const, evidence: [ev(quote)] }, condition: { kind, description: "c", evidence: [ev(quote)] } });
    it("clear independent-verification condition → wait (never turned into acceptance)", () => {
      expect(getEligibleCandidates(ctx({ request: PENDING, a: conditional("independent_verification") }))).toMatchObject({ kind: "wait", ruleId: "P4" });
    });
    it("sender proof → answer_identity once per condition evidence, then wait", () => {
      expect(moves(getEligibleCandidates(ctx({ request: PENDING, a: conditional("sender_proof") })))).toEqual(["answer_identity"]);
      const again = ctx({ request: PENDING, a: conditional("sender_proof"), history: [past("answer_identity", { requestId: "r-1" })] });
      expect(getEligibleCandidates(again)).toMatchObject({ kind: "wait", ruleId: "P4" });
    });
    it("procedure answer: explicit question → answer_procedure; otherwise clarify_condition", () => {
      expect(moves(getEligibleCandidates(ctx({ request: PENDING, a: conditional("procedure_answer", "I'll do it once you explain how the card works?") })))).toEqual(["answer_procedure"]);
      expect(moves(getEligibleCandidates(ctx({ request: PENDING, a: conditional("procedure_answer") })))).toEqual(["clarify_condition"]);
    });
    it("other/unspecified → clarify_condition once, then wait (repeated condition clarification)", () => {
      expect(moves(getEligibleCandidates(ctx({ request: PENDING, a: conditional("unspecified") })))).toEqual(["clarify_condition"]);
      const repeated = ctx({ request: PENDING, a: conditional("other", "if the other thing"), history: [past("clarify_condition", { requestId: "r-1", refs: [{ kind: "message", id: "m-old" }] })] });
      const e = getEligibleCandidates(repeated);
      expect(e).toMatchObject({ kind: "wait", ruleId: "P4" });
      expect(e.kind === "wait" && e.excluded[0]).toMatchObject({ moveId: "clarify_condition", reason: expect.stringMatching(/already delivered/) });
    });
  });

  describe("P5 refusal / rejection", () => {
    it("textual refusal of a pending request → acknowledge once, never re-present", () => {
      const c = ctx({ request: PENDING, a: { decision: { label: "refused", evidence: [ev("I won't send it.")] } } });
      expect(moves(getEligibleCandidates(c))).toEqual(["acknowledge_refusal"]);
      expect(getEligibleCandidates({ ...c, history: [past("acknowledge_refusal", { requestId: "r-1" })] })).toMatchObject({ kind: "wait", ruleId: "P5" });
    });
    it("rejected request → acknowledge citing the rejection event; afterwards wait; no request recreation", () => {
      const c = ctx({ request: { ...PENDING, status: "rejected" }, rejectionEventIds: ["e-rej"], trigger: { kind: "event", id: "e-rej" } });
      const [ack] = only(getEligibleCandidates(c));
      expect(ack).toMatchObject({ moveId: "acknowledge_refusal", constraints: { maxWords: 40, allowedStyles: ["concise_professional"] } });
      expect(ack.evidenceRefs).toContainEqual({ kind: "event", id: "e-rej" });
      const after = getEligibleCandidates({ ...c, history: [past("acknowledge_refusal", { refs: [{ kind: "event", id: "e-rej" }] })] });
      expect(after).toMatchObject({ kind: "wait" });
    });
  });

  describe("P6 verification claims and intent", () => {
    const obs = (behavior: "claimed_verification_completed" | "expressed_verification_intent", claimedResult: "unspecified" | "contradicts_request" = "unspecified") => ({
      verificationObservations: [{ behavior, channelProvenance: "unspecified" as const, channelDescription: null, claimedResult, evidence: [ev("I checked.")] }],
    });
    it("unspecified claimed check → one clarify_claimed_check (no counterevidence)", () => {
      expect(moves(getEligibleCandidates(ctx({ request: PENDING, a: obs("claimed_verification_completed") })))).toEqual(["clarify_claimed_check"]);
    });
    it("verification claim versus event: a contradicting claim without any server verification → wait, controls stay available", () => {
      expect(getEligibleCandidates(ctx({ request: PENDING, a: obs("claimed_verification_completed", "contradicts_request") }))).toMatchObject({ kind: "wait", ruleId: "P6" });
    });
    it("verification intent without action → wait (nonterminal), also before any request exists", () => {
      expect(getEligibleCandidates(ctx({ request: PENDING, a: obs("expressed_verification_intent") }))).toMatchObject({ kind: "wait", ruleId: "P6" });
      expect(getEligibleCandidates(ctx({ a: obs("expressed_verification_intent") }))).toMatchObject({ kind: "wait", ruleId: "P6" });
    });
  });

  it("P7 explicit acceptance with no action → wait; nothing presses or submits", () => {
    expect(getEligibleCandidates(ctx({ request: PENDING, a: { decision: { label: "explicit_acceptance", evidence: [ev("Yes")] } } }))).toMatchObject({ kind: "wait", ruleId: "P7" });
  });

  it("P8 unclear with ambiguity evidence → one clarify_decision; without evidence → wait", () => {
    const amb = { ambiguities: [{ field: "decision", description: "Okay could mean anything", evidence: [ev("Okay.")] }] };
    expect(moves(getEligibleCandidates(ctx({ request: PENDING, a: amb })))).toEqual(["clarify_decision"]);
    expect(getEligibleCandidates(ctx({ request: PENDING }))).toMatchObject({ kind: "wait", ruleId: "P8" });
    const repeated = ctx({ request: PENDING, a: amb, history: [past("clarify_decision", { requestId: "r-1" })] });
    expect(getEligibleCandidates(repeated)).toMatchObject({ kind: "wait" });
  });

  it("P9 considering → wait", () => {
    expect(getEligibleCandidates(ctx({ request: PENDING, a: { decision: { label: "considering", evidence: [ev("let me think")] } } }))).toMatchObject({ kind: "wait", ruleId: "P9" });
  });

  describe("P10 no request yet (conversation scope)", () => {
    it("→ present_code_request and continue_premise; only present carries the tool intent", () => {
      const cs = only(getEligibleCandidates(ctx()));
      expect(cs.map((c) => [c.moveId, c.toolIntent])).toEqual([
        ["present_code_request", "present_practice_code_request"],
        ["continue_premise", "none"],
      ]);
    });
    it("continue_premise never twice consecutively and at most twice per session", () => {
      expect(moves(getEligibleCandidates(ctx({ history: [past("continue_premise")] })))).toEqual(["present_code_request"]);
      expect(moves(getEligibleCandidates(ctx({ history: [past("continue_premise"), past("answer_identity"), past("continue_premise"), past("answer_procedure")] })))).toEqual(["present_code_request"]);
      expect(moves(getEligibleCandidates(ctx({ history: [past("continue_premise"), past("answer_identity")] })))).toEqual(["present_code_request", "continue_premise"]);
    });
    it("a presented request is never presented again", () => {
      expect(getEligibleCandidates(ctx({ request: PENDING }))).not.toMatchObject({ candidates: [expect.objectContaining({ moveId: "present_code_request" })] });
    });
  });

  it("P11 pending request, nothing else → wait", () => {
    expect(getEligibleCandidates(ctx({ request: { ...PENDING, status: "completed" } }))).toMatchObject({ kind: "wait", ruleId: "P11" });
  });

  it("no applied assessment for the latest message → wait", () => {
    expect(getEligibleCandidates(ctx({ assessment: null }))).toMatchObject({ kind: "wait" });
  });

  it("address_doubt at most once per issue", () => {
    const i = issue("identity_question", "You're lying, this is fake.");
    expect(moves(getEligibleCandidates(ctx({ issues: [i], history: [past("address_doubt", { issueId: i.id })] })))).toEqual(["answer_identity"]);
  });

  it("backs off once after a committed proof limit, then waits instead of answering the same challenge again", () => {
    const current = issue("identity_question", "Prove you are really from Cedar.");
    const first = ctx({ issues: [current], history: [past("address_doubt", { issueId: "i-old" })] });
    first.doubtBoundaryGiven = true;
    expect(moves(getEligibleCandidates(first))).toEqual(["back_off_doubt"]);
    const repeated = ctx({ issues: [current], history: [past("address_doubt", { issueId: "i-old" }), past("back_off_doubt", { issueId: current.id })], doubtBoundaryGiven: true });
    expect(getEligibleCandidates(repeated)).toMatchObject({ kind: "wait" });
    expect(moves(getEligibleCandidates(ctx({ issues: [issue("identity_question", "Who are you?")] })))).toEqual(["answer_identity"]);
  });
});

describe("Stage 2: candidate invariants", () => {
  it("ids are server-generated, stable within a revision, and change with the revision", () => {
    const a = only(getEligibleCandidates(ctx()));
    const b = only(getEligibleCandidates(ctx()));
    const c = only(getEligibleCandidates(ctx({ revision: 8 })));
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a[0].id).not.toBe(c[0].id);
    expect(a[0].id).toBe(candidateId(7, { moveId: "present_code_request", requestId: null, issueId: null, focus: "present_request" }));
  });

  it("every candidate carries all forbidden claim codes, ≤1 question, and never F06", () => {
    const cases = [ctx(), ctx({ issues: [issue("identity_question", "scam!"), issue("procedure_question", "how?")] }), ctx({ request: PENDING, a: { decision: { label: "refused", evidence: [ev("no")] } } })];
    for (const c of cases.flatMap((x) => only(getEligibleCandidates(x)))) {
      expect(c.constraints.forbiddenClaimCodes).toEqual(ForbiddenClaimCodeSchema.options);
      expect(c.constraints.maxQuestions).toBe(1);
      expect(c.constraints.allowedFactIds).not.toContain("F06");
      expect(c.revision).toBe(7);
      expect(c.evidenceRefs.some((r) => r.kind === "assessment")).toBe(true);
    }
  });

  it("clarify and acknowledge use 40 words and concise style only; answers allow both styles and 70 words", () => {
    const [answer] = only(getEligibleCandidates(ctx({ issues: [issue("procedure_question", "how?")] })));
    const [clarify] = only(getEligibleCandidates(ctx({ issues: [issue("decision_needs_clarification", "Okay.")] })));
    expect(answer.constraints).toMatchObject({ maxWords: 70, allowedStyles: ["concise_professional", "plain_explanatory"] });
    expect(clarify.constraints).toMatchObject({ maxWords: 40, allowedStyles: ["concise_professional"] });
  });
});
