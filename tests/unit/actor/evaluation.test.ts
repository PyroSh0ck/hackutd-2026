import { describe, expect, it } from "vitest";
import { ActorInputSchema } from "@/server/actor/schemas";
import { validateActorOutput } from "@/server/actor/validate";
import { runActor } from "@/server/actor/run";
import { options, setup } from "./harness";
import { EVALUATION_CASES, SEMANTIC_FAILURES, SEMANTIC_NEGATIVE_PROBES, evaluationInput } from "./evaluation-fixtures";

describe("behavioral/writing evaluation fixtures (synthetic replay; human ratings pending)", () => {
  it("has at least 20 behavioral cases, five held out, and a 12-case writing subset with 8/4 split", () => {
    expect(EVALUATION_CASES.length).toBeGreaterThanOrEqual(20); expect(new Set(EVALUATION_CASES.map((c) => c.id)).size).toBe(EVALUATION_CASES.length);
    expect(EVALUATION_CASES.filter((c) => c.split === "heldout").length).toBeGreaterThanOrEqual(5);
    const writing = EVALUATION_CASES.filter((c) => c.writingQuality); expect(writing).toHaveLength(12); expect(writing.filter((c) => c.split === "heldout")).toHaveLength(4);
    expect(new Set(EVALUATION_CASES.map((c) => c.action)).size).toBe(6);
    for (const c of EVALUATION_CASES) { expect(c.expectedTarget.length).toBeGreaterThan(10); expect(c.forbiddenClaims.length).toBeGreaterThan(0); }
  });
  it.each(EVALUATION_CASES.map((c) => [c.id, c] as const))("%s has valid runtime input and a structurally valid synthetic sample", async (_id, c) => {
    const actorInput = evaluationInput(c); expect(ActorInputSchema.safeParse(actorInput).success).toBe(true);
    const s = setup([{ ok: true, output: c.sampleOutput }]); const result = await runActor({ ...options(), input: actorInput }, s.deps);
    expect(result).toMatchObject({ kind: "prepared", calls: 1 });
    // This checks metadata/schema only. No actor self-grading or semantic claim is made.
  });
  it("runtime content rules block the unauthorized request; the other four semantic failures still pass deterministic validation", () => {
    expect(new Set(SEMANTIC_NEGATIVE_PROBES.map((p) => p.category))).toEqual(new Set(SEMANTIC_FAILURES));
    for (const probe of SEMANTIC_NEGATIVE_PROBES) {
      const c = EVALUATION_CASES.find((c) => c.id === probe.caseId)!;
      expect(probe.text).toContain(probe.offendingSpan);
      const actorInput = evaluationInput(c);
      const v = validateActorOutput({ text: probe.text, usedFactIds: [], introducedAdditionIds: [] }, actorInput, { reserved: options().reserved, knownSecrets: options().knownSecrets, state: setup().current });
      if (probe.category === "unauthorized_request") {
        expect(v.valid).toBe(false);
        expect(v.violations).toEqual([expect.objectContaining({ code: "prohibited_content", detail: expect.stringMatching(/^CR2_code_request at \d+-\d+$/) })]);
      } else {
        // Honest limit: these are semantic errors no deterministic rule here detects.
        expect(v.valid, `${probe.category}: ${probe.reason}`).toBe(true);
      }
    }
  });
  it("reports replay hard-pass/soft-warning/call rates separately; human means stay pending", async () => {
    let valid = 0; let warnings = 0; let calls = 0;
    for (const c of EVALUATION_CASES) {
      const s = setup([{ ok: true, output: c.sampleOutput }]);
      const result = await runActor({ ...options(), input: evaluationInput(c) }, s.deps);
      calls += result.calls;
      if (result.kind === "prepared") { valid++; if (result.styleMetrics?.warnings.length) warnings++; }
    }
    expect(valid).toBe(21); expect(calls).toBe(21); expect(warnings).toBeGreaterThan(0);
    console.info(JSON.stringify({ mode: "synthetic_replay", sampleCount: 21, heldout: 6, writingSubset: 12, hardValidationPassRate: valid / 21, softWarningRate: warnings / 21, repairRate: 0, callsPerResponse: calls / 21, latency: "7 ms per call from injected fixture clock; not provider latency", humanRatings: "pending", humanMeans: null, semanticPassRate: null }));
  });
});
