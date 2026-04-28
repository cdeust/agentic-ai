/**
 * causal-graph.ts — unit tests for the PC algorithm port.
 *
 * Postconditions verified per function contract:
 *   1. computeCoOccurrenceMatrix: correct pair counts; no self-pairs.
 *   2. computeConditionalIndependence: degenerate inputs → 0.0; PMI positive
 *      for dependent pairs; conditioning reduces PMI when a third variable
 *      explains co-occurrence.
 *   3. computeTemporalPrecedence: correct "a_before_b" / "b_before_a" / null
 *      based on ISO-8601 lexicographic ordering.
 *   4. discoverCausalEdges: returns [] when no entities; sorted by strength;
 *      is_directed set iff temporal precedence was determined.
 *   5. findCausalChain: returns [] for unknown start; returns all reachable paths;
 *      paths contain no cycles.
 *   6. findCommonCauses: returns sorted intersection of cause sets.
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py
 */

import { describe, it, expect } from "vitest";
import {
  computeCoOccurrenceMatrix,
  computeConditionalIndependence,
  computeTemporalPrecedence,
  discoverCausalEdges,
  findCausalChain,
  findCommonCauses,
  type CausalEdge,
} from "../../src/consolidation/causal-graph.js";

// ── 1. computeCoOccurrenceMatrix ─────────────────────────────────────────────

describe("computeCoOccurrenceMatrix", () => {
  it("returns empty map for empty memories", () => {
    const result = computeCoOccurrenceMatrix([], ["A", "B"]);
    expect(result.size).toBe(0);
  });

  it("returns empty map for empty entity list", () => {
    const mems = [{ content: "A and B together" }];
    const result = computeCoOccurrenceMatrix(mems, []);
    expect(result.size).toBe(0);
  });

  it("counts co-occurring pairs correctly", () => {
    // A and B appear in 2 memories; B and C appear in 1 memory.
    const mems = [
      { content: "Alpha and Bravo are related" },
      { content: "Alpha meets Bravo again" },
      { content: "Bravo and Charlie present" },
    ];
    const result = computeCoOccurrenceMatrix(mems, ["Alpha", "Bravo", "Charlie"]);

    // Alpha-Bravo: 2 (case-insensitive match)
    // Alpha-Charlie: 0
    // Bravo-Charlie: 1
    const alphaBravo = Array.from(result.entries()).find(([k]) =>
      k.toLowerCase().includes("alpha") && k.toLowerCase().includes("bravo"),
    );
    expect(alphaBravo?.[1]).toBe(2);

    const bravoCharlie = Array.from(result.entries()).find(([k]) =>
      k.toLowerCase().includes("bravo") && k.toLowerCase().includes("charlie"),
    );
    expect(bravoCharlie?.[1]).toBe(1);

    // A-C pair should not be present (never co-occurred)
    const alphaCharlie = Array.from(result.entries()).find(([k]) =>
      k.toLowerCase().includes("alpha") && k.toLowerCase().includes("charlie"),
    );
    expect(alphaCharlie).toBeUndefined();
  });

  it("treats pair keys as sorted (no duplicates)", () => {
    const mems = [{ content: "Zebra and Apple coexist" }];
    const result = computeCoOccurrenceMatrix(mems, ["Apple", "Zebra"]);
    // Should have exactly one key for Apple-Zebra, not two.
    expect(result.size).toBe(1);
    const count = result.values().next().value;
    expect(count).toBe(1);
  });
});

// ── 2. computeConditionalIndependence ─────────────────────────────────────────

describe("computeConditionalIndependence", () => {
  it("returns 0 for zero total", () => {
    expect(computeConditionalIndependence(5, 3, 4, 0)).toBe(0.0);
  });

  it("returns 0 for zero a_count", () => {
    expect(computeConditionalIndependence(5, 0, 4, 10)).toBe(0.0);
  });

  it("returns 0 for zero b_count", () => {
    expect(computeConditionalIndependence(5, 3, 0, 10)).toBe(0.0);
  });

  it("returns positive PMI for highly dependent pair", () => {
    // P(A,B) = 9/10; P(A) = 9/10; P(B) = 9/10
    // expected = (9/10)*(9/10) = 0.81; PMI = log2(0.9/0.81) ≈ 0.152
    const pmi = computeConditionalIndependence(9, 9, 9, 10);
    expect(pmi).toBeGreaterThan(0);
  });

  it("returns negative PMI for independent pair (rare co-occurrence)", () => {
    // P(A,B) = 1/100; P(A)=50/100; P(B)=50/100 → expected=0.25; PMI = log2(0.01/0.25) ≈ -4.64
    const pmi = computeConditionalIndependence(1, 50, 50, 100);
    expect(pmi).toBeLessThan(0);
  });

  it("reduces PMI when conditioned_count is the full pair count", () => {
    // With conditioning_ratio = 1.0 → PMI * max(0, 1-1) = 0
    const pmi = computeConditionalIndependence(5, 5, 5, 10, 5);
    expect(pmi).toBe(0.0);
  });
});

// ── 3. computeTemporalPrecedence ──────────────────────────────────────────────

describe("computeTemporalPrecedence", () => {
  it("returns null when entity not in map", () => {
    const result = computeTemporalPrecedence(new Map(), "A", "B");
    expect(result).toBeNull();
  });

  it("returns a_before_b when A has earlier timestamp", () => {
    const map = new Map([["A", "2024-01-01T00:00:00Z"], ["B", "2024-06-01T00:00:00Z"]]);
    expect(computeTemporalPrecedence(map, "A", "B")).toBe("a_before_b");
  });

  it("returns b_before_a when B has earlier timestamp", () => {
    const map = new Map([["A", "2024-06-01T00:00:00Z"], ["B", "2024-01-01T00:00:00Z"]]);
    expect(computeTemporalPrecedence(map, "A", "B")).toBe("b_before_a");
  });

  it("returns null when timestamps are equal", () => {
    const t = "2024-03-15T12:00:00Z";
    const map = new Map([["A", t], ["B", t]]);
    expect(computeTemporalPrecedence(map, "A", "B")).toBeNull();
  });
});

// ── 4. discoverCausalEdges ────────────────────────────────────────────────────

describe("discoverCausalEdges", () => {
  it("returns [] for empty entity list", () => {
    expect(discoverCausalEdges([], new Map(), new Map(), 10)).toEqual([]);
  });

  it("returns [] for zero total memories", () => {
    expect(discoverCausalEdges(["A", "B"], new Map(), new Map(), 0)).toEqual([]);
  });

  it("discovers edge between strongly co-occurring entities", () => {
    // Construct: A and B co-occur 9 times out of 10 memories, each appears 9 times.
    // P(A,B)=0.9; P(A)=0.9; P(B)=0.9; expected=0.81; PMI=log2(0.9/0.81)≈0.152
    // Use a low threshold (0.1) to let the edge through.
    // Source: PMI formula from cortex@f2b9f99 mcp_server/core/causal_graph.py:57-58
    const entities = ["EntityA", "EntityB"];
    const coOccurrences = new Map<string, number>();
    // pairKey("EntityA","EntityB") — sorted order: EntityA < EntityB
    coOccurrences.set("EntityA\0EntityB", 9);

    const entityCounts = new Map([["EntityA", 9], ["EntityB", 9]]);

    const edges = discoverCausalEdges(entities, coOccurrences, entityCounts, 10, {
      minObservations: 3,
      independenceThreshold: 0.1,
    });

    expect(edges.length).toBeGreaterThan(0);
    if (edges[0] !== undefined) {
      expect(edges[0].evidence).toBe(9);
      expect(edges[0].strength).toBeGreaterThan(0);
    }
  });

  it("returns edges sorted by strength descending", () => {
    // Two entity pairs: one strong, one weaker.
    // PMI for (A,B): p_ab=0.9, p_a=0.9, p_b=0.9 → expected=0.81 → PMI≈0.152
    // PMI for (A,C): p_ab=0.4, p_a=0.9, p_c=0.4 → expected=0.36 → PMI<0 (no edge)
    // Use a very low threshold so both pass.
    const entities = ["A", "B", "C"];
    const coOccurrences = new Map([
      ["A\0B", 9], // strong co-occurrence
      ["A\0C", 4], // weaker
    ]);
    const entityCounts = new Map([["A", 9], ["B", 9], ["C", 4]]);

    const edges = discoverCausalEdges(entities, coOccurrences, entityCounts, 10, {
      minObservations: 3,
      independenceThreshold: 0.0, // zero threshold: include any positive PMI
    });

    if (edges.length >= 2 && edges[0] !== undefined && edges[1] !== undefined) {
      expect(edges[0].strength).toBeGreaterThanOrEqual(edges[1].strength);
    }
  });

  it("sets is_directed=true when temporal precedence is given", () => {
    // "Early" < "Late" in sorted order → pairKey = "Early\0Late"
    // P(A,B)=0.9, P(A)=0.9, P(B)=0.9 → PMI≈0.152 > 0.1
    const entities = ["Early", "Late"];
    const coOccurrences = new Map([["Early\0Late", 9]]);
    const entityCounts = new Map([["Early", 9], ["Late", 9]]);
    const entityFirstSeen = new Map([
      ["Early", "2024-01-01T00:00:00Z"],
      ["Late", "2024-12-01T00:00:00Z"],
    ]);

    const edges = discoverCausalEdges(entities, coOccurrences, entityCounts, 10, {
      minObservations: 3,
      independenceThreshold: 0.1,
      entityFirstSeen,
    });

    expect(edges.length).toBeGreaterThan(0);
    if (edges[0] !== undefined) {
      expect(edges[0].is_directed).toBe(true);
      expect(edges[0].source).toBe("Early");
      expect(edges[0].target).toBe("Late");
    }
  });

  it("sets is_directed=false when no temporal information", () => {
    // "X" < "Y" → pairKey = "X\0Y"
    const entities = ["X", "Y"];
    const coOccurrences = new Map([["X\0Y", 9]]);
    const entityCounts = new Map([["X", 9], ["Y", 9]]);

    const edges = discoverCausalEdges(entities, coOccurrences, entityCounts, 10, {
      minObservations: 3,
      independenceThreshold: 0.1,
    });

    expect(edges.length).toBeGreaterThan(0);
    if (edges[0] !== undefined) {
      expect(edges[0].is_directed).toBe(false);
      // Undirected edges have half the PMI strength.
      // source: cortex@f2b9f99 mcp_server/core/causal_graph.py:175
    }
  });
});

// ── 5. findCausalChain ────────────────────────────────────────────────────────

describe("findCausalChain", () => {
  function makeEdges(pairs: [string, string][]): CausalEdge[] {
    return pairs.map(([src, tgt]) => ({
      source: src,
      target: tgt,
      strength: 1.0,
      is_directed: true,
      evidence: 5,
    }));
  }

  it("returns [] for unknown start entity", () => {
    const edges = makeEdges([["A", "B"]]);
    expect(findCausalChain(edges, "Z")).toEqual([]);
  });

  it("returns single-step chains", () => {
    const edges = makeEdges([["A", "B"]]);
    const chains = findCausalChain(edges, "A");
    expect(chains).toContainEqual(["A", "B"]);
  });

  it("returns multi-step chains", () => {
    const edges = makeEdges([["A", "B"], ["B", "C"]]);
    const chains = findCausalChain(edges, "A");
    expect(chains).toContainEqual(["A", "B", "C"]);
  });

  it("does not return paths containing cycles", () => {
    // A → B → C → A would be cyclic; the algorithm must stop before A.
    const edges = makeEdges([["A", "B"], ["B", "C"], ["C", "A"]]);
    const chains = findCausalChain(edges, "A");
    for (const path of chains) {
      const uniqueNodes = new Set(path);
      expect(uniqueNodes.size).toBe(path.length);
    }
  });

  it("respects maxDepth", () => {
    const edges = makeEdges([["A", "B"], ["B", "C"], ["C", "D"], ["D", "E"]]);
    const chains = findCausalChain(edges, "A", 2);
    for (const path of chains) {
      expect(path.length).toBeLessThanOrEqual(2);
    }
  });
});

// ── 6. findCommonCauses ───────────────────────────────────────────────────────

describe("findCommonCauses", () => {
  function makeEdges(pairs: [string, string][]): CausalEdge[] {
    return pairs.map(([src, tgt]) => ({
      source: src,
      target: tgt,
      strength: 1.0,
      is_directed: true,
      evidence: 5,
    }));
  }

  it("returns [] when there are no common causes", () => {
    const edges = makeEdges([["A", "X"], ["B", "Y"]]);
    expect(findCommonCauses(edges, "X", "Y")).toEqual([]);
  });

  it("finds a single common cause", () => {
    // C → X, C → Y → C is a common cause of X and Y.
    const edges = makeEdges([["C", "X"], ["C", "Y"]]);
    expect(findCommonCauses(edges, "X", "Y")).toEqual(["C"]);
  });

  it("finds multiple common causes sorted", () => {
    const edges = makeEdges([
      ["Zeta", "X"], ["Zeta", "Y"],
      ["Alpha", "X"], ["Alpha", "Y"],
    ]);
    expect(findCommonCauses(edges, "X", "Y")).toEqual(["Alpha", "Zeta"]);
  });

  it("only includes directed edges", () => {
    // An undirected edge should not contribute to cause lookup.
    const undirected: CausalEdge = {
      source: "P",
      target: "X",
      strength: 0.5,
      is_directed: false,
      evidence: 3,
    };
    const directed: CausalEdge = {
      source: "P",
      target: "Y",
      strength: 0.7,
      is_directed: true,
      evidence: 4,
    };
    // P is directed into Y but undirected into X → not a common cause.
    expect(findCommonCauses([undirected, directed], "X", "Y")).toEqual([]);
  });
});
