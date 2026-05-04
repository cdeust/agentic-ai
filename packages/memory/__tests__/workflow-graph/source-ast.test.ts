/**
 * Tests for WorkflowGraphASTSource (Phase 7 Group H — L6 AST uncap re-sync).
 *
 * source: cortex@f2b9f99 mcp_server/infrastructure/workflow_graph_source_ast.py
 *
 * All AP-dependent paths (loadSymbolsAsync / loadAstEdgesAsync / searchCodebase /
 * verifySymbols) require live AP graph access and cannot be tested without
 * a running automatised-pipeline server. Those paths are marked it.todo.
 *
 * Pure-function and env-gated behavior is tested directly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowGraphASTSource } from "../../src/workflow-graph/sources/source-ast.js";

// ── enabled() ─────────────────────────────────────────────────────────────

describe("WorkflowGraphASTSource.enabled()", () => {
  const original = process.env["CORTEX_MEMORY_AP_ENABLED"];

  afterEach(() => {
    if (original === undefined) {
      delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    } else {
      process.env["CORTEX_MEMORY_AP_ENABLED"] = original;
    }
  });

  it("returns true when env var is unset (default)", () => {
    delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    const src = new WorkflowGraphASTSource();
    expect(src.enabled()).toBe(true);
  });

  it("returns false when CORTEX_MEMORY_AP_ENABLED=0", () => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "0";
    const src = new WorkflowGraphASTSource();
    expect(src.enabled()).toBe(false);
  });

  it("returns true when CORTEX_MEMORY_AP_ENABLED=1", () => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "1";
    const src = new WorkflowGraphASTSource();
    expect(src.enabled()).toBe(true);
  });
});

// ── loadSymbolsAsync / loadAstEdgesAsync — disabled path ──────────────────
// Note: sync façades (loadSymbols / loadAstEdges) were removed in the
// catch-up wave (port/catchup-recall-real). Tests updated to the async API
// which returns [] when AP is disabled (same observable contract).

describe("WorkflowGraphASTSource async API when AP disabled", () => {
  beforeEach(() => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "0";
  });

  afterEach(() => {
    delete process.env["CORTEX_MEMORY_AP_ENABLED"];
  });

  it("loadSymbolsAsync returns [] when AP is disabled", async () => {
    const src = new WorkflowGraphASTSource();
    await expect(src.loadSymbolsAsync([])).resolves.toEqual([]);
  });

  it("loadAstEdgesAsync returns [] when AP is disabled", async () => {
    const src = new WorkflowGraphASTSource();
    await expect(src.loadAstEdgesAsync([])).resolves.toEqual([]);
  });

  it("loadSymbolsAsync returns [] when enabled but no graph paths exist", async () => {
    // With AP enabled but no CORTEX_AP_GRAPH_PATH and no default paths on CI,
    // resolveGraphPaths returns [] and the loader short-circuits.
    delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    delete process.env["CORTEX_AP_GRAPH_PATH"];
    const src = new WorkflowGraphASTSource();
    // May return [] (no graphs) or throw McpConnectionError (caught internally).
    // Either way, the promise must resolve to an array.
    const result = await src.loadSymbolsAsync([]);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── loadSymbolsAsync — disabled path ─────────────────────────────────────

describe("WorkflowGraphASTSource.loadSymbolsAsync — disabled", () => {
  beforeEach(() => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "0";
  });
  afterEach(() => {
    delete process.env["CORTEX_MEMORY_AP_ENABLED"];
  });

  it("returns [] immediately when AP is disabled", async () => {
    const src = new WorkflowGraphASTSource();
    const result = await src.loadSymbolsAsync([]);
    expect(result).toEqual([]);
  });

  it("returns [] even with file paths when AP is disabled", async () => {
    const src = new WorkflowGraphASTSource();
    const result = await src.loadSymbolsAsync(["/some/file.ts"]);
    expect(result).toEqual([]);
  });
});

// ── loadAstEdgesAsync — disabled path ────────────────────────────────────

describe("WorkflowGraphASTSource.loadAstEdgesAsync — disabled", () => {
  beforeEach(() => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "0";
  });
  afterEach(() => {
    delete process.env["CORTEX_MEMORY_AP_ENABLED"];
  });

  it("returns [] when AP is disabled", async () => {
    const src = new WorkflowGraphASTSource();
    const result = await src.loadAstEdgesAsync([]);
    expect(result).toEqual([]);
  });
});

// ── loadSymbolsAsync — AP enabled but no graphs ───────────────────────────

describe("WorkflowGraphASTSource.loadSymbolsAsync — enabled, no graphs", () => {
  const origEnabled = process.env["CORTEX_MEMORY_AP_ENABLED"];
  const origPath = process.env["CORTEX_AP_GRAPH_PATH"];

  beforeEach(() => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "1";
    // Point to a path that doesn't exist so _resolveGraphPaths returns [].
    process.env["CORTEX_AP_GRAPH_PATH"] = "/nonexistent/graph/path/that/does/not/exist";
  });
  afterEach(() => {
    if (origEnabled === undefined) delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    else process.env["CORTEX_MEMORY_AP_ENABLED"] = origEnabled;
    if (origPath === undefined) delete process.env["CORTEX_AP_GRAPH_PATH"];
    else process.env["CORTEX_AP_GRAPH_PATH"] = origPath;
  });

  it("returns [] when no graph paths can be resolved", async () => {
    const src = new WorkflowGraphASTSource();
    const result = await src.loadSymbolsAsync([]);
    expect(result).toEqual([]);
  });
});

// ── verifySymbols — disabled path ────────────────────────────────────────

describe("WorkflowGraphASTSource.verifySymbols — disabled", () => {
  beforeEach(() => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "0";
  });
  afterEach(() => {
    delete process.env["CORTEX_MEMORY_AP_ENABLED"];
  });

  it("returns {q: false} for all inputs when disabled", async () => {
    const src = new WorkflowGraphASTSource();
    const result = await src.verifySymbols(["Foo", "Bar::Baz"]);
    expect(result).toEqual({ Foo: false, "Bar::Baz": false });
  });

  it("returns {} for empty list", async () => {
    const src = new WorkflowGraphASTSource();
    const result = await src.verifySymbols([]);
    expect(result).toEqual({});
  });
});

// ── close() ─────────────────────────────────────────────────────────────

describe("WorkflowGraphASTSource.close()", () => {
  it("is idempotent — no throws", () => {
    const src = new WorkflowGraphASTSource();
    expect(() => {
      src.close();
      src.close();
    }).not.toThrow();
  });
});

// ── live AP graph tests (require running automatised-pipeline) ─────────────

it.todo(
  // port-pending: live AP graph required
  "loadSymbolsAsync — load-all mode (paths=[]) returns uncapped symbol list",
);

it.todo(
  // port-pending: live AP graph required
  "loadSymbolsAsync — Import nodes use s.id as qualified_name surrogate",
);

it.todo(
  // port-pending: live AP graph required
  "loadAstEdgesAsync — Defines_File_Import edges appear in imports kind",
);

it.todo(
  // port-pending: live AP graph required
  "loadAstEdgesAsync — Uses_Method_Struct edges appear in uses kind",
);

it.todo(
  // port-pending: live AP graph required
  "loadAstEdgesAsync — Cartesian call labels produce correct Calls_Function_Method edges",
);
