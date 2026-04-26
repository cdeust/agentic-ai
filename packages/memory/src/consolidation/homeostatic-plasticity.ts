/**
 * Homeostatic plasticity — network-level stability mechanisms.
 *
 * Without homeostasis, Hebbian learning is unstable: strong memories get stronger
 * (runaway potentiation), weak memories get weaker (catastrophic depression), and
 * the system collapses to either all-hot or all-cold. Biology prevents this via
 * homeostatic mechanisms that maintain target activity levels.
 *
 * Three homeostatic mechanisms:
 *
 * 1. Synaptic Scaling (Turrigiano 2008; Tetzlaff et al. 2011)
 *    Multiplicative scaling: delta_w = alpha * w * (r_target - r_actual).
 *    All weights scale proportionally, preserving relative ordering —
 *    Turrigiano's key experimental finding.
 *    // source: Tetzlaff C, Kolbe C, Dasgupta S, Bhatt DK (2011)
 *      "Time scales of memory, learning, and plasticity."
 *      Frontiers in Computational Neuroscience 5:47, Eq. 3.
 *    // source: Houweling AR et al. (2005) "Homeostatic synaptic plasticity can
 *      explain post-traumatic epileptogenesis." Cerebral Cortex 15:834-845.
 *
 * 2. Metaplasticity / BCM Threshold (Abraham & Bear 1996)
 *    Sliding modification threshold: theta_M = E[c^2].
 *    BCM phi function: phi(c, theta_m) = c * (c - theta_m).
 *    // source: Bienenstock EL, Cooper LN, Munro PW (1982) J Neuroscience 2:32-48.
 *
 * 3. Intrinsic Excitability Regulation
 *    Engineering heuristic (no paper source). Gain 0.1 is hand-tuned.
 *
 * Cohort correction (bimodal distributions):
 *    // source: Wilcox RR (2012) "Modern Statistics for the Behavioral Sciences",
 *      ch. 4 — sigma-rule outlier detection for non-Gaussian distributions.
 *    // source: Hinton & Salakhutdinov (2006) "Reducing the Dimensionality of
 *      Data with Neural Networks." Science 313:504-507 — subtractive
 *      renormalization to break mode collapse.
 *    // source: Pfister et al. (2013) "Good things peak in pairs." Frontiers in
 *      Computational Neuroscience. Bimodality test for homeostatic state.
 *      Pfister threshold has false-positives on platykurtic unimodal.
 *    // source: Wilcox RR (2012) bimodality coefficient < 5/9 indicates unimodal.
 *
 * Port of: mcp_server/core/homeostatic_plasticity.py
 * Pure business logic — no I/O.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

// Target mean heat for synaptic scaling. Hand-tuned for Cortex memory system.
const TARGET_HEAT = 0.4;

// Scaling rate alpha in delta_w = alpha * w * (r_target - r_actual).
// Hand-tuned: 0.05 gives gentle convergence (~20 cycles to halve a deviation).
const SCALING_RATE = 0.05;

// BCM threshold EMA decay. Hand-tuned: 0.95 gives ~20-step memory.
const BCM_THETA_DECAY = 0.95;

// Excitability bounds. Hand-tuned engineering heuristic.
const MIN_GLOBAL_EXCITABILITY = 0.1;
const MAX_GLOBAL_EXCITABILITY = 0.9;

// Target fraction of engram slots that should be "active" (excitability >= 0.5).
// Hand-tuned engineering heuristic.
const TARGET_ACTIVE_FRACTION = 0.3;

// Sigma multiplier for hot-cohort detection.
// // source: Wilcox (2012) sigma rule for non-Gaussian outlier identification.
// 0.5 comfortably separates the upper peak even when the two peaks have
// equal mass and symmetric spread.
const DEFAULT_COHORT_SIGMA = 0.5;

// Fraction of (heat - target_mean) gap removed per cycle.
// 0.3 gives gentle convergence: chosen to halve the gap in ~2 cycles.
// // source: Hinton & Salakhutdinov (2006); general pattern for breaking mode collapse.
const DEFAULT_COHORT_STRENGTH = 0.3;

// ── Synaptic Scaling (Turrigiano 2008; Tetzlaff et al. 2011) ─────────────────

/**
 * Compute multiplicative scaling factor from Turrigiano synaptic scaling.
 *
 * Implements: delta_w = alpha * w * (r_target - r_actual)
 * // source: Tetzlaff et al. (2011) Frontiers in Computational Neuroscience 5:47, Eq. 3.
 *
 * w_new = w + delta_w = w * (1 + alpha * (r_target - r_actual))
 * factor = 1 + alpha * (r_target - r_actual)
 *
 * This is continuous (no dead zone) — Turrigiano scaling is always active,
 * and naturally produces no change when r_actual == r_target.
 */
export function computeScalingFactor(
  currentAvgHeat: number,
  targetHeat = TARGET_HEAT,
  scalingRate = SCALING_RATE,
): number {
  return 1.0 + scalingRate * (targetHeat - currentAvgHeat);
}

/**
 * Apply multiplicative scaling to a list of heat values.
 *
 * Preserves relative ordering (Turrigiano's key finding) and clamps to [0, 1].
 */
export function applySynapticScaling(
  heats: readonly number[],
  scalingFactor: number,
): number[] {
  return heats.map((h) => Math.max(0.0, Math.min(1.0, h * scalingFactor)));
}

// ── Metaplasticity (BCM Threshold) ────────────────────────────────────────────

/**
 * Compute the sliding BCM modification threshold.
 *
 * BCM theory (Bienenstock, Cooper & Munro 1982):
 *     theta_M = E[c^2]
 *
 * Updated via EMA: theta_new = decay * theta_old + (1 - decay) * E[c^2].
 * High activity -> high threshold -> LTP harder (prevents saturation).
 * Low activity -> low threshold -> LTP easier (prevents collapse).
 * // source: Abraham WC, Bear MF (1996) Metaplasticity. Trends Neurosci 19:126-130.
 */
export function computeBcmThreshold(
  recentActivityLevels: readonly number[],
  currentThreshold = 0.5,
  decay = BCM_THETA_DECAY,
): number {
  if (recentActivityLevels.length === 0) return currentThreshold;
  const avgSquared =
    recentActivityLevels.reduce((s, a) => s + a * a, 0) / recentActivityLevels.length;
  return decay * currentThreshold + (1 - decay) * avgSquared;
}

/**
 * Compute LTP/LTD rate modulation using the BCM phi function.
 *
 * BCM phi (Bienenstock, Cooper & Munro 1982, Eq. 3):
 *     phi(c, theta_m) = c * (c - theta_m)
 *
 * When c > theta_m: phi > 0 -> LTP.
 * When 0 < c < theta_m: phi < 0 -> LTD.
 *
 * Returns (ltpMultiplier, ltdMultiplier). Both in [0, 2].
 */
export function computeLtpLtdModulation(
  memoryHeat: number,
  bcmThreshold: number,
): [number, number] {
  const phi = memoryHeat * (memoryHeat - bcmThreshold);

  if (phi >= 0) {
    const ltpMult = Math.min(2.0, 1.0 + phi);
    const ltdMult = Math.max(0.0, 1.0 - phi);
    return [ltpMult, ltdMult];
  } else {
    const absPhi = Math.abs(phi);
    const ltdMult = Math.min(2.0, 1.0 + absPhi);
    const ltpMult = Math.max(0.0, 1.0 - absPhi);
    return [ltpMult, ltdMult];
  }
}

// ── Intrinsic Excitability Regulation ─────────────────────────────────────────

/**
 * Compute global excitability adjustment for engram slots.
 *
 * Engineering heuristic (no paper source). If too many slots are highly
 * excitable, global excitability is dampened. If too few, boost it.
 * The gain of 0.1 is hand-tuned for gentle convergence.
 *
 * @returns Additive adjustment. Positive = boost, negative = dampen.
 */
export function computeExcitabilityAdjustment(
  excitabilities: readonly number[],
  opts: {
    targetActiveFraction?: number;
    activeThreshold?: number;
  } = {},
): number {
  if (excitabilities.length === 0) return 0.0;
  const { targetActiveFraction = TARGET_ACTIVE_FRACTION, activeThreshold = 0.5 } = opts;
  const activeCount = excitabilities.filter((e) => e >= activeThreshold).length;
  const currentFraction = activeCount / excitabilities.length;
  const deviation = targetActiveFraction - currentFraction;
  return deviation * 0.1;
}

/**
 * Apply global adjustment and clamp excitability to safe bounds.
 *
 * Bounds [0.1, 0.9] are hand-tuned to prevent complete silencing or
 * runaway excitation.
 */
export function applyExcitabilityBounds(
  excitability: number,
  adjustment = 0.0,
): number {
  return Math.max(
    MIN_GLOBAL_EXCITABILITY,
    Math.min(MAX_GLOBAL_EXCITABILITY, excitability + adjustment),
  );
}

// ── Cohort Correction (bimodal distributions) ─────────────────────────────────

/**
 * Return indices of memories in the hot cohort (heat > mean + sigma*std).
 *
 * // source: Wilcox (2012) sigma rule for non-Gaussian outlier identification.
 */
export function detectHotCohort(
  heats: readonly number[],
  mean: number,
  std: number,
  cohortThresholdSigma = DEFAULT_COHORT_SIGMA,
): number[] {
  if (heats.length === 0 || std <= 0) return [];
  const threshold = mean + cohortThresholdSigma * std;
  return heats.reduce<number[]>((acc, h, i) => {
    if (h > threshold) acc.push(i);
    return acc;
  }, []);
}

/**
 * Subtractively pull the hot cohort toward targetMean; others untouched.
 *
 * Unlike multiplicative scaling, this is NOT order-preserving across the
 * full set — that is the point: collapsing the upper mode toward the target
 * merges it with the lower mode over repeated cycles.
 *
 * // source: Hinton & Salakhutdinov (2006); general pattern for breaking
 *   mode collapse in self-supervised representation learning.
 */
export function applyCohortCorrection(
  heats: readonly number[],
  cohortIndices: readonly number[],
  targetMean: number,
  correctionStrength = DEFAULT_COHORT_STRENGTH,
): number[] {
  const cohortSet = new Set(cohortIndices);
  return heats.map((h, i) => {
    if (!cohortSet.has(i)) return h;
    const delta = correctionStrength * (h - targetMean);
    return Math.max(0.0, Math.min(1.0, h - delta));
  });
}
