// parity-oracle/vitest.parity.config.ts — Vitest config for the parity oracle.
//
// This config is invoked by `pnpm parity` (package.json scripts.parity):
//   vitest run --config parity-oracle/vitest.parity.config.ts
//
// Parity tests assert byte-identical (modulo masked fields) output between
// the TypeScript port and the Python source implementation.
//
// source: MISSION.md §3.1 — parity-oracle suite must pass 100%.
// source: ci.yml step "Parity oracle" — this config is the CI contract.
//
// Test file convention: **/*.parity.test.ts
// Fixture data: loaded from port-parity-baseline worktree deliverables.
// Baseline data path (injected via env): PARITY_BASELINE_DIR

import { defineConfig } from "vitest/config";

// source: vitest.dev/config — reporter "verbose" gives per-test lines in CI.
export default defineConfig({
  test: {
    name: "parity-oracle",

    // Parity tests live only in parity-oracle/**/*.parity.test.ts.
    // They are explicitly excluded from the workspace root config so they
    // do NOT run under `pnpm test` — only under `pnpm parity`.
    include: ["parity-oracle/**/*.parity.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],

    // Parity tests compare against frozen baseline data; they may be slower.
    // source: vitest.dev/config#test-timeout — default 5000ms is too tight for
    // full fixture suites; 30s is conservative and matches typical LLM-call mocks.
    testTimeout: 30_000, // source: empirical — baseline fixture load ~2s on M2 Mac

    // In CI, verbose output is essential for diagnosing divergence.
    reporter: ["verbose"],

    // Globals false: parity tests must import { describe, it, expect } explicitly
    // to keep local-reasoning intact (no implicit global injection).
    globals: false,

    // Environment: Node (parity tests call the TS port directly, no DOM needed).
    environment: "node",
  },
});
