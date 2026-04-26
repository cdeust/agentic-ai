/**
 * Neurogenesis analog and separation metrics.
 *
 * Simulates adult neurogenesis: new "neurons" (embedding dimensions) are
 * hyperexcitable initially and gradually mature, creating temporal context
 * signals for natural temporal clustering. Also provides separation metrics
 * for monitoring pattern separation effectiveness.
 *
 * // source: Aimone JB et al. (2011) Resolving new memories: DG, neurogenesis, and
 *   pattern separation. Neuron 70:589-596.
 * // source: Cognitive Neurodynamics (2025) Dynamic impact of adult neurogenesis
 *   on pattern separation in the DG neural network.
 *
 * Port of: mcp_server/core/neurogenesis.py
 * Pure business logic — no I/O.
 */

import { cosineSimilarity, norm, scale } from "../shared/linear-algebra.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const NEUROGENESIS_BOOST = 0.3;
const SEPARATION_THRESHOLD = 0.75;

// ── Temporal Separation Weights ───────────────────────────────────────────────

function computeBoostMagnitude(
  hoursSinceCreation: number,
  maturationHours: number,
  boost: number,
): number {
  const maturity = 1.0 - Math.exp(-hoursSinceCreation / maturationHours);
  const immaturity = 1.0 - maturity;
  return boost * immaturity;
}

function applyDimensionBoosts(
  weights: number[],
  hoursSinceCreation: number,
  boostMagnitude: number,
): void {
  const embeddingDim = weights.length;
  const timeBucket = Math.floor(hoursSinceCreation / 6.0);
  const boostedStart = (timeBucket * 7) % embeddingDim;
  const boostedCount = Math.max(1, Math.floor(embeddingDim * 0.1));

  for (let i = 0; i < boostedCount; i++) {
    const dimIdx = (boostedStart + i) % embeddingDim;
    weights[dimIdx] = 1.0 + boostMagnitude;
  }
}

/**
 * Compute dimension-specific weights for temporal pattern separation.
 *
 * Simulates adult neurogenesis: new "neurons" are hyperexcitable initially
 * and gradually mature. Recent memories get boosted on a rotating subset
 * of dimensions (temporal hash), creating natural temporal clustering.
 *
 * // source: Aimone JB et al. (2011) Neuron 70:589-596.
 *
 * @param hoursSinceCreation - Age of the memory in hours.
 * @param embeddingDim       - Dimensionality of embeddings.
 * @param boost              - How much extra weight new dimensions get.
 * @param maturationHours    - How long until neurogenesis boost fades.
 * @returns Per-dimension weight vector (length = embeddingDim).
 */
export function computeTemporalSeparationWeights(
  hoursSinceCreation: number,
  embeddingDim: number,
  opts: {
    boost?: number;
    maturationHours?: number;
  } = {},
): number[] {
  const { boost = NEUROGENESIS_BOOST, maturationHours = 48.0 } = opts;

  const boostMagnitude = computeBoostMagnitude(hoursSinceCreation, maturationHours, boost);
  const weights = new Array<number>(embeddingDim).fill(1.0);
  applyDimensionBoosts(weights, hoursSinceCreation, boostMagnitude);
  return weights;
}

/**
 * Apply temporal separation weights to an embedding.
 *
 * Element-wise multiplication followed by renormalization.
 *
 * @returns Temporally-weighted embedding (unit norm).
 */
export function applyTemporalWeights(
  embedding: readonly number[],
  weights: readonly number[],
): number[] {
  if (embedding.length !== weights.length) return Array.from(embedding);

  const weighted = embedding.map((e, i) => e * (weights[i] ?? 1.0));
  const weightedNorm = norm(weighted);
  if (weightedNorm > 1e-10) {
    return scale(weighted, 1.0 / weightedNorm);
  }
  return weighted;
}

// ── Separation Metrics ────────────────────────────────────────────────────────

/**
 * Compute how much an embedding was changed by pattern separation.
 *
 * Returns 0.0 if unchanged, approaches 1.0 if completely orthogonalized.
 */
export function computeSeparationIndex(
  originalEmbedding: readonly number[],
  separatedEmbedding: readonly number[],
): number {
  const sim = cosineSimilarity(originalEmbedding, separatedEmbedding);
  return Math.max(0.0, 1.0 - sim);
}

/**
 * Compute how much interference pressure a memory faces.
 *
 * Returns average similarity to neighbors above threshold, weighted
 * by how far above threshold each neighbor is. Score of 0.0 means
 * no interference pressure.
 */
export function computeInterferenceScore(
  embedding: readonly number[],
  neighborEmbeddings: readonly (readonly number[])[],
  threshold = SEPARATION_THRESHOLD,
): number {
  if (neighborEmbeddings.length === 0) return 0.0;

  const excessSimilarities: number[] = [];
  for (const neighbor of neighborEmbeddings) {
    const sim = cosineSimilarity(embedding, neighbor);
    if (sim > threshold) excessSimilarities.push(sim - threshold);
  }

  if (excessSimilarities.length === 0) return 0.0;

  const avgExcess = excessSimilarities.reduce((s, x) => s + x, 0) / neighborEmbeddings.length;
  return Math.min(1.0, avgExcess / (1.0 - threshold));
}
