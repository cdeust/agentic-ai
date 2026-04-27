// vitest.config.ts — workspace root Vitest config for the agentic-ai monorepo.
//
// Pattern lifted from: prd-spec-generator/vitest.workspace.ts
// source: vitest.dev/guide/workspace — workspace mode requires defineWorkspace
// at the root and per-package defineConfig files.
//
// Tests live in:
//   packages/*/src/__tests__/**/*.test.ts
//   packages/*/__tests__/**/*.test.ts
// Parity tests are separated into parity-oracle/ and invoked via pnpm parity,
// not pnpm test, to keep CI signal distinct.

import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  // Per-package configs own their own name, include/exclude, and reporter.
  // The root workspace just enumerates them.
  "packages/*/vitest.config.ts",
  "packages/mcp-servers/*/vitest.config.ts",
]);
