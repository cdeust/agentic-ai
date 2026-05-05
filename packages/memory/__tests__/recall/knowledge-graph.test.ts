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

// ── P2a additions (D-06/D-07/D-08) ────────────────────────────────────────
// These tests would have caught the missing detectCoOccurrences, inferRelationships,
// VALID_REL_TYPES and ENTITY_TYPES from cortex@ed33435 knowledge_graph.py.
// source: cortex@ed33435 mcp_server/core/knowledge_graph.py:18-56, 198-281

import {
  VALID_REL_TYPES,
  ENTITY_TYPES,
  detectCoOccurrences,
  inferRelationships,
} from "../../src/recall/knowledge-graph.js";

describe("VALID_REL_TYPES and ENTITY_TYPES (D-08)", () => {
  it("VALID_REL_TYPES contains all 13 expected types", () => {
    // source: cortex@ed33435 knowledge_graph.py:18-34
    const expected = [
      "co_occurrence", "imports", "calls", "debugged_with", "decided_to_use",
      "caused_by", "resolved_by", "preceded_by", "derived_from", "defines",
      "extends", "implements", "contains",
    ];
    expect(VALID_REL_TYPES.size).toBe(13);
    for (const t of expected) {
      expect(VALID_REL_TYPES.has(t)).toBe(true);
    }
  });

  it("ENTITY_TYPES contains all 16 expected types", () => {
    // source: cortex@ed33435 knowledge_graph.py:37-56
    const expected = [
      "function", "dependency", "error", "decision", "technology", "file",
      "variable", "class", "interface", "type", "enum", "trait", "protocol",
      "constant", "module", "struct",
    ];
    expect(ENTITY_TYPES.size).toBe(16);
    for (const t of expected) {
      expect(ENTITY_TYPES.has(t)).toBe(true);
    }
  });
});

describe("detectCoOccurrences (D-06)", () => {
  it("returns empty for no entity names", () => {
    expect(detectCoOccurrences([], "some content")).toEqual([]);
  });

  it("returns empty when no entities appear in content", () => {
    const result = detectCoOccurrences(["EntityA", "EntityB"], "unrelated text here");
    expect(result).toEqual([]);
  });

  it("detects co-occurrence of two entities within default window", () => {
    // Both names appear close together in the content (< 500 chars)
    const content = "The RecallPipeline uses HopfieldNet for associative retrieval.";
    const result = detectCoOccurrences(["RecallPipeline", "HopfieldNet"], content);
    expect(result).toHaveLength(1);
    const [nameA, nameB, proximity] = result[0]!;
    const names = [nameA, nameB];
    expect(names).toContain("RecallPipeline");
    expect(names).toContain("HopfieldNet");
    expect(proximity).toBeGreaterThan(0);
    expect(proximity).toBeLessThanOrEqual(1);
  });

  it("proximity score is rounded to 4 decimal places", () => {
    const content = "Alpha Beta"; // short distance
    const result = detectCoOccurrences(["Alpha", "Beta"], content);
    if (result.length > 0) {
      const [, , prox] = result[0]!;
      const str = prox.toString();
      const decimals = str.includes(".") ? str.split(".")[1]!.length : 0;
      expect(decimals).toBeLessThanOrEqual(4);
    }
  });

  it("entities farther apart than window are not returned", () => {
    // Place two entities > 500 chars apart
    const padding = "x".repeat(600);
    const content = `EntityA ${padding} EntityB`;
    const result = detectCoOccurrences(["EntityA", "EntityB"], content, 500);
    expect(result).toHaveLength(0);
  });
});

describe("inferRelationships (D-07)", () => {
  it("returns empty for empty entity list", () => {
    expect(inferRelationships([])).toEqual([]);
  });

  it("infers imports edges from importer/dependency entities", () => {
    const entities = [
      { name: "numpy", type: "dependency", relationship_context: "" },
      { name: "array_func", type: "function", relationship_context: "imports" },
    ];
    const relationships = inferRelationships(entities);
    const importEdge = relationships.find((r) => r.type === "imports");
    expect(importEdge).toBeDefined();
    expect(importEdge!.source).toBe("numpy");
    expect(importEdge!.target).toBe("array_func");
  });

  it("infers resolved_by edges from error entities", () => {
    const entities = [
      { name: "TypeError", type: "error", relationship_context: "resolved_by" },
    ];
    const relationships = inferRelationships(entities);
    const resolvedEdge = relationships.find((r) => r.type === "resolved_by");
    expect(resolvedEdge).toBeDefined();
    expect(resolvedEdge!.source).toBe("TypeError");
  });

  it("infers decided_to_use edge when >= 2 decision entities exist", () => {
    const entities = [
      { name: "vitest", type: "decision", relationship_context: "decided_to_use" },
      { name: "jest", type: "decision", relationship_context: "decided_to_use" },
    ];
    const relationships = inferRelationships(entities);
    const decidedEdge = relationships.find((r) => r.type === "decided_to_use");
    expect(decidedEdge).toBeDefined();
    expect(decidedEdge!.source).toBe("vitest");
    expect(decidedEdge!.target).toBe("jest");
  });

  it("no decided_to_use edge when < 2 decisions", () => {
    const entities = [
      { name: "vitest", type: "decision", relationship_context: "decided_to_use" },
    ];
    const relationships = inferRelationships(entities);
    const decidedEdge = relationships.find((r) => r.type === "decided_to_use");
    expect(decidedEdge).toBeUndefined();
  });
});
