// Gives each request its own ID and logger.
// Every request made through the logger automatically includes the request ID, method, and the route

import "server-only";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { logger } from "@/server/logger";

export function createRequestContext(request: Request, route: string) {
  const requestId = randomUUID();
  const startedAt = performance.now();

  const log = logger.child({
    requestId,
    method: request.method,
    route,
  });

  function complete(statusCode: number, error?: unknown) {
    const fields = {
      event: "http.request.completed",
      statusCode,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    };

    if (statusCode >= 500) {
      log.error({ ...fields, err: error }, "Request failed");
    } else if (statusCode >= 400) {
      log.warn(fields, "Request rejected");
    } else {
      log.info(fields, "Request completed");
    }
  }

  return {
    requestId,
    log,
    complete,
  };
}
