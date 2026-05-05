/**
 * Homeostatic plasticity — distribution health metrics.
 *
 * Split from homeostatic_plasticity.py to keep files under 300 lines.
 * Computes statistical health metrics for value distributions (heats, weights)
 * to determine whether homeostatic mechanisms need to intervene.
 *
 * References:
 *   Pfister R et al. (2013) "Good things peak in pairs: a note on the
 *       bimodality coefficient." Frontiers in Psychology 4:700
 *   Pébay P (2008) "Formulas for Robust, One-Pass Parallel Computation of
 *       Covariances and Arbitrary-Order Statistical Moments." Sandia Report
 *       SAND2008-6212. Equations 2.1 (M1), 2.2 (M2), 2.3 (M3), 2.4 (M4).
 *
 * Port of: mcp_server/core/homeostatic_health.py
 * Pure business logic — no I/O.
 */

export interface DistributionHealth {
  mean: number;
  std: number;
  skew: number;
  kurtosis_excess: number;
  deviation_from_target: number;
  bimodality_coefficient: number;
  health_score: number;
}

const EMPTY_HEALTH: DistributionHealth = {
  mean: 0.0,
  std: 0.0,
  skew: 0.0,
  kurtosis_excess: 0.0,
  deviation_from_target: 1.0,
  bimodality_coefficient: 0.0,
  health_score: 0.0,
};

/**
 * Compute mean, std, skewness, and excess kurtosis in a single pass.
 *
 * Uses Welford's online algorithm extended to third and fourth central
 * moments (Pébay 2008, §2, equations 2.1–2.4). We maintain running
 * M2 (sum of squared deviations), M3 (sum of cubed deviations),
 * and M4 (sum of quartic deviations) via the incremental update
 * formulas. This is numerically stable and touches each value once.
 *
 * Precondition: values is an array of finite numbers.
 * Postcondition: results are within 1e-9 of the four-pass implementation
 *   on any well-conditioned input (Pébay 2008, §4 stability analysis).
 * Invariant (per iteration): after processing n values, (m1, M2, M3, M4)
 *   equal the exact running moments for the first n values.
 *
 * Source: Pébay (2008) SAND2008-6212, equations 2.1–2.4.
 */
function computeMoments(values: number[]): [number, number, number, number] {
  let n = 0;
  let m1 = 0.0;
  let m2 = 0.0;
  let m3 = 0.0;
  let m4 = 0.0;

  for (const x of values) {
    const n1 = n;
    n += 1;
    const delta = x - m1;
    const deltaN = delta / n;
    const deltaN2 = deltaN * deltaN;
    const term1 = delta * deltaN * n1;

    // Fourth moment must be updated before M3 and M2 (depends on old M2, M3).
    m4 +=
      term1 * deltaN2 * (n * n - 3 * n + 3) +
      6.0 * deltaN2 * m2 -
      4.0 * deltaN * m3;
    // Third moment depends on old M2, must precede M2 update.
    m3 += term1 * deltaN * (n - 2) - 3.0 * deltaN * m2;
    m2 += term1;
    m1 += deltaN;
  }

  if (n === 0) {
    return [0.0, 0.0, 0.0, 0.0];
  }

  const variance = m2 / Math.max(n - 1, 1);
  const std = Math.sqrt(variance);

  let skew = 0.0;
  let kurtosis = 0.0;
  if (std > 1e-10) {
    skew = m3 / (n * std ** 3);
    kurtosis = m4 / (n * std ** 4) - 3.0;
  }

  return [m1, std, skew, kurtosis];
}

/**
 * Compute overall health score from distribution statistics.
 *
 * Health = 1.0 (perfectly healthy) to 0.0 (needs intervention).
 * Penalizes: high deviation, high bimodality, extreme skew, low variance.
 *
 * Precondition: all arguments are finite numbers.
 * Postcondition: result is clamped to [0, 1].
 */
function computeHealthScore(
  deviation: number,
  bimodality: number,
  skew: number,
  std: number,
): number {
  let health = 1.0;
  health -= Math.min(deviation * 2.0, 0.4);
  health -= Math.min(Math.max(bimodality - 0.4, 0) * 1.5, 0.3);
  health -= Math.min(Math.abs(skew) * 0.15, 0.2);
  if (std < 0.05) health -= 0.1;
  return Math.max(0.0, Math.min(1.0, health));
}

function healthFromMoments(
  mean: number,
  std: number,
  skew: number,
  kurtosis: number,
  targetMean: number,
): DistributionHealth {
  // Pfister 2013 bimodality coefficient formula
  const bimodality = (skew ** 2 + 1) / Math.max(kurtosis + 3, 0.01);
  const deviation = Math.abs(mean - targetMean);
  const health = computeHealthScore(deviation, bimodality, skew, std);

  return {
    mean: Math.round(mean * 10000) / 10000,
    std: Math.round(std * 10000) / 10000,
    skew: Math.round(skew * 10000) / 10000,
    kurtosis_excess: Math.round(kurtosis * 10000) / 10000,
    deviation_from_target: Math.round(deviation * 10000) / 10000,
    bimodality_coefficient: Math.round(bimodality * 10000) / 10000,
    health_score: Math.round(health * 10000) / 10000,
  };
}

/**
 * Compute health metrics for a distribution of values (heats, weights, etc.).
 *
 * Returns metrics that indicate whether homeostatic mechanisms are needed.
 *
 * @param values - List of values (e.g., heats).
 * @param targetMean - Desired mean value.
 * @returns Health metrics with scores indicating intervention need.
 *
 * Precondition: values is an array of finite floats.
 * Postcondition: health_score in [0,1]; deviation_from_target >= 0.
 */
export function computeDistributionHealth(
  values: number[],
  targetMean: number,
): DistributionHealth {
  if (values.length === 0) {
    return { ...EMPTY_HEALTH };
  }
  const [mean, std, skew, kurtosis] = computeMoments(values);
  return healthFromMoments(mean, std, skew, kurtosis, targetMean);
}

/** Raw moments tuple for a single chunk — inputs to pairwise merge formulas. */
type RawMoments = [n: number, m1: number, m2: number, m3: number, m4: number];

/**
 * Raw (n, M1, M2, M3, M4) for a single chunk — inputs to pairwise merge
 * formulas in computeDistributionHealthStreaming.
 *
 * Source: Pébay (2008) SAND2008-6212 §3.1 (pairwise merge of moments).
 */
function chunkRawMoments(values: number[]): RawMoments {
  let n = 0;
  let m1 = 0.0;
  let m2 = 0.0;
  let m3 = 0.0;
  let m4 = 0.0;
  for (const x of values) {
    const n1 = n;
    n += 1;
    const delta = x - m1;
    const deltaN = delta / n;
    const deltaN2 = deltaN * deltaN;
    const term1 = delta * deltaN * n1;
    m4 +=
      term1 * deltaN2 * (n * n - 3 * n + 3) +
      6.0 * deltaN2 * m2 -
      4.0 * deltaN * m3;
    m3 += term1 * deltaN * (n - 2) - 3.0 * deltaN * m2;
    m2 += term1;
    m1 += deltaN;
  }
  return [n, m1, m2, m3, m4];
}

/**
 * Streaming moments over chunks of values — never fully materializes the list.
 *
 * Applies Pébay 2008 pairwise-combination formulas to merge chunk moments into
 * running totals — mathematically identical to computeDistributionHealth on the
 * concatenated list, but peak memory is O(chunk) not O(total).
 *
 * @param valueChunks - Iterable yielding arrays of floats.
 * @param targetMean - Desired mean value.
 * @returns [health, totalCount].
 *
 * Source: Pébay (2008) SAND2008-6212 §3.1 (pairwise merge of moments).
 * Precondition: each chunk element is a finite float.
 * Postcondition: health result is numerically identical to computeDistributionHealth
 *   applied to the concatenated chunks.
 */
export function computeDistributionHealthStreaming(
  valueChunks: Iterable<number[]>,
  targetMean: number,
): [DistributionHealth, number] {
  // Running aggregated moments (Pébay §3.1 notation).
  let n = 0;
  let m1 = 0.0;
  let m2 = 0.0;
  let m3 = 0.0;
  let m4 = 0.0;

  for (const chunk of valueChunks) {
    if (chunk.length === 0) continue;
    const [nB, m1B, m2B, m3B, m4B] = chunkRawMoments(chunk);
    if (nB === 0) continue;
    if (n === 0) {
      [n, m1, m2, m3, m4] = [nB, m1B, m2B, m3B, m4B];
      continue;
    }
    // Pairwise combine running (a) and chunk (b) moments.
    // Pébay 2008 §3.1 equations 2.1–2.4.
    const nAb = n + nB;
    const delta = m1B - m1;
    const deltaN = delta / nAb;
    const deltaN2 = deltaN * deltaN;
    const naNb = n * nB;

    const m4New =
      m4 +
      m4B +
      delta * deltaN * deltaN2 * naNb * (n * n - naNb + nB * nB) +
      6 * deltaN2 * (n * n * m2B + nB * nB * m2) +
      4 * deltaN * (n * m3B - nB * m3);
    const m3New =
      m3 +
      m3B +
      delta * deltaN2 * naNb * (n - nB) +
      3 * deltaN * (n * m2B - nB * m2);
    const m2New = m2 + m2B + delta * deltaN * naNb;
    const m1New = m1 + deltaN * nB;

    n = nAb;
    m1 = m1New;
    m2 = m2New;
    m3 = m3New;
    m4 = m4New;
  }

  if (n === 0) {
    return [{ ...EMPTY_HEALTH }, 0];
  }

  const variance = m2 / Math.max(n - 1, 1);
  const std = Math.sqrt(variance);
  let skew = 0.0;
  let kurtosis = 0.0;
  if (std > 1e-10) {
    skew = m3 / (n * std ** 3);
    kurtosis = m4 / (n * std ** 4) - 3.0;
  }

  return [healthFromMoments(m1, std, skew, kurtosis, targetMean), n];
}
