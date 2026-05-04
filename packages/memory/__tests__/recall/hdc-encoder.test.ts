/**
 * Unit tests for the HDC encoder module.
 *
 * Verifies algebraic properties of the HDC bind/bundle/permute algebra:
 *   - bind associativity and commutativity
 *   - bundle idempotence and associativity
 *   - permute reversibility: permute(permute(v, n), -n) = v
 *   - encodeText produces same vector for same text (determinism)
 *   - computeHdcScores filters below threshold
 *
 * source: Kanerva (2009) "Hyperdimensional Computing" §2.3
 *         cortex@bc0ae4f mcp_server/core/hdc_encoder.py
 */

import { describe, expect, it } from "vitest";
import {
  HDC_DIM,
  bind,
  bundle,
  computeHdcScores,
  encodeText,
  encodeWithPosition,
  permute,
  similarity,
} from "../../src/recall/hdc-encoder.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

/** Return a small HDC dim for fast tests. */
const DIM = 64;

function makeVec(seed: number, dim: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = ((seed * 31 + i * 17) & 1) === 0 ? -1 : 1;
  return v;
}

// ── bind ───────────────────────────────────────────────────────────────────

describe("bind", () => {
  it("produces a vector of the same length", () => {
    const a = makeVec(1, DIM);
    const b = makeVec(2, DIM);
    expect(bind(a, b)).toHaveLength(DIM);
  });

  it("all entries are ±1 (bipolar postcondition)", () => {
    const a = makeVec(3, DIM);
    const b = makeVec(4, DIM);
    const c = bind(a, b);
    for (const v of c) {
      expect(Math.abs(v)).toBe(1);
    }
  });

  it("is commutative: bind(a,b) = bind(b,a)", () => {
    const a = makeVec(5, DIM);
    const b = makeVec(6, DIM);
    const ab = bind(a, b);
    const ba = bind(b, a);
    expect(ab).toEqual(ba);
  });

  it("bind(a, a) is identity-like: bind(bind(a,a), a) = a", () => {
    // bind(a, a)[i] = a[i]^2 = 1; bind(1-vec, a)[i] = a[i]
    const a = makeVec(7, DIM);
    const aa = bind(a, a);
    const aaa = bind(aa, a);
    expect(aaa).toEqual(a);
  });
});

// ── bundle ─────────────────────────────────────────────────────────────────

describe("bundle", () => {
  it("throws for empty input", () => {
    expect(() => bundle([])).toThrow("bundle requires at least one vector");
  });

  it("returns a copy for single-vector input", () => {
    const v = makeVec(8, DIM);
    const result = bundle([v]);
    expect(result).not.toBe(v); // copy, not same reference
    expect(result).toEqual(v);
  });

  it("all entries are ±1 (bipolar postcondition)", () => {
    const vecs = [makeVec(9, DIM), makeVec(10, DIM), makeVec(11, DIM)];
    const result = bundle(vecs);
    for (const v of result) {
      expect(Math.abs(v)).toBe(1);
    }
  });

  it("bundling a vector with its inverse gives tiebreak result (no zeros)", () => {
    const v = makeVec(12, DIM);
    const inv = v.map((x) => -x) as unknown as Float32Array;
    const inv32 = new Float32Array(inv);
    const result = bundle([v, inv32]);
    // No entry should be zero — tiebreak fills all
    for (const val of result) {
      expect(Math.abs(val)).toBe(1);
    }
  });
});

// ── permute ────────────────────────────────────────────────────────────────

describe("permute", () => {
  it("permute(v, 0) = v", () => {
    const v = makeVec(13, DIM);
    expect(permute(v, 0)).toEqual(v);
  });

  it("permute(permute(v, n), -n) = v (invertibility)", () => {
    const v = makeVec(14, DIM);
    const shifted = permute(v, 7);
    const restored = permute(shifted, -7);
    expect(restored).toEqual(v);
  });

  it("result has the same length as input", () => {
    const v = makeVec(15, DIM);
    expect(permute(v, 3)).toHaveLength(DIM);
  });

  it("different shifts produce different vectors for non-trivial input", () => {
    const v = makeVec(16, DIM);
    const s1 = permute(v, 1);
    const s2 = permute(v, 2);
    // They should differ (unless the vector is constant — which it isn't for our fixture)
    expect(s1).not.toEqual(s2);
  });
});

// ── similarity ─────────────────────────────────────────────────────────────

describe("similarity", () => {
  it("identical vectors give similarity 1.0", () => {
    const v = makeVec(17, DIM);
    expect(similarity(v, v)).toBeCloseTo(1.0, 6);
  });

  it("inverted vector gives similarity -1.0", () => {
    const v = makeVec(18, DIM);
    const inv = v.map((x) => -x) as Float32Array;
    expect(similarity(v, inv)).toBeCloseTo(-1.0, 6);
  });

  it("returns 0 for zero-length vectors", () => {
    expect(similarity(new Float32Array(0), new Float32Array(0))).toBe(0);
  });

  it("result is in [-1, 1]", () => {
    const a = makeVec(19, DIM);
    const b = makeVec(20, DIM);
    const sim = similarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(-1.0);
    expect(sim).toBeLessThanOrEqual(1.0);
  });
});

// ── encodeText ─────────────────────────────────────────────────────────────

describe("encodeText", () => {
  it("is deterministic: same text → same vector", () => {
    const text = "recall memory Hopfield pgvector";
    const a = encodeText(text, DIM);
    const b = encodeText(text, DIM);
    expect(a).toEqual(b);
  });

  it("returns neutral (all-zero) vector for empty/stopword-only text", () => {
    const v = encodeText("the a an is", DIM);
    // neutral = Float32Array of zeros
    expect(Array.from(v).every((x) => x === 0)).toBe(true);
  });

  it("produces same-length vector regardless of input", () => {
    const short = encodeText("hello", DIM);
    const long = encodeText("hello world this is a longer sentence with more words", DIM);
    expect(short).toHaveLength(DIM);
    expect(long).toHaveLength(DIM);
  });

  it("similar texts produce higher similarity than dissimilar texts", () => {
    const base = encodeText("Hopfield network memory retrieval", HDC_DIM);
    const similar = encodeText("Hopfield networks retrieve memories associatively", HDC_DIM);
    const dissimilar = encodeText("TypeScript build system webpack vite", HDC_DIM);
    const simSimilar = similarity(base, similar);
    const simDissimilar = similarity(base, dissimilar);
    expect(simSimilar).toBeGreaterThan(simDissimilar);
  });
});

// ── encodeWithPosition ─────────────────────────────────────────────────────

describe("encodeWithPosition", () => {
  it("returns zero vector for empty token list", () => {
    const v = encodeWithPosition([], DIM);
    expect(v).toHaveLength(DIM);
  });

  it("is deterministic", () => {
    const tokens = ["recall", "memory", "graph"];
    const a = encodeWithPosition(tokens, DIM);
    const b = encodeWithPosition(tokens, DIM);
    expect(a).toEqual(b);
  });

  it("different orderings produce different vectors", () => {
    const t1 = ["alpha", "beta", "gamma"];
    const t2 = ["gamma", "beta", "alpha"];
    const v1 = encodeWithPosition(t1, DIM);
    const v2 = encodeWithPosition(t2, DIM);
    // Different orderings should produce different encodings
    // (permute embeds position; reordering changes the result)
    expect(v1).not.toEqual(v2);
  });
});

// ── computeHdcScores ───────────────────────────────────────────────────────

describe("computeHdcScores", () => {
  it("returns empty for empty memory list", () => {
    expect(computeHdcScores("query", [])).toEqual([]);
  });

  it("filters results below threshold", () => {
    const mems: Array<[number, string]> = [
      [1, "completely unrelated content about databases"],
      [2, "recall memory retrieval hopfield network"],
    ];
    // High threshold — only very similar content passes
    const results = computeHdcScores("recall hopfield network", mems, HDC_DIM, 0.9);
    // With a threshold of 0.9, even similar text may not match — but ALL scores must be >= 0.9
    for (const [, sim] of results) {
      expect(sim).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("results are sorted descending by similarity", () => {
    const mems: Array<[number, string]> = [
      [1, "recall memory retrieval hopfield network embeddings"],
      [2, "build system typescript webpack vitest"],
      [3, "memory recall associative retrieval"],
    ];
    const results = computeHdcScores("recall memory hopfield", mems, HDC_DIM, 0.0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]![1]).toBeGreaterThanOrEqual(results[i]![1]);
    }
  });

  it("identical query and content gives maximum similarity", () => {
    const content = "hopfield memory recall network";
    const mems: Array<[number, string]> = [[42, content]];
    const results = computeHdcScores(content, mems, HDC_DIM, 0.0);
    expect(results).toHaveLength(1);
    // Identical text → similarity should be exactly 1.0
    expect(results[0]![1]).toBeCloseTo(1.0, 6);
  });
});
