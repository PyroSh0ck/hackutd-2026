/**
 * Live practice-pipeline smoke test (the legacy `game:smoke` only exercises the old /play game).
 *
 *   pnpm practice:smoke            # live models from env/.env.local; SpacetimeDB if TRAINING_BACKEND=spacetime
 *
 * Exit codes: 0 all checks passed · 1 a check failed · 2 BLOCKED (live provider not configured).
 * Never falls back to fixture models. Prints configuration NAMES and model ids only, never values.
 * Evidence (redacted: no practice code, no token, no prompts) is written to tmp/practice-smoke-<ts>.json.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { readModelConfig } from "@/server/game/opponent/client";
import { SpacetimeBackend, spacetimeConfigFromEnv } from "@/server/engine/spacetime-backend";
import { actorModelFromEnv } from "@/server/actor/model";
import { plannerModels, readObserverModelConfig, readPlannerModelConfig, structuredModels } from "@/server/observer/model";
import { ObserverService } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import { toolPlannerFromEnv } from "@/server/planner/tool-model";

config({ path: ".env.local", quiet: true });

type Check = { name: string; ok: boolean; detail: string; ms?: number };

async function main() {
  const required = ["MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_ID"] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length || !readModelConfig(process.env)) {
    console.log(`BLOCKED: live provider not configured (missing: ${missing.join(", ") || "valid model config"}). Live acceptance not run.`);
    process.exit(2);
  }
  const observerConfig = readObserverModelConfig();
  const planning = readPlannerModelConfig();
  const tools = process.env.PLANNER_PROTOCOL === "tools";
  const spacetime = process.env.TRAINING_BACKEND === "spacetime" ? spacetimeConfigFromEnv() : null;
  if (process.env.TRAINING_BACKEND === "spacetime" && !spacetime) {
    console.log("FAIL: TRAINING_BACKEND=spacetime but SpacetimeDB is not configured.");
    process.exit(1);
  }
  const service = new ObserverService({
    ...(spacetime ? { backend: new SpacetimeBackend(spacetime) } : { store: new MemoryObserverStore() }),
    models: () => structuredModels(observerConfig),
    policy: observerConfig.reviewPolicy,
    timeoutMs: observerConfig.timeoutMs,
    planning: {
      models: () => ({ planner: plannerModels(planning).planner, actor: actorModelFromEnv() }),
      timeoutMs: planning.timeoutMs,
      ...(tools ? { toolPlanner: () => toolPlannerFromEnv() } : {}),
    },
  });
  const owner = `anon:practice-smoke-${randomUUID()}`;
  const checks: Check[] = [];
  const evidence: Record<string, unknown> = {
    models: { provider: new URL(process.env.MODEL_BASE_URL!).host, model: process.env.MODEL_ID, planner: process.env.PLANNER_MODEL_ID || process.env.MODEL_ID, actor: process.env.ACTOR_MODEL_ID || process.env.MODEL_ID },
    plannerProtocol: tools ? "tools" : "structured",
    backend: service.backend.name,
  };
  const timed = async <T>(fn: () => Promise<T>) => {
    const t = performance.now();
    const value = await fn();
    return { value, ms: Math.round(performance.now() - t) };
  };

  const { sessionId } = (await service.createSession(owner)).session;
  const first = await timed(() => service.submitMessage(owner, sessionId, { idempotencyKey: randomUUID(), content: "Who is this, and which company are you with?" }));
  const assessments = await service.assessments(owner, sessionId);
  const a = assessments.at(-1);
  checks.push({ name: "observer structured response with validated evidence", ok: Boolean(a && a.resolution !== "unclear_fallback" && a.validation.structurallyValid && a.validation.evidenceReferencesValid), detail: a ? `${a.finalAssessment.decision.label} · ${a.resolution} · review ${a.reviewStatus}` : "no assessment", ms: first.ms });
  const plans = await service.plans(owner, sessionId);
  const committed = plans.find((p) => p.status === "committed");
  checks.push({ name: "opponent reply committed", ok: Boolean(committed), detail: committed ? `move committed (${committed.plannerProtocol ?? "structured"})` : `plans: ${plans.map((p) => `${p.status}:${p.failureReason ?? ""}`).join(", ")}` });
  if (tools) {
    const calls = committed?.toolCalls ?? [];
    checks.push({
      name: "planner tool calls with provider call ids (context read + move execution)",
      ok: calls.length >= 2 && calls[0].name === "get_training_context" && calls.some((c) => c.name === "execute_training_move") && calls.every((c) => c.callId.length > 0),
      detail: calls.map((c) => `${c.name}:${c.status}:${c.callId.slice(0, 12)}`).join(" | ") || "no tool calls",
    });
  }
  evidence.turn1 = { latencyMs: first.ms, assessment: a && { label: a.finalAssessment.decision.label, resolution: a.resolution, attempts: a.attempts.map((x) => ({ stage: x.stage, outcome: x.outcome, latencyMs: x.latencyMs })) }, plan: committed && { attempts: committed.attempts, toolCalls: committed.toolCalls, actorAttempts: committed.actorAudit?.attempts.length } };

  // Stop during the session: a terminal stop must prevent any later response.
  await service.submitEvent(owner, sessionId, { idempotencyKey: randomUUID(), type: "conversation_ended", requestId: null });
  const after = (await service.getSession(owner, sessionId)).session;
  const assistantBefore = (first.value.session.messages.filter((m) => m.role === "assistant")).length;
  checks.push({ name: "terminal stop: no later opponent message", ok: after.ended && after.messages.filter((m) => m.role === "assistant").length === assistantBefore, detail: `outcome ${after.outcome}` });

  mkdirSync("tmp", { recursive: true });
  const file = `tmp/practice-smoke-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify({ ...evidence, checks }, null, 2));
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  —  ${c.detail}${c.ms ? ` (${c.ms} ms)` : ""}`);
  console.log(`Evidence: ${file}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
