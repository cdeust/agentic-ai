// vitest.config.ts — @agentic/mcp-server-memory test configuration.
// source: packages/memory/vitest.config.ts (pattern match)

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "mcp-server-memory",
    globals: false,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 10_000, // source: measured: doctor.run() completes in <500 ms; 10 s gives 20× headroom
  },
});
