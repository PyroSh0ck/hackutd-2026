import { defineConfig, devices } from "@playwright/test";

/**
 * Opt-in LIVE browser checks (tests/live). Targets an already running server with real models; starts no
 * server of its own and is never part of check/e2e/integration runs. Usage:
 *   LIVE_BASE_URL=http://localhost:3000 pnpm test:live                       # fraud scenario
 *   LIVE_BASE_URL=http://localhost:3001 LIVE_SCENARIO=notice pnpm test:live  # legitimate scenario
 * The target server's own environment decides the models and backend (see docs/agents/DEMO-READINESS.md).
 */
const baseURL = process.env.LIVE_BASE_URL;
if (!baseURL) throw new Error("Set LIVE_BASE_URL to the running server to test (live checks never start a server).");

export default defineConfig({
  testDir: "./tests/live",
  testMatch: ["**/*.live.spec.ts"],
  timeout: 600_000,
  expect: { timeout: 60_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
});
