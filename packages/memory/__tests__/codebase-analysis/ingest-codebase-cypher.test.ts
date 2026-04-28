/**
 * Tests for ingest-codebase-cypher.ts — filePathFromQn (v3.14.9 re-sync).
 *
 * source: cortex@f2b9f99 mcp_server/handlers/ingest_codebase_cypher.py:53-111
 *
 * Pure function tests — no I/O, no upstream MCP calls.
 *
 * The Python original was ported from a single-candidate return to a
 * priority-ordered candidates list in v3.14.9. Each test below maps to
 * one of the four heuristics documented in the Python docstring.
 */

import { describe, expect, it } from "vitest";
import { filePathFromQn } from "../../src/codebase-analysis/handlers/ingest-codebase-cypher.js";

// ── heuristic 1 — head already looks like a file path ─────────────────────
describe("filePathFromQn — heuristic 1: head is a file path", () => {
  it("returns the head when head contains a slash (Python-AP format)", () => {
    const candidates = filePathFromQn("src/core/payments.py::PaymentService");
    expect(candidates).toEqual(["src/core/payments.py"]);
  });

  it("returns the head when head ends with a code extension", () => {
    const candidates = filePathFromQn("handlers/recall.ts::recallHandler");
    expect(candidates).toEqual(["handlers/recall.ts"]);
  });

  it("returns [head] only (no further heuristics once path detected)", () => {
    const candidates = filePathFromQn("a/b/c.rs::MyStruct");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toBe("a/b/c.rs");
  });
});

// ── heuristic 2 — dotted-module head (classic Python pkg.mod::Sym) ─────────
describe("filePathFromQn — heuristic 2: dotted-module head", () => {
  it("converts pkg.mod::Sym to pkg/mod.py", () => {
    const candidates = filePathFromQn("mcp_server.handlers.recall::recall");
    expect(candidates).toEqual(["mcp_server/handlers/recall.py"]);
  });

  it("single-segment module works", () => {
    const candidates = filePathFromQn("payments::PaymentService");
    // 'payments' has no dot, no slash, no code ext → falls through to heuristic 3
    // A single-segment Rust-style qn produces drop-1 candidate: payments.py
    expect(candidates).toContain("payments.py");
  });

  it("returns [dotted-path.py] only (no further heuristics for dotted module)", () => {
    const candidates = filePathFromQn("a.b.c::X");
    expect(candidates).toEqual(["a/b/c.py"]);
  });
});

// ── heuristic 3 — Rust-style a::b::c module path ──────────────────────────
describe("filePathFromQn — heuristic 3: Rust-style module path", () => {
  it("produces drop-1 candidate for module::function", () => {
    const candidates = filePathFromQn("mcp_server::handler");
    expect(candidates).toContain("mcp_server.py");
  });

  it("produces drop-1 and drop-2 candidates for module::Class::method", () => {
    const candidates = filePathFromQn("mcp_server::handlers::recall::RecallHandler");
    // drop-1: mcp_server/handlers/recall.py
    expect(candidates).toContain("mcp_server/handlers/recall.py");
    // drop-2: mcp_server/handlers.py
    expect(candidates).toContain("mcp_server/handlers.py");
  });

  it("returns candidates in priority order (drop-1 first)", () => {
    const candidates = filePathFromQn("a::b::c::d");
    expect(candidates[0]).toBe("a/b/c.py"); // drop-1
    expect(candidates[1]).toBe("a/b.py");   // drop-2
    expect(candidates[2]).toBe("a.py");     // drop-3
  });

  it("no duplicates in the candidates list", () => {
    const candidates = filePathFromQn("a::b::c");
    const unique = new Set(candidates);
    expect(unique.size).toBe(candidates.length);
  });
});

// ── edge cases ────────────────────────────────────────────────────────────
describe("filePathFromQn — edge cases", () => {
  it("returns [] for empty string", () => {
    expect(filePathFromQn("")).toEqual([]);
  });

  it("returns [] when there is no ::", () => {
    expect(filePathFromQn("NoModuleSeparator")).toEqual([]);
    expect(filePathFromQn("some.dotted.name")).toEqual([]);
  });

  it("returns [] for only :: at position 0 (empty head)", () => {
    expect(filePathFromQn("::symbol")).toEqual([]);
  });
});
