/**
 * Live provider acceptance (E9/E10 against the REAL configured model). Separate from mocked tests.
 *
 *   pnpm game:smoke            # uses MODEL_BASE_URL / MODEL_API_KEY / MODEL_ID from env or .env.local
 *
 * Runs the real GameService + tool loop with an in-memory store (no DB writes): player message ->
 * live turn -> (expect a live payment request) -> player rejects -> live turn observes the rejection.
 * Prints tool calls, latency, and privacy checks on every serialized request. Never prints the key.
 * Exit codes: 0 pass, 1 fail, 2 blocked (provider not configured).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { OpenAICompatibleClient, readModelConfig } from "@/server/game/opponent/client";
import { bankAlertScenario as scenario } from "@/server/game/scenario/bank-alert";
import { GameService } from "@/server/game/service";
import { MemoryGameStore } from "@/server/game/store/memory-store";
import type { PlayerAction, PlayerView } from "@/contracts/game";

config({ path: ".env.local", quiet: true });

async function main() {
  const modelConfig = readModelConfig();
  if (!modelConfig) {
    console.log("BLOCKED: live provider not configured (need MODEL_BASE_URL, MODEL_API_KEY, MODEL_ID). Live acceptance not run.");
    process.exit(2);
  }
  console.log(`Provider: ${new URL(modelConfig.baseUrl).host}  model: ${modelConfig.modelId}`);

  const bodies: string[] = [];
  const store = new MemoryGameStore();
  const service = new GameService({ store, modelClient: () => new OpenAICompatibleClient(modelConfig, fetch as never, (body) => bodies.push(body)) });
  const owner = "smoke-owner";
  const act = async (view: PlayerView, action: PlayerAction) => {
    const started = Date.now();
    const response = await service.submitAction(owner, view.sessionId, { actionId: randomUUID(), expectedVersion: view.version, action });
    return { ...response, ms: Date.now() - started };
  };

  const checks: Array<{ id: string; pass: boolean; detail: string }> = [];
  const check = (id: string, pass: boolean, detail: string) => {
    checks.push({ id, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${id}: ${detail}`);
  };

  let view = await service.createSession(owner, { scenarioId: "bank-alert", opponentMode: "live" });
  let turns = 0;
  const firstTurn = await act(view, { type: "send_message", text: "Oh no, is my account okay? What do I need to do?" });
  view = firstTurn.session;
  turns++;
  console.log(`turn 1: ${firstTurn.ms} ms`, firstTurn.result.opponentTurn);

  // Allow up to two more player messages for the model to present its request.
  while (!view.paymentRequests.some((r) => r.status === "pending") && turns < 3 && view.status === "active") {
    const next = await act(view, { type: "send_message", text: "Okay, how do I move the money?" });
    view = next.session;
    turns++;
    console.log(`turn ${turns}: ${next.ms} ms`, next.result.opponentTurn);
  }
  const request = view.paymentRequests.find((r) => r.status === "pending");
  check("E10a live tool call has a verified effect", Boolean(request && request.origin === "live_model"), request ? `request ${request.requestId}: ${request.amount} -> ${request.recipient.recipientId} (${request.origin})` : "no live payment request created");
  check("live turns not fallback", view.opponent.lastTurn?.origin === "live_model", JSON.stringify(view.opponent.lastTurn));

  if (request) {
    const before = view.paymentRequests.length;
    const rejected = await act(view, { type: "reject_payment", requestId: request.requestId });
    view = rejected.session;
    console.log(`after rejection: ${rejected.ms} ms`, rejected.result.opponentTurn);
    const lastBody = JSON.parse(bodies.at(-1) ?? "{}") as { messages?: Array<{ role: string; content: string | null }> };
    const observation = lastBody.messages?.find((m) => m.role === "user")?.content ?? "";
    check("E10b rejection observed by model", observation.includes('"status":"rejected"'), "serialized observation contains the rejected request status");
    const adapted = view.paymentRequests.length > before || view.status === "ended" || view.messages.at(-1)?.origin === "live_model";
    check("E10c model responded after rejection", Boolean(adapted && rejected.result.opponentTurn?.origin === "live_model"), `new requests: ${view.paymentRequests.length - before}, status: ${view.status}, last message origin: ${view.messages.at(-1)?.origin}`);
  }

  const forbidden = [...scenario.privateSentinels, ...scenario.verification.facts.map((f) => f.text), scenario.account.accountLabel, "1500", modelConfig.apiKey];
  const leaks = bodies.flatMap((body, i) => forbidden.filter((value) => body.includes(value)).map((value) => `request ${i + 1}: ${value === modelConfig.apiKey ? "<api key>" : value}`));
  check("E9 serialized requests exclude private values", leaks.length === 0, leaks.length ? leaks.join("; ") : `${bodies.length} requests checked`);

  const log = await service.developerLog(owner, view.sessionId);
  for (const turn of log.turns) {
    console.log(`  ${turn.turnId}: ${turn.origin} ${turn.fallbackReason ?? ""} requests=${turn.modelRequests} latency=${turn.latencyMs}ms`);
    for (const call of turn.toolCalls) console.log(`    ${call.name} ${JSON.stringify(call.arguments)} -> ${call.status}${call.rejectionReason ? ` (${call.rejectionReason})` : ""}`);
  }
  console.log("transcript:");
  for (const m of view.messages) console.log(`  [${m.origin}] ${m.from}: ${m.text}`);

  mkdirSync("test-results", { recursive: true });
  const evidence = { at: new Date().toISOString(), model: modelConfig.modelId, checks, turns: log.turns, transcript: view.messages.map((m) => ({ from: m.from, origin: m.origin, text: m.text })) };
  writeFileSync("test-results/game-smoke.json", JSON.stringify(evidence, null, 2));
  console.log("evidence: test-results/game-smoke.json");
  process.exit(checks.every((c) => c.pass) ? 0 : 1);
}

main().catch((error) => {
  console.error("SMOKE ERROR:", error instanceof Error ? error.message : error);
  process.exit(1);
});
