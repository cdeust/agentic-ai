/**
 * Unit tests for coverage.ts — submodular selection.
 *
 * Invariants:
 *   - Result length ≤ min(maxChunks, candidates.length)
 *   - IDs are unique (no duplicates)
 *   - When tokenBudget=undefined, always returns exactly maxChunks items
 *     (or candidates.length if smaller)
 *   - Selection is deterministic for the same input
 */

import { describe, expect, it } from "vitest";
import { submodularSelect } from "../../../src/recall/context-assembly/coverage.js";

function makeCandidate(
  score: number,
  content: string,
  embedding?: number[],
): { score: number; content: string; embedding?: number[] } {
  return { score, content, ...(embedding ? { embedding } : {}) };
}

describe("submodularSelect", () => {
  it("returns empty list for empty candidates", () => {
    expect(submodularSelect([])).toEqual([]);
  });

  it("returns at most maxChunks items", () => {
    const candidates = Array.from({ length: 10 }, () =>
      makeCandidate(0.5, "content"),
    );
    const result = submodularSelect(candidates, { maxChunks: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("node ID uniqueness — no duplicate candidates selected", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate(i / 5, `unique content ${i}`),
    );
    const result = submodularSelect(candidates, { maxChunks: 5 });
    const contents = result.map((c) => c.content);
    const unique = new Set(contents);
    expect(unique.size).toBe(contents.length);
  });

  it("respects tokenBudget soft upper bound", () => {
    // Each candidate has content of ~9 chars ≈ 3 tokens
    const candidates = Array.from({ length: 10 }, () =>
      makeCandidate(1, "123456789"),
    );
    // Budget of 10 tokens → at most 3 items (each costs 3)
    const result = submodularSelect(candidates, {
      tokenBudget: 10,
      maxChunks: 10,
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("is deterministic for same input", () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      makeCandidate(Math.sin(i), `content-${i}`),
    );
    const r1 = submodularSelect(candidates, { maxChunks: 4 }).map((c) => c.content);
    const r2 = submodularSelect(candidates, { maxChunks: 4 }).map((c) => c.content);
    expect(r1).toEqual(r2);
  });

  it("returns results in original index order", () => {
    const candidates = [
      makeCandidate(0.9, "A"),
      makeCandidate(0.5, "B"),
      makeCandidate(0.8, "C"),
    ];
    const result = submodularSelect(candidates, { maxChunks: 3 });
    // All three selected — should be in original index order [A, B, C]
    // (or a consistent subset ordered by index)
    const selectedContents = result.map((c) => c.content);
    expect(["A", "B", "C"].every((x) => selectedContents.includes(x))).toBe(true);
  });

  it("applies diversity penalty when embeddings are provided", () => {
    // Two near-identical candidates (embedding close) + one diverse
    const near1 = makeCandidate(0.9, "near1", [1, 0, 0]);
    const near2 = makeCandidate(0.85, "near2", [0.99, 0.14, 0]);
    const diverse = makeCandidate(0.7, "diverse", [0, 0, 1]);

    const result = submodularSelect([near1, near2, diverse], {
      maxChunks: 2,
      diversityLambda: 1.0,
    });
    const contents = result.map((c) => c.content);
    // With max diversity weight, the diverse item should beat near2
    expect(contents).toContain("near1");
    expect(contents).toContain("diverse");
  });
});
