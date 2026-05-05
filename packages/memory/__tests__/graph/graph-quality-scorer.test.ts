/**
 * Tests for graph-quality-scorer.ts
 *
 * Verifies: structural nodes always get quality=1.0; memory/entity scoring;
 * in-place mutation; quality in [0,1] invariant.
 */

import { describe, it, expect } from "vitest";
import { scoreAllNodes } from "../../src/graph/graph-quality-scorer.js";

describe("scoreAllNodes", () => {
  it("mutates nodes in place", () => {
    const nodes = [{ id: "a", type: "root" }];
    scoreAllNodes(nodes, []);
    expect(nodes[0]["quality"]).toBeDefined();
    expect(nodes[0]["qualityLabel"]).toBeDefined();
  });

  it("structural nodes always get quality=1.0", () => {
    const structuralTypes = ["root", "category", "type-group"];
    for (const type of structuralTypes) {
      const nodes = [{ id: "n", type }];
      scoreAllNodes(nodes, []);
      expect(nodes[0]["quality"]).toBe(1.0);
    }
  });

  it("quality is always in [0, 1] for all node types", () => {
    const nodes = [
      { id: "d1", type: "domain", sessionCount: 5, confidence: 0.7 },
      { id: "e1", type: "entry-point", frequency: 3, confidence: 0.6 },
      { id: "p1", type: "recurring-pattern", frequency: 4, confidence: 0.5 },
      { id: "t1", type: "tool-preference", ratio: 0.4, avgPerSession: 2 },
      { id: "f1", type: "behavioral-feature", activation: 0.6 },
      { id: "m1", type: "memory", heat: 0.5, importance: 0.7, accessCount: 3 },
      { id: "en1", type: "entity", heat: 0.4 },
    ];
    const edges = [
      { source: "d1", target: "e1" },
      { source: "d1", target: "p1" },
      { source: "e1", target: "m1" },
    ];
    scoreAllNodes(nodes, edges);
    for (const node of nodes) {
      const q = node["quality"] as number;
      expect(q).toBeGreaterThanOrEqual(0.0);
      expect(q).toBeLessThanOrEqual(1.0);
    }
  });

  it("memory with high recall rank gets bonus", () => {
    const highRank = [{ id: "m", type: "memory", heat: 0.5, importance: 0.5, accessCount: 0, lastRecallRank: 1 }];
    const noRank = [{ id: "m", type: "memory", heat: 0.5, importance: 0.5, accessCount: 0, lastRecallRank: null }];
    scoreAllNodes(highRank, []);
    scoreAllNodes(noRank, []);
    expect(highRank[0]["quality"] as number).toBeGreaterThan(noRank[0]["quality"] as number);
  });

  it("isolated entity gets quality 0.15", () => {
    const nodes = [{ id: "e", type: "entity", heat: 0.0 }];
    scoreAllNodes(nodes, []);
    expect(nodes[0]["quality"]).toBeCloseTo(0.15, 3);
  });
});
