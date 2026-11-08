import "server-only";
import { z } from "zod";

const ServerEnvSchema = z.object({
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = ServerEnvSchema.safeParse({
    LOG_LEVEL: process.env.LOG_LEVEL,
  });

  if (!result.success) {
    const invalidFields = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");

    throw new Error(`Invalid server environment variables: ${invalidFields}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}

const DatabaseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>;

let cachedDatabaseEnv: DatabaseEnv | undefined;

export function getDatabaseEnv(): DatabaseEnv {
  if (cachedDatabaseEnv) {
    return cachedDatabaseEnv;
  }

  const result = DatabaseEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
  });

  if (!result.success) {
    throw new Error("Missing or invalid DATABASE_URL");
  }

  cachedDatabaseEnv = result.data;
  return cachedDatabaseEnv;
}

const AuthEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
});

export function getAuthEnv() {
  const result = AuthEnvSchema.safeParse({
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  });

  if (!result.success) {
    throw new Error("Missing or invalid BETTER_AUTH_SECRET or BETTER_AUTH_URL");
  }

  return result.data;
}
