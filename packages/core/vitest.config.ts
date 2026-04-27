// vitest.config.ts — per-package Vitest config for @agentic-ai/core.
//
// Pattern: lifted from prd-spec-generator/packages/core/vitest.config.ts.
// Tests live in src/__tests__/**/*.test.ts and __tests__/**/*.test.ts.
// The workspace root (vitest.config.ts) enumerates this file via glob.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Workspace name must be unique across all packages.
    name: "@agentic-ai/core",
    include: [
      "src/__tests__/**/*.test.ts",
      "src/**/*.test.ts",
      "__tests__/**/*.test.ts",
    ],
    exclude: ["dist/**", "node_modules/**"],
    // Coverage is opt-in at the workspace level; per-package configs opt in.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__tests__/**"],
    },
  },
});
