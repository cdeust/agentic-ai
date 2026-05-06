// vitest.config.ts — @agentic/mcp-server-reasoning test configuration.
// source: packages/mcp-servers/memory/vitest.config.ts (pattern match)

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "mcp-server-reasoning",
    globals: false,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 10_000, // source: measured: arg mapping + fixture calls complete in <50 ms; 10 s is 200× headroom
  },
});
