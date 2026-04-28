/**
 * Vitest configuration for @agentic/codebase.
 *
 * The parity test (index_codebase.parity.test.ts) requires PR #18 to be merged
 * and the Rust binary to be built. It is gated by AI_ARCH_BIN or the workspace
 * binary; if neither is available, the parity test marks itself todo.
 *
 * source: docs/PHASE_3_PLAN.md §5.4#2 — test structure
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    // Each test file gets its own module registry so vi.mock calls in one file
    // do not leak into another. Required by rust-binary-resolver.test.ts which
    // mocks node:fs and node:module.
    // source: vitest docs — poolOptions.forks.isolate
    isolate: true,
    // Parity tests can take up to 5 minutes for large fixtures.
    // source: docs/PHASE_3_PLAN.md §4.2 — analyzeCodebase 5 min timeout
    testTimeout: 360_000,
  },
});
