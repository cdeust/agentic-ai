/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * PG recall weight computation: intent-adaptive signal weights.
 * Part 1 of 2 (pg-recall.ts = weights + orchestration).
 *
 * Port of: cortex@ed33435 mcp_server/core/pg_recall.py:1-180
 *
 * Pure business logic — no I/O.
 */

import { QueryIntent } from "./types.js";

// ── Base PG weight profile ────────────────────────────────────────────────
// These weights are engineering defaults, NOT paper-prescribed values.
// The TMM normalization framework (Bruch et al., ACM TOIS 2023) defines the
// fusion formula but does NOT prescribe per-signal weights — those are
// corpus-specific. See benchmarks/beam/ablation_results.json for empirical
// justification from the BEAM ablation study.
//
// Ablation data (benchmarks/beam/ablation_results.json):
//   BEAM-optimal: fts=0.0, heat=0.7, ngram=0.0 → MRR 0.554
//   But fts=0.0 regresses LongMemEval -9.2pp R@10, LoCoMo -15.5pp R@10
// These defaults are balanced across all three benchmarks.
// source: cortex@ed33435 mcp_server/core/pg_recall.py:93-100

export const _BASE_PG_WEIGHTS: Record<string, number> = {
  vector: 1.0,   // Primary signal — always full strength
  fts: 0.5,      // Keyword matching: essential for factual/technical queries
  heat: 0.3,     // Thermodynamic importance signal
  ngram: 0.3,    // Fuzzy matching: helps partial/code token matches
  recency: 0.0,  // Disabled by default; enabled for temporal intents
};

// Intent-specific PG weight overrides.
// source: cortex@ed33435 mcp_server/core/pg_recall.py:102-123
export const _PG_INTENT_OVERRIDES: Record<string, Record<string, number>> = {
  [QueryIntent.TEMPORAL]: {
    heat: 0.6,
    recency: 0.2,
  },
  [QueryIntent.KNOWLEDGE_UPDATE]: {
    recency: 0.5,
    heat: 0.5,
  },
  [QueryIntent.EVENT_ORDER]: {
    heat: 0.4,
    recency: 0.3,
    fts: 0.6,
  },
  [QueryIntent.SUMMARIZATION]: {
    heat: 0.5,
    fts: 0.7,
  },
  [QueryIntent.PREFERENCE]: {
    fts: 0.8,
    heat: 0.5,
  },
};

// ── Weight computation ────────────────────────────────────────────────────

function isMechanismDisabled(mech: string): boolean {
  if (typeof process === "undefined") return false;
  return process.env[`CORTEX_ABLATE_${mech}`] === "1";
}

/**
 * Compute PG recall_memories() signal weights for a given intent.
 *
 * Port of: cortex@ed33435 mcp_server/core/pg_recall.py:126-169
 *
 * Derives base weights from coreWeights (from query_intent) when available,
 * then applies intent-specific PG overrides.
 *
 * Verification ablation hooks (Popper C2):
 *   CORTEX_DECAY_DISABLED=1   → forces heat weight to 0.0
 *   CORTEX_HEAT_CONSTANT=<f>  → forces heat weight to 0.0
 *   CORTEX_ABLATE_ADAPTIVE_DECAY=1 → forces heat weight to 0.0
 * source: cortex@ed33435 mcp_server/core/pg_recall.py:136-158
 *
 * precondition: intent is a known QueryIntent value
 * postcondition: all weights non-negative; vector = 1.0; heat = 0.0 when
 *   any ablation env var is set; ngram = fts * 0.6
 */
export function computePgWeights(
  intent: string,
  coreWeights: Record<string, number> = {},
): Record<string, number> {
  const cw = coreWeights;

  // Vector is always 1.0 in the PG path.
  // ngram derived from fts (same ratio as Python).
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:145-151
  const base: Record<string, number> = {
    vector: 1.0,
    fts: cw["fts"] ?? (_BASE_PG_WEIGHTS["fts"] ?? 0.5),
    heat: cw["heat"] ?? (_BASE_PG_WEIGHTS["heat"] ?? 0.3),
    ngram: (cw["fts"] ?? (_BASE_PG_WEIGHTS["fts"] ?? 0.5)) * 0.6, // source: cortex@ed33435 mcp_server/core/pg_recall.py:149
    recency: 0.0,
  };

  const overrides = _PG_INTENT_OVERRIDES[intent];
  if (overrides) {
    Object.assign(base, overrides);
  }

  // Ablation: disable heat/decay signal
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:153-158
  const heatDisabled =
    (typeof process !== "undefined" && (
      process.env["CORTEX_DECAY_DISABLED"] === "1" ||
      process.env["CORTEX_HEAT_CONSTANT"] !== undefined
    )) ||
    isMechanismDisabled("ADAPTIVE_DECAY");

  if (heatDisabled) {
    base["heat"] = 0.0;
  }

  return base;
}

// ── Chronological reranking ───────────────────────────────────────────────
// ChronoRAG (Chen et al., arxiv 2508.18748, 2025): for event ordering
// queries, blend relevance rank with chronological rank via Reciprocal
// Rank Fusion (Cormack et al., SIGIR 2009).

export interface ChronoCandidate {
  memory_id: number;
  created_at?: string;
  score?: number;
  _rel_rank?: number;
  _chr_rank?: number;
  [key: string]: unknown;
}

/**
 * Blend relevance ranking with chronological ordering.
 *
 * Port of: cortex@ed33435 mcp_server/core/pg_recall.py:62-88
 *
 * For event ordering queries, the chronological position of memories
 * matters as much as semantic relevance.
 *
 * precondition: candidates is non-empty
 * postcondition: each candidate has updated score; list sorted descending;
 *   _rel_rank and _chr_rank fields removed from output
 *
 * Constants — source: cortex@ed33435 mcp_server/core/pg_recall.py:63
 *   beta = 0.5  (equal weight relevance + chrono)
 *   k    = 60   (Cormack 2009 default)
 */
export function chronologicalRerank(
  candidates: ChronoCandidate[],
  beta = 0.5,  // source: cortex@ed33435 mcp_server/core/pg_recall.py:63
  k = 60,      // source: cortex@ed33435 mcp_server/core/pg_recall.py:63
): ChronoCandidate[] {
  // Assign relevance rank
  const withRel = candidates.map((c, i) => ({ ...c, _rel_rank: i }));

  // Sort by timestamp for chronological rank
  const chrono = [...withRel].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
  for (let i = 0; i < chrono.length; i++) {
    const item = chrono[i];
    if (item) item._chr_rank = i;
  }

  // Build id→_chr_rank map from the sorted copy
  const chrRankMap = new Map<number, number>(
    chrono.map((c) => [c.memory_id, c._chr_rank ?? 0]),
  );

  // RRF blend: score = (1-beta)/(k+rel_rank) + beta/(k+chr_rank)
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:83
  const scored = withRel.map((c) => {
    const relRank = c._rel_rank ?? 0;
    const chrRank = chrRankMap.get(c.memory_id) ?? relRank;
    const score =
      (1 - beta) / (k + relRank) + beta / (k + chrRank);
    const { _rel_rank: _, _chr_rank: __, ...rest } = c;
    void _;
    void __;
    return { ...rest, score };
  });

  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
