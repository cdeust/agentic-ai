/**
 * Ablation framework — lesion study simulator for Cortex mechanisms.
 *
 * In neuroscience, ablation studies remove or disable brain regions to measure
 * their contribution. This module applies the same methodology to Cortex:
 * disable individual neuroscience mechanisms and measure impact on
 * system-level behaviour.
 *
 * Each mechanism has an enable/disable flag. When disabled:
 *   - The mechanism returns neutral/identity values (no modulation)
 *   - Other mechanisms continue operating normally
 *   - System-level metrics are tracked for comparison
 *
 * Pure business logic — no I/O. The env-var read is a single
 * process.env lookup (constant-time miss in production; set only by
 * the E1 verification campaign).
 *
 * Port of: cortex@ed33435 mcp_server/core/ablation.py
 */

// ── Mechanism enum ────────────────────────────────────────────────────────

/** Enumeration of all ablatable Cortex mechanisms.
 * source: cortex@ed33435 mcp_server/core/ablation.py:48-77
 */
export enum Mechanism {
  OSCILLATORY_CLOCK = "oscillatory_clock",
  CASCADE = "consolidation_cascade",
  PREDICTIVE_CODING = "hierarchical_predictive_coding",
  NEUROMODULATION = "coupled_neuromodulation",
  PATTERN_SEPARATION = "pattern_separation",
  SCHEMA_ENGINE = "schema_engine",
  TRIPARTITE_SYNAPSE = "tripartite_synapse",
  INTERFERENCE = "interference_management",
  HOMEOSTATIC_PLASTICITY = "homeostatic_plasticity",
  SYNAPTIC_PLASTICITY = "synaptic_plasticity",
  SYNAPTIC_TAGGING = "synaptic_tagging",
  EMOTIONAL_TAGGING = "emotional_tagging",
  MICROGLIAL_PRUNING = "microglial_pruning",
  SPREADING_ACTIVATION = "spreading_activation",
  ENGRAM_ALLOCATION = "engram_allocation",
  RECONSOLIDATION = "reconsolidation",
  DENDRITIC_CLUSTERS = "dendritic_clusters",
  TWO_STAGE_MODEL = "two_stage_model",
  HOPFIELD = "hopfield_network",
  HDC = "hyperdimensional_computing",
  SURPRISE_MOMENTUM = "surprise_momentum",
  ADAPTIVE_DECAY = "adaptive_decay",
  CO_ACTIVATION = "co_activation",
  EMOTIONAL_RETRIEVAL = "emotional_retrieval",
  EMOTIONAL_DECAY = "emotional_decay",
  MOOD_CONGRUENT_RERANK = "mood_congruent_rerank",
}

// ── Core gate ────────────────────────────────────────────────────────────

/**
 * True iff CORTEX_ABLATE_<NAME>=1 is set for this mechanism.
 *
 * Production hot-paths call this at the entry point and short-circuit to
 * a no-op when True. Used by the E1 verification campaign to produce
 * per-mechanism causal deltas; in production the env var is never set.
 *
 * Reads process.env on every call — callers are not in a tight loop;
 * test env varies per-run; production env never changes mid-process.
 * DO NOT memoize.
 *
 * Accepts either a Mechanism enum (uses .name, e.g. "OSCILLATORY_CLOCK")
 * or a string (upper-cased, hyphens normalised).
 *
 * precondition:  mechanism is a Mechanism enum value or a non-empty string.
 * postcondition: returns true iff process.env[`CORTEX_ABLATE_${name}`] === "1".
 *
 * source: cortex@ed33435 mcp_server/core/ablation.py:25-45
 */
export function isMechanismDisabled(mechanism: Mechanism | string): boolean {
  if (typeof process === "undefined") return false;
  let name: string;
  // Check if mechanism is a Mechanism enum value (e.g. "hopfield_network")
  // In that case, look up the enum KEY (e.g. "HOPFIELD") for the env var.
  // source: cortex@ed33435 mcp_server/core/ablation.py:41-45 — uses mechanism.name
  const enumKey = (Object.keys(Mechanism) as Array<keyof typeof Mechanism>).find(
    (k) => Mechanism[k] === mechanism,
  );
  if (enumKey !== undefined) {
    name = enumKey; // e.g. "HOPFIELD"
  } else {
    // Raw string like "HOPFIELD" or "hopfield_network" — normalise to upper/underscored
    name = String(mechanism).toUpperCase().replace(/-/g, "_");
  }
  return process.env[`CORTEX_ABLATE_${name}`] === "1";
}

// ── AblationConfig ────────────────────────────────────────────────────────

/**
 * Configuration specifying which mechanisms are enabled/disabled.
 *
 * Immutable-style: mutating methods return new instances.
 *
 * source: cortex@ed33435 mcp_server/core/ablation.py:79-104
 */
export class AblationConfig {
  constructor(public readonly disabled: ReadonlySet<string> = new Set()) {}

  /** Check if a mechanism is enabled (not in the disabled set). */
  isEnabled(mechanism: Mechanism | string): boolean {
    // Mechanism is a string-valued enum union; both branches stringify.
    // Kept as a single String() coercion to preserve the previous shape.
    const name = String(mechanism);
    return !this.disabled.has(name);
  }

  /** Return new config with mechanism disabled. */
  disable(mechanism: Mechanism | string): AblationConfig {
    const name = String(mechanism);
    const next = new Set(this.disabled);
    next.add(name);
    return new AblationConfig(next);
  }

  /** Return new config with mechanism enabled. */
  enable(mechanism: Mechanism | string): AblationConfig {
    const name = String(mechanism);
    const next = new Set(this.disabled);
    next.delete(name);
    return new AblationConfig(next);
  }

  /** Disable all mechanisms except the specified ones. */
  disableAllExcept(...mechanisms: Mechanism[]): AblationConfig {
    const keep = new Set(mechanisms.map(String));
    const allMechs = new Set(Object.values(Mechanism).map(String));
    const nextDisabled = new Set([...allMechs].filter((v) => !keep.has(v)));
    return new AblationConfig(nextDisabled);
  }
}

// ── AblationResult ────────────────────────────────────────────────────────

/**
 * Result of comparing baseline vs ablation condition.
 *
 * source: cortex@ed33435 mcp_server/core/ablation.py:111-120
 */
export interface AblationResult {
  mechanism: string;
  baselineMetrics: Record<string, number>;
  ablationMetrics: Record<string, number>;
  deltas: Record<string, number>;
  impactScore: number;
  interpretation: string;
}

// ── Delta computation ─────────────────────────────────────────────────────

/**
 * Compute signed differences between baseline and ablation metrics.
 *
 * precondition:  baseline and ablation are maps of metric name → float value.
 * postcondition: result[k] = ablation[k] - baseline[k] for every key in
 *   the union of both maps; rounded to 6 decimal places.
 *
 * source: cortex@ed33435 mcp_server/core/ablation.py:122-132
 */
export function computeAblationDeltas(
  baseline: Record<string, number>,
  ablation: Record<string, number>,
): Record<string, number> {
  const deltas: Record<string, number> = {};
  const keys = new Set([...Object.keys(baseline), ...Object.keys(ablation)]);
  for (const key of keys) {
    const b = baseline[key] ?? 0.0;
    const a = ablation[key] ?? 0.0;
    deltas[key] = Math.round((a - b) * 1e6) / 1e6;
  }
  return deltas;
}

// ── Impact score ──────────────────────────────────────────────────────────

/**
 * Compute overall impact magnitude from deltas via RMS + sigmoid.
 *
 * precondition:  deltas is a non-empty record of float values.
 * postcondition: result ∈ [0, 1]; rounded to 4 decimal places.
 *   Returns 0.0 for empty deltas (no effect observable).
 *
 * source: cortex@ed33435 mcp_server/core/ablation.py:135-141
 *   sigmoid: 1 / (1 + e^(-5 * rms))  — e approximated as 2.718
 */
export function computeImpactScore(deltas: Record<string, number>): number {
  const values = Object.values(deltas);
  if (values.length === 0) return 0.0;
  const sumSquared = values.reduce((acc, d) => acc + d * d, 0);
  const rms = Math.sqrt(sumSquared / values.length);
  // source: cortex@ed33435 mcp_server/core/ablation.py:141 — sigmoid with base 2.718
  const sigmoid = 1.0 / (1.0 + 2.718 ** (-5.0 * rms));
  return Math.round(sigmoid * 1e4) / 1e4;
}

// ── Interpretation ────────────────────────────────────────────────────────

/**
 * Generate human-readable interpretation of ablation results.
 *
 * precondition:  impactScore ∈ [0, 1].
 * postcondition: returns a non-empty string describing the ablation effect.
 *
 * source: cortex@ed33435 mcp_server/core/ablation.py:144-170
 */
export function generateInterpretation(
  mechanism: string,
  deltas: Record<string, number>,
  impactScore: number,
): string {
  if (impactScore < 0.1) {
    return `Ablation of ${mechanism} had minimal impact on system behavior.`;
  }

  const sortedDeltas = Object.entries(deltas)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 3);

  const parts = [`Ablation of ${mechanism} (impact=${impactScore.toFixed(2)}):`];
  for (const [metric, delta] of sortedDeltas) {
    const direction = delta > 0 ? "increased" : "decreased";
    const magnitude = Math.abs(delta);
    if (magnitude > 0.01) {
      parts.push(`  ${metric} ${direction} by ${magnitude.toFixed(4)}`);
    }
  }

  if (impactScore > 0.5) {
    parts.push("  This mechanism appears CRITICAL for system function.");
  } else if (impactScore > 0.3) {
    parts.push("  This mechanism contributes meaningfully to system behavior.");
  } else {
    parts.push("  This mechanism has a minor but measurable contribution.");
  }

  return parts.join("\n");
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Create a complete ablation result from baseline and ablation metrics.
 *
 * precondition:  mechanism is non-empty; baseline and ablation are float maps.
 * postcondition: returned AblationResult has deltas, impactScore, and
 *   interpretation all consistent with baseline/ablation.
 *
 * source: cortex@ed33435 mcp_server/core/ablation.py:173-190
 */
export function createAblationResult(
  mechanism: string,
  baseline: Record<string, number>,
  ablation: Record<string, number>,
): AblationResult {
  const deltas = computeAblationDeltas(baseline, ablation);
  const impactScore = computeImpactScore(deltas);
  const interpretation = generateInterpretation(mechanism, deltas, impactScore);

  return {
    mechanism,
    baselineMetrics: baseline,
    ablationMetrics: ablation,
    deltas,
    impactScore,
    interpretation,
  };
}

// ── Neutral values (identity functions for disabled mechanisms) ────────────

/**
 * Return neutral encoding strength (no oscillatory modulation).
 * source: cortex@ed33435 mcp_server/core/ablation.py:196
 */
export function neutralEncodingStrength(): number { return 1.0; }

/**
 * Return neutral retrieval strength (no oscillatory modulation).
 * source: cortex@ed33435 mcp_server/core/ablation.py:201
 */
export function neutralRetrievalStrength(): number { return 1.0; }

/**
 * Return neutral LTP modulation (no astrocyte/neuromodulation).
 * source: cortex@ed33435 mcp_server/core/ablation.py:206
 */
export function neutralLtpModulation(): number { return 1.0; }

/**
 * Return neutral schema match (no schema acceleration).
 * source: cortex@ed33435 mcp_server/core/ablation.py:211
 */
export function neutralSchemaMatch(): number { return 0.0; }

/**
 * Return neutral interference (no interference management).
 * source: cortex@ed33435 mcp_server/core/ablation.py:216
 */
export function neutralInterferenceScore(): number { return 0.0; }

/**
 * Return neutral separation (no pattern separation).
 * source: cortex@ed33435 mcp_server/core/ablation.py:221
 */
export function neutralSeparationIndex(): number { return 0.0; }

/**
 * Return neutral dependency (no two-stage model).
 * source: cortex@ed33435 mcp_server/core/ablation.py:226
 */
export function neutralHippocampalDependency(): number { return 0.5; }

/**
 * Return neutral scaling (no homeostatic plasticity).
 * source: cortex@ed33435 mcp_server/core/ablation.py:231
 */
export function neutralScalingFactor(): number { return 1.0; }
