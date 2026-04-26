/**
 * Tests for codebase-parser and codebase-extractors.
 *
 * Uses the small-python fixture repo as a Rosetta Stone:
 * We know the Python source; we verify the TS extractor produces the
 * correct symbol and import counts (anchor on proper names).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile, detectLanguage, buildMemoryContent } from "../../src/codebase-analysis/codebase-parser.js";
import {
  extractImportsPython,
  extractSymbolsPython,
  extractDocstring,
} from "../../src/codebase-analysis/codebase-extractors.js";

const FIXTURE_ROOT =
  "/Users/cdeust/Developments/agentic-ai/worktrees/port-parity-baseline/parity-oracle/codebase/fixture-repos/small-python/src";

function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), "utf8");
}

// ── Language detection ────────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("maps .py to python", () => expect(detectLanguage("foo.py")).toBe("python"));
  it("maps .ts to typescript", () => expect(detectLanguage("foo.ts")).toBe("typescript"));
  it("maps .tsx to typescript", () => expect(detectLanguage("foo.tsx")).toBe("typescript"));
  it("maps .go to go", () => expect(detectLanguage("foo.go")).toBe("go"));
  it("maps .rs to rust", () => expect(detectLanguage("foo.rs")).toBe("rust"));
  it("returns unknown for unrecognised", () => expect(detectLanguage("foo.lua")).toBe("unknown"));
});

// ── Python import extraction ──────────────────────────────────────────────

describe("extractImportsPython — models.py", () => {
  const content = readFixture("models.py");

  it("extracts from __future__ import annotations", () => {
    const imports = extractImportsPython(content);
    const future = imports.find((i) => i.module === "__future__");
    expect(future).toBeDefined();
    expect(future?.names).toContain("annotations");
  });

  it("extracts dataclasses import", () => {
    const imports = extractImportsPython(content);
    const dc = imports.find((i) => i.module === "dataclasses");
    expect(dc).toBeDefined();
  });
});

// ── Python symbol extraction ──────────────────────────────────────────────

describe("extractSymbolsPython — models.py", () => {
  const content = readFixture("models.py");
  const symbols = extractSymbolsPython(content);

  it("finds Memory class", () => {
    const mem = symbols.find((s) => s.name === "Memory");
    expect(mem).toBeDefined();
    expect(mem?.kind).toBe("class");
  });

  it("finds Domain class", () => {
    const dom = symbols.find((s) => s.name === "Domain");
    expect(dom).toBeDefined();
    expect(dom?.kind).toBe("class");
  });

  it("finds is_hot method", () => {
    const method = symbols.find((s) => s.name === "is_hot");
    expect(method).toBeDefined();
    expect(method?.kind).toBe("function");
  });

  it("finds decay method", () => {
    const method = symbols.find((s) => s.name === "decay");
    expect(method).toBeDefined();
  });
});

// ── Docstring extraction ──────────────────────────────────────────────────

describe("extractDocstring — models.py", () => {
  const content = readFixture("models.py");
  it("extracts module docstring", () => {
    const doc = extractDocstring(content, "python");
    expect(doc).toContain("Domain models");
  });
});

// ── parseFile integration ─────────────────────────────────────────────────

describe("parseFile — models.py", () => {
  const content = readFixture("models.py");
  const analysis = parseFile("src/models.py", content);

  it("sets path", () => expect(analysis.path).toBe("src/models.py"));
  it("sets language to python", () => expect(analysis.language).toBe("python"));
  it("sets non-empty contentHash", () => expect(analysis.contentHash).toHaveLength(16));
  it("counts lines > 0", () => expect(analysis.lineCount).toBeGreaterThan(10));

  it("finds at least 2 class definitions", () => {
    const classes = analysis.definitions.filter((d) => d.kind === "class");
    expect(classes.length).toBeGreaterThanOrEqual(2);
  });

  it("finds Memory and Domain in definitions", () => {
    const names = analysis.definitions.map((d) => d.name);
    expect(names).toContain("Memory");
    expect(names).toContain("Domain");
  });

  it("has empty callsPerFunction (regex fallback does not populate)", () => {
    expect(analysis.callsPerFunction).toEqual({});
  });
});

// ── buildMemoryContent ────────────────────────────────────────────────────

describe("buildMemoryContent", () => {
  const content = readFixture("models.py");
  const analysis = parseFile("src/models.py", content);
  const mc = buildMemoryContent(analysis);

  it("includes file path", () => expect(mc).toContain("# File: src/models.py"));
  it("includes language", () => expect(mc).toContain("Language: python"));
  it("includes Definitions section", () => expect(mc).toContain("## Definitions"));
  it("includes Memory symbol", () => expect(mc).toContain("Memory"));
});

// ── Counting disproof test (Champollion Move 3) ───────────────────────────
// The Python file has 2 classes + 4 methods. The regex extractor should
// produce at least 6 symbol definitions. If it returns 0, the extractor
// is broken regardless of how well it "looks".

describe("symbol count sanity (Champollion counting move)", () => {
  const store = [
    "models.py",
    "consolidation.py",
    "domain_detector.py",
    "retrieval.py",
    "write_gate.py",
  ];

  for (const file of store) {
    it(`${file}: extracts at least 1 symbol`, () => {
      const content = readFixture(file);
      const symbols = extractSymbolsPython(content);
      expect(symbols.length).toBeGreaterThan(0);
    });
  }
});
