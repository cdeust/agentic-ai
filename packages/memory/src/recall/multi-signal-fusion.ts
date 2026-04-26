/**
 * Multi-signal fusion: orchestrates BM25 + heat + n-gram signals into a
 * single ranked list using Reciprocal Rank Fusion.
 *
 * Port of: mcp_server/handlers/recall_helpers.py (collect_signals, build_result)
 *          mcp_server/core/scoring.py
 *
 * Vector and spreading-activation signals come from the MemoryStore port
 * (pgvector / FTS). BM25 and n-gram are computed client-side here.
 *
 * Pure business logic — takes a MemoryStore port and returns scored pairs.
 * No global state.
 *
 * Signals that depend on PG stored procedures (hopfield, hdc, sr, sa) are
 * accepted as pre-computed inputs from the store port — this function
 * does NOT compute them.
 */

import { computeBm25Scores, computeNgramScore } from "./bm25.js";
import { computeRecencyBoost, computeSessionCoherence } from "./heat.js";
import { rrfFuseSignals } from "./rrf.js";
import type { MemoryItem, MultiSignalSignals, RecallResult } from "./types.js";
import type { QueryIntentValue } from "./types.js";
import { QueryIntent } from "./types.js";

// ── Text-signal computation ────────────────────────────────────────────────

/**
 * Compute BM25 + n-gram signals from a hot-memory pool.
 *
 * Port of: mcp_server/handlers/recall_helpers.py::compute_text_signals
 */
export function computeTextSignals(
  query: string,
  hotMems: MemoryItem[],
): {
  bm25: Array<[number, number]>;
  ngram: Array<[number, number]>;
} {
  if (hotMems.length === 0) return { bm25: [], ngram: [] };

  const ids = hotMems.map((m) => m.id);
  const docs = hotMems.map((m) => m.content);

  const bm25Scores = computeBm25Scores(query, docs);
  const bm25: Array<[number, number]> = ids
    .map((id, i): [number, number] => [id, bm25Scores[i] ?? 0])
    .filter(([, s]) => s > 0);

  const ngram: Array<[number, number]> = hotMems
    .map((m): [number, number] => [m.id, computeNgramScore(query, m.content)])
    .filter(([, s]) => s > 0);

  return { bm25, ngram };
}

// ── Heat signal from pool ──────────────────────────────────────────────────

/**
 * Extract raw heat scores from a hot-memory pool.
 * Port of: mcp_server/handlers/recall_helpers.py::collect_signals (heat key)
 */
export function extractHeatSignal(
  hotMems: MemoryItem[],
): Array<[number, number]> {
  return hotMems.map((m) => [m.id, m.heat]);
}

// ── Result building ────────────────────────────────────────────────────────

interface RecallSettings {
  SESSION_COHERENCE_BONUS: number;
  SESSION_COHERENCE_WINDOW_HOURS: number;
  RECENCY_BOOST_MAX: number;
  RECENCY_BOOST_HALFLIFE_DAYS: number;
  RECENCY_BOOST_CUTOFF_DAYS: number;
}

/**
 * Compute recency boost based on query intent.
 * Port of: mcp_server/handlers/recall_helpers.py::compute_result_boost
 */
function computeResultBoost(
  intent: QueryIntentValue,
  createdAt: string,
  settings: RecallSettings,
): number {
  if (intent === QueryIntent.KNOWLEDGE_UPDATE) {
    return computeRecencyBoost(
      createdAt,
      settings.RECENCY_BOOST_MAX * 3.0,
      settings.RECENCY_BOOST_HALFLIFE_DAYS * 0.5,
      settings.RECENCY_BOOST_CUTOFF_DAYS * 2.0,
    );
  }
  return computeRecencyBoost(
    createdAt,
    settings.RECENCY_BOOST_MAX,
    settings.RECENCY_BOOST_HALFLIFE_DAYS,
    settings.RECENCY_BOOST_CUTOFF_DAYS,
  );
}

/**
 * Normalize tags from string or array form.
 * Port of: mcp_server/handlers/recall_helpers.py::parse_tags
 */
function parseTags(tags: string | string[] | undefined): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Build a single RecallResult from a raw memory and its fused score.
 * Port of: mcp_server/handlers/recall_helpers.py::build_result
 */
export function buildRecallResult(
  mem: MemoryItem,
  score: number,
  intent: QueryIntentValue,
  settings: RecallSettings,
): RecallResult {
  const createdAt = mem.created_at ?? "";
  const heat = computeSessionCoherence(
    mem.heat,
    createdAt,
    settings.SESSION_COHERENCE_BONUS,
    settings.SESSION_COHERENCE_WINDOW_HOURS,
  );
  const boost = computeResultBoost(intent, createdAt, settings);

  return {
    memory_id: mem.id,
    content: mem.content,
    score: Math.round(score * (1 + boost) * 10000) / 10000,
    heat: Math.round(heat * 10000) / 10000,
    domain: mem.domain ?? "",
    tags: parseTags(mem.tags),
    store_type: mem.store_type ?? "episodic",
    created_at: createdAt,
    importance: mem.importance ?? 0.5,
    surprise: mem.surprise_score ?? 0,
    recency_boost: Math.round(boost * 10000) / 10000,
  };
}

// ── Fusion entry point ────────────────────────────────────────────────────

/**
 * Fuse all available signals into a ranked list of (id, score) pairs.
 *
 * Accepts pre-computed signals (from the MemoryStore port) alongside
 * locally-computed BM25 + n-gram + heat signals.
 *
 * This is the pure-logic core of the multi-signal retrieval pipeline.
 * The handler wraps this with store reads and result building.
 *
 * Port of: the fusion step in mcp_server/handlers/recall_helpers.py::collect_signals
 *          plus mcp_server/core/unified_search_fusion.py::fuse
 */
export function fuseSignals(
  signals: MultiSignalSignals,
  rrfK = 60,
): Array<[number, number]> {
  const activeSignals: Record<string, Array<[number, number]>> = {};
  for (const [name, pairs] of Object.entries(signals)) {
    if (pairs.length > 0) {
      activeSignals[name] = pairs;
    }
  }
  return rrfFuseSignals(activeSignals, rrfK);
}

// ── Strategic ordering (Lost-in-the-Middle mitigation) ────────────────────

/**
 * Reorder results to mitigate the "Lost in the Middle" degradation.
 *
 * Puts the highest-scoring results at the top and bottom; middle results
 * are placed in the centre where LLM attention is weakest.
 *
 * Port of: mcp_server/handlers/recall.py::_apply_strategic_ordering
 *
 * source: Liu et al. (2023) "Lost in the Middle: How Language Models Use
 * Long Contexts." Transactions on Association for Computational Linguistics.
 */
export function applyStrategicOrdering<T>(
  results: T[],
  topFraction = 0.3,
  bottomFraction = 0.2,
): T[] {
  const n = results.length;
  if (n < 5) return results;
  const topN = Math.max(1, Math.floor(n * topFraction));
  const bottomN = Math.max(1, Math.floor(n * bottomFraction));
  if (n - topN - bottomN <= 0) return results;
  return [
    ...results.slice(0, topN),
    ...results.slice(n - bottomN),
    ...results.slice(topN, n - bottomN),
  ];
}

export type { RecallSettings };
