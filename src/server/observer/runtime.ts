import "server-only";

import { ObserverIdSchema } from "@/contracts/observer";
import { NotFoundError } from "@/server/http/errors";
import { actorModelFromEnv } from "@/server/actor/model";
import type { TrainingBackend } from "@/server/engine/backend";
import { SpacetimeBackend, spacetimeConfigFromEnv } from "@/server/engine/spacetime-backend";
import { FixtureActorModel, FixturePlannerModel } from "@/server/planner/testing/fixture-models";
import { plannerModels, readObserverModelConfig, readPlannerModelConfig, structuredModels } from "./model";
import { ObserverService } from "./service";
import { PrismaObserverStore } from "./store/prisma-store";
import { sharedTrace, traceEnabled } from "./trace";
import { FixtureStructuredModel } from "./testing/fixture-model";

let service: ObserverService | undefined;

/** True only for the Playwright test server: both flags must be set. Never in production. */
export const fixtureModelsEnabled = () => process.env.E2E_TEST === "1" && process.env.OBSERVER_MODEL_MODE === "fixture";

/**
 * Authoritative training backend. TRAINING_BACKEND=spacetime makes the SpacetimeDB module the single
 * authority for training state; it is never silently replaced by Postgres when unconfigured.
 */
export function trainingBackendFromEnv(): { backend?: TrainingBackend; store?: PrismaObserverStore } {
  if (process.env.TRAINING_BACKEND === "spacetime") {
    const config = spacetimeConfigFromEnv();
    if (!config) throw new Error("TRAINING_BACKEND=spacetime but SpacetimeDB is not configured (run pnpm spacetime:setup or set SPACETIME_URL/SPACETIME_DATABASE/SPACETIME_TOKEN).");
    return { backend: new SpacetimeBackend(config) };
  }
  return { store: new PrismaObserverStore() };
}

/** Process-wide service: the configured training backend + structured models from server-only env. */
export function observerService(): ObserverService {
  if (!service) {
    const config = readObserverModelConfig();
    const planning = readPlannerModelConfig();
    service = new ObserverService({
      ...trainingBackendFromEnv(),
      models: () =>
        fixtureModelsEnabled()
          ? { observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") }
          : structuredModels(config),
      policy: config.reviewPolicy,
      timeoutMs: config.timeoutMs,
      planning: {
        // Actor v2 uses its own native json_schema adapter (src/server/actor/model.ts); ACTOR_MODEL_ID optional.
        models: () => (fixtureModelsEnabled() ? { planner: new FixturePlannerModel(), actor: new FixtureActorModel() } : { planner: plannerModels(planning).planner, actor: actorModelFromEnv() }),
        timeoutMs: planning.timeoutMs,
      },
      // Agent lab trace: development or AGENT_DEBUG=1 only (records prompts and raw model output).
      trace: traceEnabled() ? sharedTrace() : undefined,
    });
  }
  return service;
}

export function parseObserverSessionId(id: unknown): string {
  const result = ObserverIdSchema.safeParse(id);
  if (!result.success) throw new NotFoundError("Observer session");
  return result.data;
}
