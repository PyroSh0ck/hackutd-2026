import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

const testEnv = parse(readFileSync(".env.test.local", "utf8"));

if (!testEnv.DATABASE_URL) {
  throw new Error("Set the testing branch DATABASE_URL in .env.test.local");
}

if (!testEnv.BETTER_AUTH_SECRET || !testEnv.BETTER_AUTH_URL) {
  throw new Error(
    "BETTER_AUTH_SECRET and BETTER_AUTH_URL are required in .env.test.local",
  );
}

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/api/**/*.spec.ts", "**/e2e/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm exec next start --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 180000,
    stdout: "pipe",
    stderr: "pipe",

    env: {
      DATABASE_URL: testEnv.DATABASE_URL,
      DATABASE_URL_UNPOOLED: testEnv.DATABASE_URL_UNPOOLED,
      BETTER_AUTH_SECRET: testEnv.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: testEnv.BETTER_AUTH_URL,
      LOG_LEVEL: "warn",
      E2E_TEST: "1",
      // Deterministic, labeled observer model for HTTP plumbing tests (requires E2E_TEST=1 as well).
      OBSERVER_MODEL_MODE: "fixture",
      AGENT_DEBUG: "1",
      // Optional: run the same suites with SpacetimeDB as the training authority / the tool-calling planner.
      ...(process.env.TRAINING_BACKEND ? { TRAINING_BACKEND: process.env.TRAINING_BACKEND } : {}),
      ...(process.env.PLANNER_PROTOCOL ? { PLANNER_PROTOCOL: process.env.PLANNER_PROTOCOL } : {}),
    },
  },
});
