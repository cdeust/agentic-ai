import { describe, it, expect } from "vitest";
import { jaccardSimilarity } from "../../src/shared/similarity.js";

describe("jaccardSimilarity", () => {
  it("returns 0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0.0);
  });

  it("returns 1 for identical non-empty sets", () => {
    const s = new Set(["a", "b", "c"]);
    expect(jaccardSimilarity(s, s)).toBe(1.0);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0.0);
  });

  it("returns 0.5 for 50% overlap", () => {
    const a = new Set(["a", "b"]);
    const b = new Set(["b", "c"]);
    // intersection = {b}, union = {a, b, c} → 1/3? No: |A|=2, |B|=2, intersect=1, union=3
    expect(jaccardSimilarity(a, b)).toBeCloseTo(1 / 3, 10);
  });

  it("is symmetric", () => {
    const a = new Set(["x", "y", "z"]);
    const b = new Set(["y", "z", "w"]);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(jaccardSimilarity(b, a), 10);
  });

  it("returns value in [0, 1]", () => {
    for (let i = 0; i < 20; i++) {
      const a = new Set(Array.from({ length: i }, (_, j) => String(j)));
      const b = new Set(Array.from({ length: i }, (_, j) => String(j + i / 2)));
      const result = jaccardSimilarity(a, b);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    }
  });
});
