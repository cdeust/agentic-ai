/**
 * abstention-gate.ts — Retrieval abstention gate.
 *
 * Ports: core/abstention_gate.py (~132 LOC)
 *
 * Filters retrieval results that don't actually answer the query.
 * The model is a fine-tuned DistilBERT trained on BEAM (query, passage,
 * relevant/irrelevant) pairs with hard-negative mining.
 *
 * When the model is unavailable, falls back to no-op (returns results
 * unchanged) — never breaks retrieval. This is an intentional design
 * decision: abstention improves precision when the model is loaded, but
 * degrading to "no filtering" is strictly better than crashing the caller.
 *
 * Correctness invariant:
 *   filterByAbstention(q, candidates, t, k) returns a subset of
 *   candidates (never introduces new elements), and |result| >= min(k, |candidates|).
 *
 * Source model: github.com/cdeust/cortex-know-when-to-stop-training-model
 * source: core/abstention_gate.py
 */

// ── Calibrated thresholds (from v0.1 model evaluation) ────────────────────
// Score range on diverse queries: 0.215 - 0.830
// F1-optimal threshold:        0.45
// Precision-optimal threshold: 0.55
// Recall-optimal threshold:    0.35
// source: cortex core/abstention_gate.py v0.1 model evaluation (calibration on diverse queries)
export const DEFAULT_THRESHOLD = 0.45; // source: cortex core/abstention_gate.py:DEFAULT_THRESHOLD (F1-optimal at 0.45)

// ── Model interface ─────────────────────────────────────────────────────────

/**
 * AbstentionClassifier interface.
 *
 * Implementors: the cortex-beam-abstain classifier (see below), test stubs.
 * precondition:  each pair[1] (passage) is non-empty.
 * postcondition: returned scores[i] is the relevance probability for pairs[i].
 *
 * source: cortex core/abstention_gate.py — DistilBERT classifier trained on
 *   BEAM (query, passage, relevant/irrelevant) pairs with hard-negative mining.
 *   Model: github.com/cdeust/cortex-know-when-to-stop-training-model
 */
export interface AbstentionClassifier {
  predictBatch(pairs: Array<[string, string]>): number[];
}

// The singleton classifier, loaded lazily.
// DEFERRED: the @xenova/transformers ONNX runtime is now available (ADR-0013),
// but the cortex-beam-abstain model file has not been published to HuggingFace
// as an ONNX export. When the model file is available, load it here via:
//   const { pipeline } = await import("@xenova/transformers");
//   const clf = await pipeline("text-classification", "Xenova/cortex-beam-abstain");
// Until then: graceful degradation to no-op (return all results unchanged).
// FAILS_ON: classifier model not loaded — filterByAbstention returns all candidates.
let _classifier: AbstentionClassifier | null = null;
let _loadAttempted = false;

/**
 * Lazy-load the abstention classifier.
 *
 * Returns null if the model is not available. Callers must treat null
 * as "no filtering" — return all results unchanged.
 *
 * postcondition: after this function returns, _loadAttempted = true.
 */
function getClassifier(): AbstentionClassifier | null {
  if (_classifier !== null) return _classifier;
  if (_loadAttempted) return null;
  _loadAttempted = true;
  // DEFERRED: cortex-beam-abstain ONNX model not yet bundled.
  // The ONNX runtime is available via @xenova/transformers (ADR-0013).
  // Remaining blocker: publish cortex-beam-abstain as Xenova/cortex-beam-abstain
  // on HuggingFace Hub. Track in PHASE_7_TRACKING.md Group A.
  // For now: graceful degradation to no-op (return all candidates unchanged).
  return null;
}

/** Test hook: inject a classifier stub. Restores null on resetClassifier(). */
export function injectClassifier(clf: AbstentionClassifier): void {
  _classifier = clf;
  _loadAttempted = true;
}

/** Test hook: remove injected classifier and reset load-attempted flag. */
export function resetClassifier(): void {
  _classifier = null;
  _loadAttempted = false;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Filter retrieval results using the abstention classifier.
 *
 * precondition:  query is a string; candidates is an array of dicts with
 *   a 'content' field; threshold ∈ (0, 1); keepAtLeast >= 0.
 *
 * postcondition:
 *   - result.filtered is a subset of candidates.
 *   - result.scores.length === candidates.length.
 *   - result.filtered.length >= min(keepAtLeast, candidates.length).
 *   - If classifier unavailable, result.filtered === candidates and
 *     all scores are 1.0 (no filtering applied).
 *
 * source: core/abstention_gate.py:filter_by_abstention
 */
export function filterByAbstention(
  query: string,
  candidates: Array<Record<string, unknown>>,
  threshold = DEFAULT_THRESHOLD,
  keepAtLeast = 0,
): { filtered: Array<Record<string, unknown>>; scores: number[] } {
  if (candidates.length === 0) return { filtered: [], scores: [] };

  const clf = getClassifier();
  if (clf === null) {
    // Model unavailable — return everything unchanged.
    return { filtered: candidates, scores: new Array(candidates.length).fill(1.0) };
  }

  const pairs: Array<[string, string]> = candidates.map((c) => [
    query,
    typeof c["content"] === "string" ? c["content"] : "",
  ]);
  const scores = clf.predictBatch(pairs);

  // Filter by threshold.
  const kept = candidates.filter((_, i) => (scores[i] ?? 0) >= threshold);

  // If filtering removed everything but caller wants minimum results,
  // keep top-N by score regardless of threshold.
  if (kept.length < keepAtLeast && candidates.length > 0) {
    const ranked = candidates
      .map((c, i) => ({ c, score: scores[i] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, keepAtLeast)
      .map((x) => x.c);
    return { filtered: ranked, scores };
  }

  return { filtered: kept, scores };
}

/**
 * Quick check: should the system return empty results entirely?
 *
 * Returns true when ALL candidates score below threshold (no relevant match).
 *
 * precondition:  same as filterByAbstention.
 * postcondition: returns true IFF filtered is empty after applying threshold.
 *
 * source: core/abstention_gate.py:should_abstain
 */
export function shouldAbstain(
  query: string,
  candidates: Array<Record<string, unknown>>,
  threshold = DEFAULT_THRESHOLD,
): boolean {
  const { filtered } = filterByAbstention(query, candidates, threshold);
  return filtered.length === 0;
}
