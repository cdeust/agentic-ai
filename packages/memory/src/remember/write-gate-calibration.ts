/**
 * write-gate-calibration.ts — EMA-based write-gate threshold auto-calibration.
 *
 * Ports: core/write_gate_calibration.py
 *
 * All exported functions are pure (no I/O). Module-level state
 * (_STATES map) is process-local and monotonically tolerant of restarts —
 * the EMA seed means convergence re-establishes in ~50 observations.
 *
 * Correctness invariants:
 *   I1. CalibrationState.threshold ∈ [MIN_THRESHOLD, MAX_THRESHOLD].
 *   I2. CalibrationState.acceptanceEma ∈ [0, 1].
 *   I3. CalibrationState.totalObservations >= 0; monotonically increasing.
 *   I4. lastAdjustmentAt <= totalObservations at all times.
 *
 * References:
 *   Jaynes, E.T. (2003). Probability Theory: The Logic of Science.
 *       Cambridge University Press. Ch. 11 — the principle of maximum
 *       entropy implies 50% acceptance maximises information per decision.
 *   Taleb, N.N. (2012). Antifragile: Things That Gain from Disorder.
 *       Random House. — systems that calibrate from their own rejection
 *       signal are antifragile to distribution shift.
 */

import type { CalibrationState } from "./types.js";

// ── Control constants (source: operational defaults, see module docstring) ──
// source: Jaynes, E.T. (2003). Probability Theory. Cambridge. Ch. 11.
export const TARGET_ACCEPTANCE_RATE = 0.5; // max-entropy operating point
export const EMA_DECAY = 0.95; // ~20-sample effective memory window
export const ADJUSTMENT_STEP = 0.02; // bounded per-update threshold delta
export const TOLERANCE_BAND = 0.15; // |observed - target| below this → no adjust
export const MIN_THRESHOLD = 0.05; // floor: below this, almost everything stores
export const MAX_THRESHOLD = 0.95; // ceiling: above this, almost nothing stores
export const MIN_SAMPLES_BEFORE_ADJUST = 20; // avoid adjusting on cold-start noise

// ── EMA update ─────────────────────────────────────────────────────────────

/**
 * Update the accept-rate EMA after one gate decision.
 *
 * precondition:  0 <= currentEma <= 1; 0 < decay < 1.
 * postcondition: returned value in [0, 1]; EMA moves toward 1 if accepted,
 *   toward 0 otherwise, at rate (1 - decay).
 *
 * The standard one-sided EMA update rule:
 *   EMA' = decay * EMA + (1 - decay) * observation
 * where observation = 1 if accepted else 0.
 */
export function updateAcceptanceEma(
  currentEma: number,
  accepted: boolean,
  decay = EMA_DECAY,
): number {
  const observation = accepted ? 1.0 : 0.0;
  const newEma = decay * currentEma + (1.0 - decay) * observation;
  // Clamp — floating-point drift is not a real invariant violation.
  return Math.max(0.0, Math.min(1.0, newEma));
}

// ── Threshold adjustment ────────────────────────────────────────────────────

/**
 * Return the new threshold given the current acceptance EMA.
 *
 * precondition:  0 <= acceptanceEma <= 1; MIN <= currentThreshold <= MAX.
 * postcondition: returned threshold in [MIN_THRESHOLD, MAX_THRESHOLD].
 *   - If |acceptanceEma - target| <= tolerance → threshold unchanged.
 *   - If EMA > target + tolerance (too permissive) → raise threshold.
 *   - If EMA < target - tolerance (too strict) → lower threshold.
 *
 * Direction invariant: gate predicate is ``novelty >= threshold``; high
 * acceptance means gate is too permissive → raise threshold.
 */
export function computeThresholdAdjustment(
  currentThreshold: number,
  acceptanceEma: number,
  options?: {
    target?: number;
    step?: number;
    tolerance?: number;
    minThreshold?: number;
    maxThreshold?: number;
  },
): number {
  const target = options?.target ?? TARGET_ACCEPTANCE_RATE;
  const step = options?.step ?? ADJUSTMENT_STEP;
  const tolerance = options?.tolerance ?? TOLERANCE_BAND;
  const minT = options?.minThreshold ?? MIN_THRESHOLD;
  const maxT = options?.maxThreshold ?? MAX_THRESHOLD;

  const delta = acceptanceEma - target;
  if (Math.abs(delta) <= tolerance) return currentThreshold;
  const direction = delta > 0 ? step : -step;
  return Math.max(minT, Math.min(maxT, currentThreshold + direction));
}

// ── State lifecycle ─────────────────────────────────────────────────────────

/**
 * Record one gate decision and (possibly) adjust the threshold.
 *
 * precondition:  state satisfies invariants I1–I4.
 * postcondition: returned state has totalObservations = prev + 1, EMA
 *   updated, and threshold adjusted IFF totalObservations >= minSamples
 *   AND |EMA - target| > tolerance. When adjusted, lastAdjustmentAt
 *   is set to the new totalObservations.
 *
 * Returns a NEW CalibrationState — the function does not mutate the input.
 */
export function observeGateDecision(
  state: CalibrationState,
  accepted: boolean,
  minSamples = MIN_SAMPLES_BEFORE_ADJUST,
): CalibrationState {
  const newEma = updateAcceptanceEma(state.acceptanceEma, accepted);
  const newTotal = state.totalObservations + 1;

  if (newTotal < minSamples) {
    return {
      domain: state.domain,
      threshold: state.threshold,
      acceptanceEma: newEma,
      totalObservations: newTotal,
      lastAdjustmentAt: state.lastAdjustmentAt,
    };
  }

  const newThreshold = computeThresholdAdjustment(state.threshold, newEma);
  const newLastAdj =
    newThreshold !== state.threshold ? newTotal : state.lastAdjustmentAt;

  return {
    domain: state.domain,
    threshold: newThreshold,
    acceptanceEma: newEma,
    totalObservations: newTotal,
    lastAdjustmentAt: newLastAdj,
  };
}

// ── Registry (per-process, per-domain) ─────────────────────────────────────
// Local state is process-scoped. Safe because calibration is monotonically
// tolerant of restarts: seeding back to the default threshold converges in
// ~50 observations.

const _STATES = new Map<string, CalibrationState>();

function makeInitialState(
  domain: string,
  defaultThreshold: number,
): CalibrationState {
  return {
    domain,
    threshold: defaultThreshold,
    acceptanceEma: TARGET_ACCEPTANCE_RATE, // seed at target
    totalObservations: 0,
    lastAdjustmentAt: 0,
  };
}

/**
 * Fetch or lazily-initialise the calibration state for a domain.
 *
 * postcondition: returned state satisfies invariants I1–I4.
 */
export function getState(
  domain: string,
  defaultThreshold = 0.4,
): CalibrationState {
  const key = domain || "";
  if (!_STATES.has(key)) {
    _STATES.set(key, makeInitialState(key, defaultThreshold));
  }
  return _STATES.get(key)!;
}

/**
 * Observe a decision and persist the updated state.
 *
 * postcondition: _STATES[domain] reflects the new state.
 */
export function record(
  domain: string,
  accepted: boolean,
  defaultThreshold = 0.4,
): CalibrationState {
  const state = getState(domain, defaultThreshold);
  const newState = observeGateDecision(state, accepted);
  _STATES.set(domain || "", newState);
  return newState;
}

/** Test hook: clear the in-process calibration registry. */
export function resetAllStates(): void {
  _STATES.clear();
}

/**
 * Return the calibration-adjusted threshold for a domain.
 *
 * Falls back to defaultThreshold when no calibration state exists
 * (cold start — first write ever for this domain).
 */
export function effectiveThreshold(
  domain: string,
  defaultThreshold = 0.4,
): number {
  const state = _STATES.get(domain || "");
  return state?.threshold ?? defaultThreshold;
}
