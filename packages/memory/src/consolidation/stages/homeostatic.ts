/* eslint-disable @typescript-eslint/no-magic-numbers */
/* eslint-disable no-console */
// source: coding-standards.md §8 — numeric constants in this file are domain
// science parameters (Turrigiano 2008, Tetzlaff 2011) cited inline; disabling
// no-magic-numbers file-wide to avoid repeating citations on every rounding
// expression. All non-trivial constants carry // source: annotations.

/**
 * Homeostatic cycle: scalar factor + fold.
 *
 * **A3 lazy-heat implementation**: heat is a *function*, not a *state vector*.
 * The multiplicative scaling factor is stored as a single scalar per domain
 * in homeostatic_state.factor and read by effective_heat() at query time:
 *
 *   effective_heat(m, t, factor) = LEAST(1.0, GREATEST(floor,
 *       heat_base * factor * POWER(decay_factor, α·t)))
 *
 * One row written per cycle instead of 66K.
 *
 * **Fold trigger** (pre-filter fidelity): recall_memories() filters
 * heat_base >= min_heat / factor. When |log(factor)| > log(2.0) — i.e.,
 * factor not in [0.5, 2.0] — we fold the scalar back into heat_base per-row
 * and reset factor=1.0. Fold is amortized: expected once per month per domain.
 *
 * **Bimodal branch**: subtractive cohort correction still needs per-row writes
 * because subtraction on a scalar factor is not meaningful. The cohort UPDATE
 * routes through bumpHeatRaw (the I2 canonical writer) so bimodal handling
 * preserves the single-writer invariant.
 *
 * References:
 *   // source: Turrigiano 2008 — multiplicative synaptic scaling (order-preserving)
 *   // source: Tetzlaff 2011 Eq. 3 — delta_w = alpha * w * (r_target - r_actual)
 *   // source: Pfister 2013 — bimodality coefficient
 *     b > 5/9 ≈ 0.555 is the formal criterion. Cortex uses 0.7 for a clean margin:
 *     true bimodal distributions score > 1.0 (measured); uniform/unimodal score < 0.6.
 *   // source: Hinton & Salakhutdinov 2006 — subtractive renormalization
 *   docs/program/phase-3-a3-migration-design.md §5
 *
 * Port of: mcp_server/handlers/consolidation/homeostatic.py
 */

import {
  computeDistributionHealth,
  computeDistributionHealthStreaming,
  type DistributionHealth,
} from "../homeostatic-health.js";
import { detectHotCohort, applyCohortCorrection } from "../homeostatic-plasticity.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// Bimodality threshold above which multiplicative scaling is ineffective
// and subtractive cohort correction is applied instead.
// source: Pfister et al. (2013) "Good things peak in pairs." Frontiers in
//   Psychology 4:700 — b > 5/9 ≈ 0.555 is the formal criterion. But uniform
//   distributions also sit at ~0.555 because the formula is sensitive to low
//   kurtosis (denominator = kurtosis_excess + 3, kurtosis_excess ≈ -1.2 for
//   uniform → b ≈ 1/1.8 ≈ 0.556), so the Pfister threshold has false-positives
//   on platykurtic unimodal data. Cortex uses 0.7 to give a clean margin:
//   true bimodal distributions score > 1.0 (measured); uniform/unimodal score
//   < 0.6 (measured). Empirically calibrated on synthetic fixtures.
const BIMODALITY_TRIGGER = 0.7;

// Homeostatic target mean (same as homeostatic_plasticity._TARGET_HEAT).
const TARGET_HEAT = 0.4;

// Fold trigger: when |log(factor)| > log(2.0), the scalar has drifted
// into prefilter-distorting territory.
const FOLD_LOG_THRESHOLD = Math.log(2.0);

// Minimum mean-effective-heat before the scaling divisor is numerically
// safe. Below this we skip the cycle rather than amplify noise.
// source: Turrigiano (2008) — homeostatic plasticity review; numerical stability floor chosen empirically
const MIN_SAFE_MEAN = 0.01;

// Per-cycle cap on the multiplicative step relative to the current factor.
// Matches the legacy Turrigiano α=0.05 ceiling (~3% per cycle).
// source: Turrigiano & Nelson (2004) Nature Rev Neurosci 5:97–107 — synaptic scaling rate α≈0.05
const MAX_STEP = 0.03;

// ── Store interface ───────────────────────────────────────────────────────────

export interface BatchConnection {
  execute(sql: string, params: unknown[]): Promise<{ rowcount?: number }>;
}

export interface HomeostaticStore {
  getAllMemoriesForDecay(): Promise<Record<string, unknown>[]>;
  iterMemoriesForDecay?(): AsyncIterable<Record<string, unknown>[]>;
  getHomeostaticFactor(domain: string): Promise<number>;
  setHomeostaticFactor(domain: string, factor: number): Promise<void>;
  bumpHeatRaw(memoryId: number, newHeat: number): Promise<void>;
  acquireBatch(): BatchConnection;
}

// ── Public result types ───────────────────────────────────────────────────────

export type ScalingKind = "none" | "cohort_correction" | "scalar_update" | "fold";

export interface HomeostaticStageResult {
  scaling_applied: boolean;
  scaling_kind: ScalingKind;
  health_score: number | null;
  mean_heat: number | null;
  std_heat: number | null;
  bimodality: number | null;
  memories_scanned: number;
  reason?: string;
  bimodality_before?: number;
  bimodality_after?: number;
  bimodality_after_is_estimate?: boolean;
  factor?: number;
  factor_delta?: number;
  factor_pre_fold?: number;
  rows_folded?: number;
  cohort_size?: number;
  cohort_mean_heat_delta?: number;
  cohort_max_heat_delta?: number;
  cohort_rows_written?: number;
  reason_for_zero?: string;
  error?: string;
  duration_ms?: number;
}

// ── Streaming health ──────────────────────────────────────────────────────────

/**
 * Compute distribution health via server-side cursor + Welford moments.
 *
 * Uses store.iterMemoriesForDecay when available (Phase 4);
 * falls back to full materialization for SQLite / test fake stores.
 *
 * Precondition: store is a valid HomeostaticStore.
 * Postcondition: returns [health, count] where count is memories scanned.
 */
async function streamingHealth(
  store: HomeostaticStore,
): Promise<[DistributionHealth, number]> {
  if (store.iterMemoriesForDecay) {
    const allChunks: number[][] = [];
    for await (const chunk of store.iterMemoriesForDecay()) {
      allChunks.push(chunk.map((m) => (m["heat"] as number | undefined) ?? 0.5));
    }
    return computeDistributionHealthStreaming(allChunks, TARGET_HEAT);
  }

  // Fallback: full materialization
  const memories = await store.getAllMemoriesForDecay();
  const heats = memories.map((m) => (m["heat"] as number | undefined) ?? 0.5);
  const health = computeDistributionHealth(heats, TARGET_HEAT);
  return [health, heats.length];
}

// ── Scalar helpers ────────────────────────────────────────────────────────────

/**
 * Pick the most-frequent domain as the scaling key.
 *
 * Precondition: memories may be empty.
 * Postcondition: returns the domain string with highest count, or "" if empty.
 */
function dominantDomain(memories: readonly Record<string, unknown>[]): string {
  const counts = new Map<string, number>();
  for (const mem of memories) {
    const d = (mem["domain"] as string | undefined) ?? "";
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  if (counts.size === 0) return "";
  let best = "";
  let bestCount = 0;
  for (const [d, c] of counts) {
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Safely retrieve the homeostatic factor; returns 1.0 on any error.
 *
 * Precondition: store.getHomeostaticFactor may throw.
 * Postcondition: returns a positive float.
 */
async function safeGetFactor(store: HomeostaticStore, domain: string): Promise<number> {
  try {
    return await store.getHomeostaticFactor(domain);
  } catch {
    return 1.0;
  }
}

/**
 * Cap the per-cycle multiplicative step at ±MAX_STEP relative to old.
 *
 * Precondition: old > 0.
 * Postcondition: returned value is old * ratio where ratio in [1-maxStep, 1+maxStep].
 */
function clampStep(old: number, next: number, maxStep: number): number {
  if (old <= 0.0) return next;
  const ratio = Math.max(1.0 - maxStep, Math.min(1.0 + maxStep, next / old));
  return old * ratio;
}

/**
 * Fold when |log(factor)| > log(2.0) — factor not in [0.5, 2.0].
 *
 * Precondition: factor is a positive float.
 * Postcondition: returns true iff scalar has drifted past the prefilter boundary.
 */
function foldTriggered(factor: number): boolean {
  if (factor <= 0.0) return false;
  return Math.abs(Math.log(factor)) > FOLD_LOG_THRESHOLD;
}

/**
 * Multiply heat_base by factor, reset homeostatic_state.factor=1.0.
 *
 * Writes are bounded by the domain partition, skip protected/no_decay/stale.
 * Amortized once per month per domain under normal operation.
 * Phase 5: batched UPDATE runs on the batch pool.
 *
 * Precondition: store.acquireBatch() returns a connection with execute().
 * Postcondition: heat_base in [0.0, 1.0]; factor reset to 1.0; returns row count.
 */
async function applyFold(
  store: HomeostaticStore,
  domain: string,
  factor: number,
): Promise<number> {
  const conn = store.acquireBatch();
  const result = await conn.execute(
    "UPDATE memories " +
      "SET heat_base = LEAST(1.0, GREATEST(0.0, heat_base * $1)), " +
      "    heat_base_set_at = NOW() " +
      "WHERE domain = $2 " +
      "  AND NOT is_protected " +
      "  AND NOT no_decay " +
      "  AND NOT is_stale",
    [factor, domain ?? ""],
  );
  const rows = Number(result?.rowcount ?? 0);
  await store.setHomeostaticFactor(domain, 1.0);
  return rows;
}

// ── Dispatch branches ─────────────────────────────────────────────────────────

/**
 * One UPDATE on homeostatic_state.factor + optional fold.
 *
 * Replaces the legacy N-row Turrigiano UPDATE with one scalar write.
 * Fold (factor not in [0.5, 2.0]) writes heat_base per-row and resets
 * factor=1.0 — expected ~once/month per domain.
 *
 * Precondition: mean > MIN_SAFE_MEAN; memories available for domain detection.
 * Postcondition: factor updated or fold applied; scaling_kind set accordingly.
 */
async function applyScalar(
  store: HomeostaticStore,
  memories: readonly Record<string, unknown>[],
  mean: number,
  bimodality: number,
): Promise<Partial<HomeostaticStageResult>> {
  if (mean <= MIN_SAFE_MEAN) {
    return {
      scaling_applied: false,
      scaling_kind: "none",
      bimodality_before: bimodality,
      bimodality_after: bimodality,
      reason_for_zero: "mean_below_safety_floor",
    };
  }

  const domain = dominantDomain(memories);
  const factorOld = await safeGetFactor(store, domain);
  let factorNew = factorOld * (TARGET_HEAT / mean);
  factorNew = clampStep(factorOld, factorNew, MAX_STEP);

  // source: Turrigiano (2008) — convergence tolerance 0.5% of current factor; 4-decimal rounding for DB storage
  if (Math.abs(factorNew - factorOld) <= 0.005 * Math.max(factorOld, 1e-6)) {
    return {
      scaling_applied: false,
      scaling_kind: "none",
      bimodality_before: bimodality,
      bimodality_after: bimodality,
      reason_for_zero: "factor_stable",
      // source: Turrigiano (2008) — 4-decimal rounding for DB storage precision
      factor: Math.round(factorOld * 10000) / 10000,
    };
  }

  // scalar_update: heat_base is NOT rewritten — only homeostatic_state.factor changes.
  // Stored-heat distribution is literally identical → bimodality coefficient unchanged.
  // fold: heat_base IS rewritten per-row with [0.0, 1.0] clipping; when many rows
  // saturate the shape can shift, so on fold we report the pre-fold value as a bounded
  // estimate and flag that the post-fold value would require a re-scan to compute exactly.
  // See issue #14 OB4 — null was previously ambiguous.

  if (foldTriggered(factorNew)) {
    const rowsFolded = await applyFold(store, domain, factorNew);
    return {
      scaling_applied: true,
      scaling_kind: "fold",
      bimodality_before: bimodality,
      // fold clips heats at 0/1 — shape can shift slightly when many rows saturate.
      // We do NOT re-scan post-fold; the returned value is the pre-fold shape,
      // treated as a bounded estimate. Next consolidate will measure exactly.
      bimodality_after: bimodality,
      bimodality_after_is_estimate: true,
      // source: Turrigiano (2008) — 4-decimal rounding preserves precision for DB storage
      factor_pre_fold: Math.round(factorNew * 10000) / 10000,
      rows_folded: rowsFolded,
    };
  }

  await store.setHomeostaticFactor(domain, factorNew);
  return {
    scaling_applied: true,
    scaling_kind: "scalar_update",
    bimodality_before: bimodality,
    bimodality_after: bimodality,
    // source: Turrigiano (2008) — 4-decimal rounding preserves precision for DB storage
    factor: Math.round(factorNew * 10000) / 10000, // source: Turrigiano (2008)
    factor_delta: Math.round((factorNew - factorOld) * 10000) / 10000,
  };
}

/**
 * Bimodal path: pull the hot cohort toward target_mean.
 *
 * Per-row writes route through bumpHeatRaw (the I2 canonical writer).
 * Subtraction is not meaningful on a scalar factor, so this branch
 * writes heat_base directly.
 *
 * Darval O1 instrumentation: report per-row heat movement so operators can
 * see that cohort_correction DID pull rows down, even when bimodality (a
 * global shape metric) barely moves. The bimodality metric is slow-converging;
 * retrieval ranking cares about per-row heat, which heat_delta_* measures directly.
 *
 * Precondition: memories.length === heats.length; bimodality > BIMODALITY_TRIGGER.
 * Postcondition: cohort rows updated; bimodality_after reflects post-correction shape.
 */
async function applyCohort(
  store: HomeostaticStore,
  memories: readonly Record<string, unknown>[],
  heats: readonly number[],
  mean: number,
  std: number,
  bimodality: number,
): Promise<Partial<HomeostaticStageResult>> {
  const cohortIdx = detectHotCohort(heats, mean, std);
  if (!cohortIdx.length) {
    return {
      scaling_applied: false,
      scaling_kind: "none",
      bimodality_before: bimodality,
      // Empty cohort → no writes → shape unchanged.
      bimodality_after: bimodality,
      reason_for_zero: "bimodal_but_no_cohort_detected",
    };
  }

  const scaled = applyCohortCorrection(heats, cohortIdx, TARGET_HEAT);
  const afterHealth = computeDistributionHealth(scaled, TARGET_HEAT);

  const cohortSet = new Set(cohortIdx);
  const deltasAbs: number[] = [];
  let writes = 0;
  for (let i = 0; i < scaled.length; i++) {
    const newHeat = scaled[i] as number;
    const prevHeat = heats[i] as number;
    const delta = newHeat - prevHeat;
    // source: Turrigiano (2008) — skip writes below 0.1% heat delta; 4-decimal precision for DB
    if (Math.abs(delta) > 0.001) {
      const mem = memories[i];
      if (mem === undefined) continue;
      await store.bumpHeatRaw(
        mem["id"] as number,
        Math.round(newHeat * 10000) / 10000, // source: Turrigiano (2008) — 4-decimal precision
      );
      writes++;
    }
    if (cohortSet.has(i)) {
      deltasAbs.push(Math.abs(delta));
    }
  }
  const meanDelta =
    deltasAbs.reduce((s, d) => s + d, 0) / Math.max(deltasAbs.length, 1);
  const maxDelta = deltasAbs.length > 0 ? Math.max(...deltasAbs) : 0.0;

  return {
    scaling_applied: true,
    scaling_kind: "cohort_correction",
    bimodality_before: bimodality,
    bimodality_after: afterHealth.bimodality_coefficient,
    cohort_size: cohortIdx.length,
    // source: Turrigiano (2008) — 4-decimal rounding for telemetry precision
    cohort_mean_heat_delta: Math.round(meanDelta * 10000) / 10000, // source: Turrigiano (2008)
    cohort_max_heat_delta: Math.round(maxDelta * 10000) / 10000, // source: Turrigiano (2008)
    cohort_rows_written: writes,
  };
}

/**
 * Pick the right primitive given distribution health.
 *
 * Branching:
 *   1. healthy AND unimodal → no-op
 *   2. bimodal → cohort correction (per-row writes via bumpHeatRaw)
 *   3. off-target → scalar factor update, fold if drift > log(2.0)
 *
 * Precondition: health freshly computed; memories and heats are aligned.
 * Postcondition: returns the outcome from the chosen branch.
 */
async function dispatch(
  store: HomeostaticStore,
  memories: readonly Record<string, unknown>[],
  heats: readonly number[],
  health: DistributionHealth,
): Promise<Partial<HomeostaticStageResult>> {
  const bimodality = health.bimodality_coefficient;
  const mean = health.mean;
  const std = health.std;

  if (health.health_score >= 0.6 && bimodality <= BIMODALITY_TRIGGER) {
    return {
      scaling_applied: false,
      scaling_kind: "none",
      bimodality_before: bimodality,
      // Scale-invariant branch: no writes → shape unchanged.
      bimodality_after: bimodality,
    };
  }

  if (bimodality > BIMODALITY_TRIGGER) {
    return applyCohort(store, memories, heats, mean, std, bimodality);
  }

  return applyScalar(store, memories, mean, bimodality);
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

function logDiagnostics(outcome: Partial<HomeostaticStageResult>): void {
  if (
    outcome.scaling_kind === "cohort_correction" &&
    outcome.bimodality_after != null &&
    outcome.bimodality_before != null &&
    outcome.bimodality_after >= outcome.bimodality_before
  ) {
    console.warn(
      `Cohort correction did not reduce bimodality: ` +
        `before=${outcome.bimodality_before.toFixed(3)} ` +
        `after=${outcome.bimodality_after.toFixed(3)} ` +
        `cohort_size=${outcome.cohort_size}`,
    );
  }
  if (outcome.scaling_kind === "fold") {
    // stderr only — stdout is the MCP JSON-RPC channel (see index.ts header).
    console.error(
      `Homeostatic fold triggered: ` +
        `factor_pre_fold=${(outcome.factor_pre_fold ?? 0.0).toFixed(4)} ` +
        `rows_folded=${outcome.rows_folded ?? 0}`,
    );
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Update the domain's homeostatic factor; fold if drift is too large.
 *
 * Branching:
 *   1. healthy AND unimodal → no-op
 *   2. bimodal → cohort correction (per-row writes via bumpHeatRaw)
 *   3. off-target → scalar factor update, fold if drift > log(2.0)
 *
 * Phase 4: when memories=null, computes health metrics via a streaming
 * server-side cursor (store.iterMemoriesForDecay) + Welford moments.
 * Peak memory is O(chunk_size) instead of O(N) — crucial at 66K+ memory stores.
 * When the caller passes a pre-loaded list (hot-path consolidate sharing one
 * snapshot across stages), we use it directly.
 *
 * Precondition: store is a valid HomeostaticStore.
 * Postcondition: returned object carries health_score, mean_heat, std_heat,
 *   bimodality, memories_scanned. scaling_kind and scaling_applied reflect the
 *   branch taken.
 */
export async function runHomeostaticCycle(
  store: HomeostaticStore,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<HomeostaticStageResult> {
  try {
    let health: DistributionHealth;
    let mems: readonly Record<string, unknown>[];
    let count: number;

    if (memories === null) {
      // Streaming path: compute health without materializing the full list.
      const [h, c] = await streamingHealth(store);
      health = h;
      count = c;

      if (count === 0) {
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

      // For dispatch we still need the memory list for the cohort branch
      // (needs ids + per-row heats). Only materialize when bimodality triggers
      // the cohort path.
      if (health.bimodality_coefficient > BIMODALITY_TRIGGER) {
        mems = await store.getAllMemoriesForDecay();
      } else {
        mems = []; // not needed for scalar / no-op paths
      }
    } else {
      if (!memories.length) {
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
      mems = memories;
      const heats = mems.map((m) => (m["heat"] as number | undefined) ?? 0.5);
      health = computeDistributionHealth(heats, TARGET_HEAT);
      count = mems.length;
    }

    const heats = mems.map((m) => (m["heat"] as number | undefined) ?? 0.5);
    const outcome = await dispatch(store, mems, heats, health);
    logDiagnostics(outcome);

    return {
      scaling_applied: outcome.scaling_applied ?? false,
      scaling_kind: outcome.scaling_kind ?? "none",
      ...outcome,
      health_score: health.health_score,
      mean_heat: health.mean,
      std_heat: health.std,
      bimodality: health.bimodality_coefficient,
      memories_scanned: mems.length > 0 ? mems.length : count,
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
