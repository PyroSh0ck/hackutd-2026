import { describe, expect, it } from "vitest";
import {
  ClaimedResultSchema,
  ConditionKindSchema,
  IssueKindSchema,
  ObserverAssessmentSchema,
  OBSERVER_SCHEMA_V1,
  SubmitEventRequestSchema,
  type KnownIssue,
  type ObserverAssessment,
} from "@/contracts/observer";
import { ActorOutputSchema, CandidateSchema, PlanSchema } from "@/contracts/planner";
import { contextFor, validateCandidate } from "@/server/observer/evidence";
import { upgradeAssessmentRecord } from "@/server/observer/history";
import { RUBRIC, RUBRIC_VERSION } from "@/server/observer/rubric";
import { assessment as v1Builder, inputFor, msg } from "../observer/fixtures";

const KNOWN: KnownIssue[] = [
  { id: "i-open", kind: "procedure_question", summary: "Where to verify", evidence: [{ messageId: "m-1", quote: "Where do I check?" }], status: "open", addressedMessageId: null },
  { id: "i-done", kind: "identity_question", summary: "Who is this", evidence: [{ messageId: "m-1", quote: "Where do I check?" }], status: "addressed", addressedMessageId: "m-2" },
];
const history = [msg("m-1", "user", "Where do I check?", 1), msg("m-2", "assistant", "Use the Verify independently control.", 1)];
const requestInput = (reply: string) => inputFor(reply, { history, knownIssues: KNOWN });
const conversationInput = (reply: string) => ({ ...requestInput(reply), scope: "conversation" as const, request: null });
const errorsOf = (raw: unknown, input = requestInput("x")) => validateCandidate(raw, contextFor(input)).errors.map((e) => `${e.field}:${e.code}`);
const base = (input: ReturnType<typeof requestInput>, over: Partial<ObserverAssessment> = {}): ObserverAssessment => ({ ...v1Builder(input, "unclear", null), ...over });

describe("Stage 1 (addendum §2): new enums and strict shapes", () => {
  it("enumerates exactly the specified kinds and results", () => {
    expect(IssueKindSchema.options).toEqual(["identity_question", "procedure_question", "scenario_fact_question", "condition_needs_clarification", "decision_needs_clarification"]);
    expect(ConditionKindSchema.options).toEqual(["independent_verification", "sender_proof", "procedure_answer", "other", "unspecified"]);
    expect(ClaimedResultSchema.options).toEqual(["supports_request", "contradicts_request", "inconclusive", "unspecified"]);
  });

  it("v2 output requires the new fields (no defaults for model output) and rejects unknown keys", () => {
    const input = requestInput("Where do I check independently?");
    const good = base(input);
    expect(ObserverAssessmentSchema.safeParse(good).success).toBe(true);
    const { openIssues: _o, ...missing } = good;
    void _o;
    expect(ObserverAssessmentSchema.safeParse(missing).success).toBe(false);
    expect(ObserverAssessmentSchema.safeParse({ ...good, openIssues: [{ kind: "identity_question", summary: "x", evidence: [{ messageId: "m-cur", quote: "Where" }], status: "open" }] }).success).toBe(false);
    expect(ObserverAssessmentSchema.safeParse({ ...good, condition: { description: "d", evidence: [] } }).success).toBe(false);
    expect(ObserverAssessmentSchema.safeParse({ ...good, verificationObservations: [{ behavior: "requested_sender_proof", channelProvenance: "unspecified", channelDescription: null, evidence: [] }] }).success).toBe(false);
  });

  it("issue drafts: 1–3 evidence spans, summary 1–240 chars, at most 5; acknowledgments need evidence", () => {
    const input = requestInput("Who are you? Where do I check?");
    const e = [{ messageId: "m-cur", quote: "Who are you?" }];
    const draft = (over = {}) => ({ kind: "identity_question", summary: "Asks who", evidence: e, ...over });
    expect(ObserverAssessmentSchema.safeParse(base(input, { openIssues: [draft({ evidence: [] }) as never] })).success).toBe(false);
    expect(ObserverAssessmentSchema.safeParse(base(input, { openIssues: [draft({ evidence: [e[0], e[0], e[0], e[0]] }) as never] })).success).toBe(false);
    expect(ObserverAssessmentSchema.safeParse(base(input, { openIssues: [draft({ summary: "x".repeat(241) }) as never] })).success).toBe(false);
    expect(ObserverAssessmentSchema.safeParse(base(input, { openIssues: Array.from({ length: 6 }, (_, i) => draft({ summary: `s${i}` })) as never })).success).toBe(false);
    expect(ObserverAssessmentSchema.safeParse(base(input, { issueAcknowledgments: [{ issueId: "i-done", evidence: [] }] })).success).toBe(false);
  });
});

describe("Stage 1 (addendum §3, §6): validation invariants", () => {
  it("conversation scope: requestId null, decision unclear with no evidence, condition null", () => {
    const input = conversationInput("Yes, I'll send the code.");
    const ok = { ...base(input), requestId: null };
    expect(errorsOf(ok, input)).toEqual([]);
    expect(errorsOf({ ...ok, requestId: "r-code" }, input)).toContain("requestId:invalid_scope");
    expect(errorsOf({ ...ok, decision: { label: "explicit_acceptance", evidence: [{ messageId: "m-cur", quote: "Yes" }] } }, input)).toEqual(expect.arrayContaining(["decision.label:invalid_scope"]));
    expect(errorsOf({ ...ok, decision: { label: "unclear", evidence: [{ messageId: "m-cur", quote: "Yes" }] } }, input)).toContain("decision.evidence:invalid_scope");
    expect(errorsOf({ ...ok, condition: { kind: "other", description: "d", evidence: [{ messageId: "m-cur", quote: "Yes" }] } }, input)).toContain("condition:invalid_scope");
    // Issues and observations may still be extracted in conversation scope.
    expect(errorsOf({ ...ok, openIssues: [{ kind: "procedure_question", summary: "s", evidence: [{ messageId: "m-cur", quote: "send the code" }] }] }, input)).toEqual([]);
  });

  it("request scope rejects a null requestId", () => {
    const input = requestInput("Okay.");
    expect(errorsOf({ ...base(input), requestId: null }, input)).toContain("requestId:invalid_request_reference");
  });

  it("claimedResult must be unspecified unless the behavior is a claimed completed check", () => {
    const input = requestInput("I'll check with Cedar myself first.");
    const o = (behavior: string, claimedResult: string) => ({ behavior, channelProvenance: "user_claimed_independent", channelDescription: null, claimedResult, evidence: [{ messageId: "m-cur", quote: "check with Cedar" }] });
    expect(errorsOf(base(input, { verificationObservations: [o("expressed_verification_intent", "contradicts_request") as never] }), input)).toContain("verificationObservations[0].claimedResult:inconsistent_fields");
    expect(errorsOf(base(input, { verificationObservations: [o("claimed_verification_completed", "contradicts_request") as never] }), input)).toEqual([]);
    expect(errorsOf(base(input, { verificationObservations: [{ ...(o("claimed_verification_completed", "contradicts_request") as object), evidence: [] } as never] }), input)).toContain("verificationObservations[0].evidence:missing_evidence");
  });

  it("issue evidence uses the exact-quote checks; duplicates within one output are rejected; multiple issues are fine", () => {
    const input = requestInput("Who are you? Where do I check?");
    const d = (quote: string, kind = "identity_question") => ({ kind, summary: "s", evidence: [{ messageId: "m-cur", quote }] });
    expect(errorsOf(base(input, { openIssues: [d("Who are you?"), d("Where do I check?", "procedure_question")] as never }), input)).toEqual([]);
    expect(errorsOf(base(input, { openIssues: [d("Who are YOU?")] as never }), input)).toContain("openIssues[0].evidence[0]:quote_not_found");
    expect(errorsOf(base(input, { openIssues: [d("Who are you?"), d("Who are you?")] as never }), input)).toContain("openIssues[1]:inconsistent_fields");
    expect(errorsOf(base(input, { openIssues: [{ ...d("x"), evidence: [{ messageId: "m-2", quote: "Use the Verify" }] }] as never }), input)).toContain("openIssues[0].evidence[0]:non_user_evidence");
  });

  it("acknowledgments must cite an ADDRESSED known issue of this session", () => {
    const input = requestInput("That answers my question about where to verify.");
    const ack = (issueId: string) => ({ issueAcknowledgments: [{ issueId, evidence: [{ messageId: "m-cur", quote: "That answers my question" }] }] });
    expect(errorsOf(base(input, ack("i-done")), input)).toEqual([]);
    expect(errorsOf(base(input, ack("i-open")), input)).toContain("issueAcknowledgments[0].issueId:invalid_issue_reference");
    expect(errorsOf(base(input, ack("i-other-session")), input)).toContain("issueAcknowledgments[0].issueId:invalid_issue_reference");
  });

  it("procedural question without acceptance is valid as unclear + issue; user claims contradicting the sender stay claims", () => {
    const input = requestInput("Where do I check independently?");
    expect(errorsOf(base(input, { openIssues: [{ kind: "procedure_question", summary: "where", evidence: [{ messageId: "m-cur", quote: "Where do I check independently?" }] }] }), input)).toEqual([]);
  });
});

describe("Stage 1 (addendum §7): v1 history is normalized only on read", () => {
  it("a v1 record parses after normalization; the v2 schema itself still rejects v1-shaped output", () => {
    const input = requestInput("Only after I check.");
    const v1Assessment = { requestId: "r-code", currentMessageId: "m-cur", decision: { label: "conditional_acceptance", evidence: [{ messageId: "m-cur", quote: "Only after I check." }] }, condition: { description: "check first", evidence: [{ messageId: "m-cur", quote: "Only after I check." }] }, verificationObservations: [{ behavior: "expressed_verification_intent", channelProvenance: "unspecified", channelDescription: null, evidence: [{ messageId: "m-cur", quote: "check" }] }], statedUnderstanding: null, ambiguities: [] };
    expect(ObserverAssessmentSchema.safeParse(v1Assessment).success).toBe(false);
    const record = upgradeAssessmentRecord({
      id: "a-1", sessionId: "s-1", requestId: "r-code", currentMessageId: "m-cur", basedOnRevision: 2, observerModel: "m", reviewerModel: null, rubricVersion: "observer-rubric-v1", schemaVersion: OBSERVER_SCHEMA_V1, reviewPolicy: "consequential_and_flagged",
      proposedAssessment: v1Assessment, finalAssessment: v1Assessment, validation: { structurallyValid: true, evidenceReferencesValid: true, errors: [], reviewFlags: [] }, repairAttempted: false, reviewStatus: "not_requested", reviewerResponse: null, resolution: "accepted", failureReason: null, attempts: [], application: "applied", createdAt: "2026-11-07T12:00:00.000Z",
    });
    expect(record.finalAssessment).toMatchObject({ openIssues: [], issueAcknowledgments: [], condition: { kind: "unspecified" }, verificationObservations: [{ claimedResult: "unspecified" }] });
    expect(input.rubricVersion).toBe(RUBRIC_VERSION);
    expect(RUBRIC_VERSION).toBe("observer-rubric-v2");
    expect(Object.keys(RUBRIC.issueDefinitions)).toEqual(IssueKindSchema.options);
  });
});

describe("Stage 1: planner/actor contracts are strict", () => {
  const plan = { candidateId: "c_1", basedOnRevision: 3, selectedFactIds: ["F01"], selectedAdditionIds: [], style: "concise_professional", contentFocus: "Answer the identity question.", evidenceRefs: [{ kind: "message", id: "m-1" }], briefJustification: "Direct question." };
  it("Plan: rejects unknown keys (incl. model-set action/move/tool), F06, unknown styles, oversize text and lists", () => {
    expect(PlanSchema.safeParse(plan).success).toBe(true);
    for (const bad of [
      { ...plan, action: "present_simulated_request" },
      { ...plan, toolIntent: "present_practice_code_request" },
      { ...plan, selectedFactIds: ["F06"] },
      { ...plan, style: "urgent" },
      { ...plan, contentFocus: "x".repeat(241) },
      { ...plan, briefJustification: "   " },
      { ...plan, evidenceRefs: Array.from({ length: 6 }, (_, i) => ({ kind: "message", id: `m-${i}` })) },
      { ...plan, evidenceRefs: [{ kind: "user", id: "m-1" }] },
      { ...plan, candidateId: "" },
    ]) {
      expect(PlanSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("ActorOutput: strict; no tool or request fields", () => {
    expect(ActorOutputSchema.safeParse({ text: "Hello.", usedFactIds: [], introducedAdditionIds: [] }).success).toBe(true);
    expect(ActorOutputSchema.safeParse({ text: "Hello.", usedFactIds: [], introducedAdditionIds: [], createRequest: true }).success).toBe(false);
    expect(ActorOutputSchema.safeParse({ text: "Hello.", usedFactIds: ["F06"], introducedAdditionIds: [] }).success).toBe(false);
    expect(ActorOutputSchema.safeParse({ text: "Hello.", usedFactIds: [], introducedAdditionIds: ["new_deadline"] }).success).toBe(false);
  });
  it("Candidate: strict and bounded", () => {
    expect(CandidateSchema.safeParse({ id: "c", revision: 0 }).success).toBe(false);
  });
  it("clients can send only the fictional code token, never arbitrary fields", () => {
    expect(SubmitEventRequestSchema.safeParse({ idempotencyKey: crypto.randomUUID(), type: "practice_code_submitted", requestId: "r", practiceCode: "12345" }).success).toBe(false);
    expect(SubmitEventRequestSchema.safeParse({ idempotencyKey: crypto.randomUUID(), type: "practice_code_submitted", requestId: "r", code: "123456" }).success).toBe(false);
  });
});
