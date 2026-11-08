/**
 * Real-model semantic evaluation of the observer (brief §10 Stage 7). Separate from deterministic tests.
 *
 *   pnpm observer:eval                    # all cases, configured observer + reviewer
 *   pnpm observer:eval --split heldout    # held-out cases only
 *   pnpm observer:eval --repeat 2         # re-run critical cases to check consistency
 *
 * Uses MODEL_BASE_URL / MODEL_API_KEY / MODEL_ID (optionally OBSERVER_MODEL_ID / OBSERVER_REVIEWER_MODEL_ID,
 * OBSERVER_STRUCTURED_MODE, OBSERVER_REVIEW_POLICY, OBSERVER_TIMEOUT_MS) from env or .env.local.
 * No database writes. Never prints the API key or prompts. Exit: 0 gate pass, 1 gate fail, 2 blocked.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { readObserverModelConfig, structuredModels } from "@/server/observer/model";
import { RUBRIC_VERSION } from "@/server/observer/rubric";
import { runObserver } from "@/server/observer/run";
import { EVAL_CASES } from "../tests/observer/eval/dataset";
import { buildEvalInput, toPrediction, type Prediction } from "../tests/observer/eval/harness";
import { computeMetrics, type Metrics } from "../tests/observer/eval/metrics";

config({ path: ".env.local", quiet: true });

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function print(title: string, m: Metrics) {
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  console.log(`\n== ${title} (n=${m.n}) ==`);
  console.log(`accuracy ${pct(m.accuracy)} | unclear rate ${pct(m.unclearRate)} | non-unclear coverage ${pct(m.nonUnclearCoverage)} | selective accuracy ${pct(m.selectiveAccuracy)}`);
  console.log(`false acceptance ${m.falseAcceptance.count}/${m.falseAcceptance.nonAcceptanceGold} (${pct(m.falseAcceptance.rate)}) ${m.falseAcceptance.caseIds.join(", ")}`);
  console.log(`critical wrong explicit_acceptance: ${m.criticalWrongAcceptance.count} ${m.criticalWrongAcceptance.caseIds.join(", ")}`);
  for (const [label, s] of Object.entries(m.perLabel)) console.log(`  ${label.padEnd(23)} P ${pct(s.precision).padStart(6)}  R ${pct(s.recall).padStart(6)}  support ${s.support}  predicted ${s.predicted}`);
  console.log("confusion (rows gold → cols predicted):");
  const labels = Object.keys(m.confusion);
  console.log(`  ${"".padEnd(23)} ${labels.map((l) => l.slice(0, 6).padStart(7)).join("")}`);
  for (const gold of labels) console.log(`  ${gold.padEnd(23)} ${labels.map((p) => String(m.confusion[gold as keyof typeof m.confusion][p as keyof typeof m.confusion]).padStart(7)).join("")}`);
  console.log(`evidence refs valid (first output) ${m.evidenceReferenceValidity.valid}/${m.evidenceReferenceValidity.of} | gold evidence matched ${m.evidenceMatch.matched}/${m.evidenceMatch.of} | verification matched ${m.verificationMatch.matched}/${m.verificationMatch.of}`);
  console.log(`review rate ${pct(m.reviewRate)} | correction rate ${pct(m.correctionRate)} | fallback rate ${pct(m.fallbackRate)} | calls/turn mean ${m.callsPerTurn.mean?.toFixed(2)} max ${m.callsPerTurn.max} ${JSON.stringify(m.callsPerTurn.histogram)}`);
  console.log(`latency p50 ${m.latencyMs.p50} ms | p95 ${m.latencyMs.p95} ms | max ${m.latencyMs.max} ms | invented server fields ${m.inventedServerFields}`);
}

async function main() {
  const cfg = readObserverModelConfig();
  if (!cfg.observer) {
    console.log("BLOCKED: observer model not configured (need MODEL_BASE_URL, MODEL_API_KEY, MODEL_ID). Live semantic evaluation NOT run.");
    process.exit(2);
  }
  const models = structuredModels(cfg);
  const split = arg("split") ?? "all";
  const repeat = Math.max(1, Math.min(5, Number(arg("repeat") ?? 1)));
  const cases = EVAL_CASES.filter((c) => split === "all" || c.split === split);
  console.log(`observer ${cfg.observer.modelId} | reviewer ${cfg.reviewer?.modelId} | host ${new URL(cfg.observer.baseUrl).host} | mode ${cfg.mode} | policy ${cfg.reviewPolicy} | timeout ${cfg.timeoutMs} ms | rubric ${RUBRIC_VERSION} | cases ${cases.length}`);

  const preds: Prediction[] = [];
  const consistency: Array<{ caseId: string; labels: string[] }> = [];
  for (const c of cases) {
    const labels: string[] = [];
    const runs = c.critical ? repeat : 1;
    for (let r = 0; r < runs; r++) {
      const started = Date.now();
      const outcome = await runObserver(buildEvalInput(c), { ...models, policy: cfg.reviewPolicy, timeoutMs: cfg.timeoutMs });
      const p = toPrediction(c, outcome, Date.now() - started);
      labels.push(p.predicted);
      if (r === 0) {
        preds.push(p);
        const mark = p.predicted === p.gold ? "ok " : c.critical && p.predicted === "explicit_acceptance" ? "XX " : "-- ";
        console.log(`${mark}${c.id.padEnd(34)} gold ${p.gold.padEnd(22)} got ${p.predicted.padEnd(22)} ${p.resolution}/${p.reviewStatus}${p.failureReason ? ` (${p.failureReason})` : ""} calls ${p.calls} ${p.latencyMs}ms`);
      }
    }
    if (runs > 1) consistency.push({ caseId: c.id, labels });
  }

  const overall = computeMetrics(preds);
  const heldout = computeMetrics(preds.filter((p) => p.split === "heldout"));
  print("overall", overall);
  print("held-out only", heldout);
  if (consistency.length) {
    const unstable = consistency.filter((x) => new Set(x.labels).size > 1);
    console.log(`\nconsistency (critical cases × ${repeat}): ${consistency.length - unstable.length}/${consistency.length} stable${unstable.length ? `; unstable: ${unstable.map((x) => `${x.caseId} [${x.labels.join(", ")}]`).join("; ")}` : ""}`);
  }
  console.log(`\nRELEASE GATE (semantic part): ${overall.releaseGate.pass ? "PASS" : "FAIL"}${overall.releaseGate.reasons.length ? ` — ${overall.releaseGate.reasons.join("; ")}` : ""}`);
  console.log("Deterministic part of the gate is separate: run `pnpm check`. A small set passing is not a calibrated guarantee.");

  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/observer-eval.json",
    JSON.stringify({ at: new Date().toISOString(), observerModel: cfg.observer.modelId, reviewerModel: cfg.reviewer?.modelId, mode: cfg.mode, policy: cfg.reviewPolicy, rubricVersion: RUBRIC_VERSION, split, overall, heldout, consistency, predictions: preds }, null, 2),
  );
  console.log("evidence: test-results/observer-eval.json");
  process.exit(overall.releaseGate.pass ? 0 : 1);
}

main().catch((error) => {
  console.error("EVAL ERROR:", error instanceof Error ? error.message : error);
  process.exit(1);
});
