import { randomUUID } from "node:crypto";
import type { PlannerInput } from "@/contracts/planner";
import type { Snapshot } from "@/server/observer/store/types";
import type { StructuredModel } from "@/server/observer/model";
import { ObserverService } from "@/server/observer/service";
import { MemoryObserverStore } from "@/server/observer/store/memory-store";
import { FixtureStructuredModel } from "@/server/observer/testing/fixture-model";
import { derivePlanningContext } from "@/server/planner/context";
import { getEligibleCandidates } from "@/server/planner/eligibility";
import { buildPlannerInput } from "@/server/planner/input";
import { MAX_USER_TURNS } from "@/server/planner/scenario";

export const OWNER = "anon:planner-tests";

/** MVP scenario service over the memory store with the fixture observer and injectable planner/actor. */
export function mvp(options: { planner?: () => StructuredModel | null; actor?: () => StructuredModel | null; store?: MemoryObserverStore; planning?: boolean } = {}) {
  const store = options.store ?? new MemoryObserverStore();
  const service = new ObserverService({
    store,
    models: () => ({ observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") }),
    policy: "consequential_and_flagged",
    timeoutMs: 1000,
    planning: options.planning === false ? null : { models: () => ({ planner: options.planner?.() ?? null, actor: options.actor?.() ?? null }), timeoutMs: 1000 },
  });
  return { store, service };
}

export async function started(options: Parameters<typeof mvp>[0] = {}) {
  const ctx = mvp(options);
  const { session } = await ctx.service.createSession(OWNER);
  const id = session.sessionId;
  const say = (content: string, key = randomUUID()) => ctx.service.submitMessage(OWNER, id, { idempotencyKey: key, content });
  const act = (cmd: Omit<Parameters<ObserverService["submitEvent"]>[2], "idempotencyKey">, key = randomUUID()) => ctx.service.submitEvent(OWNER, id, { idempotencyKey: key, ...cmd });
  const snap = async () => (await ctx.store.load(id))!;
  return { ...ctx, id, say, act, snap };
}

/** Planner input for the current state of an observer-only session after `lines` (no planner involved). */
export async function plannerInputAfter(lines: string[]): Promise<{ input: PlannerInput; practiceCode: string; caseReference: string; snapshot: Snapshot }> {
  const s = await started({ planning: false });
  for (const line of lines) await s.say(line);
  const snap = await s.snap();
  const ctx = derivePlanningContext(snap, MAX_USER_TURNS);
  const e = getEligibleCandidates(ctx);
  if (e.kind !== "candidates") throw new Error(`no candidates: ${e.kind} ${e.ruleId}`);
  return { input: buildPlannerInput(snap, ctx, e.candidates, MAX_USER_TURNS), practiceCode: snap.session.practiceCode!, caseReference: snap.session.caseReference!, snapshot: snap };
}
