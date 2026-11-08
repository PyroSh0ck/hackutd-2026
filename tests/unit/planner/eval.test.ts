import { describe, expect, it } from "vitest";
import type { StructuredModel, StructuredRequest, StructuredResult } from "@/server/observer/model";
import { MOVES } from "@/server/planner/eligibility";
import { FixtureActorModel, FixturePlannerModel } from "@/server/planner/testing/fixture-models";
import { PLANNER_EVAL_CASES, REQUIRED_ACTIONS } from "../../planner/eval/dataset";
import { buildCase, evaluateCase, EXERCISE_PATHS, plannerGate, plannerMetrics, runExercisePath, type PlannerPrediction } from "../../planner/eval/harness";

describe("Stage 7: planner eval set is well-formed (data checks, not model quality)", () => {
  it("≥20 unique cases, ≥5 held out, covering every action, ambiguity, verification claims, conflicts and injection", () => {
    expect(PLANNER_EVAL_CASES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PLANNER_EVAL_CASES.map((c) => c.id)).size).toBe(PLANNER_EVAL_CASES.length);
    expect(PLANNER_EVAL_CASES.filter((c) => c.split === "heldout").length).toBeGreaterThanOrEqual(5);
    const actions = new Set(PLANNER_EVAL_CASES.flatMap((c) => c.acceptable.map((m) => MOVES[m].action)));
    expect([...actions].sort()).toEqual([...REQUIRED_ACTIONS].sort());
    for (const tag of ["ambiguity", "verification-claim", "conflicting", "injection", "fallback", "multi-issue"]) expect(PLANNER_EVAL_CASES.some((c) => c.tags.includes(tag))).toBe(true);
    expect(PLANNER_EVAL_CASES.filter((c) => c.split === "heldout" && c.tags.includes("injection")).length).toBeGreaterThanOrEqual(1);
    for (const c of PLANNER_EVAL_CASES) for (const m of c.acceptable) expect(c.candidates).toContain(m);
  });

  it.each(PLANNER_EVAL_CASES.map((c) => [c.id, c] as const))("%s reaches its state; the declared candidate set equals the rules' output", async (_id, c) => {
    const built = await buildCase(c);
    expect(built.candidates).toEqual(c.candidates);
  });
});

/** A planner that picks the first candidate whose move is NOT acceptable (or an out-of-set id) — must be caught. */
class Contrarian implements StructuredModel {
  readonly modelId = "contrarian";
  private readonly inner = new FixturePlannerModel();
  async generate(request: StructuredRequest): Promise<StructuredResult> {
    const r = await this.inner.generate(request);
    if (!r.ok) return r;
    return { ok: true, output: { ...(r.output as object), candidateId: "c_not_supplied" } };
  }
}
class Leaky implements StructuredModel {
  readonly modelId = "leaky";
  async generate(): Promise<StructuredResult> {
    return { ok: true, output: { text: "Your line will be suspended within 10 minutes unless you pay the $50 fee.", usedFactIds: [], introducedAdditionIds: [] } };
  }
}

describe("Stage 7: offline harness run (wiring only; NOT a semantic result)", () => {
  it("fixture planner/actor: every choice eligible, zero forbidden content, zero hidden leaks, within budget", async () => {
    const preds: PlannerPrediction[] = [];
    for (const c of PLANNER_EVAL_CASES) preds.push(await evaluateCase(c, await buildCase(c), new FixturePlannerModel(), new FixtureActorModel()));
    const m = plannerMetrics(preds);
    expect(m.failures).toEqual([]);
    expect(m.hiddenLeaks).toEqual([]);
    expect(m.forbiddenFindings).toEqual([]);
    expect(m.eligibleChoiceRate).toBe(1);
    expect(m.maxCalls).toEqual({ planner: 1, actor: 1 });
    expect(plannerGate(m).pass).toBe(true);
  });

  it("the metrics detect bad planners and bad actors (the harness can fail)", async () => {
    const c = PLANNER_EVAL_CASES.find((x) => x.id === "injection-no-request")!;
    const built = await buildCase(c);
    const bad = await evaluateCase(c, built, new Contrarian(), new FixtureActorModel());
    expect(bad).toMatchObject({ status: "rejected", chosenMove: null, plannerRepair: true });
    // Runtime content rules (threat, fee) now block this draft after the single repair: it is never
    // prepared, so nothing could be delivered. The eval's own screens remain a second line of defence.
    const leaky = await evaluateCase(c, built, new FixturePlannerModel(), new Leaky());
    expect(leaky.status).not.toBe("prepared");
    expect(leaky.forbiddenFindings).toEqual([]);
    const m = plannerMetrics([bad, leaky]);
    expect(m.eligibleChoiceRate).toBe(0.5);
    const gate = plannerGate(m);
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join(" ")).toMatch(/prepared rate 0 < 0.9/);
  });

  it.each(EXERCISE_PATHS.map((p) => [p.id, p] as const))("completed-exercise path %s reaches its outcome (fixture models)", async (_id, path) => {
    const r = await runExercisePath(path, new FixturePlannerModel(), new FixtureActorModel());
    expect(r.notes).toEqual([]);
    expect(r.outcome).toBe(path.outcome);
  });
});
