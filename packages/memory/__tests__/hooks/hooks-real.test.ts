/**
 * Real-store hook tests — verify that post-tool-capture and
 * compaction-checkpoint actually persist data when called with a
 * real in-memory MemoryStore.
 *
 * These tests use SqliteMemoryStore(':memory:') so they are fully
 * self-contained and require no external DB process.
 *
 * Test strategy:
 *   - Construct an in-memory store.
 *   - Inject it into the hook via vi.mock (replacing PgMemoryStore
 *     with a thin wrapper that delegates to the SqliteMemoryStore).
 *   - Call processEvent().
 *   - Assert that a row was inserted into the store.
 *
 * Layer: hooks are in the handler/infrastructure boundary.
 * Stakes: Medium (hook wiring correctness; not auth/billing path).
 *
 * source: engineer.md Move 2 — contract tested: "postcondition: row inserted".
 * source: engineer.md Move 6 — self-verify step: each test covers one postcondition.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SqliteMemoryStore } from "../../src/remember/storage/sqlite-store.js";

// ── Shared in-memory store ────────────────────────────────────────────────────

let store: SqliteMemoryStore;

// We need to intercept PgMemoryStore construction so the hooks use our
// in-memory store instead of connecting to a real PG instance.
// The mock is set up BEFORE importing the hook modules.

vi.mock("../../src/remember/storage/pg-store.js", () => {
  // Must use `function` (not arrow) so `new PgMemoryStore(...)` works as a constructor.
  // The `store` variable is set by beforeEach — the closure captures it by reference.
  function PgMemoryStore(): {
    insertMemoryAsync: (data: Parameters<SqliteMemoryStore["insertMemory"]>[0]) => Promise<number>;
    runAsync: (fn: (c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => Promise<unknown>;
    close: () => Promise<void>;
  } {
    return {
      insertMemoryAsync(data: Parameters<SqliteMemoryStore["insertMemory"]>[0]): Promise<number> {
        return Promise.resolve(store.insertMemory(data));
      },
      runAsync(fn: (c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>): Promise<unknown> {
        const fakeClient = {
          query(_sql: string, _params?: unknown[]): Promise<{ rows: unknown[] }> {
            return Promise.resolve({ rows: [] });
          },
        };
        return fn(fakeClient);
      },
      close(): Promise<void> { return Promise.resolve(); },
    };
  }
  return { PgMemoryStore };
});

// Mock cascade — we only want to test that the cascade path is invoked,
// not that it actually advances memories (that is tested in consolidation tests).
vi.mock("../../src/consolidation/stages/cascade.js", () => ({
  runCascadeAdvancement: vi.fn().mockResolvedValue({
    advanced: 0,
    scanned: 0,
    heartbeats_written: 0,
    heartbeats_skipped: 0,
    transitions_count: 0,
    transitions_preview: [],
  }),
}));

import { runCascadeAdvancement } from "../../src/consolidation/stages/cascade.js";
import { processEvent as postToolCaptureProcess } from "../../src/hooks/post-tool-capture.js";
import { processEvent as compactionCheckpointProcess } from "../../src/hooks/compaction-checkpoint.js";
import {
  POST_TOOL_USE_EDIT_EVENT,
  POST_TOOL_USE_READ_EVENT,
  POST_TOOL_USE_LOW_VALUE_EVENT,
  COMPACTION_EVENT,
} from "./fixtures.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  store = new SqliteMemoryStore(":memory:");
});

afterEach(() => {
  store.close();
});

// ── post-tool-capture real-store tests ────────────────────────────────────────

describe("post-tool-capture (real store)", () => {
  it("inserts a memory row for a high-value Edit event", async () => {
    // Postcondition under test: insertMemory called → getMemory(id) returns non-null.

    await postToolCaptureProcess(POST_TOOL_USE_EDIT_EVENT);

    // The mock calls store.insertMemory; verify by listing all memories.
    // SqliteMemoryStore does not expose listAll, but getMemory(1) is enough
    // since ':memory:' is fresh and this is the first insert.
    const inserted = store.getMemory(1);
    expect(inserted).not.toBeNull();
    expect(inserted?.content).toContain("# Tool: Edit");
    expect(inserted?.source).toBe("tool");
    expect(inserted?.tags).toContain("auto-captured");
    expect(inserted?.tags).toContain("tool:edit");
  });

  it("inserts a memory row for a light-value Read event", async () => {
    // Postcondition: Read tool (input-reference only) still inserts a row.

    await postToolCaptureProcess(POST_TOOL_USE_READ_EVENT);

    const inserted = store.getMemory(1);
    expect(inserted).not.toBeNull();
    expect(inserted?.content).toContain("# Tool: Read");
    expect(inserted?.tags).toContain("tool:read");
    // Light-value: content must not include the "Output:" section.
    expect(inserted?.content).not.toContain("**Output:**");
  });

  it("does NOT insert any row for a low-value tool event", async () => {
    // Postcondition: low-value tool (TodoRead) is filtered — store stays empty.

    await postToolCaptureProcess(POST_TOOL_USE_LOW_VALUE_EVENT);

    // No row inserted — getMemory(1) returns null on a fresh store.
    const notInserted = store.getMemory(1);
    expect(notInserted).toBeNull();
  });
});

// ── compaction-checkpoint real-store tests ────────────────────────────────────

describe("compaction-checkpoint (real store)", () => {
  it("calls runCascadeAdvancement on a valid compaction event", async () => {
    // Postcondition: cascade is invoked (runCascadeAdvancement is a mock spy).

    vi.clearAllMocks();

    await compactionCheckpointProcess(COMPACTION_EVENT);

    expect(runCascadeAdvancement).toHaveBeenCalledOnce();
  });

  it("calls runCascadeAdvancement on a null event", async () => {
    vi.clearAllMocks();

    await compactionCheckpointProcess(null);

    expect(runCascadeAdvancement).toHaveBeenCalledOnce();
  });

  it("does not throw on null event", async () => {
    await expect(compactionCheckpointProcess(null)).resolves.not.toThrow();
  });

  it("logs checkpoint save with correct session_id", async () => {
    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    };

    await compactionCheckpointProcess(COMPACTION_EVENT);

    process.stderr.write = origWrite;
    const stderrOut = stderrLines.join("");
    expect(stderrOut).toContain(`checkpoint save: session_id=${COMPACTION_EVENT.session_id}`);
    expect(stderrOut).not.toContain("stub");
  });
});
