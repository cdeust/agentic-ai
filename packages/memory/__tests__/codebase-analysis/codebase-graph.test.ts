/**
 * Tests for codebase-graph: import resolution, call edges, communities, impact.
 *
 * Uses inline fixture FileAnalysis objects — no I/O.
 */

import { describe, expect, it } from "vitest";
import {
  computeImpact,
  detectCommunities,
  extractInheritance,
  resolveAllImports,
  resolveImportToFile,
} from "../../src/codebase-analysis/codebase-graph.js";
import type { FileAnalysis } from "../../src/codebase-analysis/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeAnalysis(
  path: string,
  imports: Array<{ module: string; isRelative?: boolean }> = [],
  defs: Array<{ name: string; kind: string; signature?: string }> = [],
): FileAnalysis {
  return {
    path,
    language: "python",
    contentHash: "abc123",
    imports: imports.map((i) => ({
      module: i.module,
      names: [],
      isRelative: i.isRelative ?? false,
    })),
    definitions: defs.map((d) => ({
      name: d.name,
      kind: d.kind,
      signature: d.signature ?? "",
      docstring: "",
    })),
    docstring: "",
    lineCount: 10,
    callsPerFunction: {},
  };
}

// ── resolveImportToFile ───────────────────────────────────────────────────

describe("resolveImportToFile", () => {
  const knownFiles = new Set(["auth/tokens.py", "auth/utils.py", "main.py"]);

  it("resolves a dotted module to a known file", () => {
    const result = resolveImportToFile("auth.tokens", "main.py", knownFiles);
    expect(result).toBe("auth/tokens.py");
  });

  it("returns null for an unknown module", () => {
    const result = resolveImportToFile("unknown.module", "main.py", knownFiles);
    expect(result).toBeNull();
  });

  it("resolves a relative import from a sibling file", () => {
    const result = resolveImportToFile(".utils", "auth/tokens.py", knownFiles, true);
    expect(result).toBe("auth/utils.py");
  });
});

// ── resolveAllImports ─────────────────────────────────────────────────────

describe("resolveAllImports", () => {
  it("produces file→file edges for resolved imports", () => {
    const analyses = [
      makeAnalysis("main.py", [{ module: "auth.tokens" }]),
      makeAnalysis("auth/tokens.py", []),
    ];
    const edges = resolveAllImports(analyses);
    expect(edges).toContainEqual(["main.py", "auth/tokens.py"]);
  });

  it("does not produce self-edges", () => {
    const analyses = [makeAnalysis("main.py", [{ module: "main" }])];
    const edges = resolveAllImports(analyses);
    for (const [src, tgt] of edges) {
      expect(src).not.toBe(tgt);
    }
  });
});

// ── extractInheritance ────────────────────────────────────────────────────

describe("extractInheritance", () => {
  it("extracts parent classes from class signatures", () => {
    const analyses = [
      makeAnalysis("models.py", [], [
        { name: "Dog", kind: "class", signature: "(Animal)" },
        { name: "Animal", kind: "class" },
      ]),
    ];
    const edges = extractInheritance(analyses);
    expect(edges).toContainEqual(["Dog", "Animal"]);
  });

  it("ignores noise base classes", () => {
    const analyses = [
      makeAnalysis("models.py", [], [
        { name: "MyClass", kind: "class", signature: "(object)" },
      ]),
    ];
    const edges = extractInheritance(analyses);
    expect(edges).toHaveLength(0);
  });
});

// ── detectCommunities ─────────────────────────────────────────────────────

describe("detectCommunities", () => {
  it("returns a map with community ids for connected nodes", () => {
    const edges: [string, string][] = [
      ["a.py", "b.py"],
      ["b.py", "c.py"],
      ["d.py", "e.py"],
    ];
    const communities = detectCommunities(edges, []);
    // a, b, c should share a community; d, e another
    expect(communities.get("a.py")).toBe(communities.get("b.py"));
    expect(communities.get("b.py")).toBe(communities.get("c.py"));
    expect(communities.get("d.py")).toBe(communities.get("e.py"));
    expect(communities.get("a.py")).not.toBe(communities.get("d.py"));
  });

  it("handles empty inputs gracefully", () => {
    const c = detectCommunities([], []);
    expect(c.size).toBe(0);
  });
});

// ── computeImpact ─────────────────────────────────────────────────────────

describe("computeImpact", () => {
  const fileEdges: [string, string][] = [
    ["app.py", "auth.py"],
    ["app.py", "models.py"],
    ["tests.py", "app.py"],
  ];

  it("upstream of auth.py includes app.py and tests.py (transitively)", () => {
    const impact = computeImpact("auth.py", fileEdges, [], 3);
    expect(impact.upstream).toContain("app.py");
    expect(impact.upstream).toContain("tests.py");
  });

  it("downstream of app.py includes auth.py and models.py", () => {
    const impact = computeImpact("app.py", fileEdges, [], 3);
    expect(impact.downstream).toContain("auth.py");
    expect(impact.downstream).toContain("models.py");
  });

  it("does not include target file itself", () => {
    const impact = computeImpact("app.py", fileEdges, [], 3);
    expect(impact.upstream).not.toContain("app.py");
    expect(impact.downstream).not.toContain("app.py");
  });
});
