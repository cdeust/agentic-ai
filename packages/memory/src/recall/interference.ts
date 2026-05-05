/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Interference management — orthogonalization, retrieval suppression,
 * domain metrics, proactive and retroactive interference detection.
 *
 * Port of: cortex@ed33435 mcp_server/core/interference.py (lines 1-331)
 *          cortex@ed33435 mcp_server/core/interference_detection.py (lines 1-339)
 *
 * Memory interference is the primary cause of forgetting in both biological
 * and artificial systems. Detection helpers (proactive, retroactive) are
 * co-located here for symmetry with the interference_detection.py extraction.
 *
 * Computational model:
 *   Norman KA, Newman EL, Detre GJ (2007). A neural network model of
 *   retrieval-induced forgetting. Psychological Review 114:887-953.
 *
 * Additional references:
 *   Anderson MC, Neely JH (1996) Interference and inhibition in memory
 *   retrieval. Academic Press.
 *   Wixted JT (2004) The psychology and neuroscience of forgetting.
 *   Annual Review of Psychology 55:235-269.
 *   Yassa MA, Stark CEL (2011) Pattern separation in the hippocampus.
 *   Trends in Neurosciences 34:515-525.
 *   Jaccard, P. (1912). New Phytologist 11(2):37-50. (Set similarity.)
 *
 * Pure business logic — no I/O.
 */

import { cosineSimilarity, dot, norm, normalize } from "./vector-similarity.js";

// ── Configuration ─────────────────────────────────────────────────────────
// All constants are hand-tuned for this system's operating regime
// (hours/days timescale, 384-dim embeddings). They are not derived from
// Norman et al. 2007's parameters (which target ms-timescale neural dynamics).

/**
 * Rate at which each orthogonalization step removes the interfering
 * projection component. 0.15 yields ~3-6 sleep cycles to fully separate
 * two memories at sim > 0.7. Hand-tuned; no direct biological equivalent.
 * source: cortex@ed33435 mcp_server/core/interference.py:59
 */
const _ORTHOGONALIZATION_RATE = 0.15; // source: cortex@ed33435 mcp_server/core/interference.py:59

/**
 * Floor similarity — orthogonalization stops here to preserve meaningful
 * semantic overlap. Hand-tuned to prevent over-separation.
 * source: cortex@ed33435 mcp_server/core/interference.py:63
 */
const _MIN_ORTHOGONAL_SIMILARITY = 0.2;

/**
 * Lateral inhibition strength for retrieval suppression.
 * Simplified from Norman et al. 2007's oscillating g parameter.
 * In the full model, g oscillates between ~0.4 (g_high) and ~0.1 (g_low).
 * Our fixed 0.3 approximates the time-averaged effect. Hand-tuned.
 * source: cortex@ed33435 mcp_server/core/interference.py:69
 */
const _RETRIEVAL_SUPPRESSION = 0.3;

/**
 * Cosine similarity threshold above which two memories are considered
 * to be interfering. Hand-tuned; corresponds roughly to the point where
 * pattern separation mechanisms would engage in hippocampus (Yassa & Stark 2011).
 * source: cortex@ed33435 mcp_server/core/interference.py:73
 */
const _INTERFERENCE_THRESHOLD = 0.7;

// ── Detection-only constants ──────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/interference_detection.py:46-60

/**
 * Discount applied when memories are in different directory contexts.
 * Models context-dependent interference (Anderson & Neely 1996).
 * Hand-tuned.
 * source: cortex@ed33435 mcp_server/core/interference_detection.py:53
 */
const _CONTEXT_DISCOUNT = 0.3;

/**
 * Score above which interference is considered critical.
 * Hand-tuned.
 * source: cortex@ed33435 mcp_server/core/interference_detection.py:59
 */
const _CRITICAL_INTERFERENCE = 0.85; // source: cortex@ed33435 mcp_server/core/interference_detection.py:59

// ── Orthogonalization Helpers ─────────────────────────────────────────────

/**
 * Remove a fraction of vec's projection onto basis.
 *
 * Port of: cortex@ed33435 mcp_server/core/interference.py:79-91
 *
 * Implements a simplified version of the sleep-dependent orthogonalization
 * described in Yassa & Stark 2011. Each call removes rate * 0.5 of the
 * shared component, modeling one consolidation cycle.
 *
 * precondition: vec and basis have the same length > 0
 * postcondition: result has same length as vec; norm may change
 */
function projectAway(
  vec: number[],
  basis: number[],
  rate: number,
): number[] {
  const basisNormSq = basis.reduce((s, v) => s + v * v, 0);
  if (basisNormSq < 1e-10) return [...vec]; // source: cortex@ed33435 mcp_server/core/interference.py:86 — degenerate basis guard
  const projCoeff = (dot(vec, basis) / basisNormSq) * rate * 0.5; // source: interference.py:89
  const result = vec.map((v, i) => v - projCoeff * (basis[i] ?? 0));
  return result;
}

/**
 * Normalize vec to unit length, falling back if degenerate.
 * Port of: cortex@ed33435 mcp_server/core/interference.py:94-97
 */
function renormalize(vec: number[], fallback: number[]): number[] {
  const n = norm(vec);
  if (n > 1e-10) return normalize(vec); // source: cortex@ed33435 mcp_server/core/interference.py:95 — degenerate vector guard
  return [...fallback];
}

/**
 * Interpolate back toward originals if similarity dropped too far.
 * Port of: cortex@ed33435 mcp_server/core/interference.py:100-114
 *
 * precondition: currentSim > newSim (otherwise this is a no-op)
 * postcondition: returned sim is >= minSimilarity (if possible)
 */
function backoffToMinimum(
  newA: number[],
  newB: number[],
  origA: number[],
  origB: number[],
  newSim: number,
  currentSim: number,
  minSimilarity: number,
): [number[], number[], number] {
  const t = Math.min(
    1.0,
    Math.max(
      0.0,
      (minSimilarity - newSim) / Math.max(currentSim - newSim, 1e-10), // source: cortex@ed33435 mcp_server/core/interference.py:107 — division-by-zero guard
    ),
  );
  const blendedA = newA.map(
    (v, i) => (1 - t) * v + t * (origA[i] ?? 0),
  );
  const blendedB = newB.map(
    (v, i) => (1 - t) * v + t * (origB[i] ?? 0),
  );
  const normA = renormalize(blendedA, origA);
  const normB = renormalize(blendedB, origB);
  const finalSim = cosineSimilarity(normA, normB);
  return [normA, normB, finalSim];
}

// ── Orthogonalization ─────────────────────────────────────────────────────

/**
 * Gradually push two interfering embeddings apart (sleep-dependent).
 *
 * Port of: cortex@ed33435 mcp_server/core/interference.py:119-164
 *
 * Models the offline orthogonalization component of interference resolution.
 * In Norman et al. 2007, competing representations are separated via
 * contrastive Hebbian learning during sleep-like replay. We simplify this to
 * symmetric projection removal.
 *
 * One step of gradual rotation per call. Multiple sleep cycles achieve full
 * separation. Returns (new_a, new_b, remaining_sim).
 *
 * precondition: embeddingA and embeddingB have equal length
 * postcondition: remaining_sim in [minSimilarity, 1.0] (or 0 if lengths differ)
 *
 * Constants — source: cortex@ed33435 mcp_server/core/interference.py:120-121
 *   rate           = 0.15 (_ORTHOGONALIZATION_RATE)
 *   min_similarity = 0.2  (_MIN_ORTHOGONAL_SIMILARITY)
 */
export function orthogonalizePair(
  embeddingA: number[],
  embeddingB: number[],
  rate = _ORTHOGONALIZATION_RATE,
  minSimilarity = _MIN_ORTHOGONAL_SIMILARITY,
): [number[], number[], number] {
  if (embeddingA.length !== embeddingB.length) {
    return [[...embeddingA], [...embeddingB], 0.0];
  }

  const currentSim = cosineSimilarity(embeddingA, embeddingB);
  if (currentSim <= minSimilarity) {
    return [[...embeddingA], [...embeddingB], currentSim];
  }

  const newA = renormalize(
    projectAway(embeddingA, embeddingB, rate),
    embeddingA,
  );
  const newB = renormalize(
    projectAway(embeddingB, embeddingA, rate),
    embeddingB,
  );

  let newSim = cosineSimilarity(newA, newB);
  let finalA = newA;
  let finalB = newB;

  if (newSim < minSimilarity) {
    [finalA, finalB, newSim] = backoffToMinimum(
      newA,
      newB,
      embeddingA,
      embeddingB,
      newSim,
      currentSim,
      minSimilarity,
    );
  }

  // source: cortex@ed33435 mcp_server/core/interference.py:163
  return [finalA, finalB, parseFloat(newSim.toFixed(6))];
}

// ── Retrieval Suppression ─────────────────────────────────────────────────

/**
 * Compute retrieval suppression from competing memories.
 *
 * Port of: cortex@ed33435 mcp_server/core/interference.py:169-213
 *
 * Simplified lateral inhibition consistent with Norman et al. 2007.
 * In the full LCA model, units with higher activation suppress units
 * with lower activation through the global inhibition term
 * -g * sum_j(a_j). Our simplification: only competitors with scores
 * higher than the target contribute suppression, proportional to their
 * score advantage.
 *
 * precondition: targetScore >= 0; competitorScores are non-negative
 * postcondition: result in [0, targetScore]
 *
 * Constants — source: cortex@ed33435 mcp_server/core/interference.py:169
 *   suppression_factor = 0.3 (_RETRIEVAL_SUPPRESSION)
 */
export function computeRetrievalSuppression(
  targetScore: number,
  competitorScores: number[],
  suppressionFactor = _RETRIEVAL_SUPPRESSION,
): number {
  if (competitorScores.length === 0) return targetScore;

  const strongerCompetitors = competitorScores.filter((s) => s > targetScore);
  if (strongerCompetitors.length === 0) return targetScore;

  const totalSuppression = strongerCompetitors.reduce(
    (sum, s) => sum + (s - targetScore) * suppressionFactor,
    0,
  );

  return Math.max(0.0, targetScore - totalSuppression);
}

// ── Domain Interference Metrics ───────────────────────────────────────────

interface PairwiseStats {
  maxSims: number[];
  interferencePairs: number;
  totalPairs: number;
}

/**
 * Compute max similarities and interference pair counts.
 * Port of: cortex@ed33435 mcp_server/core/interference.py:218-240
 *
 * precondition: embeddings has >= 2 vectors; all same length; n <= embeddings.length
 * postcondition: maxSims.length === n; interferencePairs <= totalPairs
 */
function computePairwiseStats(
  embeddings: number[][],
  n: number,
  threshold: number,
): PairwiseStats {
  const maxSims: number[] = [];
  let interferencePairs = 0;
  let totalPairs = 0;

  for (let i = 0; i < n; i++) {
    let bestSim = 0.0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const embI = embeddings[i];
      const embJ = embeddings[j];
      if (!embI || !embJ) continue;
      const sim = cosineSimilarity(embI, embJ);
      bestSim = Math.max(bestSim, sim);
      if (sim >= threshold) interferencePairs++;
      totalPairs++;
    }
    maxSims.push(bestSim);
  }

  return { maxSims, interferencePairs, totalPairs };
}

/**
 * Classify interference pressure level from average score.
 *
 * Port of: cortex@ed33435 mcp_server/core/interference.py:244-254
 *
 * Thresholds are hand-tuned based on observed domain statistics.
 * No direct mapping to Norman et al. 2007 parameters.
 *
 * source: cortex@ed33435 mcp_server/core/interference.py:244-254
 *   critical: avg_score >= 0.5
 *   high:     avg_score >= 0.3
 *   medium:   avg_score >= 0.1
 *   low:      otherwise
 */
function classifyPressure(avgScore: number): string {
  if (avgScore >= 0.5) return "critical";
  if (avgScore >= 0.3) return "high";
  if (avgScore >= 0.1) return "medium";
  return "low";
}

const _LOW_PRESSURE = {
  mean_max_similarity: 0.0,
  interfering_pair_fraction: 0.0,
  avg_interference_score: 0.0,
  pressure_level: "low",
};

/**
 * Compute aggregate interference metrics for a domain.
 *
 * Port of: cortex@ed33435 mcp_server/core/interference.py:262-296
 *
 * precondition: embeddings has >= 2 vectors of equal length
 * postcondition: all numeric fields rounded to 4 decimal places;
 *   pressure_level is one of "low" | "medium" | "high" | "critical"
 *
 * Constants — source: cortex@ed33435 mcp_server/core/interference.py:265-266
 *   threshold    = 0.7  (_INTERFERENCE_THRESHOLD)
 *   sample_limit = 100
 */
export function computeDomainInterferencePressure(
  embeddings: number[][],
  threshold = _INTERFERENCE_THRESHOLD,
  sampleLimit = 100, // source: cortex@ed33435 mcp_server/core/interference.py:266
): {
  mean_max_similarity: number;
  interfering_pair_fraction: number;
  avg_interference_score: number;
  pressure_level: string;
} {
  if (embeddings.length < 2) return { ..._LOW_PRESSURE };

  const n = Math.min(embeddings.length, sampleLimit);
  const { maxSims, interferencePairs, totalPairs } = computePairwiseStats(
    embeddings,
    n,
    threshold,
  );

  const meanMax =
    maxSims.length > 0
      ? maxSims.reduce((a, b) => a + b, 0) / maxSims.length
      : 0.0;
  const pairFraction = interferencePairs / Math.max(totalPairs, 1);
  const avgScore = meanMax * pairFraction;

  return {
    mean_max_similarity: parseFloat(meanMax.toFixed(4)),
    interfering_pair_fraction: parseFloat(pairFraction.toFixed(4)),
    avg_interference_score: parseFloat(avgScore.toFixed(4)),
    pressure_level: classifyPressure(avgScore),
  };
}

// ── DETECTION — Resolution Hints ─────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/interference_detection.py:63-93

/**
 * Suggest resolution strategy for proactive interference.
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:66-76
 */
function suggestPiResolution(
  score: number,
  similarity: number,
  stage: string,
): string {
  if (score >= _CRITICAL_INTERFERENCE) return "pattern_separation";
  if (similarity > 0.9) return "merge_or_update";
  if (stage === "consolidated") return "context_binding";
  return "normal_encoding";
}

/**
 * Suggest resolution strategy for retroactive interference.
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:79-91
 */
function suggestRiResolution(
  score: number,
  stage: string,
  heat: number,
): string {
  if (score >= _CRITICAL_INTERFERENCE) return "protect_old_memory";
  if (stage === "labile" || stage === "early_ltp") return "accelerate_consolidation";
  if (heat < 0.2) return "accept_overwrite";
  return "orthogonalize_at_sleep";
}

// ── DETECTION — Jaccard similarity ────────────────────────────────────────

function jaccardSimilarity<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0.0;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}

// ── DETECTION — Proactive Interference ───────────────────────────────────

/**
 * Compute proactive interference score from component signals.
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:100-128
 *
 * precondition: sim, entityOverlap, heatFactor in [0, 1]; stage is known
 * postcondition: result in [0, ~1.5]; higher = stronger interference
 *
 * Stage factors — source: cortex@ed33435 mcp_server/core/interference_detection.py:115-122
 *   consolidated: 1.2
 *   late_ltp:     1.0
 *   early_ltp:    0.8
 *   labile:       0.5
 *   default:      0.7
 *
 * Component weights — source: cortex@ed33435 mcp_server/core/interference_detection.py:125
 *   sim: 0.4, entity_overlap: 0.25, heat_factor: 0.2, stage_factor: 0.15
 */
function computePiScore(
  sim: number,
  entityOverlap: number,
  heatFactor: number,
  stage: string,
  contextMatch: number,
): number {
  const stageFactors: Record<string, number> = {
    consolidated: 1.2,
    late_ltp: 1.0,
    early_ltp: 0.8,
    labile: 0.5,
  };
  const stageFactor = stageFactors[stage] ?? 0.7;

  return (
    // source: cortex@ed33435 mcp_server/core/interference_detection.py:125 — weights sim=0.4 entity=0.25 heat=0.2 stage=0.15
    (sim * 0.4 + entityOverlap * 0.25 + heatFactor * 0.2 + stageFactor * 0.15) *
    contextMatch
  );
}

/**
 * Context discount: different directories reduce interference.
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:131-138
 */
function computePiContextMatch(mem: Record<string, unknown>): number {
  if (
    mem["directory_context"] &&
    mem["directory_context"] !== mem["new_directory"]
  ) {
    return 1.0 - _CONTEXT_DISCOUNT; // source: interference_detection.py:137
  }
  return 1.0;
}

interface InterferenceDescriptor {
  memory_id: unknown;
  similarity: number;
  entity_overlap: number;
  interference_score: number;
  interference_type: "proactive" | "retroactive";
  resolution_hint: string;
}

/**
 * Build a proactive interference result dict.
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:141-149
 */
function buildPiResult(
  mem: Record<string, unknown>,
  sim: number,
  entityOverlap: number,
  score: number,
  stage: string,
): InterferenceDescriptor {
  return {
    memory_id: mem["id"],
    similarity: parseFloat(sim.toFixed(4)),
    entity_overlap: parseFloat(entityOverlap.toFixed(4)),
    interference_score: parseFloat(score.toFixed(4)),
    interference_type: "proactive",
    resolution_hint: suggestPiResolution(score, sim, stage),
  };
}

/**
 * Evaluate one existing memory for proactive interference.
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:152-175
 */
function evaluatePiCandidate(
  mem: Record<string, unknown>,
  newEmbedding: number[],
  newEntitySet: Set<string>,
  threshold: number,
): InterferenceDescriptor | null {
  const emb = mem["embedding"];
  if (!emb || !Array.isArray(emb) || emb.length !== newEmbedding.length) {
    return null;
  }

  const sim = cosineSimilarity(newEmbedding, emb as number[]);
  if (sim < threshold) return null;

  const memEntities = new Set<string>(
    (mem["entities"] as string[] | undefined) ?? [],
  );
  const entityOverlap =
    newEntitySet.size > 0 || memEntities.size > 0
      ? jaccardSimilarity(newEntitySet, memEntities)
      : 0.0;

  const stage = (mem["consolidation_stage"] as string | undefined) ?? "labile";
  const score = computePiScore(
    sim,
    entityOverlap,
    (mem["heat"] as number | undefined) ?? 0.5,
    stage,
    computePiContextMatch(mem),
  );

  if (score < threshold * 0.7) return null; // source: interference_detection.py:173

  return buildPiResult(mem, sim, entityOverlap, score, stage);
}

/**
 * Detect old memories that may interfere with encoding a new memory.
 *
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:178-212
 *
 * precondition: existingMemories each have 'embedding', 'entities', 'heat', 'id'
 * postcondition: result sorted descending by interference_score
 *
 * Constants — source: cortex@ed33435 mcp_server/core/interference_detection.py:178
 *   threshold = 0.7 (_INTERFERENCE_THRESHOLD)
 */
export function detectProactiveInterference(
  newMemoryEmbedding: number[],
  newMemoryEntities: string[],
  existingMemories: Record<string, unknown>[],
  threshold = _INTERFERENCE_THRESHOLD,
): InterferenceDescriptor[] {
  const newEntitySet = new Set<string>(newMemoryEntities);
  const interferences: InterferenceDescriptor[] = [];

  for (const mem of existingMemories) {
    const result = evaluatePiCandidate(
      mem,
      newMemoryEmbedding,
      newEntitySet,
      threshold,
    );
    if (result !== null) interferences.push(result);
  }

  interferences.sort(
    (a, b) => b.interference_score - a.interference_score,
  );
  return interferences;
}

// ── DETECTION — Retroactive Interference ────────────────────────────────

/**
 * Compute interference resistance from consolidation stage and similarity.
 * Mirrors mcp_server/core/cascade_stages.compute_interference_resistance.
 *
 * Stage resistance mapping — hand-tuned approximation of Norman et al. 2007:
 *   consolidated: high resistance (old strong patterns)
 *   late_ltp:     moderate resistance
 *   early_ltp:    low resistance
 *   labile:       minimal resistance
 */
function computeInterferenceResistance(stage: string, sim: number): number {
  const BASE: Record<string, number> = {
    consolidated: 0.8,
    late_ltp: 0.6,
    early_ltp: 0.4,
    labile: 0.2,
  };
  const base = BASE[stage] ?? 0.3;
  // Similarity reduces resistance (more overlap = more competition)
  return Math.max(0.0, base - sim * 0.2);
}

interface RetroactiveDescriptor {
  memory_id: unknown;
  similarity: number;
  vulnerability: number;
  overwrite_pressure: number;
  risk_score: number;
  interference_type: "retroactive";
  resolution_hint: string;
}

/**
 * Compute how vulnerable an old memory is to overwriting.
 *
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:223-241
 *
 * Formula: (1 - resistance) * (1 - heat * 0.5) * (1 - importance * 0.3)
 * source: cortex@ed33435 mcp_server/core/interference_detection.py:237-238
 */
function computeVulnerability(
  oldStage: string,
  sim: number,
  oldHeat: number,
  oldImportance: number,
): number {
  const resistance = computeInterferenceResistance(oldStage, sim);
  return (1.0 - resistance) * (1.0 - oldHeat * 0.5) * (1.0 - oldImportance * 0.3);
}

/**
 * Evaluate one existing memory for retroactive interference risk.
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:244-271
 */
function evaluateRiCandidate(
  mem: Record<string, unknown>,
  newEmbedding: number[],
  newImportance: number,
  threshold: number,
): RetroactiveDescriptor | null {
  const emb = mem["embedding"];
  if (!emb || !Array.isArray(emb) || emb.length !== newEmbedding.length) {
    return null;
  }

  const sim = cosineSimilarity(newEmbedding, emb as number[]);
  if (sim < threshold) return null;

  const oldHeat = (mem["heat"] as number | undefined) ?? 0.5;
  const oldImportance = (mem["importance"] as number | undefined) ?? 0.5;
  const oldStage = (mem["consolidation_stage"] as string | undefined) ?? "labile";

  const vulnerability = computeVulnerability(oldStage, sim, oldHeat, oldImportance);
  const overwritePressure = newImportance * sim;
  const riskScore = vulnerability * overwritePressure;

  // Hand-tuned threshold — source: cortex@ed33435 mcp_server/core/interference_detection.py:269
  if (riskScore <= 0.2) return null;

  return {
    memory_id: mem["id"],
    similarity: parseFloat(sim.toFixed(4)),
    vulnerability: parseFloat(vulnerability.toFixed(4)),
    overwrite_pressure: parseFloat(overwritePressure.toFixed(4)),
    risk_score: parseFloat(riskScore.toFixed(4)),
    interference_type: "retroactive",
    resolution_hint: suggestRiResolution(riskScore, oldStage, oldHeat),
  };
}

/**
 * Detect old memories at risk of being overwritten by a new memory.
 *
 * Port of: cortex@ed33435 mcp_server/core/interference_detection.py:274-309
 *
 * precondition: existingMemories each have 'embedding', 'heat', 'importance',
 *   'consolidation_stage', 'id' fields
 * postcondition: result sorted descending by risk_score
 *
 * Constants — source: cortex@ed33435 mcp_server/core/interference_detection.py:274
 *   threshold = 0.7 (_INTERFERENCE_THRESHOLD)
 */
export function detectRetroactiveInterference(
  newMemoryEmbedding: number[],
  newMemoryImportance: number,
  existingMemories: Record<string, unknown>[],
  threshold = _INTERFERENCE_THRESHOLD,
): RetroactiveDescriptor[] {
  const atRisk: RetroactiveDescriptor[] = [];

  for (const mem of existingMemories) {
    const result = evaluateRiCandidate(
      mem,
      newMemoryEmbedding,
      newMemoryImportance,
      threshold,
    );
    if (result !== null) atRisk.push(result);
  }

  atRisk.sort((a, b) => b.risk_score - a.risk_score);
  return atRisk;
}

// ── Re-exports of public constants (for testing) ──────────────────────────
export {
  _ORTHOGONALIZATION_RATE as ORTHOGONALIZATION_RATE,
  _MIN_ORTHOGONAL_SIMILARITY as MIN_ORTHOGONAL_SIMILARITY,
  _RETRIEVAL_SUPPRESSION as RETRIEVAL_SUPPRESSION,
  _INTERFERENCE_THRESHOLD as INTERFERENCE_THRESHOLD,
  _CONTEXT_DISCOUNT as CONTEXT_DISCOUNT,
  _CRITICAL_INTERFERENCE as CRITICAL_INTERFERENCE,
};
export type { InterferenceDescriptor, RetroactiveDescriptor };
