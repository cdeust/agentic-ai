/**
 * Per-process store for Platt calibration of FlashRank reranker scores.
 *
 * Collects (raw_score, label) training pairs from rate_memory feedback
 * and fits Platt parameters every N pairs. The fitted parameters are
 * cached and applied in the reranker blend step.
 *
 * Cold start returns raw scores (which is the current production behaviour),
 * so restart is never worse than the pre-calibration baseline.
 *
 * Pure business logic — module-level mutable state is explicit and audited
 * (engineer.md Move 3 §Construct 1 override: write-once-at-startup /
 * runtime-seed configuration).
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker_calibration.py
 */

import {
  type PlattParams,
  type TrainingSample,
  MIN_SAMPLES,
  fitPlatt,
} from "./platt-calibration.js";

// ── Config ────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/reranker_calibration.py:31-32

export const REFIT_EVERY = 50;   // source: cortex@ed33435 mcp_server/core/reranker_calibration.py:31
export const MAX_SAMPLES = 2000; // source: cortex@ed33435 mcp_server/core/reranker_calibration.py:32

// ── State ─────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/reranker_calibration.py:37-39
// Module-level mutable state is explicit (Move 3 override justified above).

let _samples: TrainingSample[] = [];
let _params: PlattParams | null = null;
let _samplesAtLastFit = 0;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Add one (raw_score, useful) pair and possibly refit.
 *
 * precondition:  rawScore is a finite float; useful is a boolean.
 * postcondition: _samples has one more pair (bounded at MAX_SAMPLES via
 *   FIFO trim). If the number of samples since the last fit crossed
 *   REFIT_EVERY AND the total size is >= MIN_SAMPLES, _params is refit
 *   via fitPlatt.
 *
 * source: cortex@ed33435 mcp_server/core/reranker_calibration.py:45-69
 */
export function recordRating(rawScore: number, useful: boolean): void {
  _samples.push({ rawScore: Number(rawScore), label: useful ? 1 : 0 });

  if (_samples.length > MAX_SAMPLES) {
    // FIFO trim — keep the most recent MAX_SAMPLES pairs.
    _samples = _samples.slice(_samples.length - MAX_SAMPLES);
  }

  const samplesSinceFit = _samples.length - _samplesAtLastFit;
  if (samplesSinceFit >= REFIT_EVERY && _samples.length >= MIN_SAMPLES) {
    const fitted = fitPlatt([..._samples]);
    if (fitted !== null) {
      _params = fitted;
      _samplesAtLastFit = _samples.length;
    }
  }
}

/**
 * Return the currently-fitted Platt parameters, or null if untrained.
 * source: cortex@ed33435 mcp_server/core/reranker_calibration.py:72-73
 */
export function getParams(): PlattParams | null {
  return _params;
}

/**
 * Return the number of collected (raw_score, useful) pairs.
 * source: cortex@ed33435 mcp_server/core/reranker_calibration.py:76-77
 */
export function sampleCount(): number {
  return _samples.length;
}

/**
 * Test-only hook: reset all in-process calibration state.
 * source: cortex@ed33435 mcp_server/core/reranker_calibration.py:80-87
 */
export function resetForTests(): void {
  _samples = [];
  _params = null;
  _samplesAtLastFit = 0;
}
