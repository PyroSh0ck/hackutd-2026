import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Live SpacetimeDB integration tests (needs a running local server with the module published). */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/spacetime/**/*.test.ts"],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
