/**
 * Unit tests for heat-propagation.ts — spreading activation.
 *
 * Coverage:
 *   - spreadActivation: empty seeds, single seed, convergent summation,
 *     maxNodes cap, decay correctness, threshold pruning.
 *   - Convergence test: propagate N steps from a single hot node, verify
 *     decay matches Python output to ~1e-6 tolerance.
 *   - mapEntityActivationToMemories: max-of-entity semantics.
 *   - resolveSeedEntities: case-insensitive matching.
 *   - buildEntityGraph: bidirectional adjacency, minHeat filter.
 *
 * source: spreading_activation.py defaults:
 *   decay=0.65, threshold=0.1, maxDepth=3, maxNodes=50
 * source: Collins & Loftus (1975) — activation decay per hop.
 */

import { describe, it, expect } from "vitest";
import {
  buildEntityGraph,
  mapEntityActivationToMemories,
  resolveSeedEntities,
  spreadActivation,
} from "../../src/graph/heat-propagation.js";
import type { EntityGraph } from "../../src/graph/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntityGraph(
  adj: Record<number, Array<[number, number]>>,
): EntityGraph {
  const g: EntityGraph = new Map();
  for (const [src, neighbors] of Object.entries(adj)) {
    g.set(Number(src), neighbors.map(([t, w]) => [t, w] as [number, number]));
  }
  return g;
}

// ── spreadActivation ─────────────────────────────────────────────────────

describe("spreadActivation", () => {
  it("returns empty map when no seeds match the graph", () => {
    const g = makeEntityGraph({ 1: [[2, 1.0]] });
    const result = spreadActivation(g, [99]);
    expect(result.size).toBe(0);
  });

  it("returns only seeds when graph has no edges from seed", () => {
    const g = makeEntityGraph({ 1: [] });
    const result = spreadActivation(g, [1], { initialActivation: 1.0 });
    expect(result.get(1)).toBe(1.0);
  });

  it("single hop: neighbor activation = initial * edgeWeight * decay", () => {
    // 1 → 2 with edge weight 1.0, decay=0.65
    const g = makeEntityGraph({ 1: [[2, 1.0]], 2: [] });
    const result = spreadActivation(g, [1], { decay: 0.65, initialActivation: 1.0, threshold: 0.01, maxDepth: 1 });
    const act2 = result.get(2) ?? 0;
    // spread = 1.0 * 1.0 * 0.65 = 0.65
    expect(act2).toBeCloseTo(0.65, 6);
  });

  it("two hops: activation decays by decay^2 at depth 2", () => {
    // 1 → 2 → 3, all edge weights 1.0, decay=0.65
    const g = makeEntityGraph({ 1: [[2, 1.0]], 2: [[3, 1.0]], 3: [] });
    const result = spreadActivation(g, [1], {
      decay: 0.65,
      initialActivation: 1.0,
      threshold: 0.01,
      maxDepth: 2,
    });
    const act3 = result.get(3) ?? 0;
    // hop1: act2 = 1.0 * 1.0 * 0.65 = 0.65
    // hop2: act3 = 0.65 * 1.0 * 0.65 = 0.4225
    expect(act3).toBeCloseTo(0.4225, 6);
  });

  it("convergent activation: two paths to same node sum their contributions", () => {
    // 1 → 3 and 2 → 3, both with weight 1.0
    const g = makeEntityGraph({
      1: [[3, 1.0]],
      2: [[3, 1.0]],
      3: [],
    });
    const result = spreadActivation(g, [1, 2], {
      decay: 0.65,
      initialActivation: 1.0,
      threshold: 0.01,
      maxDepth: 1,
    });
    const act3 = result.get(3) ?? 0;
    // Both seeds contribute 0.65; convergent sum = 1.30
    expect(act3).toBeCloseTo(1.3, 6);
  });

  it("threshold prunes low-activation nodes", () => {
    // Edge weight 0.1 × decay 0.65 = 0.065 < threshold 0.1
    const g = makeEntityGraph({ 1: [[2, 0.1]], 2: [[3, 1.0]], 3: [] });
    const result = spreadActivation(g, [1], {
      decay: 0.65,
      initialActivation: 1.0,
      threshold: 0.1,
      maxDepth: 3,
    });
    // act2 = 0.065 < threshold → node 3 should not be reached
    expect(result.has(3)).toBe(false);
  });

  it("respects maxNodes cap: returns at most maxNodes entries", () => {
    // Create 20 neighbors from seed 1
    const neighbors: Array<[number, number]> = Array.from(
      { length: 20 },
      (_, i) => [i + 2, 1.0] as [number, number],
    );
    const g = makeEntityGraph({ 1: neighbors });
    const result = spreadActivation(g, [1], {
      decay: 0.65,
      initialActivation: 1.0,
      threshold: 0.01,
      maxDepth: 1,
      maxNodes: 5,
    });
    expect(result.size).toBeLessThanOrEqual(5);
  });

  it("stops early when frontier is empty before maxDepth", () => {
    // Chain stops at depth 1 — no further edges
    const g = makeEntityGraph({ 1: [[2, 1.0]], 2: [] });
    // Should not throw; returns result after depth 1
    const result = spreadActivation(g, [1], {
      maxDepth: 5,
      threshold: 0.01,
      decay: 0.65,
      initialActivation: 1.0,
    });
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(false); // node 3 does not exist
  });
});

// ── Convergence / parity test ─────────────────────────────────────────────

describe("spreadActivation convergence parity", () => {
  /**
   * Parity test: reproduce the Python reference output for a simple
   * linear graph with default parameters.
   *
   * Python equivalent (spreading_activation.py):
   *   graph = {1: [(2, 1.0)], 2: [(3, 1.0)], 3: [(4, 1.0)], 4: []}
   *   spread_activation(graph, [1], initial_activation=1.0, decay=0.65,
   *                     threshold=0.1, max_depth=3, max_nodes=50)
   *
   * Expected (computed from Python source equations):
   *   act1 = 1.0  (seed)
   *   act2 = 1.0 * 1.0 * 0.65 = 0.65
   *   act3 = 0.65 * 1.0 * 0.65 = 0.4225  (≥ threshold 0.1 → propagates)
   *   act4 = 0.4225 * 1.0 * 0.65 = 0.274625 (≥ threshold 0.1 → propagates)
   *
   * source: _propagate_one_hop in spreading_activation.py.
   * source: Collins & Loftus (1975) — exponential decay by distance.
   */
  it("3-hop linear chain matches Python reference output to 1e-6", () => {
    const g = makeEntityGraph({
      1: [[2, 1.0]],
      2: [[3, 1.0]],
      3: [[4, 1.0]],
      4: [],
    });
    const result = spreadActivation(g, [1], {
      initialActivation: 1.0,
      decay: 0.65,
      threshold: 0.1,
      maxDepth: 3,
      maxNodes: 50,
    });

    expect(result.get(1)).toBeCloseTo(1.0, 6);
    expect(result.get(2)).toBeCloseTo(0.65, 6);
    expect(result.get(3)).toBeCloseTo(0.4225, 6);
    expect(result.get(4)).toBeCloseTo(0.274625, 6);
  });

  /**
   * Parity: node 5 would be activation 0.274625 * 0.65 = 0.17850625 but
   * max_depth=3 means the loop runs for depths 0,1,2 (3 iterations).
   * After depth 0 (seed frontier): act2 settled.
   * After depth 1: act3 settled.
   * After depth 2: act4 settled.
   * Node 5 is never reached.
   */
  it("maxDepth=3 does not reach depth-4 node", () => {
    const g = makeEntityGraph({
      1: [[2, 1.0]],
      2: [[3, 1.0]],
      3: [[4, 1.0]],
      4: [[5, 1.0]],
      5: [],
    });
    const result = spreadActivation(g, [1], {
      initialActivation: 1.0,
      decay: 0.65,
      threshold: 0.01,
      maxDepth: 3,
      maxNodes: 50,
    });
    expect(result.has(5)).toBe(false);
  });
});

// ── mapEntityActivationToMemories ─────────────────────────────────────────

describe("mapEntityActivationToMemories", () => {
  it("maps entity activation to memory via max semantics", () => {
    const activations = new Map([[1, 0.9], [2, 0.5]]);
    // Memory 10 mentions entities 1 and 2; max(0.9, 0.5) = 0.9
    const entityToMem = new Map([[1, [10]], [2, [10]]]);
    const scores = mapEntityActivationToMemories(activations, entityToMem);
    expect(scores).toHaveLength(1);
    expect(scores[0]![0]).toBe(10);
    expect(scores[0]![1]).toBeCloseTo(0.9, 6);
  });

  it("sorts descending by score", () => {
    const activations = new Map([[1, 0.3], [2, 0.9]]);
    const entityToMem = new Map([[1, [10]], [2, [20]]]);
    const scores = mapEntityActivationToMemories(activations, entityToMem);
    expect(scores[0]![0]).toBe(20); // higher score first
    expect(scores[1]![0]).toBe(10);
  });

  it("returns empty array when no overlap", () => {
    const activations = new Map([[99, 1.0]]);
    const entityToMem = new Map([[1, [10]]]);
    const scores = mapEntityActivationToMemories(activations, entityToMem);
    expect(scores).toHaveLength(0);
  });
});

// ── resolveSeedEntities ───────────────────────────────────────────────────

describe("resolveSeedEntities", () => {
  it("matches case-insensitively", () => {
    const idx = new Map([["typescript", 1]]);
    expect(resolveSeedEntities(["TypeScript"], idx)).toEqual([1]);
  });

  it("deduplicates matched entity ids", () => {
    const idx = new Map([["typescript", 1]]);
    const result = resolveSeedEntities(["typescript", "TypeScript"], idx);
    expect(result).toEqual([1]);
  });

  it("ignores unmatched terms", () => {
    const idx = new Map([["typescript", 1]]);
    expect(resolveSeedEntities(["rust"], idx)).toEqual([]);
  });

  it("returns empty array for empty terms", () => {
    const idx = new Map([["typescript", 1]]);
    expect(resolveSeedEntities([], idx)).toEqual([]);
  });
});

// ── buildEntityGraph ──────────────────────────────────────────────────────

describe("buildEntityGraph", () => {
  it("builds bidirectional adjacency from relationships", () => {
    const entities = [
      { id: 1, name: "A", heat: 1 },
      { id: 2, name: "B", heat: 1 },
    ];
    const rels = [{ sourceEntityId: 1, targetEntityId: 2, weight: 0.8, confidence: 1.0 }];
    const [graph, nameIndex] = buildEntityGraph(entities, rels);
    expect(graph.get(1)?.some(([t]) => t === 2)).toBe(true);
    expect(graph.get(2)?.some(([t]) => t === 1)).toBe(true);
    expect(nameIndex.get("a")).toBe(1);
  });

  it("filters entities below minHeat", () => {
    const entities = [
      { id: 1, name: "A", heat: 0.5 },
      { id: 2, name: "B", heat: 0.1 },
    ];
    const rels = [{ sourceEntityId: 1, targetEntityId: 2 }];
    const [graph] = buildEntityGraph(entities, rels, 0.3);
    // Entity 2 has heat 0.1 < minHeat 0.3 → relationship is excluded
    expect(graph.get(1)?.some(([t]) => t === 2)).toBeFalsy();
  });

  it("edge weight = relationship weight × confidence", () => {
    const entities = [{ id: 1, heat: 1 }, { id: 2, heat: 1 }];
    const rels = [{ sourceEntityId: 1, targetEntityId: 2, weight: 0.8, confidence: 0.5 }];
    const [graph] = buildEntityGraph(entities, rels);
    const edge = graph.get(1)?.find(([t]) => t === 2);
    expect(edge?.[1]).toBeCloseTo(0.4, 6);
  });
});
