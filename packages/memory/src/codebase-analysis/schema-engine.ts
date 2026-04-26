/**
 * Schema engine — matching, accommodation, and evolution of cortical schemas.
 *
 * Ported from mcp_server/core/schema_engine.py
 *
 * Orchestrates the schema lifecycle after formation:
 *   - Matching: compare new memories against existing schemas
 *   - Accommodation: update schemas when assimilation fails (Piaget)
 *   - Revision: detect when a schema needs splitting
 *   - Predictions: generate top-down expectations for predictive coding
 *
 * Re-exports formation/merging/serialization from schema-extraction.ts for
 * backward compatibility.
 *
 * Theoretical basis (all qualitative — no published equations):
 *   Tse D et al. (2007) — Experimental demonstration that prior schemas
 *       accelerate consolidation ~15x in rats. Purely behavioral data;
 *       no mathematical model or equations are provided.
 *   van Kesteren MTR et al. (2012) — Conceptual framework: mPFC-mediated
 *       schema congruency vs MTL-mediated novelty encoding (dual pathway).
 *       Descriptive model with no computational specification.
 *   Piaget J (1952) — Assimilation (fit into existing schema) and
 *       accommodation (modify schema on mismatch) are qualitative
 *       developmental theory, not a computational model.
 *
 * Engineering implementation:
 *   Schema matching uses Jaccard similarity between entity/tag sets —
 *   an engineering choice to operationalize qualitative "congruency."
 *   Accommodation uses EMA updates — a standard signal processing
 *   technique, not derived from any schema paper.
 *   All thresholds are hand-tuned:
 *     _HIGH_MATCH=0.7, _MEDIUM_MATCH=0.3, _MAX_VIOLATIONS=10,
 *     _SCHEMA_EMA_ALPHA=0.1
 *
 * Pure business logic — no I/O.
 */

import type { Schema } from "./types.js";
import { generateLabel, makeSchema } from "./schema-extraction.js";

// ── Configuration ─────────────────────────────────────────────────────────

const _HIGH_MATCH_THRESHOLD = 0.7;
const _MEDIUM_MATCH_THRESHOLD = 0.3;
const _MAX_VIOLATIONS_BEFORE_REVISION = 10;
const _SCHEMA_EMA_ALPHA = 0.1;

// ── Jaccard helper (inline — schema-extraction.ts keeps its own copy) ─────

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

// ── Schema Matching ───────────────────────────────────────────────────────

export function computeSchemaMatch(
  memoryEntities: string[],
  memoryTags: string[],
  schema: Schema,
): number {
  /**
   * Compute how well a new memory matches an existing schema.
   *
   * Uses weighted Jaccard overlap between memory entities/tags and schema
   * signatures. Entities weighted by their schema frequency.
   *
   * Returns:
   *   Match score [0, 1]. >0.7 = strong match, <0.3 = violation.
   */
  if (
    Object.keys(schema.entitySignature).length === 0 &&
    Object.keys(schema.tagSignature).length === 0
  ) {
    return 0;
  }

  const scores: number[] = [];

  if (Object.keys(schema.entitySignature).length > 0) {
    const entityScore = _computeEntityMatch(memoryEntities, schema);
    scores.push(entityScore * 0.7);
  }

  if (Object.keys(schema.tagSignature).length > 0) {
    const tagJaccard = jaccardSimilarity(
      new Set(memoryTags),
      new Set(Object.keys(schema.tagSignature)),
    );
    scores.push(tagJaccard * 0.3);
  }

  return Math.min(1.0, scores.reduce((a, b) => a + b, 0));
}

function _computeEntityMatch(memoryEntities: string[], schema: Schema): number {
  const memoryEntitySet = new Set(memoryEntities);
  const schemaEntities = new Set(Object.keys(schema.entitySignature));

  if (memoryEntitySet.size === 0 && schemaEntities.size === 0) return 0;

  const overlap = [...memoryEntitySet].filter((e) => schemaEntities.has(e));
  const weightedOverlap = overlap.reduce(
    (sum, e) => sum + (schema.entitySignature[e] ?? 0),
    0,
  );
  const totalWeight = Object.values(schema.entitySignature).reduce((a, b) => a + b, 0);
  return weightedOverlap / Math.max(totalWeight, 1e-10);
}

export function classifySchemaMatch(
  matchScore: number,
): "assimilate" | "normal" | "accommodate" {
  /**
   * Classify a schema match score into a consolidation pathway.
   *
   * Returns:
   *   "assimilate" — fast consolidation (schema-consistent)
   *   "normal" — standard hippocampal consolidation
   *   "accommodate" — slow consolidation + schema update signal
   */
  if (matchScore >= _HIGH_MATCH_THRESHOLD) return "assimilate";
  if (matchScore >= _MEDIUM_MATCH_THRESHOLD) return "normal";
  return "accommodate";
}

export function findBestMatchingSchema(
  memoryEntities: string[],
  memoryTags: string[],
  schemas: Schema[],
): [Schema | null, number] {
  /**
   * Find the schema that best matches a new memory.
   *
   * Returns:
   *   [bestSchema, matchScore]. null if no schema scores above 0.1.
   */
  let bestSchema: Schema | null = null;
  let bestScore = 0;

  for (const schema of schemas) {
    const score = computeSchemaMatch(memoryEntities, memoryTags, schema);
    if (score > bestScore) {
      bestScore = score;
      bestSchema = schema;
    }
  }

  if (bestScore < 0.1) return [null, 0];
  return [bestSchema, bestScore];
}

// ── Schema Accommodation (Update) ────────────────────────────────────────

export function accommodateSchema(
  schema: Schema,
  newEntities: string[],
  newTags: string[],
  alpha = _SCHEMA_EMA_ALPHA,
): Schema {
  /**
   * Update a schema via Piaget accommodation using EMA.
   *
   * Gradually shifts the schema's expectations toward new data
   * without catastrophic overwriting.
   *
   * Returns:
   *   Updated schema (new object, original not mutated).
   */
  const updatedEntities = _emaUpdateSignature(
    schema.entitySignature,
    newEntities,
    alpha,
  );
  const updatedTags = _emaUpdateSignature(schema.tagSignature, newTags, alpha);

  return makeSchema({
    ...schema,
    label: generateLabel(updatedEntities, updatedTags),
    entitySignature: updatedEntities,
    tagSignature: updatedTags,
    violationCount: schema.violationCount + 1,
    lastUpdatedHours: 0,
  });
}

function _emaUpdateSignature(
  current: Record<string, number>,
  observed: string[],
  alpha: number,
): Record<string, number> {
  /**
   * EMA update for a frequency signature dict.
   *
   * - Observed items: EMA toward 1.0, or introduced at alpha.
   * - Unobserved items: decay by alpha * 0.5, pruned below 0.05.
   */
  const updated = { ...current };
  const observedSet = new Set(observed);

  for (const item of observed) {
    if (item in updated) {
      updated[item] = (1 - alpha) * updated[item]! + alpha * 1.0;
    } else {
      updated[item] = alpha;
    }
  }

  for (const item of Object.keys(updated)) {
    if (!observedSet.has(item)) {
      updated[item] = updated[item]! * (1 - alpha * 0.5);
      if (updated[item]! < 0.05) delete updated[item];
    }
  }

  return updated;
}

// ── Schema Revision ──────────────────────────────────────────────────────

export function shouldReviseSchema(schema: Schema): boolean {
  const totalUsage = schema.formationCount + schema.assimilationCount;
  if (totalUsage === 0) return false;
  const violationRatio = schema.violationCount / Math.max(totalUsage, 1);
  return (
    schema.violationCount >= _MAX_VIOLATIONS_BEFORE_REVISION ||
    violationRatio > 0.4
  );
}

// ── Schema Predictions (for Predictive Coding) ───────────────────────────

export function generatePredictions(schema: Schema): Record<string, number> {
  /**
   * Generate top-down predictions from a schema.
   *
   * These are the "expected entities" that the hierarchical predictive
   * coding system (Level 2) uses to compute prediction errors.
   */
  return { ...schema.entitySignature };
}

export function computePredictionError(
  predictions: Record<string, number>,
  observedEntities: string[],
): Record<string, number> {
  /**
   * Compute signed prediction errors between predictions and observations.
   *
   * Positive error: entity was predicted but not observed (missing).
   * Negative error: entity was observed but not predicted (novel).
   */
  const observedSet = new Set(observedEntities);
  const errors: Record<string, number> = {};

  for (const [entity, prob] of Object.entries(predictions)) {
    if (!observedSet.has(entity)) errors[entity] = prob;
  }

  for (const entity of observedEntities) {
    if (!(entity in predictions)) errors[entity] = -0.5;
  }

  return errors;
}

export function computeSchemaFreeEnergy(
  predictionErrors: Record<string, number>,
): number {
  /**
   * Compute schema-level free energy from prediction errors.
   *
   * Free energy = sum of squared prediction errors.
   * High free energy signals the schema needs updating.
   */
  return Object.values(predictionErrors).reduce((sum, e) => sum + e * e, 0);
}
