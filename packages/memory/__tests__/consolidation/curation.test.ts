/**
 * Unit tests for curation.ts
 * source: cortex@ed33435 mcp_server/core/curation.py
 */

import { describe, it, expect } from "vitest";
import {
  decideCurationAction,
  computeTextualOverlap,
  mergeContents,
  mergeTags,
  detectContradictions,
  identifyPrunable,
  identifyStrengheneable,
  computeRelationshipReweights,
  identifyDerivableFacts,
  MERGE_THRESHOLD,
  LINK_LOW,
} from "../../src/consolidation/curation.js";

// ── decideCurationAction ───────────────────────────────────────────────────

describe("decideCurationAction", () => {
  it("returns merge when similarity >= threshold AND textual overlap", () => {
    expect(decideCurationAction(MERGE_THRESHOLD, true)).toBe("merge");
  });

  it("returns link when similarity in [LINK_LOW, MERGE_THRESHOLD)", () => {
    expect(decideCurationAction(LINK_LOW, false)).toBe("link");
  });

  it("returns create when similarity < LINK_LOW", () => {
    expect(decideCurationAction(0.1, false)).toBe("create");
  });

  it("returns link (not merge) when high similarity but no textual overlap", () => {
    expect(decideCurationAction(0.9, false)).toBe("link");
  });
});

// ── computeTextualOverlap ──────────────────────────────────────────────────

describe("computeTextualOverlap", () => {
  it("returns 1.0 for identical strings", () => {
    expect(computeTextualOverlap("hello world", "hello world")).toBe(1.0);
  });

  it("returns 0.0 for completely different strings", () => {
    expect(computeTextualOverlap("cat dog", "fish bird")).toBe(0.0);
  });

  it("returns value between 0 and 1 for partial overlap", () => {
    const overlap = computeTextualOverlap("hello world", "hello earth");
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });

  it("returns 0 for empty strings", () => {
    expect(computeTextualOverlap("", "hello")).toBe(0);
  });
});

// ── mergeContents ──────────────────────────────────────────────────────────

describe("mergeContents", () => {
  it("returns existing when new is a substring", () => {
    expect(mergeContents("hello world", "hello")).toBe("hello world");
  });

  it("returns new when existing is a substring", () => {
    expect(mergeContents("hello", "hello world")).toBe("hello world");
  });

  it("concatenates when no overlap", () => {
    const result = mergeContents("first", "second");
    expect(result).toContain("first");
    expect(result).toContain("second");
  });
});

// ── mergeTags ──────────────────────────────────────────────────────────────

describe("mergeTags", () => {
  it("unions tag sets preserving order", () => {
    const result = mergeTags(["a", "b"], ["b", "c"]);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("handles empty arrays", () => {
    expect(mergeTags([], ["x"])).toEqual(["x"]);
    expect(mergeTags(["x"], [])).toEqual(["x"]);
  });
});

// ── detectContradictions ───────────────────────────────────────────────────

describe("detectContradictions", () => {
  it("detects negation mismatch", () => {
    const similar = [{ id: 1, content: "use postgres" }];
    const contradictions = detectContradictions("don't use postgres", similar);
    expect(contradictions.length).toBe(1);
    expect(contradictions[0].type).toBe("negation_mismatch");
  });

  it("returns empty when no contradiction", () => {
    const similar = [{ id: 1, content: "use postgres" }];
    const contradictions = detectContradictions("use postgres for storage", similar);
    expect(contradictions.length).toBe(0);
  });
});

// ── identifyPrunable ───────────────────────────────────────────────────────

describe("identifyPrunable", () => {
  it("identifies cold low-confidence unaccessed memories", () => {
    const memories = [
      { id: 1, heat: 0.005, confidence: 0.2, access_count: 0 },
      { id: 2, heat: 0.8, confidence: 0.9, access_count: 5 },
    ];
    const prunable = identifyPrunable(memories as Record<string, unknown>[]);
    expect(prunable).toContain(1);
    expect(prunable).not.toContain(2);
  });
});

// ── identifyStrengheneable ────────────────────────────────────────────────

describe("identifyStrengheneable", () => {
  it("boosts memories with high access count and confidence", () => {
    const memories = [
      { id: 10, access_count: 10, confidence: 0.9, importance: 0.5 },
      { id: 11, access_count: 1, confidence: 0.3, importance: 0.5 },
    ];
    const updates = identifyStrengheneable(memories as Record<string, unknown>[]);
    expect(updates.map(([id]) => id)).toContain(10);
    expect(updates.map(([id]) => id)).not.toContain(11);
    const [, newImp] = updates.find(([id]) => id === 10)!;
    expect(newImp).toBeGreaterThan(0.5);
  });
});

// ── computeRelationshipReweights ───────────────────────────────────────────

describe("computeRelationshipReweights", () => {
  it("boosts weight for hot-entity relationships", () => {
    const rels = [{ id: 1, source_entity_id: 1, target_entity_id: 2, weight: 1.0 }];
    const heats = new Map([[1, 0.9], [2, 0.8]]);
    const updates = computeRelationshipReweights(
      rels as Record<string, unknown>[],
      heats,
    );
    expect(updates.length).toBe(1);
    expect(updates[0][1]).toBeGreaterThan(1.0);
  });

  it("decays weight for cold-entity relationships", () => {
    const rels = [{ id: 2, source_entity_id: 3, target_entity_id: 4, weight: 2.0 }];
    const heats = new Map([[3, 0.05], [4, 0.05]]);
    const updates = computeRelationshipReweights(
      rels as Record<string, unknown>[],
      heats,
    );
    expect(updates[0][1]).toBeLessThan(2.0);
  });
});

// ── identifyDerivableFacts ────────────────────────────────────────────────

describe("identifyDerivableFacts", () => {
  it("generates facts for high-weight relationships", () => {
    const rels = [{ id: 1, source_entity_id: 10, target_entity_id: 11, weight: 15, relationship_type: "uses" }];
    const names = new Map([[10, "ModuleA"], [11, "ServiceB"]]);
    const facts = identifyDerivableFacts(rels as Record<string, unknown>[], names);
    expect(facts.length).toBe(1);
    expect(facts[0]).toContain("ModuleA");
    expect(facts[0]).toContain("ServiceB");
  });

  it("returns empty for low-weight relationships", () => {
    const rels = [{ id: 2, source_entity_id: 1, target_entity_id: 2, weight: 2, relationship_type: "mentions" }];
    const names = new Map([[1, "A"], [2, "B"]]);
    expect(identifyDerivableFacts(rels as Record<string, unknown>[], names)).toEqual([]);
  });
});
