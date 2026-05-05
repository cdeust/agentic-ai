/**
 * session-lifecycle consolidation wiring — unit tests for Eng-13 runConsolidation.
 *
 * Verifies the depth-gated consolidation logic ported from:
 *   cortex@ed33435 mcp_server/hooks/session_lifecycle.py:103-151
 *
 * Invariants tested:
 *   1. processEvent exits cleanly for short session (<5 turns) — cascade runs.
 *   2. processEvent exits cleanly for medium session (5-20 turns).
 *   3. processEvent exits cleanly for long session (>20 turns).
 *   4. Consolidation logs the correct mode to stderr.
 *   5. Consolidation failure is non-fatal (no throw).
 *
 * source: cortex@ed33435 mcp_server/hooks/session_lifecycle.py
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock PgMemoryStore — never touches real PostgreSQL.
vi.mock("../../src/remember/storage/pg-store.js", () => {
  function PgMemoryStore(): {
    runAsync: (fn: (c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => Promise<unknown>;
    close: () => Promise<void>;
  } {
    return {
      runAsync: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }
  return { PgMemoryStore };
});

vi.mock("../../src/consolidation/stages/cascade.js", () => ({
  runCascadeAdvancement: vi.fn().mockResolvedValue({
    advanced: 2,
    scanned: 10,
    heartbeats_written: 0,
    heartbeats_skipped: 0,
    transitions_count: 2,
    transitions_preview: [],
  }),
}));

import { processEvent } from "../../src/hooks/session-lifecycle.js";
import { runCascadeAdvancement } from "../../src/consolidation/stages/cascade.js";
import type { SessionEndEvent } from "../../src/hooks/types.js";

const DEFAULT_CASCADE_RESULT = {
  advanced: 2,
  scanned: 10,
  heartbeats_written: 0,
  heartbeats_skipped: 0,
  transitions_count: 2,
  transitions_preview: [],
};

const mockedCascade = vi.mocked(runCascadeAdvancement);

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeEvent(turnCount: number): SessionEndEvent {
  return {
    hook_type: "SessionEnd",
    session_id: `test-session-${turnCount}`,
    cwd: "/tmp/test-project",
    tools_used: ["Read", "Edit"],
    duration: 300,
    turn_count: turnCount,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("session-lifecycle consolidation wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCascade.mockResolvedValue(DEFAULT_CASCADE_RESULT);
  });

  it("processEvent runs without throwing for short session (<5 turns)", async () => {
    await expect(processEvent(makeEvent(3))).resolves.not.toThrow();
    expect(mockedCascade).toHaveBeenCalledOnce();
  });

  it("processEvent runs without throwing for medium session (5-20 turns)", async () => {
    await expect(processEvent(makeEvent(10))).resolves.not.toThrow();
    expect(mockedCascade).toHaveBeenCalledOnce();
  });

  it("processEvent runs without throwing for long session (>20 turns)", async () => {
    await expect(processEvent(makeEvent(25))).resolves.not.toThrow();
    expect(mockedCascade).toHaveBeenCalledOnce();
  });

  it("logs dream mode to stderr", async () => {
    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    };

    await processEvent(makeEvent(25));

    process.stderr.write = origWrite;
    const combined = stderrLines.join("");
    // The consolidation log line includes "Dream (full):" for >20 turns.
    expect(combined).toContain("Dream (full):");
  });

  it("consolidation failure is non-fatal — processEvent resolves", async () => {
    mockedCascade.mockRejectedValue(new Error("cascade exploded"));

    await expect(processEvent(makeEvent(10))).resolves.not.toThrow();
  });

  it("processEvent skips when session_id is absent", async () => {
    const event: SessionEndEvent = { hook_type: "SessionEnd" };
    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    };

    await processEvent(event);

    process.stderr.write = origWrite;
    expect(stderrLines.join("")).toContain("No session_id");
    expect(mockedCascade).not.toHaveBeenCalled();
  });
});
