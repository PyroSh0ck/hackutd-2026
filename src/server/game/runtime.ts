import "server-only";

import { SessionIdSchema } from "@/contracts/game";
import { NotFoundError } from "@/server/http/errors";
import { OpenAICompatibleClient, readModelConfig } from "./opponent/client";
import { GameService } from "./service";
import { PrismaGameStore } from "./store/prisma-store";

let service: GameService | undefined;

/** Process-wide service: Postgres store + provider from server-only env (MODEL_BASE_URL/KEY/ID). */
export function gameService(): GameService {
  if (!service) {
    service = new GameService({
      store: new PrismaGameStore(),
      modelClient: () => {
        const config = readModelConfig();
        return config ? new OpenAICompatibleClient(config) : null;
      },
    });
  }
  return service;
}

/** Malformed ids are indistinguishable from unknown or not-owned ones (404). */
export function parseSessionId(id: unknown): string {
  const result = SessionIdSchema.safeParse(id);
  if (!result.success) throw new NotFoundError("Game session");
  return result.data;
}
