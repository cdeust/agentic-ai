/**
 * Ablation framework — lesion study simulator for Cortex mechanisms.
 *
 * In neuroscience, ablation studies remove or disable brain regions to measure
 * their contribution. This module applies the same methodology to Cortex:
 * disable individual neuroscience mechanisms and measure the impact on
 * system-level behavior.
 *
 * Each mechanism has an enable/disable flag. When disabled:
 *   - The mechanism returns neutral/identity values (no modulation)
 *   - Other mechanisms continue operating normally
 *   - System-level metrics are tracked for comparison
 *
 * Pure business logic — no I/O (the env-var read is a single process.env
 * lookup, performed only when an E1 verification campaign sets it; in
 * production the var is never set so the lookup is a constant-time miss).
 *
 * Port of: mcp_server/core/ablation.py
 * source: cortex@ed33435 mcp_server/core/ablation.py
 */

// ── Mechanism enum ─────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/ablation.py:48

export const Mechanism = {
  OSCILLATORY_CLOCK: "oscillatory_clock",
  CASCADE: "consolidation_cascade",
  PREDICTIVE_CODING: "hierarchical_predictive_coding",
  NEUROMODULATION: "coupled_neuromodulation",
  PATTERN_SEPARATION: "pattern_separation",
  SCHEMA_ENGINE: "schema_engine",
  TRIPARTITE_SYNAPSE: "tripartite_synapse",
  INTERFERENCE: "interference_management",
  HOMEOSTATIC_PLASTICITY: "homeostatic_plasticity",
  SYNAPTIC_PLASTICITY: "synaptic_plasticity",
  SYNAPTIC_TAGGING: "synaptic_tagging",
  EMOTIONAL_TAGGING: "emotional_tagging",
  MICROGLIAL_PRUNING: "microglial_pruning",
  SPREADING_ACTIVATION: "spreading_activation",
  ENGRAM_ALLOCATION: "engram_allocation",
  RECONSOLIDATION: "reconsolidation",
  DENDRITIC_CLUSTERS: "dendritic_clusters",
  TWO_STAGE_MODEL: "two_stage_model",
  HOPFIELD: "hopfield_network",
  HDC: "hyperdimensional_computing",
  SURPRISE_MOMENTUM: "surprise_momentum",
  ADAPTIVE_DECAY: "adaptive_decay",
  CO_ACTIVATION: "co_activation",
  EMOTIONAL_RETRIEVAL: "emotional_retrieval",
  EMOTIONAL_DECAY: "emotional_decay",
  MOOD_CONGRUENT_RERANK: "mood_congruent_rerank",
} as const;

export type MechanismKey = keyof typeof Mechanism;
export type MechanismValue = (typeof Mechanism)[MechanismKey];

// ── Env-var check ──────────────────────────────────────────────────────────

/**
 * True iff CORTEX_ABLATE_<NAME>=1 is set for this mechanism.
 *
 * Accepts either a Mechanism value (e.g. "consolidation_cascade")
 * or the constant name (e.g. "CASCADE").
 *
 * Reads process.env on every call — callers are not in a tight loop;
 * test env varies per-run; production env never changes mid-process.
 * DO NOT memoize.
 *
 * Port of: mcp_server/core/ablation.py::is_mechanism_disabled
 * source: cortex@ed33435 mcp_server/core/ablation.py:25
 */
export function isMechanismDisabled(mechanism: MechanismValue | string): boolean {
  const name = mechanism.toUpperCase().replace(/-/g, "_");
  // eslint-disable-next-line n/no-process-env
  return (typeof process !== "undefined" ? process.env[`CORTEX_ABLATE_${name}`] : undefined) === "1";
}

// ── AblationConfig ────────────────────────────────────────────────────────

/**
 * Configuration specifying which mechanisms are enabled/disabled.
 * Port of: mcp_server/core/ablation.py::AblationConfig
 * source: cortex@ed33435 mcp_server/core/ablation.py:79
 */
export class AblationConfig {
  readonly disabled: ReadonlySet<string>;

  constructor(disabled: Iterable<string> = []) {
    this.disabled = new Set(disabled);
  }

  isEnabled(mechanism: MechanismValue | string): boolean {
    return !this.disabled.has(mechanism);
  }

  disable(mechanism: MechanismValue | string): AblationConfig {
    return new AblationConfig([...this.disabled, mechanism]);
  }

  enable(mechanism: MechanismValue | string): AblationConfig {
    const d = new Set(this.disabled);
    d.delete(mechanism);
    return new AblationConfig(d);
  }

  disableAllExcept(...mechanisms: MechanismValue[]): AblationConfig {
    const keep = new Set<string>(mechanisms);
    const allMechs = Object.values(Mechanism) as MechanismValue[];
    return new AblationConfig(allMechs.filter((m) => !keep.has(m)));
  }
}

// ── Ablation results ───────────────────────────────────────────────────────

export interface AblationResult {
  mechanism: string;
  baseline_metrics: Record<string, number>;
  ablation_metrics: Record<string, number>;
  deltas: Record<string, number>;
  impact_score: number;
  interpretation: string;
}

/**
 * Compute signed differences between baseline and ablation metrics.
 * Port of: mcp_server/core/ablation.py::compute_ablation_deltas
 * source: cortex@ed33435 mcp_server/core/ablation.py:122
 */
export function computeAblationDeltas(
  baseline: Record<string, number>,
  ablation: Record<string, number>,
): Record<string, number> {
  const deltas: Record<string, number> = {};
  const allKeys = new Set([...Object.keys(baseline), ...Object.keys(ablation)]);
  for (const key of allKeys) {
    const b = baseline[key] ?? 0;
    const a = ablation[key] ?? 0;
    deltas[key] = Math.round((a - b) * 1_000_000) / 1_000_000;
  }
  return deltas;
}

/**
 * Compute overall impact magnitude from deltas via RMS + sigmoid.
 * Port of: mcp_server/core/ablation.py::compute_impact_score
 * source: cortex@ed33435 mcp_server/core/ablation.py:135
 */
export function computeImpactScore(deltas: Record<string, number>): number {
  const values = Object.values(deltas);
  if (values.length === 0) return 0;
  const rms = Math.sqrt(values.reduce((s, d) => s + d * d, 0) / values.length);
  // sigmoid: 1 / (1 + e^(-5*rms))
  // source: cortex@ed33435 mcp_server/core/ablation.py:141
  return Math.round((1.0 / (1.0 + Math.exp(-5.0 * rms))) * 10000) / 10000;
}

/**
 * Generate human-readable interpretation of ablation results.
 * Port of: mcp_server/core/ablation.py::generate_interpretation
 * source: cortex@ed33435 mcp_server/core/ablation.py:144
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
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3); // source: cortex@ed33435 ablation.py:154

  const parts: string[] = [`Ablation of ${mechanism} (impact=${impactScore.toFixed(2)}):`];
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

/**
 * Create a complete ablation result from baseline and ablation metrics.
 * Port of: mcp_server/core/ablation.py::create_ablation_result
 * source: cortex@ed33435 mcp_server/core/ablation.py:173
 */
export function createAblationResult(
  mechanism: string,
  baseline: Record<string, number>,
  ablation: Record<string, number>,
): AblationResult {
  const deltas = computeAblationDeltas(baseline, ablation);
  const impact = computeImpactScore(deltas);
  const interp = generateInterpretation(mechanism, deltas, impact);

  return {
    mechanism,
    baseline_metrics: baseline,
    ablation_metrics: ablation,
    deltas,
    impact_score: impact,
    interpretation: interp,
  };
}

// ── Neutral values (identity functions for disabled mechanisms) ────────────

/** Return neutral encoding strength (no oscillatory modulation).
 * source: cortex@ed33435 mcp_server/core/ablation.py:196 */
export function neutralEncodingStrength(): number {
  return 1.0;
}

/** Return neutral retrieval strength (no oscillatory modulation).
 * source: cortex@ed33435 mcp_server/core/ablation.py:201 */
export function neutralRetrievalStrength(): number {
  return 1.0;
}

/** Return neutral LTP modulation (no astrocyte/neuromodulation).
 * source: cortex@ed33435 mcp_server/core/ablation.py:206 */
export function neutralLtpModulation(): number {
  return 1.0;
}

/** Return neutral schema match (no schema acceleration).
 * source: cortex@ed33435 mcp_server/core/ablation.py:211 */
export function neutralSchemaMatch(): number {
  return 0.0;
}

/** Return neutral interference (no interference management).
 * source: cortex@ed33435 mcp_server/core/ablation.py:216 */
export function neutralInterferenceScore(): number {
  return 0.0;
}

/** Return neutral separation (no pattern separation).
 * source: cortex@ed33435 mcp_server/core/ablation.py:221 */
export function neutralSeparationIndex(): number {
  return 0.0;
}

/** Return neutral dependency (no two-stage model).
 * source: cortex@ed33435 mcp_server/core/ablation.py:226 */
export function neutralHippocampalDependency(): number {
  return 0.5;
}

/** Return neutral scaling (no homeostatic plasticity).
 * source: cortex@ed33435 mcp_server/core/ablation.py:231 */
export function neutralScalingFactor(): number {
  return 1.0;
}
