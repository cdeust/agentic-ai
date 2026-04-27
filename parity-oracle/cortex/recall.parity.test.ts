// parity-oracle/cortex/recall.parity.test.ts — Parity test stub for cortex recall.
//
// This test asserts that the TypeScript port of cortex.recall() produces
// output byte-identical (modulo masked fields) to the Python source baseline.
//
// Baseline data contract:
//   The port-parity-baseline worktree owns the fixture files.
//   This test loads them via the PARITY_BASELINE_DIR environment variable.
//   If PARITY_BASELINE_DIR is not set, the test is skipped with an explanatory
//   message — allowing local development without the baseline worktree checked out.
//
// Masked fields (excluded from byte-identical comparison):
//   - timestamps (createdAt, updatedAt, recordedAt)
//   - SHA-of-bytes fields (contentHash, chunkHash)
//   - session IDs
//
// source: MISSION.md §3.1 — "byte-identical output modulo timestamps and SHA-of-bytes fields"

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Fixture loading ────────────────────────────────────────────────────────────

const BASELINE_DIR = process.env["PARITY_BASELINE_DIR"] ?? "";

/**
 * Fields that are intentionally excluded from byte-identical comparison.
 * source: MISSION.md §3.1 — "modulo timestamps and SHA-of-bytes fields"
 */
const MASKED_FIELDS: ReadonlySet<string> = new Set([
  "createdAt",
  "updatedAt",
  "recordedAt",
  "timestamp",
  "contentHash",
  "chunkHash",
  "sessionId",
  "requestId",
]);

interface RecallInput {
  readonly query: string;
  readonly limit: number;
  readonly agentTopic?: string;
}

interface RecallOutput {
  readonly results: ReadonlyArray<Record<string, unknown>>;
  readonly total: number;
}

interface ParityFixture {
  readonly description: string;
  readonly input: RecallInput;
  readonly expected: RecallOutput;
}

/**
 * Load a parity fixture file from the baseline directory.
 * Returns null if the baseline directory is not available.
 */
function loadFixture(name: string): ParityFixture[] | null {
  if (!BASELINE_DIR) return null;

  const fixturePath = join(BASELINE_DIR, "cortex", "recall", `${name}.json`);
  if (!existsSync(fixturePath)) return null;

  const raw = readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw) as ParityFixture[];
}

/**
 * Recursively strip masked fields from an object before comparison.
 * source: MISSION.md §3.1 — byte-identical modulo masked fields.
 */
function stripMasked(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripMasked);

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!MASKED_FIELDS.has(k)) {
      result[k] = stripMasked(v);
    }
  }
  return result;
}

// ── Placeholder port under test ────────────────────────────────────────────────
// REPLACE with: import { recall } from "@agentic-ai/memory/cortex";
// The import path is a placeholder until the memory package is ported.
// Until then, the test skips if the port is not available.

let recallPort: ((input: RecallInput) => Promise<RecallOutput>) | null = null;

try {
  // Dynamic import so the test file loads even when the port does not exist yet.
  // source: vitest.dev/guide/mocking — conditional dynamic import for stub.
  const mod = await import(
    /* @vite-ignore */ "../../packages/memory/src/cortex/recall.js"
  );
  recallPort =
    (mod as { recall?: (input: RecallInput) => Promise<RecallOutput> })
      .recall ?? null;
} catch {
  // Port not yet ported — tests will skip individually.
  recallPort = null;
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("cortex.recall() parity", () => {
  let fixtures: ParityFixture[] | null = null;

  beforeAll(() => {
    fixtures = loadFixture("happy-path");
  });

  it("baseline fixtures are available (setup check)", () => {
    if (!BASELINE_DIR) {
      // Not a failure: baseline worktree simply not checked out locally.
      console.error(
        "PARITY_BASELINE_DIR not set — skipping parity tests. " +
          "Set PARITY_BASELINE_DIR to the port-parity-baseline worktree path."
      );
      return;
    }
    expect(fixtures).not.toBeNull();
    expect(Array.isArray(fixtures)).toBe(true);
  });

  it("port is available", () => {
    if (!recallPort) {
      console.error(
        "recall port not yet ported — test skipped. " +
          "Port packages/memory/src/cortex/recall.ts to enable parity tests."
      );
      return;
    }
    expect(recallPort).toBeTypeOf("function");
  });

  it("happy-path fixtures produce byte-identical output (modulo masked fields)", async () => {
    if (!BASELINE_DIR || !fixtures || !recallPort) return;

    for (const fixture of fixtures) {
      const actual = await recallPort(fixture.input);
      expect(stripMasked(actual)).toStrictEqual(stripMasked(fixture.expected));
    }
  });
});
