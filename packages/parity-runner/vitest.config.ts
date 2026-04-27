/**
 * Vitest config for @agentic/parity-runner.
 *
 * source: vitest.dev/config — defineConfig API (vitest v4 — no defineWorkspace).
 * source: PHASE_PLAN.md §"Phase 5 — test config cleanup" (item 12):
 *         defineWorkspace removed in vitest v4; use defineConfig with test.projects.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    passWithNoTests: true,
  },
});
