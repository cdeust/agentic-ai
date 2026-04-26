/**
 * Homeostatic cycle: scalar factor + fold.
 *
 * A3 lazy-heat implementation: heat is a *function*, not a *state vector*.
 * The multiplicative scaling factor is stored as a single scalar per domain
 * in homeostatic_state.factor and read by effective_heat() at query time:
 *
 *   effective_heat(m, t, factor) = LEAST(1.0, GREATEST(floor,
 *       heat_base * factor * POWER(decay_factor, α·t)))
 *
 * One row written per cycle instead of 66K.
 *
 * Fold trigger (pre-filter fidelity): recall_memories() filters
 * heat_base >= min_heat / factor. When |log(factor)| > log(2.0) — i.e.,
 * factor not in [0.5, 2.0] — we fold the scalar back into heat_base per-row
 * and reset factor=1.0. Fold is amortized: expected once per month per domain.
 *
 * References:
 *   // source: Turrigiano 2008 — multiplicative synaptic scaling (order-preserving)
 *   // source: Tetzlaff 2011 Eq. 3 — delta_w = alpha * w * (r_target - r_actual)
 *   // source: Pfister 2013 — bimodality coefficient
 *     b > 5/9 ≈ 0.555 is the formal criterion. Cortex uses 0.7 for a clean margin.
 *   // source: Hinton & Salakhutdinov 2006 — subtractive renormalization
 *   // source: Wilcox RR (2012) bimodality coefficient < 5/9 indicates unimodal.
 *   docs/program/phase-3-a3-migration-design.md §5
 *
 * Port of: mcp_server/handlers/consolidation/homeostatic.py
 */

import {
  computeScalingFactor,
  detectHotCohort,
  applyCohortCorrection,
} from "../homeostatic-plasticity.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// Bimodality threshold above which multiplicative scaling is ineffective.
// // source: Pfister et al. (2013) "Good things peak in pairs." Frontiers in
//   Psychology 4:700 — b > 5/9 ≈ 0.555 is the formal criterion. Cortex uses
//   0.7 for a clean margin: true bimodal distributions score > 1.0 (measured);
//   uniform/unimodal score < 0.6 (measured).
const BIMODALITY_TRIGGER = 0.7;

const TARGET_HEAT = 0.4;
const FOLD_LOG_THRESHOLD = Math.log(2.0);
const MIN_SAFE_MEAN = 0.01;
const MAX_STEP = 0.03;

// ── Store interface ───────────────────────────────────────────────────────────

export interface HomeostaticStore {
  getAllMemoriesForDecay(): Promise<Record<string, unknown>[]>;
  getHomeostaticFactor(domain: string): Promise<number>;
  setHomeostaticFactor(domain: string, factor: number): Promise<void>;
  bumpHeatRawBatch(updates: Array<[number, number]>): Promise<void>;
}

// ── Distribution health (inline, no numpy dep) ────────────────────────────────

interface DistributionHealth {
  mean: number;
  std: number;
  bimodality_coefficient: number;
  health_score: number;
}

function computeDistributionHealth(
  heats: readonly number[],
  targetMean = TARGET_HEAT,
): DistributionHealth {
  if (heats.length === 0) {
    return { mean: 0, std: 0, bimodality_coefficient: 0, health_score: 0 };
  }

  const n = heats.length;
  const mean = heats.reduce((s, h) => s + h, 0) / n;
  const variance = heats.reduce((s, h) => s + Math.pow(h - mean, 2), 0) / n;
  const std = Math.sqrt(variance);

  // Bimodality coefficient: (skewness^2 + 1) / (kurtosis + 3*(n-1)^2/((n-2)*(n-3)))
  // Simplified for large n: BC ≈ (skewness^2 + 1) / (excess_kurtosis + 3)
  // // source: Wilcox (2012); Pfister (2013).
  let skewness = 0;
  let kurtosis = 0;
  if (std > 1e-10) {
    const m3 = heats.reduce((s, h) => s + Math.pow((h - mean) / std, 3), 0) / n;
    const m4 = heats.reduce((s, h) => s + Math.pow((h - mean) / std, 4), 0) / n;
    skewness = m3;
    kurtosis = m4 - 3; // excess kurtosis
  }
  const bimodalityCoeff =
    std > 1e-10 ? (skewness * skewness + 1) / (kurtosis + 3) : 0;

  const deviation = Math.abs(mean - targetMean);
  const healthScore = Math.max(0.0, 1.0 - deviation / targetMean);

  return {
    mean,
    std,
    bimodality_coefficient: bimodalityCoeff,
    health_score: healthScore,
  };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export type ScalingKind = "none" | "cohort_correction" | "scalar_update" | "fold";

async function dispatchScaling(
  store: HomeostaticStore,
  memories: readonly Record<string, unknown>[],
  heats: readonly number[],
  health: DistributionHealth,
): Promise<{ scaling_applied: boolean; scaling_kind: ScalingKind }> {
  const bimodal = health.bimodality_coefficient > BIMODALITY_TRIGGER;

  if (bimodal) {
    // Cohort correction: subtractive, per-row writes
    const mean = health.mean;
    const std = health.std;
    const cohortIndices = detectHotCohort(heats, mean, std);
    if (cohortIndices.length > 0) {
      const corrected = applyCohortCorrection(heats, cohortIndices, TARGET_HEAT);
      const updates: Array<[number, number]> = [];
      for (const i of cohortIndices) {
        const id = memories[i]?.["id"] as number | undefined;
        if (id != null && corrected[i] !== undefined) {
          updates.push([id, corrected[i]!]);
        }
      }
      await store.bumpHeatRawBatch(updates);
      return { scaling_applied: true, scaling_kind: "cohort_correction" };
    }
    return { scaling_applied: false, scaling_kind: "none" };
  }

  // Scalar factor path
  const currentMean = health.mean;
  if (currentMean < MIN_SAFE_MEAN) {
    return { scaling_applied: false, scaling_kind: "none" };
  }

  if (Math.abs(currentMean - TARGET_HEAT) < 0.02) {
    return { scaling_applied: false, scaling_kind: "none" };
  }

  const rawFactor = computeScalingFactor(currentMean, TARGET_HEAT);
  const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, rawFactor - 1.0));
  const newFactor = 1.0 + step;

  const currentFactor = await store.getHomeostaticFactor("default");
  const combinedFactor = currentFactor * newFactor;

  if (Math.abs(Math.log(combinedFactor)) > FOLD_LOG_THRESHOLD) {
    // Fold: apply factor to heat_base rows and reset
    const updates: Array<[number, number]> = memories.map((m, i) => [
      m["id"] as number,
      Math.max(0.0, Math.min(1.0, ((m["heat"] as number | undefined) ?? 0) * combinedFactor)),
    ]);
    await store.bumpHeatRawBatch(updates);
    await store.setHomeostaticFactor("default", 1.0);
    return { scaling_applied: true, scaling_kind: "fold" };
  }

  await store.setHomeostaticFactor("default", combinedFactor);
  return { scaling_applied: true, scaling_kind: "scalar_update" };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface HomeostaticStageResult {
  scaling_applied: boolean;
  scaling_kind: ScalingKind;
  health_score: number | null;
  mean_heat: number | null;
  std_heat: number | null;
  bimodality: number | null;
  memories_scanned: number;
  reason?: string;
  error?: string;
  duration_ms?: number;
}

/**
 * Update the domain's homeostatic factor; fold if drift is too large.
 *
 * Branching:
 *   1. healthy AND unimodal → no-op
 *   2. bimodal → cohort correction (per-row writes via bumpHeatRawBatch)
 *   3. off-target → scalar factor update, fold if drift > log(2.0)
 */
export async function runHomeostaticCycle(
  store: HomeostaticStore,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<HomeostaticStageResult> {
  try {
    const mems = memories ?? (await store.getAllMemoriesForDecay());

    if (!mems.length) {
      return {
        scaling_applied: false,
        scaling_kind: "none",
        health_score: null,
        mean_heat: null,
        std_heat: null,
        bimodality: null,
        memories_scanned: 0,
        reason: "no_memories",
      };
    }

    const heats = mems.map((m) => (m["heat"] as number | undefined) ?? 0.5);
    const health = computeDistributionHealth(heats, TARGET_HEAT);

    const outcome = await dispatchScaling(store, mems, heats, health);

    return {
      ...outcome,
      health_score: health.health_score,
      mean_heat: health.mean,
      std_heat: health.std,
      bimodality: health.bimodality_coefficient,
      memories_scanned: mems.length,
    };
  } catch (exc) {
    return {
      scaling_applied: false,
      scaling_kind: "none",
      health_score: null,
      mean_heat: null,
      std_heat: null,
      bimodality: null,
      memories_scanned: 0,
      error: `${(exc as Error).name}: ${(exc as Error).message}`,
    };
  }
}
