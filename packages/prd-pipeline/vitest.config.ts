import { defineConfig } from "vitest/config";

// Vitest v4 root config with explicit projects list. Replaces the legacy
// `vitest.workspace.ts` (which v4 no longer auto-discovers). Listing the
// projects explicitly also prevents glob-based discovery from reaching
// into `.claude/worktrees/agent-*/packages/*/vitest.config.ts` when an
// orchestrator agent is running.
//
// Note (2026-04-28, post-monorepo-merge): when the agentic-ai root vitest
// loads this file via the `packages/*/vitest.config.ts` glob, vitest treats
// it as a regular config rather than recursing into the projects array.
// Without an explicit include, it would pick up `dist/__tests__/*.test.js`
// (TypeScript-compiled artefacts that should never be re-tested at the JS
// level). Set both include + exclude so the prd-pipeline root config is a
// pure no-op test surface — sub-package configs do the actual work.
export default defineConfig({
  test: {
    name: "@agentic/prd-pipeline-root",
    include: [],
    exclude: ["**/dist/**", "**/node_modules/**"],
    projects: [
      "./packages/benchmark/vitest.config.ts",
      "./packages/core/vitest.config.ts",
      "./packages/ecosystem-adapters/vitest.config.ts",
      "./packages/meta-prompting/vitest.config.ts",
      "./packages/mcp-server/vitest.config.ts",
      "./packages/orchestration/vitest.config.ts",
      "./packages/validation/vitest.config.ts",
      "./packages/verification/vitest.config.ts",
    ],
  },
});
