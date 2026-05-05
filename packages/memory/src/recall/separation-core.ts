/**
 * Pattern separation core — dentate gyrus orthogonalization and sparsification.
 *
 * Implements the computational analog of hippocampal dentate gyrus (DG) pattern
 * separation: similar inputs are orthogonalized and sparsified to force
 * non-overlapping representations.
 *
 * The biological DG achieves pattern separation through winner-take-all lateral
 * inhibition among granule cells (beta_INT ~0.9; Myers & Scharfman 2009),
 * producing extremely sparse population codes (~2-5% active cells). This module
 * uses Gram-Schmidt projection as a computational proxy — the mathematical effect
 * (increasing Hamming distance between similar patterns) is equivalent, though the
 * biological mechanism is competitive inhibition, not linear algebra.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/separation_core.py
 *
 * References:
 *   Leutgeb JK et al. (2007) Pattern separation in the DG and CA3.
 *     Science 315:961-966
 *   Yassa MA, Stark CEL (2011) Pattern separation in the hippocampus.
 *     Trends in Neurosciences 34:515-525
 *   Rolls ET (2013) Front Syst Neurosci 7:74
 *   Myers CE, Scharfman HE (2009) Hippocampus 19:321-337
 */

import {
  cosineSimilarity,
  dot,
  norm,
  scale,
  subtract,
} from "../shared/linear-algebra.js";
import { isMechanismDisabled, Mechanism } from "./ablation.js";

// ── Configuration ─────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/separation_core.py:42-55

/** Cosine similarity threshold above which two memories need separation.
 * Engineering choice — tuned empirically for 384-dim dense embeddings.
 * source: cortex@ed33435 mcp_server/core/separation_core.py:42-43
 */
const SEPARATION_THRESHOLD = 0.75;

/** Deduplication boundary. Above this cosine similarity, memories are
 * treated as near-duplicates (handled by dedup, not separation).
 * source: cortex@ed33435 mcp_server/core/separation_core.py:46-47
 */
const IDENTITY_THRESHOLD = 0.95;

/** Floor for post-separation similarity with the original embedding,
 * preventing orthogonalization from destroying semantic content.
 * source: cortex@ed33435 mcp_server/core/separation_core.py:50-51
 */
const MIN_POST_SEPARATION_SIMILARITY = 0.3;

/** DG granule cell activation sparsity: 2-5% of cells active.
 * Leutgeb et al. (2007) Science 315:961-966; Rolls (2013) Front Syst Neurosci.
 * We use 4% as the midpoint of the published range.
 * source: cortex@ed33435 mcp_server/core/separation_core.py:53-55
 */
const SPARSITY_TARGET = 0.04;

// ── Interference Detection ────────────────────────────────────────────────

/**
 * Detect which existing memories create interference risk for a new memory.
 *
 * Returns indices and similarities of memories that are similar enough to
 * interfere but not identical (those are duplicates, not interference).
 *
 * precondition:  newEmbedding and existingEmbeddings have the same dimension.
 * postcondition: returned pairs are sorted by similarity descending;
 *   every pair (i, sim) satisfies threshold <= sim < identityThreshold.
 *
 * source: cortex@ed33435 mcp_server/core/separation_core.py:61-82
 */
export function detectInterferenceRisk(
  newEmbedding: number[],
  existingEmbeddings: number[][],
  threshold = SEPARATION_THRESHOLD,
  identityThreshold = IDENTITY_THRESHOLD,
): Array<[number, number]> {
  const risks: Array<[number, number]> = [];
  for (let i = 0; i < existingEmbeddings.length; i++) {
    const existing = existingEmbeddings[i];
    if (!existing) continue;
    const sim = cosineSimilarity(newEmbedding, existing);
    if (sim >= threshold && sim < identityThreshold) {
      risks.push([i, sim]);
    }
  }
  risks.sort(([, a], [, b]) => b - a);
  return risks;
}

// ── Orthogonalization ─────────────────────────────────────────────────────

/**
 * Project result away from a single interferer, preserving semantic content.
 *
 * Returns the updated result vector, or the original result if the
 * projection would violate the minimum similarity constraint.
 *
 * source: cortex@ed33435 mcp_server/core/separation_core.py:88-117
 */
function projectAwayFromSingle(
  result: number[],
  interferer: number[],
  original: number[],
  strength: number,
  minSimilarity: number,
): number[] {
  const interfererNorm = norm(interferer);
  if (interfererNorm < 1e-10) return result;

  const projectionCoeff = dot(result, interferer) / (interfererNorm * interfererNorm);
  const projection = scale(interferer, projectionCoeff * strength);
  const candidate = subtract(result, projection);

  const candidateNorm = norm(candidate);
  if (candidateNorm < 1e-10) return result;

  const normalized = scale(candidate, 1.0 / candidateNorm);
  const simWithOriginal = cosineSimilarity(original, normalized);
  if (simWithOriginal >= minSimilarity) return normalized;
  return result;
}

/**
 * Normalize to unit length if non-degenerate.
 * source: cortex@ed33435 mcp_server/core/separation_core.py:120-125
 */
function normalizeResult(result: number[]): number[] {
  const resultNorm = norm(result);
  if (resultNorm > 1e-10) return scale(result, 1.0 / resultNorm);
  return result;
}

/**
 * Orthogonalize a new embedding away from interfering memories.
 *
 * Uses a Gram-Schmidt-like projection: subtract the component of the new
 * embedding that lies in the subspace spanned by interfering memories.
 * Strength controls how aggressively we separate (0=no change,
 * 1=full orthogonalization).
 *
 * precondition:  newEmbedding and interferingEmbeddings have the same dimension.
 *   strength ∈ [0, 1]; minSimilarity ∈ [0, 1].
 * postcondition: returned [embedding, separationIndex] where:
 *   separationIndex = 1 - cosine_similarity(original, orthogonalized) ∈ [0, 1].
 *   Returns input unchanged when PATTERN_SEPARATION is ablated.
 *
 * source: cortex@ed33435 mcp_server/core/separation_core.py:128-166
 */
export function orthogonalizeEmbedding(
  newEmbedding: number[],
  interferingEmbeddings: number[][],
  strength = 0.5,
  minSimilarity = MIN_POST_SEPARATION_SIMILARITY,
): [number[], number] {
  if (isMechanismDisabled(Mechanism.PATTERN_SEPARATION)) {
    return [[...newEmbedding], 0.0];
  }
  if (interferingEmbeddings.length === 0) {
    return [[...newEmbedding], 0.0];
  }

  let result = [...newEmbedding];
  const dim = result.length;

  for (const interferer of interferingEmbeddings) {
    if (interferer.length !== dim) continue;
    result = projectAwayFromSingle(result, interferer, newEmbedding, strength, minSimilarity);
  }

  result = normalizeResult(result);
  const separationIndex = 1.0 - cosineSimilarity(newEmbedding, result);
  return [result, Math.max(0.0, separationIndex)];
}

// ── Sparsification ────────────────────────────────────────────────────────

/**
 * Apply DG-like sparsification to an embedding.
 *
 * Zeroes out the smallest dimensions to achieve target sparsity.
 * This simulates the DG's sparse activation pattern where only a few
 * percent of granule cells are active.
 *
 * Note: this is a lossy operation. The caller should store the original
 * embedding for later reference.
 *
 * precondition:  embedding is a non-empty float array; sparsity ∈ (0, 1].
 * postcondition: returned array has same length; non-zero entries normalized
 *   to unit length; at most ceil(dim * sparsity) non-zero entries.
 *
 * source: cortex@ed33435 mcp_server/core/separation_core.py:172-202
 *   sparsity default = 0.04 (4% — Leutgeb et al. 2007 midpoint)
 */
export function applySparsification(
  embedding: number[],
  sparsity = SPARSITY_TARGET,
): number[] {
  const dim = embedding.length;
  const k = Math.max(1, Math.floor(dim * sparsity));

  const indexed = embedding.map((v, i) => [Math.abs(v), i] as [number, number]);
  indexed.sort(([a], [b]) => b - a);
  const keepIndices = new Set(indexed.slice(0, k).map(([, i]) => i));

  const result = embedding.map((v, i) => keepIndices.has(i) ? v : 0.0);

  const resultNorm = norm(result);
  if (resultNorm > 1e-10) {
    return result.map((v) => v / resultNorm);
  }
  return result;
}

// Re-export thresholds for testing
export { SEPARATION_THRESHOLD, IDENTITY_THRESHOLD, MIN_POST_SEPARATION_SIMILARITY, SPARSITY_TARGET };
