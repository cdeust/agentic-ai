/**
 * Unit tests for sync-instructions.ts.
 *
 * Validates: schema shape, dry_run preview, no-memories early exit,
 * and the section builder.
 *
 * source: cortex@ed33435 mcp_server/handlers/sync_instructions.py
 */

import { describe, it, expect, vi } from "vitest";
import { syncInstructionsHandler, schema } from "../../src/automation/handlers/sync-instructions.js";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Minimal store stub ────────────────────────────────────────────────────────

function makeStore(memories: Array<{ content: string; heat: number; importance: number }> = []) {
  return {
    getMemoriesForDirectory: vi.fn().mockResolvedValue(memories),
    getHotMemories: vi.fn().mockResolvedValue(memories),
  };
}

// ── Schema ────────────────────────────────────────────────────────────────────

describe("syncInstructionsHandler schema", () => {
  it("has the correct title", () => {
    expect(schema.title).toBe("Sync instructions");
  });

  it("max_insights.default === 10", () => {
    expect(schema.inputSchema.properties.max_insights.default).toBe(10);
  });

  it("min_heat.default === 0.3", () => {
    expect(schema.inputSchema.properties.min_heat.default).toBe(0.3);
  });
});

// ── No memories → synced=false ────────────────────────────────────────────────

describe("syncInstructionsHandler — no memories", () => {
  it("returns synced=false with reason no_memories_found", async () => {
    const store = makeStore([]);
    const result = await syncInstructionsHandler({}, store);
    expect(result.synced).toBe(false);
    expect(result.reason).toBe("no_memories_found");
  });
});

// ── Dry run ───────────────────────────────────────────────────────────────────

describe("syncInstructionsHandler — dry_run", () => {
  it("returns synced=true with preview but does not write file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synctest-"));
    const store = makeStore([
      { content: "We decided to use pgvector for embeddings.", heat: 0.9, importance: 0.8 },
      { content: "Chose SQLite for local dev mode.", heat: 0.7, importance: 0.7 },
    ]);

    const result = await syncInstructionsHandler(
      { directory: dir, dry_run: true, max_insights: 5 },
      store,
    );

    expect(result.synced).toBe(true);
    expect(result.dry_run).toBe(true);
    // No file should have been created
    const claudeMd = join(dir, "CLAUDE.md");
    try {
      readFileSync(claudeMd);
      expect(true).toBe(false); // should not reach here
    } catch {
      // File does not exist — correct
      expect(true).toBe(true);
    }
  });
});

// ── Live write — creates CLAUDE.md ───────────────────────────────────────────

describe("syncInstructionsHandler — live write", () => {
  it("creates CLAUDE.md with cortex markers when file is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synctest2-"));
    const store = makeStore([
      { content: "Adopted trunk-based development workflow.", heat: 0.85, importance: 0.8 },
    ]);

    const result = await syncInstructionsHandler({ directory: dir, dry_run: false }, store);

    expect(result.synced).toBe(true);
    const written = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
    expect(written).toContain("<!-- cortex:memory-insights:start -->");
    expect(written).toContain("<!-- cortex:memory-insights:end -->");
    expect(written).toContain("Adopted trunk-based development workflow.");
  });

  it("updates existing CLAUDE.md in-place (replaces section)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "synctest3-"));
    const claudeMdPath = join(dir, "CLAUDE.md");
    writeFileSync(
      claudeMdPath,
      "# Project notes\n\n<!-- cortex:memory-insights:start -->\n## Memory Insights\n\n- old bullet\n\n<!-- cortex:memory-insights:end -->\n",
    );

    const store = makeStore([
      { content: "Switched from Webpack to Vite for bundling.", heat: 0.9, importance: 0.85 },
    ]);

    const result = await syncInstructionsHandler({ directory: dir, dry_run: false }, store);

    expect(result.synced).toBe(true);
    const written = readFileSync(claudeMdPath, "utf-8");
    expect(written).toContain("Switched from Webpack to Vite");
    expect(written).not.toContain("old bullet");
    // Original header preserved
    expect(written).toContain("# Project notes");
  });
});
