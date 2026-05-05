/**
 * Unit tests for layout-engine.ts.
 *
 * Invariants:
 *   - topologyFingerprint: same topology → same fingerprint (deterministic)
 *   - topologyFingerprint: different topology → different fingerprint
 *   - normalizeCoords: all outputs in approximately [-1, 1]
 *   - layout: throws on empty nodeIds
 *   - layout: throws when engineFn not injected
 *   - layout: returns one coord per node
 *   - layout: deterministic for fixed seed (FR algorithm)
 */

import { describe, expect, it } from "vitest";
import type { LayoutEngineFn } from "../../../src/workflow-graph/layout-engine.js";
import {
  layout,
  normalizeCoords,
  topologyFingerprint,
} from "../../../src/workflow-graph/layout-engine.js";

// ── Stub engine: returns a simple grid layout ───────────────────────────

const gridEngine: LayoutEngineFn = (nodeCount, _edges, _algo, _seed) => {
  return Array.from({ length: nodeCount }, (_, i) => [i % 5, Math.floor(i / 5)]);
};

describe("topologyFingerprint", () => {
  it("is deterministic for same topology", () => {
    const f1 = topologyFingerprint(["A", "B"], [["A", "B"]]);
    const f2 = topologyFingerprint(["A", "B"], [["A", "B"]]);
    expect(f1).toBe(f2);
  });

  it("is order-independent for nodes and edges", () => {
    const f1 = topologyFingerprint(["A", "B"], [["A", "B"]]);
    const f2 = topologyFingerprint(["B", "A"], [["A", "B"]]);
    expect(f1).toBe(f2);
  });

  it("differs for different topologies", () => {
    const f1 = topologyFingerprint(["A", "B"], [["A", "B"]]);
    const f2 = topologyFingerprint(["A", "B", "C"], [["A", "B"]]);
    expect(f1).not.toBe(f2);
  });

  it("returns a 16-hex-char string", () => {
    const fp = topologyFingerprint(["X"], []);
    expect(fp).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(fp)).toBe(true);
  });
});

describe("normalizeCoords", () => {
  it("returns one coord per node", () => {
    const raw: Array<[number, number]> = [[0, 0], [10, 10], [5, 0]];
    const result = normalizeCoords(["A", "B", "C"], raw);
    expect(result).toHaveLength(3);
    expect(result[0][0]).toBe("A");
  });

  it("all x, y values are in approximately [-1, 1] range with padding", () => {
    const raw: Array<[number, number]> = [[0, 0], [100, 0], [50, 100]];
    const result = normalizeCoords(["A", "B", "C"], raw);
    for (const [, x, y] of result) {
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThanOrEqual(2);
      expect(y).toBeGreaterThanOrEqual(-2);
      expect(y).toBeLessThanOrEqual(2);
    }
  });

  it("returns empty for empty raw coords", () => {
    expect(normalizeCoords([], [])).toEqual([]);
  });
});

describe("layout", () => {
  it("throws when nodeIds is empty", () => {
    expect(() => layout([], [], { engineFn: gridEngine })).toThrow();
  });

  it("throws when engineFn is not provided", () => {
    expect(() => layout(["A"], [])).toThrow();
  });

  it("returns one coord per node", () => {
    const nodes = ["A", "B", "C"];
    const edges: Array<[string, string]> = [["A", "B"]];
    const result = layout(nodes, edges, { engineFn: gridEngine });
    expect(result).toHaveLength(3);
    const ids = result.map(([id]) => id);
    expect(ids).toContain("A");
    expect(ids).toContain("B");
    expect(ids).toContain("C");
  });

  it("is deterministic for fixed seed (FR algo, small graph)", () => {
    // Determinism for grid engine is trivially satisfied; test the
    // pipeline end-to-end is stable.
    const nodes = ["n1", "n2", "n3"];
    const edges: Array<[string, string]> = [["n1", "n2"], ["n2", "n3"]];
    const r1 = layout(nodes, edges, { algorithm: "fr", seed: 0, engineFn: gridEngine });
    const r2 = layout(nodes, edges, { algorithm: "fr", seed: 0, engineFn: gridEngine });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("skips self-loop edges and edges with missing nodes", () => {
    const nodes = ["A", "B"];
    const edges: Array<[string, string]> = [
      ["A", "A"],       // self-loop
      ["A", "MISSING"], // unknown node
      ["A", "B"],       // valid
    ];
    // Should not throw and return 2 coords
    const result = layout(nodes, edges, { engineFn: gridEngine });
    expect(result).toHaveLength(2);
  });
});
