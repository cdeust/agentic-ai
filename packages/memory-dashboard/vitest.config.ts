import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 10_000, // source: measured: slowest route test (graph build + DB query) completes in <2 s; 10 s gives 5x margin
  },
});
