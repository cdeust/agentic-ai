/**
 * Unit tests for wiki symbol extraction.
 */

import { describe, it, expect } from "vitest";
import { extractSymbolRefs, harvestPageSymbols } from "../../src/wiki/symbol-extract.js";

describe("extractSymbolRefs", () => {
  it("returns empty for empty input", () => {
    expect(extractSymbolRefs("")).toEqual([]);
  });

  it("extracts backtick function calls", () => {
    const text = "Use `wiki_store.read_page()` to read pages.";
    const refs = extractSymbolRefs(text);
    expect(refs).toContain("wiki_store.read_page");
  });

  it("extracts dotted qualified names", () => {
    const text = "The class mcp_server.core.wiki_classifier handles classification.";
    const refs = extractSymbolRefs(text);
    expect(refs.some((r) => r.includes("mcp_server"))).toBe(true);
  });

  it("filters out file extensions", () => {
    const text = "See wiki_classifier.py and wiki_store.ts for details.";
    const refs = extractSymbolRefs(text);
    // Should not include things ending in .py or .ts
    for (const r of refs) {
      const tail = r.split(".").pop()?.toLowerCase() ?? "";
      expect(["py", "ts", "md", "js"]).not.toContain(tail);
    }
  });

  it("deduplicates candidates", () => {
    const text = "`foo.bar()` and `foo.bar()` again.";
    const refs = extractSymbolRefs(text);
    expect(refs.filter((r) => r === "foo.bar")).toHaveLength(1);
  });

  it("preserves first-occurrence order", () => {
    const text = "`alpha.beta()` and `gamma.delta()`.";
    const refs = extractSymbolRefs(text);
    const alphaIdx = refs.indexOf("alpha.beta");
    const gammaIdx = refs.indexOf("gamma.delta");
    if (alphaIdx >= 0 && gammaIdx >= 0) {
      expect(alphaIdx).toBeLessThan(gammaIdx);
    }
  });
});

describe("harvestPageSymbols", () => {
  it("merges claim evidence with extracted symbols", () => {
    const page = {
      lead: "The `memory_store.recall()` function retrieves memories.",
      sections: [{ heading: "Details", body: "Uses `pgvector.search()` internally." }],
    };
    const claimSymbols = ["known.symbol"];
    const result = harvestPageSymbols(page, claimSymbols);
    expect(result).toContain("known.symbol");
    expect(result).toContain("memory_store.recall");
  });

  it("handles dict sections", () => {
    const page = {
      lead: "Overview",
      sections: { "Implementation": "`class_a.method_b()` is called here." },
    };
    const result = harvestPageSymbols(page);
    expect(result.some((r) => r.includes("class_a"))).toBe(true);
  });

  it("deduplicates across claim evidence and page text", () => {
    const page = { lead: "`foo.bar()` is mentioned." };
    const result = harvestPageSymbols(page, ["foo.bar"]);
    expect(result.filter((r) => r === "foo.bar")).toHaveLength(1);
  });
});
