import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/server/db";
import { getAuthEnv } from "@/server/env";

const env = getAuthEnv();

const isLocalE2E =
  process.env.E2E_TEST === "1" &&
  env.BETTER_AUTH_URL === "http://127.0.0.1:3100";

export const auth = betterAuth({
  ...authOptions,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  rateLimit: {
    enabled: !isLocalE2E,
  },
});
