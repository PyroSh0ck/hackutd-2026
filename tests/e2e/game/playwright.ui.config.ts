import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

// Independent of the backend's :3100 / database-dependent integration suite.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../../../.artifacts/ui/playwright",
  reporter: [["list"], ["json", { outputFile: resolve(__dirname, "../../../.artifacts/ui/results.json") }]],
  workers: 1,
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3202", trace: "retain-on-failure" },
  webServer: {
    cwd: resolve(__dirname, "../../.."),
    command: "pnpm exec next dev --port 3202",
    url: "http://localhost:3202",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
