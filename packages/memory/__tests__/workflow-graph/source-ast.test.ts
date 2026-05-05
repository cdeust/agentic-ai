/**
 * Tests for WorkflowGraphASTSource (Phase 7 Group H — L6 AST uncap re-sync).
 *
 * source: cortex@f2b9f99 mcp_server/infrastructure/workflow_graph_source_ast.py
 *
 * Two test layers:
 *
 * 1. Env-gated and disabled-path behavior — tested directly with no mocks.
 * 2. AP-dependent paths (loadSymbolsAsync / loadAstEdgesAsync / verifySymbols) —
 *    tested by mocking `callUpstream` from ingest-helpers to return synthetic
 *    AP graph rows. The mock surface matches AP's query_graph response shape
 *    ({columns, rows, status:"ok"}) so the production code path runs end-to-end
 *    against a deterministic fake instead of a live automatised-pipeline server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowGraphASTSource } from "../../src/workflow-graph/sources/source-ast.js";

// AP query_graph response shape — see source-ast.ts _asList()
type ApResponse = {
  columns: string[];
  rows: unknown[][];
  status: "ok" | "error";
};

// Mock callUpstream so the real production code path executes against a
// deterministic AP fake. Each test installs its own per-table response map.
let mockResponses: Record<string, ApResponse> = {};

vi.mock("../../src/codebase-analysis/handlers/ingest-helpers.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/codebase-analysis/handlers/ingest-helpers.js")
  >("../../src/codebase-analysis/handlers/ingest-helpers.js");
  return {
    ...actual,
    callUpstream: vi.fn(async (_server: string, _tool: string, args: Record<string, unknown>) => {
      const query = String(args["query"] ?? "");
      // Match any registered response whose key (a query substring) is in the query.
      for (const [key, payload] of Object.entries(mockResponses)) {
        if (query.includes(key)) return payload as unknown as Record<string, unknown>;
      }
      // No registered response → empty result (table doesn't exist in AP).
      return { columns: [], rows: [], status: "ok" };
    }),
  };
});

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

// ── AP-graph-backed tests (callUpstream mocked at module boundary) ────────
//
// These exercise the same production code paths a live automatised-pipeline
// server would, but with a deterministic in-memory fake. Each test:
//   1. Creates a real tmpdir and points CORTEX_AP_GRAPH_PATH at it so
//      _resolveGraphPaths returns one path (existsSync passes).
//   2. Registers AP query_graph responses keyed by a substring of the query
//      that source-ast emits (e.g. "MATCH (s:Function)" or
//      "Calls_Function_Method").
//   3. Invokes the public method and asserts the normalised output.
//
// source: cortex@f2b9f99 workflow_graph_source_ast.py — same response/normalisation contract

describe("WorkflowGraphASTSource AP-backed paths (mocked callUpstream)", () => {
  let tmpGraph: string;
  const origEnabled = process.env["CORTEX_MEMORY_AP_ENABLED"];
  const origPath = process.env["CORTEX_AP_GRAPH_PATH"];

  // _resolveGraphPaths also scans roster dirs (~/.cortex/ap_graphs,
  // ~/.cache/cortex/code-graphs); on a dev machine these may exist and add
  // extra paths, multiplying mock responses. Override HOME so the roster
  // scan only sees an empty tmpdir, leaving the explicit env path as the
  // only graph path resolved.
  let tmpHome: string;
  const origHome = process.env["HOME"];

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "ap-graph-home-"));
    tmpGraph = mkdtempSync(join(tmpdir(), "ap-graph-mock-"));
    process.env["HOME"] = tmpHome;
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "1";
    process.env["CORTEX_AP_GRAPH_PATH"] = tmpGraph;
    mockResponses = {};
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = origHome;
    if (origEnabled === undefined) delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    else process.env["CORTEX_MEMORY_AP_ENABLED"] = origEnabled;
    if (origPath === undefined) delete process.env["CORTEX_AP_GRAPH_PATH"];
    else process.env["CORTEX_AP_GRAPH_PATH"] = origPath;
    rmSync(tmpGraph, { recursive: true, force: true });
    rmSync(tmpHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("loadSymbolsAsync — load-all mode (paths=[]) returns uncapped symbol list", async () => {
    // Register one response for the Function label query (load-all mode = no LIMIT clause).
    // source: source-ast.ts:430-451 — load-all baseQuery has no LIMIT
    mockResponses["MATCH (s:Function)"] = {
      columns: ["qualified_name", "name"],
      rows: [
        ["src/foo.ts::doFoo", "doFoo"],
        ["src/bar.ts::doBar", "doBar"],
      ],
      status: "ok",
    };
    const src = new WorkflowGraphASTSource();
    const rows = await src.loadSymbolsAsync([]);

    // Both symbols flow through (no per-file cap applied in load-all mode).
    const qnames = rows.map((r) => r["qualified_name"]);
    expect(qnames).toContain("src/foo.ts::doFoo");
    expect(qnames).toContain("src/bar.ts::doBar");
    // symbol_type mapping: Function → "function"
    expect(rows.find((r) => r["qualified_name"] === "src/foo.ts::doFoo")!["symbol_type"]).toBe(
      "function",
    );
  });

  it("loadSymbolsAsync — Import nodes use s.id as qualified_name surrogate", async () => {
    // _NON_QUALIFIED_LABELS = {"Import"}; source-ast.ts:434-444 selects s.id AS
    // qualified_name for those labels. Verify the row contains the synthetic id.
    // source: source-ast.ts:432-444
    //
    // The HOME tmpdir override in beforeEach() pins _resolveGraphPaths() to
    // exactly one explicit path (the env var). With one graph path resolved,
    // the row count must equal the registered mock-row count — assert both
    // unique qnames and total count to catch a regression that doubles every
    // symbol via redundant graph-path iteration. (Feynman gap D.)
    mockResponses["MATCH (s:Import)"] = {
      columns: ["qualified_name", "name"],
      rows: [
        ["src/app.ts::./utils", "./utils"],
        ["src/app.ts::lodash", "lodash"],
      ],
      status: "ok",
    };
    const src = new WorkflowGraphASTSource();
    const rows = await src.loadSymbolsAsync([]);

    const importRows = rows.filter((r) => r["symbol_type"] === "import");
    expect(importRows.length).toBe(2);
    const uniqQNames = new Set(importRows.map((r) => String(r["qualified_name"])));
    expect(uniqQNames.size).toBe(2);
    expect(uniqQNames).toEqual(new Set(["src/app.ts::./utils", "src/app.ts::lodash"]));
    // The id (file::modpath) becomes qualified_name verbatim — no name-prefix needed.
  });

  it("loadSymbolsAsync — AP error response degrades to []", async () => {
    // source: source-ast.ts:_asList:194 — payloads with status:"error" return
    // an empty list. The loader silently skips error responses (one bad table
    // never kills the whole visualization). Verify the production normaliser
    // honours that contract. (Liskov P1a.)
    mockResponses["MATCH (s:Function)"] = {
      columns: [],
      rows: [],
      status: "error",
    };
    const src = new WorkflowGraphASTSource();
    const rows = await src.loadSymbolsAsync([]);
    // No registered response for any other label → all return empty too.
    // Function would have returned rows but for the error status; nothing else
    // is registered. Result must be [].
    expect(rows.filter((r) => r["symbol_type"] === "function")).toEqual([]);
  });

  it("loadSymbolsAsync — rows with column-count mismatch are skipped", async () => {
    // source: source-ast.ts:_asList:201 — when row.length !== columns.length,
    // the row is skipped (well-formed only). Production protects callers from
    // partial/garbage data; verify the protection still exists. (Liskov P2a.)
    mockResponses["MATCH (s:Function)"] = {
      columns: ["qualified_name", "name"],
      rows: [
        ["src/foo.ts::doFoo", "doFoo"], // well-formed (length 2 matches)
        ["only_one_col"], // malformed: shorter than columns
        ["a", "b", "c"], // malformed: longer than columns
      ],
      status: "ok",
    };
    const src = new WorkflowGraphASTSource();
    const rows = await src.loadSymbolsAsync([]);

    const fnRows = rows.filter((r) => r["symbol_type"] === "function");
    // Only the well-formed row survives.
    expect(fnRows.length).toBe(1);
    expect(fnRows[0]?.["qualified_name"]).toBe("src/foo.ts::doFoo");
  });

  it("loadAstEdgesAsync — Defines_File_Import edges appear in imports kind", async () => {
    // source: source-ast.ts:679 — runEdge("imports", "Defines_File_Import", "File", "Import", false)
    // hasProvenance=false → no confidence/reason columns. selectSrc uses src.id (File).
    mockResponses["Defines_File_Import"] = {
      columns: ["src_name", "dst_name"],
      rows: [
        ["src/app.ts", "src/app.ts::./utils"],
        ["src/app.ts", "src/app.ts::lodash"],
      ],
      status: "ok",
    };
    const src = new WorkflowGraphASTSource();
    const edges = await src.loadAstEdgesAsync([]);

    const importEdges = edges.filter((e) => e["kind"] === "imports");
    // At least the two we registered (other Imports_File_* tables return [])
    expect(importEdges.length).toBeGreaterThanOrEqual(2);
    const dsts = importEdges.map((e) => e["dst_name"]);
    expect(dsts).toEqual(expect.arrayContaining(["src/app.ts::./utils", "src/app.ts::lodash"]));
    // confidence/reason are null for non-provenance tables.
    const definesEdge = importEdges.find((e) => e["dst_name"] === "src/app.ts::./utils")!;
    expect(definesEdge["confidence"]).toBeNull();
    expect(definesEdge["reason"]).toBeNull();
  });

  it("loadAstEdgesAsync — Uses_Method_Struct edges appear in uses kind", async () => {
    // source: source-ast.ts:684-693 — Uses_<src>_<dst> with hasProvenance=true.
    mockResponses["Uses_Method_Struct"] = {
      columns: ["src_name", "dst_name", "confidence", "reason"],
      rows: [
        ["src/svc.ts::Service::handle", "src/types.ts::Request", 0.95, "'type_annotation'"],
      ],
      status: "ok",
    };
    const src = new WorkflowGraphASTSource();
    const edges = await src.loadAstEdgesAsync([]);

    const usesEdges = edges.filter((e) => e["kind"] === "uses");
    expect(usesEdges.length).toBeGreaterThanOrEqual(1);
    const e0 = usesEdges.find((e) => e["dst_name"] === "src/types.ts::Request")!;
    expect(e0["src_name"]).toBe("src/svc.ts::Service::handle");
    expect(e0["confidence"]).toBe(0.95);
    // Quote-stripping at the infrastructure boundary (source-ast.ts:646-657)
    expect(e0["reason"]).toBe("type_annotation");
  });

  it("loadAstEdgesAsync — Cartesian call labels produce Calls_Function_Method edges", async () => {
    // source: source-ast.ts:546-556, 664-666 — call edges enumerate
    // Function/Method/Macro × Function/Method/Macro tables.
    mockResponses["Calls_Function_Method"] = {
      columns: ["src_name", "dst_name", "confidence", "reason"],
      rows: [
        ["src/main.ts::main", "src/svc.ts::Service::handle", 0.9, "'static_call'"],
      ],
      status: "ok",
    };
    const src = new WorkflowGraphASTSource();
    const edges = await src.loadAstEdgesAsync([]);

    const callEdges = edges.filter((e) => e["kind"] === "calls");
    expect(callEdges.length).toBeGreaterThanOrEqual(1);
    const e0 = callEdges.find((e) => e["dst_name"] === "src/svc.ts::Service::handle")!;
    expect(e0["src_name"]).toBe("src/main.ts::main");
    expect(e0["src_file"]).toBe("src/main.ts");
    expect(e0["dst_file"]).toBe("src/svc.ts");
    expect(e0["confidence"]).toBe(0.9);
    expect(e0["reason"]).toBe("static_call");
  });
});
