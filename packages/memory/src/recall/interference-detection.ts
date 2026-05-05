/**
 * Interference detection — proactive and retroactive interference helpers.
 *
 * Computational model:
 *   Norman KA, Newman EL, Detre GJ (2007) "A neural network model of
 *   retrieval-induced forgetting." Psychological Review 114:887-953.
 *
 *   Norman et al. model interference as competition between memory
 *   representations in a leaky competing accumulator (LCA). Proactive
 *   interference arises when strong existing representations (high
 *   activation from prior learning) compete with new encoding. Retroactive
 *   interference arises when new high-activation representations disrupt
 *   access to older, weaker ones.
 *
 *   Our detection functions identify these competitive dynamics using
 *   cosine similarity as a proxy for representational overlap (which
 *   determines the strength of lateral inhibition in the LCA) and
 *   consolidation stage as a proxy for connection strength (which
 *   determines interference resistance in the neural model).
 *
 * Additional references:
 *   Anderson MC, Neely JH (1996) Interference and inhibition in memory
 *   retrieval. — Behavioral framework for retrieval-induced forgetting.
 *   Provides the proactive/retroactive distinction used here.
 *
 *   Wixted JT (2004) The psychology and neuroscience of forgetting.
 *   — Review article; no equations. Cited for conceptual context on
 *   the interference vs. decay debate.
 *
 * Port of: mcp_server/core/interference_detection.py
 * Pure business logic — no I/O.
 */

import { cosineSimilarity } from "../shared/linear-algebra.js";
import { jaccardSimilarity } from "../shared/similarity.js";
import { computeInterferenceResistance } from "../consolidation/cascade-stages.js";

// ── Configuration ────────────────────────────────────────────────────────────
// All constants are hand-tuned for this system's operating regime.
// No direct mapping to Norman et al. 2007's neural model parameters.

/** Cosine similarity above which two memories are considered interfering. Hand-tuned. */
const INTERFERENCE_THRESHOLD = 0.7;

/**
 * Discount applied when memories are in different directory contexts.
 * Models context-dependent interference: memories encoded in different
 * contexts interfere less (consistent with Anderson & Neely 1996's
 * context-based accounts). Hand-tuned.
 */
const CONTEXT_DISCOUNT = 0.3;

/**
 * Score above which interference is considered critical, triggering
 * aggressive resolution (pattern separation or memory protection).
 * Hand-tuned.
 */
const CRITICAL_INTERFERENCE = 0.85;

// ── Resolution Hints ─────────────────────────────────────────────────────────

function suggestPiResolution(score: number, similarity: number, stage: string): string {
  // precondition: score in [0,1], stage is a known consolidation stage name
  // postcondition: returns one of the four resolution strategy strings
  if (score >= CRITICAL_INTERFERENCE) return "pattern_separation";
  if (similarity > 0.9) return "merge_or_update";
  if (stage === "consolidated") return "context_binding";
  return "normal_encoding";
}

function suggestRiResolution(score: number, stage: string, heat: number): string {
  // postcondition: returns one of the four resolution strategy strings
  if (score >= CRITICAL_INTERFERENCE) return "protect_old_memory";
  if (stage === "labile" || stage === "early_ltp") return "accelerate_consolidation";
  if (heat < 0.2) return "accept_overwrite";
  return "orthogonalize_at_sleep";
}

// ── Proactive Interference ───────────────────────────────────────────────────

function computePiScore(
  sim: number,
  entityOverlap: number,
  heatFactor: number,
  stage: string,
  contextMatch: number,
): number {
  /**
   * Weighted combination of similarity (representational overlap),
   * entity overlap (semantic relatedness), heat (recent activation
   * strength), and consolidation stage (connection strength). Weights
   * are hand-tuned; the relative ordering (similarity > entities >
   * heat > stage) reflects Norman et al. 2007's emphasis on
   * representational overlap as the primary driver of competition.
   *
   * Stage factors approximate interference resistance from consolidation:
   *   consolidated: 1.2 — strong prior representations compete more
   *   late_ltp: 1.0 — baseline
   *   early_ltp: 0.8 — partially consolidated, moderate competition
   *   labile: 0.5 — weakly encoded, minimal proactive effect
   * All stage factors are hand-tuned.
   */
  const stageFactors: Record<string, number> = {
    consolidated: 1.2,
    late_ltp: 1.0,
    early_ltp: 0.8,
    labile: 0.5,
  };
  const stageFactor = stageFactors[stage] ?? 0.7;

  return (
    (sim * 0.4 + entityOverlap * 0.25 + heatFactor * 0.2 + stageFactor * 0.15) *
    contextMatch
  );
}

function computePiContextMatch(mem: Record<string, unknown>, newDirectory?: string): number {
  /**
   * Context discount: different directories reduce interference.
   * Models context-dependent interference (Anderson & Neely 1996):
   * memories encoded in different working contexts interfere less.
   * Discount factor is hand-tuned.
   */
  const dirCtx = mem["directory_context"] as string | undefined;
  const memNewDir = (newDirectory ?? (mem["new_directory"] as string | undefined)) ?? "";
  if (dirCtx && dirCtx !== memNewDir) {
    return 1.0 - CONTEXT_DISCOUNT;
  }
  return 1.0;
}

function buildPiResult(
  mem: Record<string, unknown>,
  sim: number,
  entityOverlap: number,
  score: number,
  stage: string,
): Record<string, unknown> {
  return {
    memory_id: mem["id"],
    similarity: Math.round(sim * 10000) / 10000,
    entity_overlap: Math.round(entityOverlap * 10000) / 10000,
    interference_score: Math.round(score * 10000) / 10000,
    interference_type: "proactive",
    resolution_hint: suggestPiResolution(score, sim, stage),
  };
}

function evaluatePiCandidate(
  mem: Record<string, unknown>,
  newEmbedding: number[],
  newEntitySet: Set<string>,
  threshold: number,
): Record<string, unknown> | null {
  const emb = mem["embedding"] as number[] | null | undefined;
  if (!emb || emb.length !== newEmbedding.length) return null;

  const sim = cosineSimilarity(newEmbedding, emb);
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
  if (score < threshold * 0.7) return null;

  return buildPiResult(mem, sim, entityOverlap, score, stage);
}

/**
 * Detect old memories that may interfere with encoding a new memory.
 *
 * Proactive interference (Anderson & Neely 1996) occurs when existing
 * high-activation memories compete with the new memory for the same
 * representational space. In Norman et al. 2007's LCA model, this
 * corresponds to strong prior patterns suppressing the new pattern
 * through lateral inhibition during the high-g phase.
 *
 * @param newMemoryEmbedding - Embedding of the incoming memory.
 * @param newMemoryEntities - Entities in the incoming memory.
 * @param existingMemories - List of memory objects with embedding, entities, heat,
 *   id, directory_context, consolidation_stage.
 * @param threshold - Similarity threshold for interference (hand-tuned).
 * @returns List of interference descriptors, sorted by severity.
 *
 * Precondition: newMemoryEmbedding is a non-empty vector of finite floats.
 * Postcondition: result is sorted descending by interference_score.
 */
export function detectProactiveInterference(
  newMemoryEmbedding: number[],
  newMemoryEntities: string[],
  existingMemories: Record<string, unknown>[],
  threshold: number = INTERFERENCE_THRESHOLD,
): Record<string, unknown>[] {
  const newEntitySet = new Set<string>(newMemoryEntities);
  const interferences: Record<string, unknown>[] = [];

  for (const mem of existingMemories) {
    const result = evaluatePiCandidate(mem, newMemoryEmbedding, newEntitySet, threshold);
    if (result !== null) {
      interferences.push(result);
    }
  }

  interferences.sort(
    (a, b) => (b["interference_score"] as number) - (a["interference_score"] as number),
  );
  return interferences;
}

// ── Retroactive Interference ─────────────────────────────────────────────────

function computeVulnerability(
  oldStage: string,
  sim: number,
  oldHeat: number,
  oldImportance: number,
): number {
  /**
   * In Norman et al. 2007, weakly encoded patterns (low connection
   * strength) are most susceptible to interference from new, strongly
   * activated patterns. We model this through consolidation stage
   * (resistance), heat (activation recency), and importance (encoding
   * strength). The formula: (1 - resistance) * (1 - heat_boost) *
   * (1 - importance_boost). All scaling factors are hand-tuned.
   */
  const resistance = computeInterferenceResistance(oldStage, sim);
  return (1.0 - resistance) * (1.0 - oldHeat * 0.5) * (1.0 - oldImportance * 0.3);
}

function evaluateRiCandidate(
  mem: Record<string, unknown>,
  newEmbedding: number[],
  newImportance: number,
  threshold: number,
): Record<string, unknown> | null {
  const emb = mem["embedding"] as number[] | null | undefined;
  if (!emb || emb.length !== newEmbedding.length) return null;

  const sim = cosineSimilarity(newEmbedding, emb);
  if (sim < threshold) return null;

  const oldHeat = (mem["heat"] as number | undefined) ?? 0.5;
  const oldImportance = (mem["importance"] as number | undefined) ?? 0.5;
  const oldStage = (mem["consolidation_stage"] as string | undefined) ?? "labile";

  const vulnerability = computeVulnerability(oldStage, sim, oldHeat, oldImportance);
  const overwritePressure = newImportance * sim;
  const riskScore = vulnerability * overwritePressure;

  // Hand-tuned threshold: below 0.2 risk is negligible.
  if (riskScore <= 0.2) return null;

  return {
    memory_id: mem["id"],
    similarity: Math.round(sim * 10000) / 10000,
    vulnerability: Math.round(vulnerability * 10000) / 10000,
    overwrite_pressure: Math.round(overwritePressure * 10000) / 10000,
    risk_score: Math.round(riskScore * 10000) / 10000,
    interference_type: "retroactive",
    resolution_hint: suggestRiResolution(riskScore, oldStage, oldHeat),
  };
}

/**
 * Detect old memories at risk of being overwritten by a new memory.
 *
 * Retroactive interference (Anderson & Neely 1996) occurs when a new
 * high-importance memory threatens to corrupt similar existing memories.
 * In Norman et al. 2007's model, this corresponds to new strongly
 * activated patterns suppressing weaker existing patterns through the
 * LCA competition dynamics.
 *
 * @param newMemoryEmbedding - Embedding of the incoming memory.
 * @param newMemoryImportance - Importance of the incoming memory.
 * @param existingMemories - List of memory objects.
 * @param threshold - Similarity threshold for interference (hand-tuned).
 * @returns List of at-risk memories with interference descriptors.
 *
 * Precondition: newMemoryEmbedding is a non-empty vector of finite floats.
 * Postcondition: result is sorted descending by risk_score.
 */
export function detectRetroactiveInterference(
  newMemoryEmbedding: number[],
  newMemoryImportance: number,
  existingMemories: Record<string, unknown>[],
  threshold: number = INTERFERENCE_THRESHOLD,
): Record<string, unknown>[] {
  const atRisk: Record<string, unknown>[] = [];

  for (const mem of existingMemories) {
    const result = evaluateRiCandidate(mem, newMemoryEmbedding, newMemoryImportance, threshold);
    if (result !== null) {
      atRisk.push(result);
    }
  }

  atRisk.sort((a, b) => (b["risk_score"] as number) - (a["risk_score"] as number));
  return atRisk;
}
