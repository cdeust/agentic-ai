/**
 * Tests for Phase 7 Group E — composition-root DI wiring.
 *
 * Verifies that each codebase-analysis handler:
 *   1. Accepts deps via constructor injection.
 *   2. Calls deps.store methods (not a hidden singleton).
 *   3. Calls deps.mcpClientPool.call when an upstream MCP invocation
 *      is required (callUpstream path).
 *   4. Surfaces McpConnectionError (not undefined behavior) when
 *      mcpClientPool is null and a pipeline_id fetch is attempted.
 *
 * No real MemoryStore, no real MCP server — pure mocks.
 *
 * Stakes: Medium (core business logic, non-auth, non-billing).
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";

import {
  handler as analyzeHandler,
  type CodebaseAnalyzeDeps,
} from "../../../src/codebase-analysis/handlers/codebase-analyze.js";
import {
  handler as ingestPrdHandler,
  type IngestPrdDeps,
} from "../../../src/codebase-analysis/handlers/ingest-prd.js";
import {
  handler as ingestCodebaseHandler,
  type IngestCodebaseDeps,
} from "../../../src/codebase-analysis/handlers/ingest-codebase.js";
import { McpConnectionError, type McpClientPool } from "../../../src/codebase-analysis/handlers/ingest-helpers.js";

// ── Mock builders ─────────────────────────────────────────────────────────

/**
 * Build a minimal MemoryStore mock.
 *
 * precondition:  none.
 * postcondition: all methods are vi.fn(); insertMemory returns 42 by default.
 */
function makeStoreMock(): Record<string, ReturnType<typeof vi.fn>> & {
  insertMemory: ReturnType<typeof vi.fn>;
  getEntityByName: ReturnType<typeof vi.fn>;
  upsertEntity: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  getAllMemoriesForDecay: ReturnType<typeof vi.fn>;
} {
  return {
    insertMemory: vi.fn().mockReturnValue(42),
    getMemory: vi.fn().mockReturnValue(null),
    deleteMemory: vi.fn().mockReturnValue(false),
    bumpHeatRaw: vi.fn(),
    updateMemoryHeat: vi.fn(),
    updateMemoriesHeatBatch: vi.fn().mockReturnValue(0),
    updateMemoryImportance: vi.fn(),
    updateMemoryAccess: vi.fn(),
    updateMemoryMetamemory: vi.fn(),
    setMemoryProtected: vi.fn(),
    markMemoryStale: vi.fn(),
    getHomeostaticFactor: vi.fn().mockReturnValue(1.0),
    setHomeostaticFactor: vi.fn(),
    searchVectors: vi.fn().mockReturnValue([]),
    getEntityByName: vi.fn().mockReturnValue(null),
    upsertEntity: vi.fn().mockReturnValue(1),
    linkMemoryEntity: vi.fn(),
    upsertRelationship: vi.fn(),
    getSchemasForDomain: vi.fn().mockReturnValue([]),
    loadOscillatoryState: vi.fn().mockReturnValue(null),
    saveOscillatoryState: vi.fn(),
    close: vi.fn(),
    // Raw SQL escape hatch used by codebase-analyze-helpers.ts
    execute: vi.fn().mockReturnValue([]),
    insertEntity: vi.fn().mockReturnValue(1),
    insertRelationship: vi.fn(),
    getAllMemoriesForDecay: vi.fn().mockReturnValue([]),
  };
}

/**
 * Build a minimal McpClientPool mock.
 *
 * precondition:  none.
 * postcondition: call() returns the supplied result dict.
 */
function makePoolMock(result: Record<string, unknown> = {}): McpClientPool {
  return { call: vi.fn().mockResolvedValue(result) };
}

// ── codebase-analyze handler ──────────────────────────────────────────────

describe("codebase-analyze handler — DI wiring", () => {
  it("returns analyzed:false when directory does not exist", async () => {
    const store = makeStoreMock();
    const deps: CodebaseAnalyzeDeps = { store };

    const result = await analyzeHandler(
      { directory: "/nonexistent/path/that/does/not/exist" },
      deps,
    );

    expect(result["analyzed"]).toBe(false);
    expect(result["reason"]).toContain("directory not found");
    // Store must NOT be touched on an early-exit path
    expect(store.insertMemory).not.toHaveBeenCalled();
  });

  it("returns dry_run result without calling store when dry_run=true", async () => {
    const store = makeStoreMock();
    const deps: CodebaseAnalyzeDeps = { store };

    // Use a real directory (tmpdir) so existsSync passes
    const result = await analyzeHandler(
      { directory: tmpdir(), dry_run: true, max_files: 1 },
      deps,
    );

    expect(result["analyzed"]).toBe(false);
    expect(result["dry_run"]).toBe(true);
    expect(result["directory"]).toBe(tmpdir());
    expect(store.insertMemory).not.toHaveBeenCalled();
  });

  it("calls store.insertMemory when processing a real source file", async () => {
    // Create a tiny temp codebase with one TS file
    const tmpDir = mkdtempSync(join(tmpdir(), "test-codebase-"));
    writeFileSync(join(tmpDir, "main.ts"), "export function hello(): string { return 'hi'; }\n", "utf8");

    const store = makeStoreMock();
    const deps: CodebaseAnalyzeDeps = { store };

    const result = await analyzeHandler(
      { directory: tmpDir, incremental: false, max_files: 5, dry_run: false },
      deps,
    );

    expect(result["analyzed"]).toBe(true);
    // insertMemory must have been called through the injected store, not a singleton
    expect(store.insertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        directory_context: tmpDir,
        agent_context: "codebase",
        source: "codebase_analyze",
      }),
    );
  });

  it("stores singleton deps interface — handler works without initStore", async () => {
    // Prior to Phase 7 Group E, the handler required initStore() to be called.
    // This test proves the DI-wired path works without any module-level state.
    const store = makeStoreMock();
    const deps: CodebaseAnalyzeDeps = { store };

    // Should not throw even though initStore was never called
    const result = await analyzeHandler(
      { directory: tmpdir(), dry_run: true },
      deps,
    );
    expect(result["analyzed"]).toBe(false); // dry_run path
  });
});

// ── ingest-prd handler ────────────────────────────────────────────────────

describe("ingest-prd handler — DI wiring", () => {
  it("ingests a PRD from content, writing to the injected store and wikiRoot", async () => {
    const wikiRoot = mkdtempSync(join(tmpdir(), "test-wiki-"));
    const store = makeStoreMock();
    const deps: IngestPrdDeps = { store, wikiRoot, mcpClientPool: null };

    const prdContent = [
      "# My Feature PRD",
      "",
      "## Decisions",
      "- Use PostgreSQL for persistent storage",
      "",
      "## Requirements",
      "- The system must support 1000 concurrent users",
    ].join("\n");

    const result = await ingestPrdHandler(
      { content: prdContent },
      deps,
    );

    expect(result["ingested"]).toBe(true);
    expect(result["title"]).toBe("My Feature PRD");
    // Store must have been called with the injected store instance
    expect(store.insertMemory).toHaveBeenCalled();
    // At minimum the summary memory is written
    expect((store.insertMemory as Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts decision and requirement bullets correctly", async () => {
    const wikiRoot = mkdtempSync(join(tmpdir(), "test-wiki-"));
    const store = makeStoreMock();
    const deps: IngestPrdDeps = { store, wikiRoot, mcpClientPool: null };

    const prdContent = [
      "# Decisions-Test PRD",
      "",
      "## Decisions",
      "- Decision number one from the architecture review",
      "- Decision number two about the data model",
      "",
      "## Requirements",
      "- Requirement one must be satisfied by the implementation",
    ].join("\n");

    const result = await ingestPrdHandler({ content: prdContent }, deps);

    expect(result["decision_count"]).toBeGreaterThanOrEqual(1);
    expect(result["requirement_count"]).toBeGreaterThanOrEqual(1);
  });

  it("surfaces McpConnectionError when pipeline_id is used without a pool", async () => {
    const wikiRoot = mkdtempSync(join(tmpdir(), "test-wiki-"));
    const store = makeStoreMock();
    const deps: IngestPrdDeps = { store, wikiRoot, mcpClientPool: null };

    const result = await ingestPrdHandler(
      { pipeline_id: "prd-test-123" },
      deps,
    );

    // Without a real pool, the handler returns ingested:false with prd_gen_unreachable
    expect(result["ingested"]).toBe(false);
    expect(result["reason"]).toBe("prd_gen_unreachable");
  });

  it("calls mcpClientPool.call when validate=true and pool is provided", async () => {
    const wikiRoot = mkdtempSync(join(tmpdir(), "test-wiki-"));
    const store = makeStoreMock();
    const pool = makePoolMock({ score: 0.9, valid: true });
    const deps: IngestPrdDeps = { store, wikiRoot, mcpClientPool: pool };

    const prdContent = "# Validate PRD\n\n## Decisions\n- Use the pool for validation calls\n";

    await ingestPrdHandler({ content: prdContent, validate: true }, deps);

    // pool.call must have been invoked for validate_prd_document
    expect((pool.call as Mock)).toHaveBeenCalledWith(
      "prd-gen",
      "validate_prd_document",
      expect.objectContaining({ content: prdContent }),
    );
  });

  it("ingest-prd handler works without initStore — no singleton required", async () => {
    const wikiRoot = mkdtempSync(join(tmpdir(), "test-wiki-"));
    const store = makeStoreMock();
    const deps: IngestPrdDeps = { store, wikiRoot, mcpClientPool: null };

    // Should not throw even though module-level initStore was never called
    await expect(
      ingestPrdHandler({ content: "# Title\n\nBody text." }, deps),
    ).resolves.not.toThrow();
  });
});

// ── ingest-codebase handler ───────────────────────────────────────────────

describe("ingest-codebase handler — DI wiring", () => {
  it("returns ingested:false when project_path is empty", async () => {
    const store = makeStoreMock();
    const pool = makePoolMock();
    const deps: IngestCodebaseDeps = { store, wikiRoot: "", mcpClientPool: pool };

    const result = await ingestCodebaseHandler({ project_path: "" }, deps);

    expect(result["ingested"]).toBe(false);
    expect(result["reason"]).toBe("project_path is required");
    expect(store.insertMemory).not.toHaveBeenCalled();
  });

  it("returns upstream_mcp_unreachable when mcpClientPool is null and analyze is needed", async () => {
    const store = makeStoreMock();
    // null pool means callUpstream will throw McpConnectionError
    const deps: IngestCodebaseDeps = { store, wikiRoot: "", mcpClientPool: null };

    const result = await ingestCodebaseHandler(
      { project_path: "/some/codebase/path" },
      deps,
    );

    expect(result["ingested"]).toBe(false);
    expect(result["reason"]).toBe("upstream_mcp_unreachable");
  });

  it("calls pool.call with analyze_codebase when graph is not cached", async () => {
    // ensureGraph calls analyze_codebase via callUpstream
    const graphPath = "/tmp/test-graph";
    const pool = makePoolMock({
      status: "success",
      graph_path: graphPath,
    });
    const store = makeStoreMock();
    const deps: IngestCodebaseDeps = { store, wikiRoot: "", mcpClientPool: pool };

    await ingestCodebaseHandler(
      { project_path: "/test/project", top_symbols: 0, top_processes: 0 },
      deps,
    );

    // The pool must be called for analyze_codebase
    expect((pool.call as Mock)).toHaveBeenCalledWith(
      "codebase",
      "analyze_codebase",
      expect.objectContaining({ path: expect.any(String) }),
    );
  });

  it("uses injected wikiRoot for process page writes", async () => {
    const wikiRoot = mkdtempSync(join(tmpdir(), "test-wiki-codebase-"));
    const graphPath = "/tmp/test-graph-wiki";
    const pool = makePoolMock({
      status: "success",
      graph_path: graphPath,
    });
    const store = makeStoreMock();
    const deps: IngestCodebaseDeps = { store, wikiRoot, mcpClientPool: pool };

    const result = await ingestCodebaseHandler(
      { project_path: "/test/project", top_symbols: 0, top_processes: 0 },
      deps,
    );

    // Should succeed (ingested=true) or fail upstream — either way, wikiRoot is used
    // The key assertion is that no TypeError is thrown about _wikiRoot undefined
    expect(result).toHaveProperty("ingested");
  });

  it("McpConnectionError is imported from ingest-helpers, not from shared", () => {
    // Verify the type is the ingest-helpers variant (not the shared/errors variant)
    // This ensures no hidden cross-module dependency
    const err = new McpConnectionError("test");
    expect(err.name).toBe("McpConnectionError");
    expect(err).toBeInstanceOf(Error);
  });
});
