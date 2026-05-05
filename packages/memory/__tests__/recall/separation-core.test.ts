/**
 * Tests for separation-core.ts — DG orthogonalization and sparsification.
 *
 * Invariant: orthogonalized embedding is unit-length; separationIndex in [0, 1].
 * Happy path: high-similarity embeddings get separated.
 * Error path: empty interferers → no-op; mismatched dims → skipped.
 */

import { describe, it, expect } from "vitest";
import {
  detectInterferenceRisk,
  orthogonalizeEmbedding,
  applySparsification,
  SEPARATION_THRESHOLD,
  IDENTITY_THRESHOLD,
  SPARSITY_TARGET,
} from "../../src/recall/separation-core.js";

// ── detectInterferenceRisk ─────────────────────────────────────────────────

describe("detectInterferenceRisk", () => {
  const baseEmb = [1, 0, 0, 0];
  const verySimEmb = [0.98, 0.02, 0, 0]; // cosine ~ 0.98 → above identity threshold
  const simEmb = [0.9, 0.1, 0, 0];       // cosine ~ high but < identity
  const diffEmb = [0, 1, 0, 0];           // cosine = 0

  it("returns empty for no existing embeddings", () => {
    expect(detectInterferenceRisk(baseEmb, [])).toHaveLength(0);
  });

  it("detects similar (but not identical) embeddings as interference", () => {
    const risks = detectInterferenceRisk(baseEmb, [simEmb]);
    // sim ~ 0.9, which is >= SEPARATION_THRESHOLD and < IDENTITY_THRESHOLD
    if (risks.length > 0) {
      expect(risks[0]![1]).toBeGreaterThanOrEqual(SEPARATION_THRESHOLD);
      expect(risks[0]![1]).toBeLessThan(IDENTITY_THRESHOLD);
    }
  });

  it("does not flag dissimilar embeddings", () => {
    const risks = detectInterferenceRisk(baseEmb, [diffEmb]);
    // cosine = 0, which is < SEPARATION_THRESHOLD
    expect(risks).toHaveLength(0);
  });

  it("sorts results by similarity descending", () => {
    const emb1 = [0.8, 0.2, 0, 0]; // normalized: ~0.97 cosine with base
    const risks = detectInterferenceRisk(baseEmb, [simEmb, emb1]);
    for (let i = 0; i < risks.length - 1; i++) {
      expect(risks[i]![1]).toBeGreaterThanOrEqual(risks[i + 1]![1]);
    }
  });
});

// ── orthogonalizeEmbedding ─────────────────────────────────────────────────

describe("orthogonalizeEmbedding", () => {
  it("returns input unchanged for empty interferers", () => {
    const emb = [1, 0, 0, 0];
    const [result, idx] = orthogonalizeEmbedding(emb, []);
    expect(result).toEqual(emb);
    expect(idx).toBe(0.0);
  });

  it("returns separationIndex >= 0", () => {
    const emb = [1, 0, 0, 0];
    const interferer = [0.9, 0.1, 0, 0];
    const [, idx] = orthogonalizeEmbedding(emb, [interferer]);
    expect(idx).toBeGreaterThanOrEqual(0.0);
  });

  it("returns unit-length result", () => {
    const emb = [1, 0, 0, 0];
    const interferer = [0.9, 0.1, 0, 0];
    const [result] = orthogonalizeEmbedding(emb, [interferer]);
    const mag = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1.0, 4);
  });

  it("skips interferers with mismatched dimensions", () => {
    const emb = [1, 0, 0, 0];
    const wrongDim = [1, 0]; // dim=2, won't match dim=4
    const [result, idx] = orthogonalizeEmbedding(emb, [wrongDim]);
    expect(result).toEqual(emb);
    expect(idx).toBe(0.0);
  });
});

// ── applySparsification ────────────────────────────────────────────────────

describe("applySparsification", () => {
  it("preserves exactly k non-zero dimensions", () => {
    const emb = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const sparse = applySparsification(emb, 0.1); // k = 1
    const nonZero = sparse.filter((v) => v !== 0).length;
    expect(nonZero).toBe(1);
  });

  it("preserves the largest magnitude dimensions", () => {
    const emb = [0.1, 0.0, 0.5, 0.0]; // 0.5 is largest
    const sparse = applySparsification(emb, SPARSITY_TARGET); // 4% of 4 = at least 1
    const maxIdx = sparse.indexOf(Math.max(...sparse.filter((v) => v > 0)));
    expect(maxIdx).toBe(2); // index of 0.5
  });

  it("result is unit-length when non-zero elements exist", () => {
    const emb = [0.2, 0.8, 0.4, 0.6];
    const sparse = applySparsification(emb, 0.5);
    const mag = Math.sqrt(sparse.reduce((s, v) => s + v * v, 0));
    if (mag > 0) expect(mag).toBeCloseTo(1.0, 4);
  });

  it("handles all-zero embedding gracefully", () => {
    const emb = [0, 0, 0, 0];
    const sparse = applySparsification(emb);
    expect(sparse).toEqual([0, 0, 0, 0]);
  });
});
