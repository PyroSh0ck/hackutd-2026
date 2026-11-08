import "server-only";

import { ObserverIdSchema } from "@/contracts/observer";
import { NotFoundError } from "@/server/http/errors";
import { readObserverModelConfig, structuredModels } from "./model";
import { ObserverService } from "./service";
import { PrismaObserverStore } from "./store/prisma-store";
import { FixtureStructuredModel } from "./testing/fixture-model";

let service: ObserverService | undefined;

/** True only for the Playwright test server: both flags must be set. Never in production. */
export const fixtureModelsEnabled = () => process.env.E2E_TEST === "1" && process.env.OBSERVER_MODEL_MODE === "fixture";

/** Process-wide service: Postgres store + structured models from server-only env. */
export function observerService(): ObserverService {
  if (!service) {
    const config = readObserverModelConfig();
    service = new ObserverService({
      store: new PrismaObserverStore(),
      models: () =>
        fixtureModelsEnabled()
          ? { observer: new FixtureStructuredModel("fixture-observer"), reviewer: new FixtureStructuredModel("fixture-reviewer") }
          : structuredModels(config),
      policy: config.reviewPolicy,
      timeoutMs: config.timeoutMs,
    });
  }
  return service;
}

export function parseObserverSessionId(id: unknown): string {
  const result = ObserverIdSchema.safeParse(id);
  if (!result.success) throw new NotFoundError("Observer session");
  return result.data;
}
