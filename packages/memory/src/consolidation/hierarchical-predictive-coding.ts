/**
 * Hierarchical predictive coding — Fristonian multi-level novelty gate.
 *
 * Orchestrates the 3-level predictive hierarchy (sensory, entity, schema)
 * and computes combined free energy as the novelty signal for the write gate.
 *
 * This module composes signals from predictive-coding-signals and gate logic
 * from predictive-coding-gate.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/hierarchical_predictive_coding.py
 *
 * References:
 *   Friston K (2005) A theory of cortical responses. Phil Trans R Soc B 360:815-836
 *   Friston K, Kiebel S (2009) Phil Trans R Soc B 364:1211-1221
 */

import {
  type PredictionLevel,
  type HierarchicalPrediction,
  computeSensoryPrediction,
  computeSensoryErrors,
  computeEntityErrors,
  computeSchemaErrors,
} from "./predictive-coding-signals.js";

import {
  type PrecisionState,
  neuromodulatePrecisions,
} from "./predictive-coding-gate.js";

// ── Level weights ─────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/hierarchical_predictive_coding.py:61

const LEVEL_WEIGHTS: [number, number, number] = [0.30, 0.35, 0.35]; // Sensory, Entity, Schema

// ── ACh-modulated level weights ───────────────────────────────────────────

/**
 * Compute ACh-modulated level weights, normalized to sum to 1.
 *
 * High ACh (encoding): boost L0/L1 (bottom-up), reduce L2.
 * Low ACh (retrieval): boost L2 (top-down), reduce L0/L1.
 *
 * source: cortex@ed33435 mcp_server/core/hierarchical_predictive_coding.py:67-84
 */
function computeAchWeights(achLevel: number): [number, number, number] {
  const achNorm = (achLevel - 0.3) / 0.7;
  let w0 = LEVEL_WEIGHTS[0] * (0.7 + 0.6 * achNorm);
  let w1 = LEVEL_WEIGHTS[1] * (0.7 + 0.6 * achNorm);
  let w2 = LEVEL_WEIGHTS[2] * (1.3 - 0.6 * achNorm);
  const total = w0 + w1 + w2;
  if (total > 0) { w0 /= total; w1 /= total; w2 /= total; }
  return [w0, w1, w2];
}

// ── Precision modulation ──────────────────────────────────────────────────

/**
 * Apply NE/ACh precision gain to each level's free energy in-place.
 * source: cortex@ed33435 mcp_server/core/hierarchical_predictive_coding.py:87-101
 */
function applyPrecisionModulation(
  levels: PredictionLevel[],
  precisionState: PrecisionState,
  neLevel: number,
  achLevel: number,
): void {
  const modulated = neuromodulatePrecisions(precisionState.levelPrecisions, neLevel, achLevel);
  for (let i = 0; i < levels.length; i++) {
    levels[i]!.freeEnergy *= modulated[i] ?? 1.0;
  }
}

// ── Main orchestrator ─────────────────────────────────────────────────────

function computePredictionLevels(
  content: string,
  newEntityNames: string[],
  knownEntityNames: Set<string>,
  recentMemoriesFeatures: Record<string, number>[],
  schemaMatchScore: number,
  schemaFreeEnergy: number,
  schemaPredictions: Record<string, number> | null,
  schemaPrecisions: Record<string, number> | null,
  domainFamiliarity: number,
): [PredictionLevel, PredictionLevel, PredictionLevel] {
  const [sensoryPred, sensoryPrec] = computeSensoryPrediction(recentMemoriesFeatures);
  const level0 = computeSensoryErrors(content, sensoryPred, sensoryPrec);
  const level1 = computeEntityErrors(newEntityNames, knownEntityNames, schemaPredictions, schemaPrecisions);
  const level2 = computeSchemaErrors(schemaMatchScore, schemaFreeEnergy, domainFamiliarity);
  return [level0, level1, level2];
}

function aggregateNovelty(
  levels: [PredictionLevel, PredictionLevel, PredictionLevel],
  achLevel: number,
): [number, number] {
  const [w0, w1, w2] = computeAchWeights(achLevel);
  const totalFe = w0 * levels[0].freeEnergy + w1 * levels[1].freeEnergy + w2 * levels[2].freeEnergy;
  // source: cortex@ed33435 mcp_server/core/hierarchical_predictive_coding.py:145
  // sigmoid: 1 / (1 + exp(-3 * (fe - 0.5)))
  const novelty = 1.0 / (1.0 + Math.exp(-3.0 * (totalFe - 0.5)));
  return [totalFe, Math.max(0.0, Math.min(1.0, novelty))];
}

/**
 * Run the full hierarchical predictive coding pipeline.
 *
 * precondition:  content is a string; achLevel ∈ [0, 1]; neLevel >= 0.
 * postcondition: returned HierarchicalPrediction has totalFreeEnergy >= 0,
 *   noveltyScore ∈ [0, 1].
 *
 * source: cortex@ed33435 mcp_server/core/hierarchical_predictive_coding.py:149-186
 */
export function computeHierarchicalNovelty(
  content: string,
  newEntityNames: string[],
  knownEntityNames: Set<string>,
  recentMemoriesFeatures: Record<string, number>[],
  opts: {
    schemaMatchScore?: number;
    schemaFreeEnergy?: number;
    schemaPredictions?: Record<string, number> | null;
    schemaPrecisions?: Record<string, number> | null;
    domainFamiliarity?: number;
    achLevel?: number;
    neLevel?: number;
    precisionState?: PrecisionState | null;
  } = {},
): HierarchicalPrediction {
  const {
    schemaMatchScore = 0.0,
    schemaFreeEnergy = 0.0,
    schemaPredictions = null,
    schemaPrecisions = null,
    domainFamiliarity = 0.5,
    achLevel = 0.5,
    neLevel = 1.0,
    precisionState = null,
  } = opts;

  const levels = computePredictionLevels(
    content, newEntityNames, knownEntityNames,
    recentMemoriesFeatures, schemaMatchScore, schemaFreeEnergy,
    schemaPredictions, schemaPrecisions, domainFamiliarity,
  );

  if (precisionState !== null) {
    applyPrecisionModulation(levels, precisionState, neLevel, achLevel);
  }

  const [totalFe, novelty] = aggregateNovelty(levels, achLevel);

  return {
    levels,
    totalFreeEnergy: Math.round(totalFe * 1e6) / 1e6,
    noveltyScore: Math.round(novelty * 1e4) / 1e4,
    gateOpen: false,
    gateReason: "",
  };
}

// Re-exports for backward compatibility (mirrors Python __all__)
export type { PredictionLevel, HierarchicalPrediction, PrecisionState };
export { computeSensoryPrediction, computeSensoryErrors, computeEntityErrors, computeSchemaErrors };
export { neuromodulatePrecisions };
