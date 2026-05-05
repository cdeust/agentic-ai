/**
 * Predictive coding signal computation — sensory, entity, schema errors.
 *
 * Level 0 (Sensory): Raw content features (length, structure, code blocks, file refs).
 * Level 1 (Entity): Entity and relationship pattern novelty.
 * Level 2 (Schema): Domain-level regularity matching.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/predictive_coding_signals.py
 *
 * References:
 *   Friston K (2005) A theory of cortical responses. Phil Trans R Soc B 360:815-836
 *   Bastos AM et al. (2012) Canonical microcircuits for predictive coding. Neuron 76:695-711
 */

// ── Data types ────────────────────────────────────────────────────────────

/** State of one level in the predictive hierarchy. */
export interface PredictionLevel {
  level: number;
  predictions: Record<string, number>;
  precisions: Record<string, number>;
  predictionErrors: Record<string, number>;
  freeEnergy: number;
}

/** Full hierarchical prediction state across all levels. */
export interface HierarchicalPrediction {
  levels: [PredictionLevel, PredictionLevel, PredictionLevel];
  totalFreeEnergy: number;
  noveltyScore: number;
  gateOpen: boolean;
  gateReason: string;
}

function makePredictionLevel(
  level: number,
  opts: {
    predictions?: Record<string, number>;
    precisions?: Record<string, number>;
    predictionErrors?: Record<string, number>;
    freeEnergy?: number;
  } = {},
): PredictionLevel {
  return {
    level,
    predictions: opts.predictions ?? {},
    precisions: opts.precisions ?? {},
    predictionErrors: opts.predictionErrors ?? {},
    freeEnergy: opts.freeEnergy ?? 0.0,
  };
}

// ── Shared regex (mirrors predictive_coding_flat.py) ─────────────────────
// source: cortex@ed33435 mcp_server/core/predictive_coding_flat.py:19-23

const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const FILE_PATH_RE = /(?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.\w+/g;
const URL_RE = /https?:\/\/\S+/g;
const HEADING_RE = /^#{1,6}\s+\S/gm;
const LIST_RE = /^[\s]*[-*+]\s+\S/gm;

// ── Level 0: Sensory feature extraction ──────────────────────────────────

/**
 * Extract Level 0 (sensory) features from content.
 * source: cortex@ed33435 mcp_server/core/predictive_coding_signals.py:65-75
 */
function extractSensoryFeatures(content: string): Record<string, number> {
  const n = Math.max(content.length, 1);
  return {
    length: Math.min(n / 2000.0, 1.0),
    code_density: Math.min((content.match(CODE_BLOCK_RE) ?? []).length / 5.0, 1.0),
    file_ref_density: Math.min((content.match(FILE_PATH_RE) ?? []).length / 5.0, 1.0),
    url_density: Math.min((content.match(URL_RE) ?? []).length / 3.0, 1.0),
    heading_density: Math.min((content.match(HEADING_RE) ?? []).length / 5.0, 1.0),
    list_density: Math.min((content.match(LIST_RE) ?? []).length / 10.0, 1.0),
  };
}

// source: cortex@ed33435 mcp_server/core/predictive_coding_signals.py:78-85
const DEFAULT_SENSORY_PREDICTIONS: Record<string, number> = {
  length: 0.3,
  code_density: 0.2,
  file_ref_density: 0.1,
  url_density: 0.05,
  heading_density: 0.1,
  list_density: 0.1,
};

/**
 * Generate Level 0 predictions from recent memory statistics.
 *
 * postcondition: returns [predictions, precisions] based on mean/variance
 *   of recent memory features; falls back to defaults when empty.
 *
 * source: cortex@ed33435 mcp_server/core/predictive_coding_signals.py:88-107
 */
export function computeSensoryPrediction(
  recentMemoriesFeatures: Record<string, number>[],
): [Record<string, number>, Record<string, number>] {
  if (recentMemoriesFeatures.length === 0) {
    const defaultPrec = Object.fromEntries(
      Object.keys(DEFAULT_SENSORY_PREDICTIONS).map((k) => [k, 0.5]),
    );
    return { ...DEFAULT_SENSORY_PREDICTIONS }, defaultPrec;
  }

  const features = Object.keys(recentMemoriesFeatures[0] ?? {});
  const predictions: Record<string, number> = {};
  const precisions: Record<string, number> = {};

  for (const feat of features) {
    const values = recentMemoriesFeatures.map((m) => m[feat] ?? 0.0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1);
    predictions[feat] = mean;
    precisions[feat] = Math.max(0.1, Math.min(5.0, 1.0 / Math.max(variance, 0.01)));
  }

  return predictions, precisions;
}

/**
 * Compute Level 0 prediction errors for new content.
 *
 * postcondition: returned PredictionLevel has level=0; freeEnergy is the
 *   precision-weighted squared error sum.
 *
 * source: cortex@ed33435 mcp_server/core/predictive_coding_signals.py:110-133
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
    freeEnergy += precision * error * error;
  }

  return makePredictionLevel(0, { predictions, precisions, predictionErrors: errors, freeEnergy });
}

// ── Level 1: Entity prediction ────────────────────────────────────────────

/**
 * Compute entity errors when schema predictions are available.
 * source: cortex@ed33435 mcp_server/core/predictive_coding_signals.py:139-159
 */
function computeEntityErrorsWithSchema(
  newSet: Set<string>,
  newEntityNames: string[],
  predictions: Record<string, number>,
  precisions: Record<string, number>,
): [Record<string, number>, number] {
  const errors: Record<string, number> = {};
  let freeEnergy = 0.0;

  for (const [entity, prob] of Object.entries(predictions)) {
    const prec = precisions[entity] ?? 1.0;
    const error = newSet.has(entity) ? 0.0 : prob;
    errors[entity] = error;
    freeEnergy += prec * error * error;
  }

  for (const entity of newEntityNames) {
    if (!(entity in predictions)) {
      errors[entity] = -0.5;
      freeEnergy += 0.5 * 0.25;
    }
  }

  return [errors, freeEnergy];
}

/**
 * Compute Level 1 (entity) prediction errors.
 *
 * postcondition: returned PredictionLevel has level=1.
 * source: cortex@ed33435 mcp_server/core/predictive_coding_signals.py:163-195
 */
export function computeEntityErrors(
  newEntityNames: string[],
  knownEntityNames: Set<string>,
  entityPredictions: Record<string, number> | null = null,
  entityPrecisions: Record<string, number> | null = null,
): PredictionLevel {
  const predictions = entityPredictions ?? {};
  const precisions = entityPrecisions ?? {};
  const newSet = new Set(newEntityNames);

  if (Object.keys(predictions).length > 0) {
    const [errors, freeEnergy] = computeEntityErrorsWithSchema(
      newSet, newEntityNames, predictions, precisions,
    );
    return makePredictionLevel(1, { predictions, precisions, predictionErrors: errors, freeEnergy });
  }

  if (newEntityNames.length === 0) {
    return makePredictionLevel(1);
  }

  const novel = newEntityNames.filter((e) => !knownEntityNames.has(e)).length;
  const noveltyRatio = novel / newEntityNames.length;
  return makePredictionLevel(1, {
    predictions,
    precisions,
    predictionErrors: { entity_novelty_ratio: noveltyRatio },
    freeEnergy: noveltyRatio * noveltyRatio,
  });
}

// ── Level 2: Schema prediction ────────────────────────────────────────────

/**
 * Compute Level 2 (schema/domain) prediction errors.
 *
 * postcondition: returned PredictionLevel has level=2.
 * source: cortex@ed33435 mcp_server/core/predictive_coding_signals.py:201-220
 */
export function computeSchemaErrors(
  schemaMatchScore: number,
  schemaFreeEnergy: number,
  domainFamiliarity = 0.5,
): PredictionLevel {
  const schemaError = 1.0 - schemaMatchScore;
  const domainPrecision = 0.5 + domainFamiliarity * 2.0;
  const totalFe = domainPrecision * schemaError * schemaError + schemaFreeEnergy * 0.3;

  return makePredictionLevel(2, {
    predictions: { schema_match: schemaMatchScore, domain_familiarity: domainFamiliarity },
    precisions: { schema_match: domainPrecision },
    predictionErrors: { schema_mismatch: schemaError },
    freeEnergy: totalFe,
  });
}
