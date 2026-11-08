import { connection, NextResponse } from "next/server";
import { observerService } from "@/server/observer/runtime";

/**
 * Redacted deployment readiness: backend reachability and configuration NAMES only. Never calls a model
 * (no paid requests per probe) and never returns values, tokens, or provider error bodies.
 */
export async function GET() {
  // Always evaluated per request (never prerendered at build time).
  await connection();
  const configured = (...names: string[]) => names.every((n) => Boolean(process.env[n]));
  let backend = "unknown";
  let backendReachable = false;
  try {
    const service = observerService();
    backend = service.backend.name;
    await service.backend.listSessions("readiness-probe");
    backendReachable = true;
  } catch {
    backendReachable = false;
  }
  const body = {
    backend,
    backendReachable,
    modelConfigured: configured("MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_ID"),
    plannerProtocol: process.env.PLANNER_PROTOCOL === "tools" ? "tools" : "structured",
    fixtureModels: process.env.E2E_TEST === "1" && process.env.OBSERVER_MODEL_MODE === "fixture",
    agentDebug: process.env.AGENT_DEBUG === "1",
  };
  return NextResponse.json(body, { status: backendReachable ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
