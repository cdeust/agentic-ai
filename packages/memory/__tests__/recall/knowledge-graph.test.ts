/**
 * Unit tests for the knowledge-graph entity extraction module.
 *
 * Verifies properties derived from the contract in knowledge-graph.ts:
 *   - extractEntities output is deduplicated
 *   - Import entities are extracted with correct type
 *   - Function definitions are extracted with type "function"
 *   - CamelCase entities are extracted as "technology"
 *   - extractKeywords filters stopwords and short tokens
 *   - extractKeywords deduplicates
 *
 * source: cortex@bc0ae4f mcp_server/core/knowledge_graph.py
 *         cortex@bc0ae4f mcp_server/core/recall_pipeline.py:311-370
 */

import { describe, expect, it } from "vitest";
import {
  extractEntities,
  extractKeywords,
} from "../../src/recall/knowledge-graph.js";

// ── extractEntities ────────────────────────────────────────────────────────

describe("extractEntities", () => {
  it("returns empty for blank content", () => {
    expect(extractEntities("")).toEqual([]);
    expect(extractEntities("   ")).toEqual([]);
  });

  it("extracts function definitions", () => {
    const content = "def hopfield_retrieve(query, matrix, beta=8.0):\n    pass";
    const entities = extractEntities(content);
    const funcs = entities.filter((e) => e.type === "function");
    expect(funcs.some((e) => e.name === "hopfield_retrieve")).toBe(true);
  });

  it("extracts class definitions as technology", () => {
    const content = "class PatternMatrix:\n    pass";
    const entities = extractEntities(content);
    const techEntities = entities.filter((e) => e.type === "technology");
    expect(techEntities.some((e) => e.name === "PatternMatrix")).toBe(true);
  });

  it("extracts import dependencies", () => {
    const content = "from numpy import array, dot\nimport torch";
    const entities = extractEntities(content);
    const deps = entities.filter((e) => e.type === "dependency");
    expect(deps.some((e) => e.name === "numpy")).toBe(true);
    expect(deps.some((e) => e.name === "torch")).toBe(true);
  });

  it("extracts error entities from fix/resolve patterns", () => {
    const content = "We fixed the IndexError by adding bounds check.";
    const entities = extractEntities(content);
    const errors = entities.filter((e) => e.type === "error");
    expect(errors.some((e) => e.name.includes("IndexError"))).toBe(true);
  });

  it("extracts CamelCase technology entities", () => {
    const content = "We use HopfieldNetwork and TransformerEncoder for retrieval.";
    const entities = extractEntities(content);
    const tech = entities.filter((e) => e.type === "technology");
    const names = tech.map((e) => e.name);
    expect(names).toContain("HopfieldNetwork");
    expect(names).toContain("TransformerEncoder");
  });

  it("deduplicates entities (postcondition: no duplicate keys)", () => {
    // Repeat the same entity in the content
    const content = `
def compute(x):
    pass
def compute(x):
    pass
`;
    const entities = extractEntities(content);
    const funcEntities = entities.filter(
      (e) => e.type === "function" && e.name === "compute",
    );
    expect(funcEntities).toHaveLength(1);
  });

  it("extracts file path entities", () => {
    const content = "Error occurred in packages/memory/src/recall/hopfield.ts";
    const entities = extractEntities(content);
    const files = entities.filter((e) => e.type === "file");
    expect(files.length).toBeGreaterThan(0);
  });
});

// ── extractKeywords ────────────────────────────────────────────────────────

describe("extractKeywords", () => {
  it("returns empty for stopword-only text", () => {
    const keywords = extractKeywords("the a an is it in on at of to");
    expect(keywords).toEqual([]);
  });

  it("filters words shorter than 4 characters", () => {
    const keywords = extractKeywords("big cat fly hop");
    // "big" (3), "cat" (3), "fly" (3), "hop" (3) all < 4 chars → filtered
    expect(keywords).toEqual([]);
  });

  it("passes words of 4+ chars not in stoplist", () => {
    const keywords = extractKeywords("recall hopfield pgvector embeddings");
    expect(keywords).toContain("recall");
    expect(keywords).toContain("hopfield");
    expect(keywords).toContain("pgvector");
    expect(keywords).toContain("embeddings");
  });

  it("deduplicates tokens (postcondition: no duplicates)", () => {
    const keywords = extractKeywords("recall recall recall memory memory");
    const recallCount = keywords.filter((k) => k === "recall").length;
    const memoryCount = keywords.filter((k) => k === "memory").length;
    expect(recallCount).toBe(1);
    expect(memoryCount).toBe(1);
  });

  it("returns only lowercase tokens", () => {
    const keywords = extractKeywords("Hopfield PGVECTOR TransformerEncoder");
    for (const k of keywords) {
      expect(k).toBe(k.toLowerCase());
    }
  });

  it("filters non-alphabetic tokens", () => {
    const keywords = extractKeywords("recall1 hop_field test123 realword");
    // "recall1", "test123" contain digits → filtered by /^[a-z]+$/
    // "hop_field" contains underscore → split by \W+ gives "hop" and "field" (both < 4 except "field")
    expect(keywords).not.toContain("recall1");
    expect(keywords).not.toContain("test123");
  });

  it("splits on whitespace and punctuation", () => {
    const keywords = extractKeywords("recall, hopfield. pgvector! embeddings");
    expect(keywords).toContain("recall");
    expect(keywords).toContain("hopfield");
    expect(keywords).toContain("pgvector");
  });
});
