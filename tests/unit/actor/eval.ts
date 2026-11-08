/** Offline replay or explicit live evaluation. Not imported by the app or deterministic tests.
 * pnpm exec tsx --conditions=react-server tests/unit/actor/eval.ts [--live] [--out /tmp/actor-eval.json]
 * Never loads env files; supply MODEL_* through the process environment for an explicit live run. */
import { writeFileSync } from "node:fs";
import { actorModelFromEnv, type ActorModel } from "@/server/actor/model";
import { runActor, type ActorExecutionState } from "@/server/actor/run";
import { ACTOR_PROMPT_VERSION } from "@/server/actor/prompts";
import { envelope } from "./fixtures";
import { EVALUATION_CASES, SEMANTIC_FAILURES, evaluationInput } from "./evaluation-fixtures";

async function main() {
  const live = process.argv.includes("--live");
  const provider = live ? actorModelFromEnv() : null;
  if (live && !provider) {
    console.log(JSON.stringify({ status: "blocked", reason: "MODEL_BASE_URL, MODEL_API_KEY and MODEL_ID are required for an explicit live evaluation.", liveCalls: 0 }));
    process.exitCode = 2; return;
  }
  const rows = [];
  let id = 0;
  for (const fixture of EVALUATION_CASES) {
    const model: ActorModel = provider ?? { modelId: "synthetic-replay", generate: async () => ({ ok: true, output: fixture.sampleOutput }) };
    const binding = { ...envelope(), actorPromptVersion: ACTOR_PROMPT_VERSION, modelId: model.modelId };
    const execution: ActorExecutionState = { sessionId: "session", ownerKey: "owner", claimId: "claim", claimValid: true, policyVersion: binding.policyVersion, planApplicable: true, stage: "active", ended: false, revision: 20 };
    const result = await runActor({ input: evaluationInput(fixture), envelope: binding,
      reserved: [{ id: "case_reference", text: "CD-123456", introduced: false }, { id: "team_label", text: "Account Review", introduced: false }], knownSecrets: ["938201"] },
    { model, readState: async () => execution, newId: () => `eval-${++id}` });
    rows.push({ id: fixture.id, split: fixture.split, writingQuality: fixture.writingQuality, expectedTarget: fixture.expectedTarget, forbiddenClaims: fixture.forbiddenClaims,
      status: result.kind, text: result.kind === "prepared" ? result.output.text : null, calls: result.calls,
      initialHardValid: result.attempts[0]?.status === "valid", repaired: result.attempts.some((a) => a.callKind === "repair"),
      latencyMs: result.attempts.reduce((total, a) => total + a.latencyMs, 0),
      styleMetrics: result.kind === "prepared" ? result.styleMetrics : null,
      semanticReview: { status: "pending", failureCategories: null, offendingSpan: null },
      humanWritingReview: fixture.writingQuality ? { status: "pending", relevance: null, naturalness: null, personaConsistency: null, planFidelity: null, reason: null } : null,
    });
  }
  const count = rows.length;
  const valid = rows.filter((r) => r.status === "prepared");
  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const summary = {
    mode: live ? "live_provider" : "synthetic_replay", schemaVersion: "actor-v2", promptVersion: ACTOR_PROMPT_VERSION, styleVersion: "style-v1",
    providerModel: provider?.modelId ?? "synthetic-replay", sampleCount: count, heldoutCount: rows.filter((r) => r.split === "heldout").length,
    initialSchemaReferencePassRate: rows.filter((r) => r.initialHardValid).length / count, finalHardValidationPassRate: valid.length / count,
    repairRate: rows.filter((r) => r.repaired).length / count, calls: rows.reduce((sum, r) => sum + r.calls, 0),
    callsPerPreparedResponse: valid.length ? rows.reduce((sum, r) => sum + r.calls, 0) / valid.length : null,
    latencyMs: { min: latencies[0], median: latencies[Math.floor(count / 2)], max: latencies[count - 1], mean: latencies.reduce((a, b) => a + b, 0) / count },
    latencyNote: live ? "Observed provider-call durations including any repair." : "Local replay preparation only; not provider latency.",
    softWarningRate: valid.length ? valid.filter((r) => r.styleMetrics?.warnings.length).length / valid.length : null,
    semanticReview: { status: "pending", categories: SEMANTIC_FAILURES, failures: null, passRate: null },
    writingReview: { status: "pending", sampleCount: rows.filter((r) => r.writingQuality).length, means: null,
      heldoutRatings: rows.filter((r) => r.writingQuality && r.split === "heldout").map((r) => ({ id: r.id, ...r.humanWritingReview })),
      anchors: { relevance: "1 misses the question; 3 partly answers with distraction; 5 directly addresses it", naturalness: "1 repetitive/awkward; 3 usable but stiff; 5 fluent and appropriate", personaConsistency: "1 contradicts identity/voice; 3 inconsistent register; 5 stable voice" } },
  };
  const report = { summary, cases: rows };
  const outIndex = process.argv.indexOf("--out");
  if (outIndex >= 0) {
    const path = process.argv[outIndex + 1]; if (!path) throw new Error("--out requires a path");
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(summary, null, 2));
}
main().catch(() => { console.error("Actor evaluation failed; no provider payload was logged."); process.exitCode = 1; });
