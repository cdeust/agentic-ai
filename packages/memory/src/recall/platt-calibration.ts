/**
 * Platt scaling calibration for FlashRank cross-encoder scores.
 *
 * Fits a logistic regression P(useful | raw_score) = 1 / (1 + exp(A*s + B))
 * over (raw_score, label) pairs collected from user rate_memory feedback.
 *
 * Important context — historical ablation (2026-04-03, see reranker.ts):
 *   Platt-style calibration with HAND-PICKED A, B on benchmark data
 *   regressed every benchmark (BEAM -0.148, LoCoMo -5.1pp MRR). This
 *   module targets a DIFFERENT input distribution: user rate_memory
 *   feedback, not benchmark max_CE. Whether it improves ranking is an
 *   empirical question — the calibration is loaded only after MIN_SAMPLES
 *   real ratings.
 *
 * Pure business logic — no I/O. Fitting uses Newton-Raphson on the
 * log-likelihood, which is the standard stable approach for Platt's
 * 2-parameter sigmoid.
 *
 * Port of: cortex@ed33435 mcp_server/core/platt_calibration.py
 *
 * Reference:
 *   Platt, J. C. (1999). "Probabilistic outputs for support vector
 *     machines and comparisons to regularized likelihood methods."
 *     Advances in Large Margin Classifiers, MIT Press.
 */

// ── Defaults ──────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/platt_calibration.py:34-38
// Source for limits: Platt 1999 §2.1, stable numerical limits

export const MIN_SAMPLES = 50;          // source: cortex@ed33435 mcp_server/core/platt_calibration.py:36
export const MAX_ITERATIONS = 100;      // source: cortex@ed33435 mcp_server/core/platt_calibration.py:37
export const CONVERGENCE_TOL = 1e-6;   // source: cortex@ed33435 mcp_server/core/platt_calibration.py:38

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Fitted logistic regression parameters for Platt scaling.
 *
 * Invariants:
 *   - A and B are finite real numbers.
 *   - nSamples is the training-set size at fit time.
 *   - When applied: P = 1 / (1 + exp(A * raw_score + B)).
 *
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py:41-53
 */
export interface PlattParams {
  readonly A: number;
  readonly B: number;
  readonly nSamples: number;
}

/**
 * One (raw_score, label) pair from user rate_memory feedback.
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py:59-68
 */
export interface TrainingSample {
  rawScore: number;
  label: 0 | 1;
}

// ── Numerical helpers ─────────────────────────────────────────────────────

/**
 * Numerically stable sigmoid.
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py:74-81
 */
function sigmoid(x: number): number {
  if (x >= 0) {
    const ex = Math.exp(-x);
    return 1.0 / (1.0 + ex);
  }
  const ex = Math.exp(x);
  return ex / (1.0 + ex);
}

/**
 * Predicted P(useful | s) under parameters (A, B).
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py:83-85
 */
function predictPlatt(A: number, B: number, s: number): number {
  return sigmoid(-(A * s + B));
}

// ── Fit ───────────────────────────────────────────────────────────────────

/**
 * Fit A, B via Newton-Raphson on the logistic log-likelihood.
 *
 * precondition:  samples is an array; each entry has rawScore in R and
 *   label in {0, 1}.
 * postcondition: returns null if samples.length < minSamples OR if all
 *   labels are identical (degenerate). Otherwise returns finite PlattParams
 *   where A, B are the MLE solution to the Bernoulli log-likelihood under
 *   the sigmoid.
 *
 * Newton-Raphson updates (Platt 1999 §2.1):
 *   grad = sum_i (p_i - t_i) * [-s_i, -1]
 *   Hess = sum_i p_i * (1 - p_i) * [[s_i^2, s_i], [s_i, 1]]
 *   [A, B] -= Hess^-1 @ grad
 *
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py:88-164
 */
export function fitPlatt(
  samples: TrainingSample[],
  minSamples = MIN_SAMPLES,
  maxIter = MAX_ITERATIONS,
  tol = CONVERGENCE_TOL,
): PlattParams | null {
  const n = samples.length;
  if (n < minSamples) return null;

  const labels = samples.map((s) => s.label);
  const allSame = labels.every((l) => l === labels[0]);
  if (allSame) return null;

  // Good initial guess per Platt 1999 Eq. (4): based on class-prior.
  const nPos = labels.filter((l) => l === 1).length;
  const nNeg = n - nPos;
  let A = 0.0;
  let B = Math.log((nNeg + 1.0) / (nPos + 1.0));

  for (let iter = 0; iter < maxIter; iter++) {
    let gA = 0.0, gB = 0.0;
    let hAA = 0.0, hAB = 0.0, hBB = 0.0;

    for (const sample of samples) {
      const s = sample.rawScore;
      const y = sample.label;
      const p = sigmoid(-(A * s + B));
      // Platt smoothing targets (1999 Eq. 7)
      const t = y === 1
        ? (1.0 - 1.0 / (nNeg + 2.0))
        : 1.0 / (nPos + 2.0);
      const d = p - t;
      gA += d * (-s);
      gB += d * (-1.0);
      const w = p * (1.0 - p);
      hAA += w * s * s;
      hAB += w * s;
      hBB += w;
    }

    // Gradient norm test
    if (Math.sqrt(gA * gA + gB * gB) < tol) break;

    // Solve 2x2 Hessian
    const det = hAA * hBB - hAB * hAB;
    if (Math.abs(det) < 1e-12) break; // Hessian singular
    const inv = 1.0 / det;
    A -= inv * (hBB * gA - hAB * gB);
    B -= inv * (-hAB * gA + hAA * gB);
  }

  if (!isFinite(A) || !isFinite(B)) return null;
  return { A, B, nSamples: n };
}

// ── Apply ─────────────────────────────────────────────────────────────────

/**
 * Return the calibrated P(useful | raw_score).
 *
 * precondition:  rawScore is finite; params is either null or a fitted PlattParams.
 * postcondition: returns rawScore unchanged when params is null (no-op fallback);
 *   otherwise returns a probability in (0, 1) via sigmoid(-(A*s + B)).
 *
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py:170-180
 */
export function calibrateScore(
  rawScore: number,
  params: PlattParams | null,
): number {
  if (params === null) return rawScore;
  return predictPlatt(params.A, params.B, rawScore);
}

/**
 * Vectorised apply for a list of raw CE scores.
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py:183-190
 */
export function calibrateScores(
  rawScores: number[],
  params: PlattParams | null,
): number[] {
  if (params === null) return [...rawScores];
  return rawScores.map((s) => predictPlatt(params.A, params.B, s));
}

/**
 * Fraction of (useful, not-useful) pairs where calibrated(useful) > calibrated(not-useful).
 *
 * precondition:  usefulScores and notUsefulScores are float arrays.
 * postcondition: result ∈ [0, 1]. Returns 0.5 when either list is empty.
 *
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py:196-221
 */
export function pairwiseDiscrimination(
  params: PlattParams | null,
  usefulScores: number[],
  notUsefulScores: number[],
): number {
  const calibratedUseful = calibrateScores(usefulScores, params);
  const calibratedNot = calibrateScores(notUsefulScores, params);
  if (calibratedUseful.length === 0 || calibratedNot.length === 0) return 0.5;

  let total = 0;
  let wins = 0;
  for (const u of calibratedUseful) {
    for (const notU of calibratedNot) {
      total++;
      if (u > notU) wins++;
    }
  }
  return total > 0 ? wins / total : 0.5;
}
