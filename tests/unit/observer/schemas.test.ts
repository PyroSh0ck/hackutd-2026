import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AppEventSchema,
  DECISION_LABELS,
  ObserverAssessmentSchema,
  ReviewerResponseSchema,
  SubmitEventRequestSchema,
  SubmitMessageRequestSchema,
  type ObserverAssessment,
  type ValidationError,
} from "@/contracts/observer";
import { contextFor, validateCandidate } from "@/server/observer/evidence";
import { RUBRIC, RUBRIC_VERSION } from "@/server/observer/rubric";
import { assessment, event, inputFor } from "./fixtures";

const input = inputFor("Yes, I'll send the code only after I check with official support.");
const ctx = contextFor(input);
const codes = (errors: ValidationError[]) => errors.map((e) => e.code);

describe("Stage 1: valid assessments for every decision category", () => {
  const cases: Array<[ObserverAssessment["decision"]["label"], ObserverAssessment]> = [
    ["refused", assessment(input, "refused", "Yes, I'll send the code")],
    ["considering", assessment(input, "considering", "only after I check")],
    [
      "conditional_acceptance",
      assessment(input, "conditional_acceptance", "I'll send the code only after I check with official support", {
        condition: { description: "Checks with official support first", evidence: [{ messageId: "m-cur", quote: "only after I check with official support" }] },
      }),
    ],
    ["explicit_acceptance", assessment(input, "explicit_acceptance", "Yes, I'll send the code")],
    ["unclear", assessment(input, "unclear", null)],
  ];
  it.each(cases)("%s passes structural + cross-field validation (shape only, not meaning)", (_label, candidate) => {
    const result = validateCandidate(candidate, ctx);
    expect(result.errors).toEqual([]);
    expect(result.structurallyValid && result.evidenceReferencesValid).toBe(true);
    expect(result.assessment).toEqual(candidate);
  });

  it("covers every label in the schema", () => {
    expect(cases.map(([l]) => l).sort()).toEqual([...DECISION_LABELS].sort());
  });

  it("unclear may carry evidence of ambiguity; ambiguities may have empty evidence", () => {
    const candidate = assessment(input, "unclear", "only after I check", {
      ambiguities: [{ field: "decision", description: "Which check is meant is not stated.", evidence: [] }],
    });
    expect(validateCandidate(candidate, ctx).errors).toEqual([]);
  });

  it("verification observations of every behavior/provenance, coexisting", () => {
    const candidate = assessment(input, "unclear", null, {
      verificationObservations: [
        { behavior: "expressed_verification_intent", channelProvenance: "user_claimed_independent", channelDescription: "official support", evidence: [{ messageId: "m-cur", quote: "check with official support" }] },
        { behavior: "requested_sender_proof", channelProvenance: "sender_supplied", channelDescription: null, evidence: [{ messageId: "m-cur", quote: "Yes" }] },
        { behavior: "claimed_verification_completed", channelProvenance: "unspecified", channelDescription: null, evidence: [{ messageId: "m-cur", quote: "I check" }] },
      ],
      statedUnderstanding: { description: "Believes support can confirm", evidence: [{ messageId: "m-cur", quote: "official support" }] },
    });
    expect(validateCandidate(candidate, ctx).errors).toEqual([]);
  });
});

describe("Stage 1: invalid structures are rejected with specific codes", () => {
  const base = assessment(input, "explicit_acceptance", "Yes, I'll send the code");
  const cases: Array<[string, unknown, ValidationError["code"], string?]> = [
    ["null output", null, "invalid_structure"],
    ["string output", "explicit_acceptance", "invalid_structure"],
    ["array output", [base], "invalid_structure"],
    ["missing decision", { ...base, decision: undefined }, "invalid_structure", "decision"],
    ["missing condition key (null required, not absent)", Object.fromEntries(Object.entries(base).filter(([k]) => k !== "condition")), "invalid_structure", "condition"],
    ["unknown top-level key (server-owned action)", { ...base, action: { status: "completed" } }, "invalid_structure", "(root)"],
    ["unknown key in decision (confidence score)", { ...base, decision: { ...base.decision, confidence: 0.9 } }, "invalid_structure", "decision"],
    ["unknown key in evidence", { ...base, decision: { ...base.decision, evidence: [{ messageId: "m-cur", quote: "Yes", role: "user" }] } }, "invalid_structure"],
    ["unknown decision label", { ...base, decision: { ...base.decision, label: "maybe" } }, "invalid_category", "decision.label"],
    ["app-owned verification label", { ...base, verificationObservations: [{ behavior: "completed_in_app_verification", channelProvenance: "unspecified", channelDescription: null, evidence: [] }] }, "invalid_category", "verificationObservations[0].behavior"],
    ["app_known_official provenance", { ...base, verificationObservations: [{ behavior: "expressed_verification_intent", channelProvenance: "app_known_official", channelDescription: null, evidence: [] }] }, "invalid_category", "verificationObservations[0].channelProvenance"],
    ["empty quote", { ...base, decision: { ...base.decision, evidence: [{ messageId: "m-cur", quote: "" }] } }, "invalid_structure"],
    ["over-long quote", { ...base, decision: { ...base.decision, evidence: [{ messageId: "m-cur", quote: "x".repeat(401) }] } }, "invalid_structure"],
    ["too many evidence spans", { ...base, decision: { ...base.decision, evidence: Array.from({ length: 7 }, () => ({ messageId: "m-cur", quote: "Yes" })) } }, "invalid_structure"],
    ["blank condition description", { ...base, decision: { ...base.decision, label: "conditional_acceptance" }, condition: { description: "   ", evidence: [] } }, "invalid_structure"],
    ["too many ambiguities", { ...base, ambiguities: Array.from({ length: 7 }, () => ({ field: "decision", description: "x", evidence: [] })) }, "invalid_structure"],
    ["malformed message id", { ...base, decision: { ...base.decision, evidence: [{ messageId: "m cur; drop", quote: "Yes" }] } }, "invalid_structure"],
    ["evidence not an array", { ...base, decision: { ...base.decision, evidence: { messageId: "m-cur", quote: "Yes" } } }, "invalid_structure"],
  ];
  it.each(cases)("%s → %s", (_name, raw, code, field) => {
    const result = validateCandidate(raw, ctx);
    expect(result.structurallyValid).toBe(false);
    expect(result.assessment).toBeNull();
    expect(codes(result.errors)).toContain(code);
    if (field) expect(result.errors.map((e) => e.field)).toContain(field);
  });
});

describe("Stage 1: cross-field and reference invariants", () => {
  const cond = { description: "After checking with support", evidence: [{ messageId: "m-cur", quote: "only after I check" }] };
  const cases: Array<[string, ObserverAssessment, ValidationError["code"], string]> = [
    ["acceptance without evidence", assessment(input, "explicit_acceptance", null), "missing_evidence", "decision.evidence"],
    ["refusal without evidence", assessment(input, "refused", null), "missing_evidence", "decision.evidence"],
    ["considering without evidence", assessment(input, "considering", null), "missing_evidence", "decision.evidence"],
    ["conditional without condition", assessment(input, "conditional_acceptance", "Yes, I'll send the code"), "missing_condition", "condition"],
    ["conditional with evidence-less condition", assessment(input, "conditional_acceptance", "Yes", { condition: { ...cond, evidence: [] } }), "missing_evidence", "condition.evidence"],
    ["refused with a condition", assessment(input, "refused", "Yes", { condition: cond }), "inconsistent_fields", "condition"],
    ["explicit acceptance with a condition", assessment(input, "explicit_acceptance", "Yes", { condition: cond }), "inconsistent_fields", "condition"],
    [
      "verification observation without evidence",
      assessment(input, "unclear", null, { verificationObservations: [{ behavior: "requested_sender_proof", channelProvenance: "unspecified", channelDescription: null, evidence: [] }] }),
      "missing_evidence",
      "verificationObservations[0].evidence",
    ],
    ["stated understanding without evidence", assessment(input, "unclear", null, { statedUnderstanding: { description: "x", evidence: [] } }), "missing_evidence", "statedUnderstanding.evidence"],
    ["wrong request id", { ...assessment(input, "unclear", null), requestId: "r-other" }, "invalid_request_reference", "requestId"],
    ["wrong current message id", { ...assessment(input, "unclear", null), currentMessageId: "m-intro" }, "invalid_message_reference", "currentMessageId"],
  ];
  it.each(cases)("%s → %s at %s", (_name, candidate, code, field) => {
    const result = validateCandidate(candidate, ctx);
    expect(result.structurallyValid).toBe(true);
    expect(result.assessment).toBeNull();
    expect(result.errors).toContainEqual(expect.objectContaining({ code, field }));
  });
});

describe("Stage 1: server-owned schemas and HTTP inputs", () => {
  it("app events reject payload fields (no stored codes) and unknown types", () => {
    expect(AppEventSchema.safeParse(event("e1", "practice_code_submitted", "r-code")).success).toBe(true);
    expect(AppEventSchema.safeParse({ ...event("e1", "practice_code_submitted", "r-code"), code: "123456" }).success).toBe(false);
    expect(AppEventSchema.safeParse({ ...event("e1", "practice_code_submitted", "r-code"), type: "completed_in_app_verification" }).success).toBe(false);
  });

  it("clients cannot supply ids, turns, timestamps, owner ids, or code contents", () => {
    const key = "4b7e3a52-8a0f-4c2f-9b55-7c0b8a1d2e3f";
    expect(SubmitEventRequestSchema.safeParse({ idempotencyKey: key, type: "practice_code_submitted", requestId: "r1" }).success).toBe(true);
    for (const extra of [{ id: "e1" }, { turn: 3 }, { createdAt: new Date().toISOString() }, { content: "123456" }, { sessionId: "s" }]) {
      expect(SubmitEventRequestSchema.safeParse({ idempotencyKey: key, type: "practice_code_submitted", requestId: "r1", ...extra }).success).toBe(false);
    }
    expect(SubmitMessageRequestSchema.safeParse({ idempotencyKey: key, content: "hi", ownerId: "x" }).success).toBe(false);
    expect(SubmitMessageRequestSchema.safeParse({ idempotencyKey: key, content: "   " }).success).toBe(false);
    expect(SubmitMessageRequestSchema.safeParse({ idempotencyKey: key, content: "x".repeat(1001) }).success).toBe(false);
  });

  it("reviewer response needs at least one finding and rejects unknown keys", () => {
    expect(ReviewerResponseSchema.safeParse({ verdict: "supported", findings: [], correctedAssessment: null }).success).toBe(false);
    expect(
      ReviewerResponseSchema.safeParse({ verdict: "supported", findings: [{ field: "decision", verdict: "supported", explanation: "ok", evidence: [] }], correctedAssessment: null, agreed: true }).success,
    ).toBe(false);
  });

  it("rubric is versioned and defines every category", () => {
    expect(RUBRIC_VERSION).toMatch(/^observer-rubric-v\d+$/);
    expect(Object.keys(RUBRIC.decisionDefinitions).sort()).toEqual([...DECISION_LABELS].sort());
    expect(Object.keys(RUBRIC.verificationDefinitions).sort()).toEqual(["claimed_verification_completed", "expressed_verification_intent", "requested_sender_proof"]);
    expect(Object.keys(RUBRIC.channelDefinitions).sort()).toEqual(["sender_supplied", "unspecified", "user_claimed_independent"]);
  });

  it("generated JSON Schema is strict at every object level and lists only allowed enums", () => {
    const schema = z.toJSONSchema(ObserverAssessmentSchema) as Record<string, unknown>;
    const objects: Array<Record<string, unknown>> = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object") objects.push(n);
      Object.values(n).forEach(walk);
    };
    walk(schema);
    expect(objects.length).toBeGreaterThanOrEqual(6);
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
    }
    const text = JSON.stringify(schema);
    expect(text).not.toContain("completed_in_app_verification");
    expect(text).not.toContain("app_known_official");
    expect(text).not.toMatch(/"(action|status|confidence)"/);
  });
});
