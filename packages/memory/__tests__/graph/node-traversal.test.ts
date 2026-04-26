/**
 * Unit tests for node-traversal.ts — BFS traversal, SR graph builders,
 * SR scoring, and 2D projection.
 *
 * Structural coverage:
 *   - Linear graph: A → B → C (one path, no cycles)
 *   - Branching graph: A → B, A → C, B → D (multiple paths)
 *   - Cyclic graph: A → B → C → A (cycle detection via visited set)
 *   - Empty / no-neighbor cases
 *   - Temporal co-access graph construction
 *   - SR scoring
 */

import { describe, it, expect } from "vitest";
import {
  buildCoAccessGraph,
  buildTemporalCoAccess,
  computeSrScores,
  navigateFrom,
  projectTo2d,
} from "../../src/graph/node-traversal.js";
import type { SRGraph } from "../../src/graph/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a SRGraph from a plain adjacency object for test convenience. */
function makeGraph(adj: Record<number, Record<number, number>>): SRGraph {
  const g: SRGraph = new Map();
  for (const [src, neighbors] of Object.entries(adj)) {
    const srcId = Number(src);
    const inner = new Map<number, number>();
    for (const [tgt, w] of Object.entries(neighbors)) {
      inner.set(Number(tgt), w);
    }
    g.set(srcId, inner);
  }
  return g;
}

// ── navigateFrom ──────────────────────────────────────────────────────────

describe("navigateFrom", () => {
  it("returns empty map when start node has no neighbors", () => {
    const graph = makeGraph({ 1: {} });
    const result = navigateFrom(1, graph, 2);
    expect(result.size).toBe(0);
  });

  it("returns empty map when start node is absent from graph", () => {
    const graph = makeGraph({});
    const result = navigateFrom(99, graph, 2);
    expect(result.size).toBe(0);
  });

  it("linear graph A→B→C: depth 1 returns only B", () => {
    // A=1, B=2, C=3
    const graph = makeGraph({ 1: { 2: 0.9 }, 2: { 3: 0.9 }, 3: {} });
    const result = navigateFrom(1, graph, 1);
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(false);
  });

  it("linear graph A→B→C: depth 2 returns B and C", () => {
    const graph = makeGraph({ 1: { 2: 0.9 }, 2: { 3: 0.9 }, 3: {} });
    const result = navigateFrom(1, graph, 2);
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(true);
  });

  it("linear graph: hops and path are correct", () => {
    const graph = makeGraph({ 1: { 2: 0.9 }, 2: { 3: 0.9 }, 3: {} });
    const result = navigateFrom(1, graph, 2);
    const b = result.get(2);
    const c = result.get(3);
    expect(b?.hops).toBe(1);
    expect(b?.path).toEqual([1, 2]);
    expect(c?.hops).toBe(2);
    expect(c?.path).toEqual([1, 2, 3]);
  });

  it("linear graph: distances increase with hops", () => {
    const graph = makeGraph({ 1: { 2: 0.9 }, 2: { 3: 0.9 }, 3: {} });
    const result = navigateFrom(1, graph, 2);
    const distB = result.get(2)?.distance ?? 0;
    const distC = result.get(3)?.distance ?? 0;
    // distance = 1 - cumulativeWeight; C has smaller cumulative weight
    expect(distC).toBeGreaterThan(distB);
  });

  it("branching graph: explores all reachable nodes", () => {
    // A=1 → B=2, A=1 → C=3, B=2 → D=4
    const graph = makeGraph({
      1: { 2: 0.8, 3: 0.7 },
      2: { 4: 0.6 },
      3: {},
      4: {},
    });
    const result = navigateFrom(1, graph, 2);
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(true);
    expect(result.has(4)).toBe(true);
    expect(result.has(1)).toBe(false); // start node excluded
  });

  it("cyclic graph A→B→C→A: completes without infinite loop", () => {
    // All edges form a cycle: 1→2→3→1
    const graph = makeGraph({
      1: { 2: 0.9 },
      2: { 3: 0.9 },
      3: { 1: 0.9 },
    });
    const result = navigateFrom(1, graph, 4);
    // Should terminate (finite result set even with cycles).
    // Node 2 and 3 are reachable.
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(true);
    // NOTE: in Python's navigate_from, the start node (depth=0) is NOT added
    // to `visited`, so when the back-edge 3→1 is followed at depth 3, node 1
    // is recorded as a neighbor at depth 3. This is preserved here.
    // The visited-set check (line: if current_id in visited: continue) only
    // prevents double-processing, not re-discovery of the start.
    // source: navigate_from in cognitive_map.py — visited dict excludes depth-0 node.
    if (result.has(1)) {
      // If reached via back-edge, verify it has hops > 0
      expect(result.get(1)?.hops).toBeGreaterThan(0);
    }
    // Total nodes in result ≤ maxDepth (cycle is bounded by depth limit)
    expect(result.size).toBeLessThanOrEqual(4);
  });

  it("respects minWeight: edges below threshold are skipped", () => {
    const graph = makeGraph({ 1: { 2: 0.9, 3: 0.01 }, 2: {}, 3: {} });
    // Default minWeight = 0.05 → node 3 (edge 0.01) should be skipped
    const result = navigateFrom(1, graph, 2, 0.05);
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(false);
  });
});

// ── buildCoAccessGraph ────────────────────────────────────────────────────

describe("buildCoAccessGraph", () => {
  it("single sequence [1,2,3]: builds edges in both directions", () => {
    const g = buildCoAccessGraph([[1, 2, 3]], 0.9);
    expect(g.has(1)).toBe(true);
    expect(g.has(2)).toBe(true); // back-link from 2→1 exists
    expect(g.get(1)?.has(2)).toBe(true);
    expect(g.get(1)?.has(3)).toBe(true);
  });

  it("discount is applied correctly: SR[1][3] ≈ discount^1 = 0.9", () => {
    const g = buildCoAccessGraph([[1, 2, 3]], 0.9);
    const w13 = g.get(1)?.get(3) ?? 0;
    // dist = 2 → weight = 0.9^(2-1) = 0.9
    expect(w13).toBeCloseTo(0.9, 5);
  });

  it("multiple sequences accumulate weights", () => {
    // Both sequences include edge 1→2
    const g = buildCoAccessGraph([[1, 2], [1, 2]], 0.9);
    const w12 = g.get(1)?.get(2) ?? 0;
    // Each contributes 1.0 (dist=1, weight = 0.9^0 = 1). Sum = 2.
    expect(w12).toBeCloseTo(2.0, 5);
  });

  it("empty sequences produce empty graph", () => {
    const g = buildCoAccessGraph([], 0.9);
    expect(g.size).toBe(0);
  });
});

// ── buildTemporalCoAccess ─────────────────────────────────────────────────

describe("buildTemporalCoAccess", () => {
  it("memories within window are linked", () => {
    const now = new Date("2024-01-01T12:00:00Z");
    const later = new Date("2024-01-01T12:30:00Z"); // 30 min apart, window=2h
    const mems = [
      { id: 1, lastAccessed: now.toISOString() },
      { id: 2, lastAccessed: later.toISOString() },
    ];
    const g = buildTemporalCoAccess(mems, 2.0);
    expect(g.get(1)?.has(2)).toBe(true);
    expect(g.get(2)?.has(1)).toBe(true);
  });

  it("memories outside window are not linked", () => {
    const now = new Date("2024-01-01T12:00:00Z");
    const later = new Date("2024-01-01T16:00:00Z"); // 4h apart, window=2h
    const mems = [
      { id: 1, lastAccessed: now.toISOString() },
      { id: 2, lastAccessed: later.toISOString() },
    ];
    const g = buildTemporalCoAccess(mems, 2.0);
    expect(g.get(1)?.has(2)).toBeFalsy();
  });

  it("proximity score is 1.0 for identical timestamps", () => {
    const ts = "2024-01-01T12:00:00Z";
    const mems = [
      { id: 1, lastAccessed: ts },
      { id: 2, lastAccessed: ts },
    ];
    const g = buildTemporalCoAccess(mems, 2.0);
    const w = g.get(1)?.get(2) ?? 0;
    expect(w).toBeCloseTo(1.0, 5);
  });

  it("skips memories with missing lastAccessed", () => {
    const mems = [
      { id: 1, lastAccessed: "2024-01-01T12:00:00Z" },
      { id: 2 }, // no lastAccessed
    ];
    const g = buildTemporalCoAccess(mems, 2.0);
    expect(g.size).toBe(0);
  });
});

// ── computeSrScores ───────────────────────────────────────────────────────

describe("computeSrScores", () => {
  it("returns empty array for empty seeds", () => {
    const g = makeGraph({ 1: { 2: 0.8 } });
    expect(computeSrScores([], g)).toEqual([]);
  });

  it("returns empty array for empty graph", () => {
    expect(computeSrScores([1], new Map())).toEqual([]);
  });

  it("excludes seed from results", () => {
    const g = makeGraph({ 1: { 2: 0.8, 1: 0.5 } });
    const scores = computeSrScores([1], g);
    const ids = scores.map(([id]) => id);
    expect(ids).not.toContain(1);
  });

  it("normalizes by number of seeds", () => {
    // Both seeds contribute to candidate 3
    const g = makeGraph({ 1: { 3: 0.9 }, 2: { 3: 0.9 } });
    const single = computeSrScores([1], g, 10);
    const both = computeSrScores([1, 2], g, 10);
    const singleScore = single.find(([id]) => id === 3)?.[1] ?? 0;
    const bothScore = both.find(([id]) => id === 3)?.[1] ?? 0;
    // Normalized: each seed contributes 0.9 / nSeeds
    // Single: 0.9/1 = 0.9. Both: (0.9+0.9)/2 = 0.9. Should match.
    expect(bothScore).toBeCloseTo(singleScore, 5);
  });

  it("sorts results descending by score", () => {
    const g = makeGraph({ 1: { 2: 0.9, 3: 0.5, 4: 0.1 } });
    const scores = computeSrScores([1], g, 10);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]![1]).toBeGreaterThanOrEqual(scores[i]![1]);
    }
  });

  it("respects topK limit", () => {
    const adj: Record<number, number> = {};
    for (let i = 2; i <= 20; i++) adj[i] = 0.5;
    const g = makeGraph({ 1: adj });
    const scores = computeSrScores([1], g, 5);
    expect(scores.length).toBe(5);
  });
});

// ── projectTo2d ───────────────────────────────────────────────────────────

describe("projectTo2d", () => {
  it("returns empty map for empty ids", () => {
    const result = projectTo2d(new Map(), []);
    expect(result.size).toBe(0);
  });

  it("single node returns (1, 0) after normalization", () => {
    const g = makeGraph({});
    const result = projectTo2d(g, [1]);
    const xy = result.get(1);
    expect(xy).toBeDefined();
    // With one node on a unit circle at angle 0: cos(0)=1, sin(0)=0
    // After normalization max_abs=1 → (1.0, 0.0)
    expect(xy![0]).toBeCloseTo(1.0, 3);
    expect(xy![1]).toBeCloseTo(0.0, 3);
  });

  it("all coordinates are in [-1, 1]", () => {
    const now = Date.now();
    const g = makeGraph({
      1: { 2: 0.9, 3: 0.7 },
      2: { 1: 0.9, 3: 0.5 },
      3: { 1: 0.7, 2: 0.5 },
    });
    const result = projectTo2d(g, [1, 2, 3]);
    for (const [x, y] of result.values()) {
      expect(Math.abs(x)).toBeLessThanOrEqual(1.0 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(1.0 + 1e-9);
    }
    void now;
  });

  it("returns coordinates for all requested ids", () => {
    const g = makeGraph({ 1: { 2: 0.8 }, 2: { 1: 0.8 } });
    const result = projectTo2d(g, [1, 2]);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
  });
});
