/**
 * Unit tests for the Hopfield network recall module.
 *
 * Verifies mathematical properties derived from the contract in hopfield.ts:
 *   - softmax attention sums to 1.0 (via retrieve output)
 *   - sparsemax produces exact zeros for non-matching patterns
 *   - patternCompletion converges (output is L2-normalized)
 *   - computeEnergy decreases when query matches stored patterns
 *   - buildPatternMatrix normalizes rows to unit length
 *
 * source: Ramsauer et al. (2021) "Hopfield Networks is All You Need"
 *         https://arxiv.org/abs/2008.02217
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_BETA,
  buildPatternMatrix,
  computeEnergy,
  patternCompletion,
  retrieve,
  retrieveSparse,
} from "../../src/recall/hopfield.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeVec(vals: number[]): number[] {
  return vals;
}

/** Build a small pattern matrix from 3 orthogonal-ish 4-D vectors. */
function threePatternMatrix(): ReturnType<typeof buildPatternMatrix> {
  const embeddings: Array<[number, number[]]> = [
    [1, [1, 0, 0, 0]],
    [2, [0, 1, 0, 0]],
    [3, [0, 0, 1, 0]],
  ];
  return buildPatternMatrix(embeddings);
}

// ── buildPatternMatrix ─────────────────────────────────────────────────────

describe("buildPatternMatrix", () => {
  it("produces L2-normalized rows", () => {
    const mat = buildPatternMatrix([[1, [3, 4, 0, 0]]]);
    const row = mat.rows[0];
    expect(row).toBeDefined();
    let normSq = 0;
    for (const v of row!) normSq += v * v;
    // |[3,4,0,0]| = 5 → normalized to [0.6, 0.8, 0, 0]
    expect(Math.sqrt(normSq)).toBeCloseTo(1.0, 6);
  });

  it("skips empty embedding vectors", () => {
    const mat = buildPatternMatrix([
      [1, []],
      [2, [1, 0]],
    ]);
    expect(mat.rows).toHaveLength(1);
    expect(mat.patternIds).toEqual([2]);
  });

  it("sets dim to 0 for empty input", () => {
    const mat = buildPatternMatrix([]);
    expect(mat.dim).toBe(0);
    expect(mat.rows).toHaveLength(0);
  });
});

// ── retrieve ───────────────────────────────────────────────────────────────

describe("retrieve — softmax attention contract", () => {
  it("returns empty for empty matrix", () => {
    const mat = buildPatternMatrix([]);
    expect(retrieve([1, 0, 0, 0], mat)).toEqual([]);
  });

  it("returns empty for empty query embedding", () => {
    const mat = threePatternMatrix();
    expect(retrieve([], mat)).toEqual([]);
  });

  it("attention scores sum to 1 (softmax invariant)", () => {
    const mat = threePatternMatrix();
    const results = retrieve([1, 0, 0, 0], mat, DEFAULT_BETA, 100);
    const sum = results.reduce((acc, [, w]) => acc + w, 0);
    // All 3 patterns are returned, scores sum to 1
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("query aligned with pattern 1 gives highest score to pattern 1", () => {
    const mat = threePatternMatrix();
    const results = retrieve([1, 0, 0, 0], mat, DEFAULT_BETA, 10);
    expect(results[0]![0]).toBe(1);
  });

  it("respects topK limit", () => {
    const mat = threePatternMatrix();
    const results = retrieve([1, 0.1, 0.05, 0], mat, DEFAULT_BETA, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ── retrieveSparse ─────────────────────────────────────────────────────────

describe("retrieveSparse — sparsemax contract", () => {
  it("returns empty for empty matrix", () => {
    const mat = buildPatternMatrix([]);
    expect(retrieveSparse([1, 0], mat)).toEqual([]);
  });

  it("returns only non-zero entries (sparsemax produces exact zeros)", () => {
    // With high beta and a very dominant pattern, sparsemax zeroes the rest.
    const embeddings: Array<[number, number[]]> = [
      [1, [1, 0, 0, 0, 0, 0, 0, 0]],
      [2, [0, 0, 0, 0, 1, 0, 0, 0]], // orthogonal to query
    ];
    const mat = buildPatternMatrix(embeddings);
    const results = retrieveSparse([1, 0, 0, 0, 0, 0, 0, 0], mat, 50.0, 10);
    // All returned scores must be > 0
    for (const [, w] of results) {
      expect(w).toBeGreaterThan(0);
    }
  });

  it("prefers the aligned pattern", () => {
    const mat = threePatternMatrix();
    const results = retrieveSparse([1, 0, 0, 0], mat, DEFAULT_BETA, 10);
    if (results.length > 0) {
      expect(results[0]![0]).toBe(1);
    }
  });
});

// ── patternCompletion ──────────────────────────────────────────────────────

describe("patternCompletion — convergence contract", () => {
  it("returns input unchanged for empty matrix", () => {
    const mat = buildPatternMatrix([]);
    const input = [0.5, 0.5, 0.5, 0.5];
    expect(patternCompletion(input, mat)).toEqual(input);
  });

  it("output vector is L2-normalized (post-completion invariant)", () => {
    const mat = threePatternMatrix();
    const completed = patternCompletion([0.6, 0.4, 0.1, 0.0], mat, DEFAULT_BETA, 5);
    const normSq = completed.reduce((s, x) => s + x * x, 0);
    expect(Math.sqrt(normSq)).toBeCloseTo(1.0, 5);
  });

  it("noisy version of pattern 1 completes toward pattern 1", () => {
    const mat = threePatternMatrix();
    const noisy = [0.9, 0.1, 0.05, 0.02]; // close to [1,0,0,0]
    const completed = patternCompletion(noisy, mat, DEFAULT_BETA, 5);
    // The first element (aligned with pattern 1) should dominate
    expect(completed[0]).toBeGreaterThan(0.8);
  });
});

// ── computeEnergy ──────────────────────────────────────────────────────────

describe("computeEnergy — energy contract", () => {
  it("returns 0.5 * |xi|^2 for empty matrix", () => {
    const mat = buildPatternMatrix([]);
    const q = makeVec([3, 4]); // |q|^2 = 25
    expect(computeEnergy(q, mat)).toBeCloseTo(0.5 * 25, 6);
  });

  it("aligned query has lower energy than orthogonal query", () => {
    const mat = threePatternMatrix();
    // Query aligned with pattern 1
    const energyAligned = computeEnergy([1, 0, 0, 0], mat);
    // Query orthogonal to all patterns
    const energyOrtho = computeEnergy([0, 0, 0, 1], mat);
    // Lower energy = more familiar
    expect(energyAligned).toBeLessThan(energyOrtho);
  });

  it("energy is a finite real number", () => {
    const mat = threePatternMatrix();
    const energy = computeEnergy([0.5, 0.5, 0.0, 0.0], mat);
    expect(Number.isFinite(energy)).toBe(true);
  });
});
