/**
 * predictive-coding.ts — Pure novelty-signal computation for the write gate.
 *
 * Ports: core/predictive_coding_flat.py, core/predictive_coding_signals.py,
 *        core/predictive_coding_gate.py
 *
 * Every exported function is pure (no I/O, no module-level mutable state).
 * Invariants are stated in the function contract.
 *
 * References:
 *   Friston K (2005) A theory of cortical responses.
 *       Phil Trans R Soc B 360:815-836
 *   Bastos AM et al. (2012) Canonical microcircuits for predictive coding.
 *       Neuron 76:695-711
 *   Feldman H, Friston K (2010) Attention, uncertainty, and free-energy.
 *       Front Hum Neurosci 4:215
 */

// ── Structural-feature regexes (flat.py lines 19-23) ──────────────────────

const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const FILE_PATH_RE = /(?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.\w+/g;
const URL_RE = /https?:\/\/\S+/g;
const HEADING_RE = /^#{1,6}\s+\S/gm;
const LIST_RE = /^[\s]*[-*+]\s+\S/gm;

// ── Level 0: Embedding novelty ─────────────────────────────────────────────

/**
 * Embedding novelty = 1 - max(similarities).
 *
 * precondition:  similarities is a (possibly empty) list of floats in [0,1].
 * postcondition: returned value in [0, 1].
 *   - 0.5 if no data (prior = "uncertain").
 *   - Closer to 0 when the most similar known memory is very close.
 */
export function computeEmbeddingNovelty(similarities: number[]): number {
  if (similarities.length === 0) return 0.5;
  const maxSim = Math.max(...similarities);
  return Math.max(0.0, Math.min(1.0, 1.0 - maxSim));
}

// ── Level 1: Entity novelty ────────────────────────────────────────────────

/**
 * Fraction of extracted entities that are truly new.
 *
 * precondition:  newEntityNames is a list of entity name strings;
 *                knownEntityNames is the set of names already in the store.
 * postcondition: returned value in [0, 1].
 *   - 0.5 if no entities extracted (prior = "uncertain").
 *   - 1.0 if all entities are new; 0.0 if all are known.
 */
export function computeEntityNovelty(
  newEntityNames: string[],
  knownEntityNames: Set<string>,
): number {
  if (newEntityNames.length === 0) return 0.5;
  const trulyNew = newEntityNames.filter((e) => !knownEntityNames.has(e));
  return trulyNew.length / newEntityNames.length;
}

// ── Level 2: Temporal novelty ──────────────────────────────────────────────

/**
 * Temporal novelty via exponential saturation: 1 - exp(-hours/24).
 *
 * precondition:  hoursSinceSimilar is hours (>=0) or null.
 * postcondition: returned value in [0, 1].
 *   - 0.8 if null (no recent similar memory found — probably novel).
 *   - 0.0 if hoursSinceSimilar == 0 (memory just written).
 *   - Approaches 1.0 asymptotically for large hour values.
 */
export function computeTemporalNovelty(
  hoursSinceSimilar: number | null,
): number {
  if (hoursSinceSimilar === null) return 0.8;
  if (hoursSinceSimilar <= 0) return 0.0;
  return Math.min(1.0, 1.0 - Math.exp(-hoursSinceSimilar / 24.0));
}

// ── Level 3: Structural novelty ────────────────────────────────────────────

interface StructuralFeatures {
  codeBlocks: number;
  fileRefs: number;
  urls: number;
  headings: number;
  listItems: number;
  lengthBucket: number; // 0..4
}

function extractStructuralFeatures(content: string): StructuralFeatures {
  const n = Math.max(content.length, 1);
  let lengthBucket: number;
  if (n < 100) lengthBucket = 0;
  else if (n < 500) lengthBucket = 1;
  else if (n < 2000) lengthBucket = 2;
  else if (n < 8000) lengthBucket = 3;
  else lengthBucket = 4;

  return {
    codeBlocks: (content.match(CODE_BLOCK_RE) ?? []).length,
    fileRefs: (content.match(FILE_PATH_RE) ?? []).length,
    urls: (content.match(URL_RE) ?? []).length,
    headings: (content.match(HEADING_RE) ?? []).length,
    listItems: (content.match(LIST_RE) ?? []).length,
    lengthBucket,
  };
}

/**
 * Structural novelty by comparing document shape to recent memories.
 *
 * precondition:  recentContents is a list of content strings.
 * postcondition: returned value in [0, 1].
 *   - 0.7 if no recent content (prior = "probably different").
 *   - 0.0 if structurally identical to the most similar recent memory.
 */
export function computeStructuralNovelty(
  content: string,
  recentContents: string[],
): number {
  if (recentContents.length === 0) return 0.7;
  const candidate = extractStructuralFeatures(content);
  const keys = Object.keys(candidate) as (keyof StructuralFeatures)[];
  let bestMatch = 0.0;
  for (const existingContent of recentContents) {
    const existing = extractStructuralFeatures(existingContent);
    const matches = keys.filter((k) => candidate[k] === existing[k]).length;
    const similarity = matches / keys.length;
    bestMatch = Math.max(bestMatch, similarity);
  }
  return Math.max(0.0, Math.min(1.0, 1.0 - bestMatch));
}

// ── Combined novelty ───────────────────────────────────────────────────────

/**
 * Combined 4-signal novelty score.
 *
 * Weight invariant: 0.40 + 0.25 + 0.20 + 0.15 = 1.0 (convex combination).
 * precondition:  each argument is in [0, 1].
 * postcondition: returned value in [0, 1].
 *
 * source: predictive_coding_flat.py:compute_novelty_score
 */
export function computeNoveltyScore(
  embeddingNovelty: number,
  entityNovelty: number,
  temporalNovelty: number,
  structuralNovelty: number,
): number {
  return (
    0.4 * embeddingNovelty +
    0.25 * entityNovelty +
    0.2 * temporalNovelty +
    0.15 * structuralNovelty
  );
}

/**
 * Structured dict of all signal values for observability.
 *
 * postcondition: all values are rounded to 4 decimal places.
 */
// source: phase 4-to-5 cleanup, 2026-04-26
// Return type narrowed from Record<string,number> to the exact shape so that
// buildRejectionResponse and RememberResponse.novelty are mutually substitutable.
export function describeSignals(
  embedding: number,
  entity: number,
  temporal: number,
  structural: number,
  combined: number,
): {
  embedding_novelty: number;
  entity_novelty: number;
  temporal_novelty: number;
  structural_novelty: number;
  combined_novelty: number;
} {
  return {
    embedding_novelty: Math.round(embedding * 10000) / 10000,
    entity_novelty: Math.round(entity * 10000) / 10000,
    temporal_novelty: Math.round(temporal * 10000) / 10000,
    structural_novelty: Math.round(structural * 10000) / 10000,
    combined_novelty: Math.round(combined * 10000) / 10000,
  };
}

// ── Gate decision ──────────────────────────────────────────────────────────

/**
 * Flat gate decision: compare novelty score against threshold.
 *
 * precondition:  noveltyScore in [0, 1]; threshold in (0, 1).
 * postcondition: (true, reason) if bypass or novelty >= threshold.
 *                (false, reason) otherwise.
 *
 * source: predictive_coding_gate.py:gate_decision
 */
export function gateDecision(
  noveltyScore: number,
  threshold: number,
  bypass: boolean,
): [boolean, string] {
  if (bypass) return [true, "bypass"];
  if (noveltyScore >= threshold) return [true, "high_novelty"];
  return [
    false,
    `below_threshold (novelty=${noveltyScore.toFixed(3)}, threshold=${threshold})`,
  ];
}

// ── Hierarchical prediction types ─────────────────────────────────────────

export interface PredictionLevel {
  level: number;
  predictions: Record<string, number>;
  precisions: Record<string, number>;
  predictionErrors: Record<string, number>;
  freeEnergy: number;
}

export interface HierarchicalPrediction {
  levels: [PredictionLevel, PredictionLevel, PredictionLevel];
  totalFreeEnergy: number;
  noveltyScore: number;
  gateOpen: boolean;
  gateReason: string;
}

// ── Precision state ────────────────────────────────────────────────────────

export interface PrecisionState {
  domain: string;
  levelPrecisions: [number, number, number];
  predictionHistory: number;
  calibrationHits: number;
  calibrationTotal: number;
  precisionEmaAlpha: number;
}

export function makePrecisionState(domain: string): PrecisionState {
  return {
    domain,
    levelPrecisions: [1.0, 1.0, 1.0],
    predictionHistory: 0,
    calibrationHits: 0,
    calibrationTotal: 0,
    precisionEmaAlpha: 0.1,
  };
}

/**
 * Update precision estimate via inverse-variance tracking.
 *
 * precondition:  currentPrecision > 0; predictionError is a real number.
 * postcondition: returned value in [0.1, 5.0].
 *
 * source: predictive_coding_gate.py:update_precision
 */
export function updatePrecision(
  currentPrecision: number,
  predictionError: number,
  learningRate = 0.1,
): number {
  const MIN = 0.1;
  const MAX = 5.0;
  const currentVar = 1.0 / Math.max(currentPrecision, MIN);
  const newVar =
    (1 - learningRate) * currentVar + learningRate * predictionError ** 2;
  const newPrecision = 1.0 / Math.max(newVar, 1e-10);
  return Math.max(MIN, Math.min(MAX, newPrecision));
}

/**
 * Sigmoid mapping from average precision to a confidence score [0, 1].
 *
 * postcondition: precision=1.0 → ~0.5; precision=3.0 → ~0.85.
 * source: predictive_coding_gate.py:precision_to_confidence
 */
export function precisionToConfidence(levelPrecisions: number[]): number {
  const avg =
    levelPrecisions.length > 0
      ? levelPrecisions.reduce((a, b) => a + b, 0) / levelPrecisions.length
      : 1.0;
  return 1.0 / (1.0 + Math.exp(-1.5 * (avg - 1.5)));
}

// ── Level 0 (sensory) computation ──────────────────────────────────────────

const DEFAULT_SENSORY_PREDICTIONS: Record<string, number> = {
  length: 0.3,
  code_density: 0.2,
  file_ref_density: 0.1,
  url_density: 0.05,
  heading_density: 0.1,
  list_density: 0.1,
};

function extractSensoryFeatures(content: string): Record<string, number> {
  const n = Math.max(content.length, 1);
  return {
    length: Math.min(n / 2000.0, 1.0),
    code_density: Math.min(
      (content.match(CODE_BLOCK_RE) ?? []).length / 5.0,
      1.0,
    ),
    file_ref_density: Math.min(
      (content.match(FILE_PATH_RE) ?? []).length / 5.0,
      1.0,
    ),
    url_density: Math.min((content.match(URL_RE) ?? []).length / 3.0, 1.0),
    heading_density: Math.min(
      (content.match(HEADING_RE) ?? []).length / 5.0,
      1.0,
    ),
    list_density: Math.min(
      (content.match(LIST_RE) ?? []).length / 10.0,
      1.0,
    ),
  };
}

/**
 * Compute Level 0 (sensory) prediction errors.
 *
 * postcondition: returned PredictionLevel has freeEnergy >= 0.
 * source: predictive_coding_signals.py:compute_sensory_errors
 */
export function computeSensoryErrors(
  content: string,
  predictions: Record<string, number>,
  precisions: Record<string, number>,
): PredictionLevel {
  const observations = extractSensoryFeatures(content);
  const errors: Record<string, number> = {};
  let freeEnergy = 0.0;

  for (const [feat, pred] of Object.entries(predictions)) {
    const obs = observations[feat] ?? 0.0;
    const error = obs - pred;
    errors[feat] = error;
    const precision = precisions[feat] ?? 1.0;
    freeEnergy += precision * error ** 2;
  }

  return { level: 0, predictions, precisions, predictionErrors: errors, freeEnergy };
}

/**
 * Generate Level 0 predictions from recent memory statistics.
 *
 * postcondition: if no recent features, returns default predictions with
 *   uniform precision 0.5 (minimal prior knowledge).
 * source: predictive_coding_signals.py:compute_sensory_prediction
 */
export function computeSensoryPrediction(
  recentMemoriesFeatures: Record<string, number>[],
): [Record<string, number>, Record<string, number>] {
  if (recentMemoriesFeatures.length === 0) {
    const defaultPrec = Object.fromEntries(
      Object.keys(DEFAULT_SENSORY_PREDICTIONS).map((k) => [k, 0.5]),
    );
    return [{ ...DEFAULT_SENSORY_PREDICTIONS }, defaultPrec];
  }

  const features = Object.keys(recentMemoriesFeatures[0] ?? DEFAULT_SENSORY_PREDICTIONS);
  const predictions: Record<string, number> = {};
  const precisions: Record<string, number> = {};

  for (const feat of features) {
    const values = recentMemoriesFeatures.map((m) => m[feat] ?? 0.0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, v) => a + (v - mean) ** 2, 0) /
      Math.max(values.length - 1, 1);
    predictions[feat] = mean;
    precisions[feat] = Math.max(0.1, Math.min(5.0, 1.0 / Math.max(variance, 0.01)));
  }

  return [predictions, precisions];
}

// ── Level 1 (entity) computation ───────────────────────────────────────────

/**
 * Compute Level 1 (entity) prediction errors.
 *
 * postcondition: returned PredictionLevel has freeEnergy >= 0.
 * source: predictive_coding_signals.py:compute_entity_errors
 */
export function computeEntityErrors(
  newEntityNames: string[],
  knownEntityNames: Set<string>,
  entityPredictions?: Record<string, number>,
  entityPrecisions?: Record<string, number>,
): PredictionLevel {
  const predictions = entityPredictions ?? {};
  const precisions = entityPrecisions ?? {};
  const newSet = new Set(newEntityNames);

  if (Object.keys(predictions).length > 0) {
    const errors: Record<string, number> = {};
    let freeEnergy = 0.0;
    for (const [entity, prob] of Object.entries(predictions)) {
      const prec = precisions[entity] ?? 1.0;
      const error = newSet.has(entity) ? 0.0 : prob;
      errors[entity] = error;
      freeEnergy += prec * error ** 2;
    }
    for (const entity of newEntityNames) {
      if (!(entity in predictions)) {
        errors[entity] = -0.5;
        freeEnergy += 0.5 * 0.25;
      }
    }
    return { level: 1, predictions, precisions, predictionErrors: errors, freeEnergy };
  }

  if (newEntityNames.length === 0) {
    return { level: 1, predictions: {}, precisions: {}, predictionErrors: {}, freeEnergy: 0.0 };
  }

  const novel = newEntityNames.filter((e) => !knownEntityNames.has(e)).length;
  const noveltyRatio = novel / newEntityNames.length;
  return {
    level: 1,
    predictions: {},
    precisions: {},
    predictionErrors: { entity_novelty_ratio: noveltyRatio },
    freeEnergy: noveltyRatio ** 2,
  };
}

// ── Level 2 (schema) computation ───────────────────────────────────────────

/**
 * Compute Level 2 (schema/domain) prediction errors.
 *
 * postcondition: returned PredictionLevel has freeEnergy >= 0.
 * source: predictive_coding_signals.py:compute_schema_errors
 */
export function computeSchemaErrors(
  schemaMatchScore: number,
  schemaFreeEnergy: number,
  domainFamiliarity = 0.5,
): PredictionLevel {
  const schemaError = 1.0 - schemaMatchScore;
  const domainPrecision = 0.5 + domainFamiliarity * 2.0;
  const totalFe =
    domainPrecision * schemaError ** 2 + schemaFreeEnergy * 0.3;
  return {
    level: 2,
    predictions: {
      schema_match: schemaMatchScore,
      domain_familiarity: domainFamiliarity,
    },
    precisions: { schema_match: domainPrecision },
    predictionErrors: { schema_mismatch: schemaError },
    freeEnergy: totalFe,
  };
}

// ── Hierarchical gate decision ─────────────────────────────────────────────

const DEFAULT_HIERARCHICAL_THRESHOLD = 0.15;

/**
 * Gate decision using hierarchical free energy.
 *
 * precondition:  prediction is a valid HierarchicalPrediction.
 * postcondition: (true, reason) iff bypass or total_free_energy >= threshold.
 * source: predictive_coding_gate.py:hierarchical_gate_decision
 */
export function hierarchicalGateDecision(
  prediction: HierarchicalPrediction,
  threshold = DEFAULT_HIERARCHICAL_THRESHOLD,
  bypass = false,
): [boolean, string] {
  if (bypass) return [true, "bypass"];
  const fe = prediction.totalFreeEnergy;
  if (fe >= threshold) {
    const levelNames = ["sensory", "entity", "schema"] as const;
    const dominant = prediction.levels.reduce(
      (best, lvl) => (lvl.freeEnergy > best.freeEnergy ? lvl : best),
      prediction.levels[0],
    );
    return [
      true,
      `high_free_energy (FE=${fe.toFixed(3)}, dominant=${levelNames[dominant.level]})`,
    ];
  }
  return [false, `low_free_energy (FE=${fe.toFixed(3)}, threshold=${threshold})`];
}
