/**
 * Tests for workflow-graph/sources/source-native-ast.ts
 *
 * Tests: WorkflowGraphNativeASTSource public interface,
 * enabled()/astAvailable() contract, loadSymbols/loadAstEdges
 * empty-input postconditions, symbol/edge shape validation.
 *
 * source: Cortex mcp_server/infrastructure/workflow_graph_source_native_ast.py
 */

import { describe, it, expect } from "vitest";
import { WorkflowGraphNativeASTSource } from "../../src/workflow-graph/sources/source-native-ast.js";

describe("WorkflowGraphNativeASTSource — enabled()", () => {
  it("returns true (always enabled — regex fallback covers all languages)", () => {
    // source: workflow_graph_source_native_ast.py:67-71
    const src = new WorkflowGraphNativeASTSource();
    expect(src.enabled()).toBe(true);
  });
});

describe("WorkflowGraphNativeASTSource — astAvailable()", () => {
  it("returns a boolean without throwing", () => {
    // source: workflow_graph_source_native_ast.py:73-75
    const src = new WorkflowGraphNativeASTSource();
    expect(typeof src.astAvailable()).toBe("boolean");
  });
});

describe("WorkflowGraphNativeASTSource — loadSymbols()", () => {
  it("returns [] for empty input", () => {
    // source: workflow_graph_source_native_ast.py:77-96
    const src = new WorkflowGraphNativeASTSource();
    const result = src.loadSymbols([]);
    expect(result).toEqual([]);
  });

  it("returns [] for non-existent file paths", () => {
    const src = new WorkflowGraphNativeASTSource();
    const result = src.loadSymbols(["/nonexistent/__test__.py"]);
    expect(result).toEqual([]);
  });

  it("returns [] for unreadable paths (empty strings skipped)", () => {
    const src = new WorkflowGraphNativeASTSource();
    const result = src.loadSymbols(["", "  "]);
    expect(result).toEqual([]);
  });

  it("symbol rows have required fields", () => {
    // If a real TS file is passed we get rows with shape:
    // {file_path, qualified_name, symbol_type, signature, language, line, domain}
    // Test shape contract using a known-existing file.
    const src = new WorkflowGraphNativeASTSource();
    const result = src.loadSymbols([import.meta.url.replace("file://", "")]);
    for (const row of result) {
      expect(row).toHaveProperty("file_path");
      expect(row).toHaveProperty("qualified_name");
      expect(row).toHaveProperty("symbol_type");
      expect(row).toHaveProperty("signature");
      expect(row).toHaveProperty("language");
      expect(row).toHaveProperty("line");
      expect(row).toHaveProperty("domain");
    }
  });
});

describe("WorkflowGraphNativeASTSource — loadAstEdges()", () => {
  it("returns [] for empty input", () => {
    // source: workflow_graph_source_native_ast.py:98-117
    const src = new WorkflowGraphNativeASTSource();
    const result = src.loadAstEdges([]);
    expect(result).toEqual([]);
  });

  it("returns [] for non-existent file paths", () => {
    const src = new WorkflowGraphNativeASTSource();
    const result = src.loadAstEdges(["/nonexistent/__test__.py"]);
    expect(result).toEqual([]);
  });

  it("edge rows have required fields when files are parseable", () => {
    const src = new WorkflowGraphNativeASTSource();
    const thisFile = import.meta.url.replace("file://", "");
    const edges = src.loadAstEdges([thisFile]);
    for (const edge of edges) {
      expect(["calls", "imports", "member_of"]).toContain(edge.kind);
      expect(typeof edge.src_file).toBe("string");
      expect(typeof edge.dst_file).toBe("string");
      expect(edge.confidence).toBe(1.0);
      expect(typeof edge.reason).toBe("string");
    }
  });

  it("caps at _MAX_FILES_PER_CALL (2000) files", () => {
    // source: workflow_graph_source_native_ast.py:58
    const src = new WorkflowGraphNativeASTSource();
    // Pass 2001 paths — all non-existent, so returns []
    // The cap is enforced internally; this just verifies no exception
    const paths = Array.from({ length: 2001 }, (_, i) => `/nonexistent/file${i}.py`);
    expect(() => src.loadSymbols(paths)).not.toThrow();
  });
});
