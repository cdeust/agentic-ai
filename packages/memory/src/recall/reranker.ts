/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Cross-encoder reranking via FlashRank ONNX.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py
 *
 * FlashRank (ms-marco-MiniLM-L-12-v2) provides fast cross-encoder reranking.
 * Validated through LongMemEval and LoCoMo where it improves MRR by 5-15%.
 *
 * CE reranking with alpha blending of first-stage and CE scores is standard
 * IR practice — linear interpolation of retrieval and CE scores is the common
 * approach in multi-stage retrieval (Nogueira & Cho, 2019).
 *
 * Adaptive alpha (EXPERIMENTAL — disabled by default):
 *   Attempted per-query alpha based on CE score spread (QPP, Shtok et al.,
 *   TOIS 2012). Results: BEAM -0.002, LME +0.003, LoCoMo -3.8pp MRR.
 *   Kept as opt-in (adaptive=true) for future experimentation.
 *
 * Sufficient Context gate (Joren et al., ICLR 2025):
 *   Binary threshold gate: if max CE score falls below gate_threshold,
 *   all scores are suppressed by a fixed multiplier.
 *
 * ENGINEERING DEFAULTS (not paper-prescribed):
 *   - alpha=0.70: BEAM ablation (0.30→0.511, 0.50→0.529, 0.55→0.535, 0.70→0.542)
 *     source: cortex@ed33435 mcp_server/core/reranker.py:43-46
 *   - gate_threshold=0.15: source: cortex@ed33435 mcp_server/core/reranker.py:47
 *   - suppression=0.1: source: cortex@ed33435 mcp_server/core/reranker.py:48
 *
 * Pure business logic -- lazy-loaded singleton, no persistent I/O.
 */

// ── Platt calibration interface ───────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/platt_calibration.py

interface PlattParams {
  A: number;
  B: number;
  nSamples: number;
}

/**
 * Apply Platt sigmoid calibration to a raw CE score.
 * P(useful | raw_score) = 1 / (1 + exp(A * raw_score + B))
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py
 */
function calibrateScore(
  rawScore: number,
  params: PlattParams | null,
): number {
  if (params === null) return rawScore;
  const x = params.A * rawScore + params.B;
  // Numerically stable sigmoid
  if (x >= 0) {
    const ex = Math.exp(-x);
    return 1.0 / (1.0 + ex);
  }
  const ex = Math.exp(x);
  return ex / (1.0 + ex);
}

// ── Retrieval confidence gate ─────────────────────────────────────────────

/**
 * Compute confidence that retrieval found relevant results.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:66-87
 *
 * Binary threshold gate: if max CE score >= threshold, results are
 * considered sufficient (confidence=1.0). Otherwise, all scores are
 * suppressed by a fixed multiplier.
 *
 * Platt sigmoid was attempted (2026-04-03) and rejected — see module
 * docstring for ablation data showing regression on all benchmarks.
 *
 * precondition: ceScores is a list of raw CE floats
 * postcondition: returns 1.0 or suppression value (never negative)
 *
 * Constants — source: cortex@ed33435 mcp_server/core/reranker.py:83-86
 *   gate_threshold = 0.15
 *   suppression    = 0.1
 */
function computeRetrievalConfidence(
  ceScores: number[],
  gateThreshold = 0.15, // source: cortex@ed33435 mcp_server/core/reranker.py:83
  suppression = 0.1,    // source: cortex@ed33435 mcp_server/core/reranker.py:84
): number {
  if (ceScores.length === 0) return suppression;
  const maxCe = Math.max(...ceScores);
  if (maxCe >= gateThreshold) return 1.0;
  return suppression;
}

// ── Adaptive alpha ────────────────────────────────────────────────────────

/**
 * Compute per-query alpha from CE score distribution.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:90-129
 *
 * Based on post-retrieval QPP (Shtok et al., TOIS 2012): the standard
 * deviation / spread of retrieval scores predicts whether the retrieval
 * system can discriminate relevant from non-relevant documents.
 *
 * IMPORTANT: alpha never drops BELOW base_alpha. Ablation on BEAM shows
 * lower alpha hurts (0.30→0.511, 0.50→0.529, 0.70→0.542). And higher
 * fixed alpha also hurts (0.80→0.476, 0.90→0.469, 1.00→0.465).
 *
 * precondition: ceScores has at least 2 elements for meaningful spread
 * postcondition: result in [baseAlpha, baseAlpha + 0.15]
 *
 * Constants — source: cortex@ed33435 mcp_server/core/reranker.py:124-127
 *   max_boost  = 0.15
 *   spread_low = 0.3   (below this → keep base_alpha)
 *   spread_denom = 0.7 (for linear normalization above 0.3)
 */
function computeAdaptiveAlpha(
  ceScores: number[],
  baseAlpha: number,
): number {
  if (ceScores.length < 2) return baseAlpha;

  const spread = Math.max(...ceScores) - Math.min(...ceScores);
  // source: cortex@ed33435 mcp_server/core/reranker.py:123
  const MAX_BOOST = 0.15;
  if (spread < 0.3) return baseAlpha; // source: cortex@ed33435 mcp_server/core/reranker.py:124
  // Linear boost above spread=0.3, capped at max_boost
  // source: cortex@ed33435 mcp_server/core/reranker.py:126-128
  const normalized = Math.min((spread - 0.3) / 0.7, 1.0);
  return Math.min(baseAlpha + MAX_BOOST * normalized, 1.0);
}

// ── Score blending ────────────────────────────────────────────────────────

/**
 * Blend WRRF scores with cross-encoder scores, scaled by confidence.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:132-160
 *
 * precondition: candidates and ceScores are aligned by index
 * postcondition: result is sorted descending by blended score;
 *   confidence (1.0 or suppression) is applied uniformly
 */
function blendScores(
  candidates: Array<[number, number]>,
  ceScores: Map<number, number>,
  alpha: number,
  adaptive = true,
  applyPlatt = false,
  plattParams: PlattParams | null = null,
): Array<[number, number]> {
  const rawCeList = Array.from({ length: candidates.length }, (_, i) =>
    ceScores.get(i) ?? 0.0,
  );
  const confidence = computeRetrievalConfidence(rawCeList);

  // Per-query adaptive alpha based on CE score distribution
  // source: cortex@ed33435 mcp_server/core/reranker.py:148
  const effectiveAlpha = adaptive
    ? computeAdaptiveAlpha(rawCeList, alpha)
    : alpha;

  const params = applyPlatt ? plattParams : null;

  const reranked: Array<[number, number]> = candidates.map(
    ([memId, wrrfScore], i) => {
      const ce = ceScores.get(i) ?? 0.0;
      const ceForBlend = calibrateScore(ce, params);
      const blended =
        (1 - effectiveAlpha) * wrrfScore + effectiveAlpha * ceForBlend;
      return [memId, blended * confidence];
    },
  );
  reranked.sort(([, a], [, b]) => b - a);
  return reranked;
}

// ── FlashRank singleton (lazy) ─────────────────────────────────────────────
// In TS we cannot load the Python flashrank ONNX model directly.
// rerankResults degrades gracefully to returning candidates unchanged
// (same as the Python fallback on flashrank import failure).
// A native ONNX adapter may be wired in future via the EmbeddingEngine port.

let _flashrankFailed = false;

function ensureReranker(): null {
  // FlashRank ONNX is a Python-only dependency.
  // In TS we always use the identity fallback (return candidates unchanged).
  // source: cortex@ed33435 mcp_server/core/reranker.py:56-63
  if (!_flashrankFailed) {
    _flashrankFailed = true; // Mark once so the flag is consistent
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Rerank candidates using FlashRank cross-encoder.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:164-207
 *
 * precondition: candidates is a ranked list of (memory_id, wrrf_score)
 * postcondition: returns list of same or fewer length, sorted by blended score;
 *   returns input unchanged when FlashRank is unavailable (graceful degradation)
 *
 * Constants — source: cortex@ed33435 mcp_server/core/reranker.py:167-172
 *   alpha         = 0.70 (BEAM ablation optimum)
 *   max_content_len = 1200
 *   adaptive      = false (disabled by default pending ablation validation)
 *   apply_platt   = false (disabled by default until benchmark re-validation)
 */
export function rerankResults(
  _query: string,
  candidates: Array<[number, number]>,
  _contentLookup: Record<number, string>,
  alpha = 0.70,           // source: cortex@ed33435 mcp_server/core/reranker.py:168
  _maxContentLen = 1200,  // source: cortex@ed33435 mcp_server/core/reranker.py:169 — max_content_len
  adaptive = false,       // source: cortex@ed33435 mcp_server/core/reranker.py:170
  applyPlatt = false,     // source: cortex@ed33435 mcp_server/core/reranker.py:171
): Array<[number, number]> {
  const ranker = ensureReranker();
  if (ranker === null || candidates.length === 0) return candidates;
  // Unreachable: ranker is always null in TS.
  // The shape matches Python's fallback exactly.
  return blendScores(candidates, new Map(), alpha, adaptive, applyPlatt, null);
}

/**
 * Return a single raw FlashRank CE score for (query, content).
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:209-226
 *
 * Returns null if FlashRank is unavailable or encoding fails.
 */
export function getRawCeScore(
  _query: string,
  _content: string,
  _maxContentLen = 1200, // source: cortex@ed33435 mcp_server/core/reranker.py:221 — max content length for CE
): number | null {
  // FlashRank is a Python-only dependency — always unavailable in TS.
  // source: cortex@ed33435 mcp_server/core/reranker.py:214-215
  return null;
}

export type { PlattParams };
