import "server-only";
import pino from "pino";
import { getServerEnv } from "@/server/env";

const env = getServerEnv();

export const logger = pino({
  level: env.LOG_LEVEL,

  base: {
    service: "claude-configuration-testing",
  },

  timestamp: pino.stdTimeFunctions.isoTime,

  serializers: {
    err: pino.stdSerializers.err,
  },

  redact: {
    paths: [
      "password",
      "token",
      "secret",
      "authorization",
      "cookie",
      "headers.authorization",
      "headers.cookie",
      'headers["set-cookie"]',
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});
