/**
 * Unit tests for cognitive-map.ts
 *
 * Invariant assertions:
 *   - buildCoAccessGraph: all weights > 0; bidirectional
 *   - computeSrScores: sums to <= topK; seeds excluded; sorted desc
 *   - navigateFrom: does not include start node; hops consistent with depth
 *   - projectTo2d: all coordinates in [-1, 1]
 *
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py
 */

import { describe, it, expect } from "vitest";
import {
  buildCoAccessGraph,
  buildTemporalCoAccess,
  computeSrScores,
  navigateFrom,
  projectTo2d,
} from "../../src/methodology/cognitive-map.js";

describe("buildCoAccessGraph", () => {
  it("returns empty graph for empty sequences", () => {
    const g = buildCoAccessGraph([]);
    expect(g.size).toBe(0);
  });

  it("builds forward SR weights for a 3-node sequence", () => {
    // Sequence [1, 2, 3]: SR[1][2] += 1, SR[1][3] += 0.9 (discount^1)
    const g = buildCoAccessGraph([[1, 2, 3]]);
    expect(g.get(1)?.get(2)).toBeCloseTo(1, 5);
    expect(g.get(1)?.get(3)).toBeCloseTo(0.9, 5);
  });

  it("builds bidirectional links (back-link weighted by discount)", () => {
    const g = buildCoAccessGraph([[1, 2]], 0.9);
    // forward: SR[1][2] += 1; back: SR[2][1] += 0.9
    expect(g.get(1)?.get(2)).toBeCloseTo(1, 5);
    expect(g.get(2)?.get(1)).toBeCloseTo(0.9, 5);
  });

  it("accumulates weights across multiple sequences", () => {
    const g = buildCoAccessGraph([[1, 2], [1, 2]]);
    expect(g.get(1)?.get(2)).toBeCloseTo(2, 5);
  });
});

describe("buildTemporalCoAccess", () => {
  it("returns empty graph for empty array", () => {
    const g = buildTemporalCoAccess([]);
    expect(g.size).toBe(0);
  });

  it("links two memories within window", () => {
    const mems = [
      { id: 1, last_accessed: "2024-01-01T00:00:00Z" },
      { id: 2, last_accessed: "2024-01-01T01:00:00Z" }, // 1 hour apart < 2h window
    ];
    const g = buildTemporalCoAccess(mems, 2);
    expect(g.get(1)?.has(2)).toBe(true);
    expect(g.get(2)?.has(1)).toBe(true);
  });

  it("does not link memories outside window", () => {
    const mems = [
      { id: 1, last_accessed: "2024-01-01T00:00:00Z" },
      { id: 2, last_accessed: "2024-01-01T05:00:00Z" }, // 5 hours > 2h window
    ];
    const g = buildTemporalCoAccess(mems, 2);
    expect(g.get(1)?.has(2) ?? false).toBe(false);
  });
});

describe("computeSrScores", () => {
  it("returns [] for empty seeds", () => {
    expect(computeSrScores([], new Map())).toEqual([]);
  });

  it("excludes seed nodes from results", () => {
    const g = new Map<number, Map<number, number>>();
    g.set(1, new Map([[2, 0.5], [3, 0.3]]));
    const results = computeSrScores([1], g);
    const ids = results.map(([id]) => id);
    expect(ids).not.toContain(1);
    expect(ids).toContain(2);
  });

  it("sorts results descending by score", () => {
    const g = new Map<number, Map<number, number>>();
    g.set(1, new Map([[2, 0.9], [3, 0.1]]));
    const results = computeSrScores([1], g);
    expect(results[0]?.[0]).toBe(2);
    expect(results[0]?.[1]).toBeCloseTo(0.9, 3);
  });

  it("normalizes by number of seeds", () => {
    const g = new Map<number, Map<number, number>>();
    g.set(1, new Map([[3, 0.8]]));
    g.set(2, new Map([[3, 0.4]]));
    const results = computeSrScores([1, 2], g);
    // seed count = 2: total for 3 = (0.8 + 0.4) / 2 = 0.6
    expect(results[0]?.[1]).toBeCloseTo(0.6, 3);
  });
});

describe("navigateFrom", () => {
  it("returns empty map for isolated node", () => {
    const result = navigateFrom(99, new Map());
    expect(result.size).toBe(0);
  });

  it("does not include the start node in results", () => {
    const g = new Map<number, Map<number, number>>();
    g.set(1, new Map([[2, 0.5]]));
    const result = navigateFrom(1, g);
    expect(result.has(1)).toBe(false);
    expect(result.has(2)).toBe(true);
  });

  it("respects maxDepth=1", () => {
    const g = new Map<number, Map<number, number>>();
    g.set(1, new Map([[2, 0.8]]));
    g.set(2, new Map([[3, 0.8]]));
    const result = navigateFrom(1, g, 1);
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(false); // depth 2 > maxDepth 1
  });
});

describe("projectTo2d", () => {
  it("returns empty map for empty memoryIds", () => {
    expect(projectTo2d(new Map(), [])).toEqual(new Map());
  });

  it("returns a coordinate for each memory ID", () => {
    const g = new Map<number, Map<number, number>>();
    g.set(1, new Map([[2, 0.5]]));
    g.set(2, new Map([[1, 0.5]]));
    const result = projectTo2d(g, [1, 2]);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
  });

  it("coordinates are in [-1, 1]", () => {
    const g = new Map<number, Map<number, number>>();
    const ids = [1, 2, 3, 4, 5];
    for (const a of ids) {
      g.set(a, new Map(ids.filter((b) => b !== a).map((b) => [b, 0.5])));
    }
    const result = projectTo2d(g, ids);
    for (const [x, y] of result.values()) {
      expect(x).toBeGreaterThanOrEqual(-1.0001);
      expect(x).toBeLessThanOrEqual(1.0001);
      expect(y).toBeGreaterThanOrEqual(-1.0001);
      expect(y).toBeLessThanOrEqual(1.0001);
    }
  });
});
