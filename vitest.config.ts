// vitest.config.ts — workspace root Vitest config for the agentic-ai monorepo.
//
// source: vitest.dev/guide/projects — Vitest 4 replaced defineWorkspace +
// test.workspace with defineConfig({ test: { projects: [...] } }).
// defineWorkspace was removed in Vitest 4.0. Per-package configs own their
// own name, include/exclude, and reporter; the root config enumerates them
// via the projects array.
//
// Tests live in:
//   packages/*/src/__tests__/**/*.test.ts
//   packages/*/__tests__/**/*.test.ts
// Parity tests are separated into parity-oracle/ and invoked via pnpm parity,
// not pnpm test, to keep CI signal distinct.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Per-package configs own their own name, include/exclude, and reporter.
    // The root config just enumerates them via the projects array.
    projects: [
      "packages/*/vitest.config.ts",
      "packages/mcp-servers/*/vitest.config.ts",
      "packages/prd-pipeline/packages/*/vitest.config.ts",
    ],
  },
});
