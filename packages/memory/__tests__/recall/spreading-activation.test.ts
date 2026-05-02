/**
 * Unit tests for the spreading-activation module.
 *
 * Verifies properties derived from the contract in spreading-activation.ts:
 *   - Frontier monotonically expanding from seeds (BFS invariant)
 *   - Activation decays by distance
 *   - Ablation (disabled=true) returns only seed activations
 *   - mapEntityActivationToMemories uses max (not sum) aggregation
 *   - buildEntityGraph produces bidirectional edges
 *
 * source: Collins & Loftus (1975) "A spreading-activation theory of
 *         semantic processing." Psychological Review 82(6):407-428.
 *         cortex@bc0ae4f mcp_server/core/spreading_activation.py
 */

import { describe, expect, it } from "vitest";
import {
  buildEntityGraph,
  mapEntityActivationToMemories,
  resolveSeedEntities,
  spreadActivation,
} from "../../src/recall/spreading-activation.js";
import type { EntityGraph } from "../../src/recall/spreading-activation.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

/**
 * Simple chain graph: 1 → 2 → 3 → 4
 * Each edge has weight 1.0.
 */
function chainGraph(): EntityGraph {
  return new Map([
    [1, [[2, 1.0]]],
    [2, [[1, 1.0], [3, 1.0]]],
    [3, [[2, 1.0], [4, 1.0]]],
    [4, [[3, 1.0]]],
  ]);
}

/**
 * Hub-and-spoke: 0 connects to 1, 2, 3.
 */
function hubGraph(): EntityGraph {
  return new Map([
    [0, [[1, 1.0], [2, 1.0], [3, 1.0]]],
    [1, [[0, 1.0]]],
    [2, [[0, 1.0]]],
    [3, [[0, 1.0]]],
  ]);
}

// ── spreadActivation ───────────────────────────────────────────────────────

describe("spreadActivation — BFS contract", () => {
  it("returns empty map for seeds not in graph", () => {
    const graph = chainGraph();
    const result = spreadActivation(graph, [99], { threshold: 0.0 });
    expect(result.size).toBe(0);
  });

  it("seeds are initialized to initialActivation", () => {
    const graph = chainGraph();
    const result = spreadActivation(graph, [1], { maxDepth: 0 });
    // With maxDepth=0 and disabled=false, the loop runs 0 times; only seeds present.
    // Actually maxDepth=0 means the for loop runs 0 times — seed only.
    expect(result.has(1)).toBe(true);
    expect(result.get(1)).toBe(1.0);
  });

  it("activation decays with distance from seed", () => {
    const graph = chainGraph();
    const result = spreadActivation(graph, [1], {
      decay: 0.5,
      threshold: 0.01,
      maxDepth: 3,
    });
    const act1 = result.get(1) ?? 0;
    const act2 = result.get(2) ?? 0;
    const act3 = result.get(3) ?? 0;
    // Activation should decrease with distance
    expect(act1).toBeGreaterThan(act2);
    expect(act2).toBeGreaterThan(act3);
  });

  it("does not exceed maxNodes cap (invariant: size <= maxNodes)", () => {
    const graph = hubGraph();
    const result = spreadActivation(graph, [0], { maxNodes: 2, threshold: 0.0 });
    expect(result.size).toBeLessThanOrEqual(2);
  });

  it("disabled=true (ablation) returns only seed activations", () => {
    const graph = chainGraph();
    const result = spreadActivation(graph, [1], {
      disabled: true,
      threshold: 0.0,
      maxDepth: 5,
    });
    // Only the seed should be present
    expect(result.has(1)).toBe(true);
    // No propagation to neighbors
    expect(result.has(2)).toBe(false);
  });

  it("frontiers expand: depth-2 includes nodes not in depth-1 result", () => {
    const graph = chainGraph(); // 1 → 2 → 3 → 4
    const depth1 = spreadActivation(graph, [1], {
      maxDepth: 1,
      threshold: 0.01,
    });
    const depth2 = spreadActivation(graph, [1], {
      maxDepth: 2,
      threshold: 0.01,
    });
    // Depth-2 should cover at least as many nodes as depth-1
    expect(depth2.size).toBeGreaterThanOrEqual(depth1.size);
  });

  it("all activation values are non-negative", () => {
    const graph = hubGraph();
    const result = spreadActivation(graph, [0], { threshold: 0.0, maxDepth: 3 });
    for (const [, act] of result) {
      expect(act).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── mapEntityActivationToMemories ──────────────────────────────────────────

describe("mapEntityActivationToMemories", () => {
  it("returns empty for no entity-to-memory mappings", () => {
    const activations = new Map([[1, 0.8], [2, 0.5]]);
    const result = mapEntityActivationToMemories(activations, new Map());
    expect(result).toEqual([]);
  });

  it("uses max (not sum) aggregation", () => {
    // Memory 10 is mentioned by entity 1 (act 0.9) and entity 2 (act 0.3)
    const activations = new Map([[1, 0.9], [2, 0.3]]);
    const entityToMemory = new Map([[1, [10]], [2, [10]]]);
    const result = mapEntityActivationToMemories(activations, entityToMemory);
    expect(result).toHaveLength(1);
    expect(result[0]![1]).toBeCloseTo(0.9, 6); // max of 0.9 and 0.3
  });

  it("result is sorted descending by score", () => {
    const activations = new Map([[1, 0.5], [2, 0.9], [3, 0.1]]);
    const entityToMemory = new Map([
      [1, [10]],
      [2, [20]],
      [3, [30]],
    ]);
    const result = mapEntityActivationToMemories(activations, entityToMemory);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]![1]).toBeGreaterThanOrEqual(result[i]![1]);
    }
  });
});

// ── resolveSeedEntities ────────────────────────────────────────────────────

describe("resolveSeedEntities", () => {
  it("resolves case-insensitively", () => {
    const index = new Map([["hopfield", 1], ["pgvector", 2]]);
    const seeds = resolveSeedEntities(["Hopfield", "PGVECTOR"], index);
    expect(seeds).toContain(1);
    expect(seeds).toContain(2);
  });

  it("deduplicates: same entity appears only once", () => {
    const index = new Map([["hopfield", 1]]);
    const seeds = resolveSeedEntities(["hopfield", "Hopfield", "HOPFIELD"], index);
    expect(seeds).toHaveLength(1);
    expect(seeds).toEqual([1]);
  });

  it("ignores terms not in the index", () => {
    const index = new Map([["known", 5]]);
    const seeds = resolveSeedEntities(["unknown", "alsoUnknown"], index);
    expect(seeds).toEqual([]);
  });
});

// ── buildEntityGraph ───────────────────────────────────────────────────────

describe("buildEntityGraph", () => {
  it("produces bidirectional edges", () => {
    const entities = [
      { id: 1, name: "EntityA", heat: 1.0 },
      { id: 2, name: "EntityB", heat: 1.0 },
    ];
    const rels = [{ source_entity_id: 1, target_entity_id: 2, weight: 1.0 }];
    const { graph } = buildEntityGraph(entities, rels);
    // Edge 1→2
    expect(graph.get(1)?.some(([n]) => n === 2)).toBe(true);
    // Reverse edge 2→1
    expect(graph.get(2)?.some(([n]) => n === 1)).toBe(true);
  });

  it("excludes entities below minHeat", () => {
    const entities = [
      { id: 1, name: "Hot", heat: 1.0 },
      { id: 2, name: "Cold", heat: 0.0 },
    ];
    const rels = [{ source_entity_id: 1, target_entity_id: 2, weight: 1.0 }];
    const { graph } = buildEntityGraph(entities, rels, 0.5);
    // Entity 2 has heat 0.0 < 0.5 → excluded
    expect(graph.has(2)).toBe(false);
    // No edge from 1 to 2 since 2 is excluded
    expect(graph.get(1)?.some(([n]) => n === 2)).toBeFalsy();
  });

  it("builds nameIndex with lowercased names", () => {
    const entities = [{ id: 7, name: "Hopfield", heat: 1.0 }];
    const { nameIndex } = buildEntityGraph(entities, []);
    expect(nameIndex.get("hopfield")).toBe(7);
    expect(nameIndex.has("Hopfield")).toBe(false);
  });

  it("multiplies weight * confidence for edge weight", () => {
    const entities = [
      { id: 1, name: "A", heat: 1.0 },
      { id: 2, name: "B", heat: 1.0 },
    ];
    const rels = [{ source_entity_id: 1, target_entity_id: 2, weight: 0.5, confidence: 0.8 }];
    const { graph } = buildEntityGraph(entities, rels);
    const edge = graph.get(1)?.find(([n]) => n === 2);
    expect(edge?.[1]).toBeCloseTo(0.4, 6); // 0.5 * 0.8
  });
});
