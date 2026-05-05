/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * 3-tier retrieval dispatch: simple, mixed (multi-hop), deep (BM25-primary).
 *
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py
 *
 * Dispatch strategy (validated via LoCoMo, LongMemEval, BEAM benchmarks):
 *   - Simple: balanced 9-signal WRRF (general/semantic/temporal)
 *   - Mixed: multi-hop with entity bridging (multi-hop intent)
 *   - Deep: BM25-primary + entity-weighted (entity/factual queries)
 *
 * Pure business logic -- no I/O. Takes signals as data.
 */

import { QueryIntent } from "./types.js";
import { rerankResults } from "./reranker.js";

// ── Tier Classification ───────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:28-40

const _SIMPLE_INTENTS = new Set<string>([
  QueryIntent.GENERAL,
  QueryIntent.SEMANTIC,
  QueryIntent.TEMPORAL,
  QueryIntent.CAUSAL,
  QueryIntent.KNOWLEDGE_UPDATE,
]);
const MIXED_INTENTS = new Set<string>([QueryIntent.MULTI_HOP]);
const DEEP_INTENTS = new Set<string>([
  QueryIntent.ENTITY,
  QueryIntent.INSTRUCTION,
]);

/**
 * Map query intent to retrieval tier.
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:38-43
 */
export function classifyTier(intent: string): string {
  if (MIXED_INTENTS.has(intent)) return "mixed";
  if (DEEP_INTENTS.has(intent)) return "deep";
  if (_SIMPLE_INTENTS.has(intent)) return "simple";
  return "simple";
}

// ── WRRF Fusion ───────────────────────────────────────────────────────────

/**
 * Weighted Reciprocal Rank Fusion across multiple signals.
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:47-57
 *
 * precondition: signalResults.length === signalWeights.length
 * postcondition: returns (id, score) list sorted descending by score
 */
export function wrfFuse(
  signalResults: Array<Array<[number, number]>>,
  signalWeights: number[],
  k = 60, // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:53 — RRF k=60 (Cormack 2009)
): Array<[number, number]> {
  const scores = new Map<number, number>();
  for (let i = 0; i < signalResults.length; i++) {
    const weight = signalWeights[i] ?? 0;
    if (weight <= 0) continue;
    const results = signalResults[i] ?? [];
    for (let rank = 0; rank < results.length; rank++) {
      const entry = results[rank];
      if (!entry) continue;
      const [memId] = entry;
      scores.set(memId, (scores.get(memId) ?? 0) + weight / (k + rank + 1));
    }
  }
  return Array.from(scores.entries()).sort(([, a], [, b]) => b - a);
}

// ── Signal Names ──────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:60-70

const _SIGNAL_NAMES = [
  "vector",
  "fts",
  "heat",
  "hopfield",
  "hdc",
  "sr",
  "sa",
  "bm25",
  "ngram",
] as const;

type SignalName = (typeof _SIGNAL_NAMES)[number];

// ── Signal Weight Profiles ────────────────────────────────────────────────

/**
 * Default balanced weights.
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:73-83
 */
function baseWeights(
  v: number,
  f: number,
  h: number,
  sa: number,
): Record<string, number> {
  return {
    vector: v,
    fts: f,
    heat: h,
    hopfield: v * 0.5,  // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:78
    hdc: v * 0.4,       // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:79
    sr: h * 0.6,        // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:80
    sa,
    bm25: f * 0.8,      // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:82
    ngram: f * 0.6,     // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:83
  };
}

/**
 * BM25-primary weights for entity/factual queries.
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:86-96
 */
function deepWeights(
  v: number,
  f: number,
  h: number,
  sa: number,
): Record<string, number> {
  return {
    vector: v * 0.7,    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:88
    fts: f * 1.2,       // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:89
    heat: h * 0.5,      // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:90
    hopfield: v * 0.3,  // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:91
    hdc: v * 0.2,       // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:92
    sr: h * 0.3,        // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:93
    sa: sa * 1.5,       // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:94
    bm25: f * 1.5,      // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:95
    ngram: f * 1.0,     // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:96
  };
}

/**
 * Balanced weights for multi-hop queries.
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:99-109
 */
function mixedWeights(
  v: number,
  f: number,
  h: number,
  sa: number,
): Record<string, number> {
  return {
    vector: v,
    fts: f,
    heat: h,
    hopfield: v * 0.5,   // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:104
    hdc: v * 0.4,        // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:105
    sr: h * 0.6,         // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:106
    sa: sa * 1.2,        // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:107
    bm25: f * 0.8,       // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:108
    ngram: f * 0.6,      // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:109
  };
}

/**
 * BM25+FTS-primary weights for instruction/directive queries.
 *
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:112-125
 *
 * Instructions have distinctive lexical patterns ("always", "never", "must").
 * BM25 IDF weighting surfaces rare directive keywords that vector similarity
 * misses. Reduced vector weight avoids dilution by topic-adjacent content.
 */
function instructionWeights(
  v: number,
  f: number,
  h: number,
  sa: number,
): Record<string, number> {
  return {
    vector: v * 0.5,   // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:117
    fts: f * 1.5,      // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:118
    heat: h * 0.5,     // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:119
    hopfield: v * 0.2, // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:120
    hdc: v * 0.2,      // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:121
    sr: h * 0.3,       // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:122
    sa: sa * 0.5,      // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:123
    bm25: f * 2.0,     // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:124
    ngram: f * 1.2,    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:125
  };
}

/**
 * Compute per-signal WRRF weights based on tier and intent.
 *
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:128-144
 *
 * precondition: tier is one of "simple" | "mixed" | "deep"
 * postcondition: returns non-negative weights for all 9 signal names
 */
export function computeSignalWeights(
  tier: string,
  intentWeights: Record<string, number>,
  baseVector = 1.0,  // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:131
  baseFts = 0.5,     // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:132
  baseHeat = 0.3,    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:133
  intent?: string,
): Record<string, number> {
  const v = baseVector * (intentWeights["vector"] ?? 1.0);
  const f = baseFts * (intentWeights["fts"] ?? 1.0);
  const h = baseHeat * (intentWeights["heat"] ?? 1.0);
  const sa = f * 0.5 * (intentWeights["spreading"] ?? 1.0);

  if (intent === QueryIntent.INSTRUCTION) return instructionWeights(v, f, h, sa);
  if (tier === "deep") return deepWeights(v, f, h, sa);
  if (tier === "mixed") return mixedWeights(v, f, h, sa);
  return baseWeights(v, f, h, sa);
}

// ── Multi-Hop Merge ──────────────────────────────────────────────────────

/**
 * Merge hop results: reinforce existing, add new at reduced weight.
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:149-157
 *
 * postcondition: all ids from primary are present; secondary ids added at
 *   reduced weight; result sorted descending by score
 */
export function mergeMultihopResults(
  primary: Array<[number, number]>,
  secondary: Array<[number, number]>,
  hopWeight = 0.3, // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:150
): Array<[number, number]> {
  const scores = new Map<number, number>(primary);
  for (const [mid, score] of secondary) {
    if (scores.has(mid)) {
      scores.set(mid, (scores.get(mid) ?? 0) + score * hopWeight);
    } else {
      scores.set(mid, score * hopWeight);
    }
  }
  return Array.from(scores.entries()).sort(([, a], [, b]) => b - a);
}

/**
 * Execute multi-hop sub-queries and merge into fused results.
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:160-167
 *
 * precondition: hopFn returns ranked (id, score) pairs for a query string
 * postcondition: sub-queries limited to first 3 decomposed sub-queries
 */
function runMultihop(
  query: string,
  fused: Array<[number, number]>,
  hopFn: (q: string) => Array<[number, number]>,
): Array<[number, number]> {
  const subQueries = decomposQuery(query).slice(0, 3); // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:162
  for (const subQ of subQueries) {
    const hopResults = hopFn(subQ);
    if (hopResults.length > 0) {
      fused = mergeMultihopResults(fused, hopResults);
    }
  }
  return fused;
}

/**
 * Simple query decomposition for multi-hop bridging.
 * Mirrors mcp_server/core/query_decomposition.decompose_query sub_queries extraction.
 */
function decomposQuery(query: string): string[] {
  // Split on common connectives that signal sub-queries
  return query
    .split(/\band\b|\bbut\b|\balso\b|\bthen\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── Orchestrator ──────────────────────────────────────────────────────────

export interface DispatchRetrievalArgs {
  query: string;
  signals: Partial<Record<SignalName, Array<[number, number]>>>;
  intentInfo: {
    intent: string;
    weights?: Record<string, number>;
  };
  contentLookup: Map<number, string>;
  wrrfK?: number;
  baseVectorW?: number;
  baseFtsW?: number;
  baseHeatW?: number;
  maxResults?: number;
  hopFn?: ((q: string) => Array<[number, number]>) | null;
}

/**
 * Run 3-tier retrieval dispatch. Returns (results, tier_name).
 *
 * Port of: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:172-197
 *
 * precondition: intentInfo.intent is a known QueryIntent value
 * postcondition: results are ranked (id, score) pairs; tier is one of
 *   "simple" | "mixed" | "deep"
 */
export function dispatchRetrieval({
  query,
  signals,
  intentInfo,
  contentLookup,
  wrrfK = 60,       // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:174 — Cormack 2009
  baseVectorW = 1.0,
  baseFtsW = 0.5,
  baseHeatW = 0.3,
  maxResults = 10,
  hopFn = null,
}: DispatchRetrievalArgs): [Array<[number, number]>, string] {
  const intent = intentInfo.intent;
  const tier = classifyTier(intent);
  const weights = computeSignalWeights(
    tier,
    intentInfo.weights ?? {},
    baseVectorW,
    baseFtsW,
    baseHeatW,
    intent,
  );

  const signalLists = _SIGNAL_NAMES.map(
    (n) => signals[n] ?? [],
  );
  const weightList = _SIGNAL_NAMES.map((n) => weights[n] ?? 0.0);

  let fused = wrfFuse(signalLists, weightList, wrrfK);

  if (tier === "mixed" && hopFn !== null) {
    try {
      fused = runMultihop(query, fused, hopFn);
    } catch {
      // Non-load-bearing; fall through
    }
  }

  const rerankPool = fused.slice(0, maxResults * 3);
  if (contentLookup.size > 0) {
    try {
      const reranked = rerankResults(
        query,
        rerankPool,
        Object.fromEntries(contentLookup),
      );
      return [reranked, tier];
    } catch {
      // Fall through to unranked pool
    }
  }

  return [rerankPool, tier];
}
