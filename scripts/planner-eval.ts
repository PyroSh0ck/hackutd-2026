/**
 * Real-model evaluation of the planner + actor (planner brief §12 Stage 7). Separate from deterministic tests.
 *
 *   pnpm planner:eval                    # all cases + completed-exercise paths
 *   pnpm planner:eval --split heldout    # held-out cases only
 *
 * The session states are reached with the FIXTURE observer (so the observer's quality does not confound the
 * planner result); only the planner and actor are live. Uses MODEL_BASE_URL / MODEL_API_KEY / MODEL_ID
 * (optionally PLANNER_MODEL_ID, ACTOR_MODEL_ID, PLANNER_TIMEOUT_MS, OBSERVER_STRUCTURED_MODE) from env or
 * .env.local. No database writes. Never prints the API key or prompts. Exit: 0 gate pass, 1 fail, 2 blocked.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { plannerModels, readPlannerModelConfig } from "@/server/observer/model";
import { POLICY_VERSION } from "@/server/planner/eligibility";
import { PLANNER_EVAL_CASES } from "../tests/planner/eval/dataset";
import { buildCase, evaluateCase, EXERCISE_PATHS, plannerGate, plannerMetrics, runExercisePath, type PlannerPrediction } from "../tests/planner/eval/harness";

config({ path: ".env.local", quiet: true });

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const cfg = readPlannerModelConfig();
  if (!cfg.planner || !cfg.actor) {
    console.log("BLOCKED: planner/actor models not configured (need MODEL_BASE_URL, MODEL_API_KEY, MODEL_ID). Live planner evaluation NOT run.");
    process.exit(2);
  }
  const { planner, actor } = plannerModels(cfg);
  const split = arg("split") ?? "all";
  const cases = PLANNER_EVAL_CASES.filter((c) => split === "all" || c.split === split);
  console.log(`planner ${cfg.planner.modelId} | actor ${cfg.actor.modelId} | host ${new URL(cfg.planner.baseUrl).host} | mode ${cfg.mode} | timeout ${cfg.timeoutMs} ms | policy ${POLICY_VERSION} | cases ${cases.length}`);

  const preds: PlannerPrediction[] = [];
  for (const c of cases) {
    const p = await evaluateCase(c, await buildCase(c), planner, actor);
    preds.push(p);
    const mark = p.status === "prepared" && p.acceptableChoice && !p.forbiddenFindings.length && !p.hiddenLeaks.length ? "ok " : "-- ";
    console.log(`${mark}${c.id.padEnd(28)} ${c.split.padEnd(7)} ${p.status.padEnd(9)} move ${String(p.chosenMove).padEnd(22)} calls ${p.calls.planner}+${p.calls.actor} ${p.latencyMs}ms${p.failureReason ? ` (${p.failureReason})` : ""}${p.forbiddenFindings.length ? ` FORBIDDEN ${p.forbiddenFindings.join(",")}` : ""}${p.hiddenLeaks.length ? ` LEAK ${p.hiddenLeaks.join(",")}` : ""}`);
    if (p.text) console.log(`     "${p.text}"`);
  }
  const overall = plannerMetrics(preds);
  const heldout = plannerMetrics(preds.filter((p) => p.split === "heldout"));
  for (const [title, m] of [["overall", overall], ["held-out only", heldout]] as const) {
    console.log(`\n== ${title} (n=${m.cases}) ==`);
    console.log(`prepared ${m.prepared}/${m.cases} | eligible-choice ${m.eligibleChoiceRate} | acceptable-choice ${m.acceptableChoiceRate} | invalid-reference ${m.invalidReferenceRate} | planner repair ${m.plannerRepairRate} | actor repair ${m.actorRepairRate}`);
    console.log(`forbidden findings ${m.forbiddenFindings.length} | hidden leaks ${m.hiddenLeaks.length} | latency p50 ${m.latencyMs.p50} ms max ${m.latencyMs.max} ms | max calls ${m.maxCalls.planner}+${m.maxCalls.actor}`);
  }

  const paths: Array<Awaited<ReturnType<typeof runExercisePath>>> | null = split === "all" ? [] : null;
  if (paths) for (const path of EXERCISE_PATHS) paths.push(await runExercisePath(path, planner, actor));
  if (paths) for (const r of paths) console.log(`path ${r.id}: ${r.reached ? "reached" : "NOT reached"} ${r.outcome ?? "no outcome"} (expected ${r.expected}), ${r.assistantMessages} sender messages${r.notes.length ? `; ${r.notes.join("; ")}` : ""}`);

  const gate = plannerGate(overall);
  const pathsOk = !paths || paths.every((p) => p.reached);
  console.log(`\nRELEASE GATE (semantic part): ${gate.pass && pathsOk ? "PASS" : "FAIL"}${gate.reasons.length ? ` — ${gate.reasons.join("; ")}` : ""}${pathsOk ? "" : " — an exercise path did not reach its outcome"}`);
  console.log("Deterministic guarantees (no state mutation from models, no hidden-fact payloads) are covered by `pnpm check`. A small set passing is not proof of universal reliability.");

  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/planner-eval.json", JSON.stringify({ at: new Date().toISOString(), plannerModel: cfg.planner.modelId, actorModel: cfg.actor.modelId, mode: cfg.mode, policy: POLICY_VERSION, split, overall, heldout, paths, predictions: preds }, null, 2));
  console.log("evidence: test-results/planner-eval.json");
  process.exit(gate.pass && pathsOk ? 0 : 1);
}

main().catch((error) => {
  console.error("EVAL ERROR:", error instanceof Error ? error.message : error);
  process.exit(1);
});
