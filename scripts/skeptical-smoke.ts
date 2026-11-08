/** Opt-in live model regression for repeated identity doubt. Uses an isolated in-memory training store. */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { actorModelFromEnv } from "@/server/actor/model";
import { readObserverModelConfig, readPlannerModelConfig, plannerModels, structuredModels } from "@/server/observer/model";
import { ObserverService } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import { toolPlannerFromEnv } from "@/server/planner/tool-model";

config({ path: ".env.local", quiet: true });

const proofLimit = /\b(?:can'?t|cannot|doesn'?t|does not)\s+(?:prove|confirm|establish)\b/i;
const same = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function assert(condition: unknown, detail: string): asserts condition { if (!condition) throw new Error(detail); }

async function main() {
  assert(process.env.MODEL_BASE_URL && process.env.MODEL_API_KEY && process.env.MODEL_ID, "Live model configuration is missing.");
  const observer = readObserverModelConfig();
  const planner = readPlannerModelConfig();
  const service = new ObserverService({
    store: new MemoryObserverStore(),
    models: () => structuredModels(observer),
    policy: observer.reviewPolicy,
    timeoutMs: observer.timeoutMs,
    planning: {
      models: () => ({ planner: plannerModels(planner).planner, actor: actorModelFromEnv() }),
      timeoutMs: planner.timeoutMs,
      ...(process.env.PLANNER_PROTOCOL === "tools" ? { toolPlanner: () => toolPlannerFromEnv() } : {}),
    },
    enabledScenarios: ["mobile-code-01"],
  });
  const owner = `anon:skeptical-smoke-${randomUUID()}`;
  const sessionId = (await service.createSession(owner)).session.sessionId;
  let boundary: string | null = null;
  let backedOff = false;
  for (const userText of ["no", "liar", "prove it", "prove it again"]) {
    const before = await service.plans(owner, sessionId);
    const result = await service.submitMessage(owner, sessionId, { idempotencyKey: randomUUID(), content: userText });
    const plans = (await service.plans(owner, sessionId)).slice(before.length);
    const committed = plans.find((p) => p.status === "committed" && p.acceptedPlan);
    const move = committed?.candidateSnapshot.find((c) => c.id === committed.acceptedPlan?.candidateId)?.moveId ?? null;
    const reply = committed?.committedMessageId ? result.session.messages.find((m) => m.id === committed.committedMessageId)?.content ?? null : null;
    assert(result.session.turnStatus.state !== "failed", `${userText}: technical failure`);
    console.log(JSON.stringify({ input: userText, move, status: result.session.turnStatus.state, replied: Boolean(reply) }));
    if (userText === "prove it again") assert(move === null && result.session.turnStatus.state === "paused", "A third proof challenge generated another reply instead of pausing.");
    if (userText === "no") {
      assert(move === "acknowledge_refusal", "A clear no to the opening invitation was not acknowledged.");
      continue;
    }
    if (move === "back_off_doubt") {
      assert(boundary, "Backed off before any honest proof limit was given.");
      assert(reply && same(reply) !== same(boundary), "Back-off reply repeated the proof-limit response.");
      assert(!/\b(?:send|share|give|provide)\b.{0,40}\bcode\b/i.test(reply), "Back-off reply asked for a code.");
      backedOff = true;
    } else if (reply && proofLimit.test(reply)) {
      boundary = reply;
    }
  }
  assert(boundary, "No honest proof limit was given to the first identity challenge.");
  assert(backedOff, "Repeated identity challenge did not trigger back_off_doubt.");
  const directId = (await service.createSession(owner)).session.sessionId;
  let firstProofReply: string | null = null;
  for (const [index, userText] of ["prove it", "How can you prove it?"].entries()) {
    const before = await service.plans(owner, directId);
    const result = await service.submitMessage(owner, directId, { idempotencyKey: randomUUID(), content: userText });
    const committed = (await service.plans(owner, directId)).slice(before.length).find((p) => p.status === "committed" && p.acceptedPlan);
    const move = committed?.candidateSnapshot.find((c) => c.id === committed.acceptedPlan?.candidateId)?.moveId ?? null;
    const reply = committed?.committedMessageId ? result.session.messages.find((m) => m.id === committed.committedMessageId)?.content ?? null : null;
    if (result.session.turnStatus.state === "failed" || !reply) {
      const assessment = (await service.assessments(owner, directId)).at(-1);
      console.error(JSON.stringify({ diagnostic: { turnStatus: result.session.turnStatus, plans: (await service.plans(owner, directId)).slice(before.length).map((p) => ({ status: p.status, failure: p.failureReason, attempts: p.attempts.map((a) => ({ stage: a.stage, outcome: a.outcome, errors: a.errors.map((e) => e.code) })), actorErrors: p.actorValidationAttempts.flatMap((x) => x.errors.map((e) => e.code)) })), assessment: assessment && { resolution: assessment.resolution, failure: assessment.failureReason, attempts: assessment.attempts.map((a) => ({ stage: a.stage, outcome: a.outcome })) } } }));
    }
    assert(result.session.turnStatus.state !== "failed" && reply, `Direct proof turn ${index + 1} failed.`);
    console.log(JSON.stringify({ input: userText, move, status: result.session.turnStatus.state, replied: true }));
    if (index === 0) {
      assert(proofLimit.test(reply), "First direct proof challenge did not receive an honest proof limit.");
      firstProofReply = reply;
    } else {
      assert(move === "back_off_doubt" && firstProofReply && same(reply) !== same(firstProofReply), "Repeated direct proof challenge did not back off distinctly.");
    }
  }
  const cooperativeId = (await service.createSession(owner)).session.sessionId;
  let requestPresented = false;
  for (const userText of ["Who is this?", "Okay, what do you need from me?", "Alright, go ahead", "What should I do now?"]) {
    const before = await service.plans(owner, cooperativeId);
    const result = await service.submitMessage(owner, cooperativeId, { idempotencyKey: randomUUID(), content: userText });
    const committed = (await service.plans(owner, cooperativeId)).slice(before.length).find((p) => p.status === "committed" && p.acceptedPlan);
    const move = committed?.candidateSnapshot.find((c) => c.id === committed.acceptedPlan?.candidateId)?.moveId ?? null;
    assert(result.session.turnStatus.state !== "failed", `Cooperative turn failed: ${userText}`);
    console.log(JSON.stringify({ path: "cooperative", input: userText, move, request: result.session.requestStatus, status: result.session.turnStatus.state }));
    if (move === "present_code_request" && result.session.requestStatus !== "not_presented") {
      requestPresented = true;
      break;
    }
  }
  assert(requestPresented, "Cooperative conversation did not reach a committed request within four turns.");
  console.log("PASS: skeptical path backed off cleanly; cooperative path reached a committed request.");
}

main().catch((error) => { console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
