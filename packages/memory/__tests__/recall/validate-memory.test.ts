/**
 * Unit tests for validate-memory-handler.ts
 * source: cortex@ed33435 mcp_server/handlers/validate_memory.py
 */

import { describe, it, expect, vi } from "vitest";
import {
  handler,
  assessMemories,
  resolveExistingPaths,
  collectAllRefs,
} from "../../src/recall/handlers/validate-memory-handler.js";
import type { ValidateMemoryStore } from "../../src/recall/handlers/validate-memory-handler.js";

function makeStore(overrides: Partial<ValidateMemoryStore> = {}): ValidateMemoryStore {
  return {
    getMemory: vi.fn().mockResolvedValue(null),
    getMemoriesForDomain: vi.fn().mockResolvedValue([]),
    getMemoriesForDirectory: vi.fn().mockResolvedValue([]),
    getAllMemoriesForValidation: vi.fn().mockResolvedValue([]),
    markMemoryStale: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── assessMemories ─────────────────────────────────────────────────────────

describe("assessMemories", () => {
  it("marks memory stale when all refs missing", () => {
    const memories = [{ id: 1, content: "/nonexistent/path/file.ts" }];
    const existing = new Set<string>();
    const { reports, staleIds } = assessMemories(
      memories as Record<string, unknown>[],
      existing,
      0.5, // source: cortex@ed33435 validate_memory.py:70
    );
    expect(reports[0].is_stale).toBe(true);
    expect(staleIds).toContain(1);
  });

  it("does not mark memory stale when all refs exist", () => {
    const memories = [{ id: 2, content: "/some/valid/path.ts" }];
    const existing = new Set(["/some/valid/path.ts"]);
    const { reports, staleIds } = assessMemories(
      memories as Record<string, unknown>[],
      existing,
      0.5,
    );
    expect(reports[0].is_stale).toBe(false);
    expect(staleIds).not.toContain(2);
  });

  it("returns no_refs reason for memories with no path refs", () => {
    const memories = [{ id: 3, content: "No file paths here, just text." }];
    const { reports } = assessMemories(
      memories as Record<string, unknown>[],
      new Set(),
      0.5,
    );
    expect(reports[0].reason).toBe("no_refs");
  });
});

// ── collectAllRefs ─────────────────────────────────────────────────────────

describe("collectAllRefs", () => {
  it("extracts absolute paths from content", () => {
    const mems = [{ id: 1, content: "See /usr/local/bin/cortex for details" }];
    const refs = collectAllRefs(mems as Record<string, unknown>[]);
    expect(refs.some((r) => r.includes("cortex"))).toBe(true);
  });
});

// ── handler ───────────────────────────────────────────────────────────────

describe("handler", () => {
  it("returns zero validated when no memories found", async () => {
    const store = makeStore();
    const result = await handler({}, store);
    expect(result.validated).toBe(0);
    expect(result.stale_found).toBe(0);
    expect(result.reports).toEqual([]);
  });

  it("does not call markMemoryStale in dry_run mode", async () => {
    const mem = { id: 42, content: "/nonexistent/path/abc.ts" };
    const store = makeStore({
      getAllMemoriesForValidation: vi.fn().mockResolvedValue([mem]),
    });
    const result = await handler({ dry_run: true }, store);
    expect(store.markMemoryStale).not.toHaveBeenCalled();
    expect(result.dry_run).toBe(true);
    expect(result.stale_updated).toBe(0);
  });
});
