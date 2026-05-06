/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * PG recall: intent-adaptive retrieval + reconsolidation pipeline.
 * Part 2 of 2 (full recall() orchestration).
 *
 * Port of: cortex@ed33435 mcp_server/core/pg_recall.py:180-636
 *
 * Two top-level functions are exposed:
 *
 *   recall()         — the WRRF composition retrieval path. Returns a
 *                      flat ranked list of candidates. Used by the
 *                      production handler and the BEAM benchmark harness.
 *
 *   assemblContext() — the structured 3-phase context assembler.
 *                      Returns a budgeted, slot-filled prompt with
 *                      truncation awareness. See context-assembly/.
 *
 * Pure business logic — takes a store + embeddings, returns results.
 */

import { classifyQueryIntent } from "./query-intent.js";
import { QueryIntent } from "./types.js";
import { rerankResults } from "./reranker.js";
import { computePgWeights, chronologicalRerank } from "./pg-recall-weights.js";
import {
  hopfieldComplete,
  hdcRerank,
  spreadingActivationExpand,
  dendriticModulate,
  type Candidate,
  type CandidateStore,
} from "./recall-pipeline-stages.js";
import {
  emotionalRetrievalRerank,
  moodCongruentRerank,
  reconsolidationApply,
  type ReconsolidationStore,
} from "./recall-pipeline.js";
import type { EmbeddingEngine } from "./port.js";

// ── Titans memory (test-time learning) ───────────────────────────────────
// Behrouz et al., NeurIPS 2025 — neural associative memory M with
// surprise-gated momentum S.
// source: cortex@ed33435 mcp_server/core/pg_recall.py:24-28

interface TitansMemory {
  update(qEmb: number[] | null, resultEmbs: number[][]): number;
}

let _titans: TitansMemory | null = null;

function getTitans(): TitansMemory {
  if (_titans === null) {
    _titans = createTitansMemory();
  }
  return _titans;
}

/**
 * Minimal TitansMemory implementation.
 * Source: Behrouz et al. (NeurIPS 2025) exact equations:
 *   S_t = eta * S_{t-1} - theta * grad_l(M_{t-1}; x_t)
 *   M_t = M_{t-1} - S_t
 * source: cortex@ed33435 mcp_server/core/pg_recall.py:391-400
 */
function createTitansMemory(): TitansMemory {
  // Source: cortex@ed33435 mcp_server/core/titans_memory.py (default parameters)
  const eta = 0.9;    // momentum decay
  const theta = 0.01; // source: cortex@ed33435 mcp_server/core/titans_memory.py — gradient step (engineering default)
  let S = 0.0;
  let M = 0.0;

  return {
    update(qEmb: number[] | null, resultEmbs: number[][]): number {
      if (qEmb === null || resultEmbs.length === 0) return S;
      // Approximate gradient as mean inner product (engineering proxy)
      const totalDot = resultEmbs.reduce((acc, r) => {
        if (r.length !== qEmb.length) return acc;
        let d = 0;
        for (let i = 0; i < qEmb.length; i++) d += (qEmb[i] ?? 0) * (r[i] ?? 0);
        return acc + d;
      }, 0);
      const gradApprox = totalDot / Math.max(resultEmbs.length, 1);
      S = eta * S - theta * gradApprox;
      M = M - S;
      return S; // surprise = current momentum magnitude
    },
  };
}

// ── User mood resolver ────────────────────────────────────────────────────

/**
 * Return the user's session-level mood in [-1, +1], or null if absent.
 * Port of: cortex@ed33435 mcp_server/core/pg_recall.py:30-52
 *
 * No get_user_mood() method exists in the current PgMemoryStore (April 2026),
 * so this returns null and MOOD_CONGRUENT_RERANK no-ops.
 */
function getUserMood(
  store: PgStore,
): number | null {
  if (store === null) return null;
  const s = store as unknown as Record<string, unknown>;
  if (typeof s["getUserMood"] !== "function") return null;
  try {
    const v = s["getUserMood"] as () => unknown;
    const result = v();
    if (result === null || result === undefined) return null;
    const n = Number(result);
    if (isNaN(n)) return null;
    return Math.max(-1.0, Math.min(1.0, n));
  } catch {
    return null;
  }
}

// ── Store interface for the PG path ──────────────────────────────────────

export interface PgRecallMemoriesParams {
  query_text: string;
  query_embedding: number[] | null;
  intent: string;
  domain?: string | null;
  directory?: string | null;
  agent_topic?: string | null;
  min_heat: number;
  max_results: number;
  wrrf_k: number;
  weights: Record<string, number>;
  include_globals: boolean;
}

export interface PgStore extends CandidateStore, ReconsolidationStore {
  recallMemories(params: PgRecallMemoriesParams): Candidate[] | Promise<Candidate[]>;
  getMemory?(id: number): Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  searchByTagVector?(
    embedding: number[],
    tag: string,
    opts?: { domain?: string | null; limit?: number },
  ): Candidate[] | Promise<Candidate[]>;
  getUserMood?(): number | null;
}

// ── _TYPE_INTENTS pool guarantee ──────────────────────────────────────────
// ENGRAM (arxiv 2511.12960): typed memory pools prevent instruction/
// preference memories from being drowned out by episodic memories.
// source: cortex@ed33435 mcp_server/core/pg_recall.py:298-313

const _TYPE_INTENTS: Partial<Record<string, string>> = {
  [QueryIntent.INSTRUCTION]: "instruction",
  [QueryIntent.PREFERENCE]: "preference",
};

// ── recall() orchestration ────────────────────────────────────────────────

export interface RecallOptions {
  topK?: number;
  domain?: string | null;
  directory?: string | null;
  agentTopic?: string | null;
  minHeat?: number;
  rerank?: boolean;
  rerankAlpha?: number;
  wrrfK?: number;
  momentumState?: { momentum?: number } | null;
  includeGlobals?: boolean;
}

/**
 * Full PG-path retrieval: intent → weights → recall_memories → rerank.
 *
 * Port of: cortex@ed33435 mcp_server/core/pg_recall.py:185-405
 *
 * precondition: store.recallMemories exists; embeddings is non-null or can
 *   be null (q_emb will be null, which degrades gracefully)
 * postcondition: result.length <= topK; every entry has memory_id + content +
 *   score; returns [] when store returns no candidates
 *
 * Constants — source: cortex@ed33435 mcp_server/core/pg_recall.py:197-204
 *   rerank_alpha = 0.70 (BEAM ablation optimum)
 *   wrrf_k       = 60   (Cormack 2009)
 *   min_heat     = 0.01
 *   top_k        = 10
 */
export async function recall(
  query: string,
  store: PgStore,
  embeddings: EmbeddingEngine | null,
  {
    topK = 10,
    domain = null,
    directory = null,
    agentTopic = null,
    minHeat = 0.01, // source: cortex@ed33435 mcp_server/core/pg_recall.py:197
    rerank = true,
    rerankAlpha = 0.70,  // source: cortex@ed33435 mcp_server/core/pg_recall.py:202
    wrrfK = 60,          // source: cortex@ed33435 mcp_server/core/pg_recall.py:203
    momentumState = null,
    includeGlobals = true,
  }: RecallOptions = {},
): Promise<Candidate[]> {
  // 1. Intent classification
  const intentInfo = classifyQueryIntent(query);
  const intent = intentInfo.intent;

  // 2. Intent-adaptive PG weights
  const weights = computePgWeights(intent, intentInfo.weights ?? {});

  // 3. Encode query
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:217-222
  const qEmb = embeddings !== null ? await embeddings.encode(query) : null;

  // 4. PG recall_memories (server-side WRRF fusion)
  const pgMax = topK;
  let candidates: Candidate[] = await store.recallMemories({
    query_text: query,
    query_embedding: qEmb,
    intent: String(intent),
    domain,
    directory,
    agent_topic: agentTopic,
    min_heat: minHeat,
    max_results: pgMax,
    wrrf_k: wrrfK,
    weights,
    include_globals: includeGlobals,
  });

  if (candidates.length === 0) return [];

  // 4a. HOPFIELD (Ramsauer 2021 attention)
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:240-248
  candidates = await hopfieldComplete(
    candidates,
    qEmb,
    store,
    embeddings?.dimensions ?? 0,
  );

  // 4b. HDC (Kanerva 2009 bipolar algebra)
  candidates = hdcRerank(candidates, query);

  // 4c. SPREADING_ACTIVATION (Collins & Loftus 1975 BFS over entity graph)
  candidates = await spreadingActivationExpand(candidates, query, store);

  // 4d. DENDRITIC_CLUSTERS (Poirazi 2003 multiplicative modulation)
  candidates = await dendriticModulate(candidates, query, store);

  // 4e. EMOTIONAL_RETRIEVAL — Bower 1981 mood-congruent recall
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:267-269
  candidates = emotionalRetrievalRerank(candidates, query);

  // 4f. MOOD_CONGRUENT_RERANK — Bower 1981 mood-state-dependent recall
  // Returns identity when no mood signal exists.
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:272-274
  candidates = moodCongruentRerank(candidates, getUserMood(store));

  // 4g. RECONSOLIDATION — Nader, Schafe & LeDoux (2000), Nature 406(6797).
  // MUST be the final post-WRRF stage so the mutation reflects the
  // FINAL ranking the user will see.
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:276-282
  candidates = await reconsolidationApply(candidates, query, store);

  // 5. Client-side FlashRank reranking
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:285-296
  if (rerank && candidates.length > 1) {
    const rankedPairs = candidates.map((c): [number, number] => [
      c.memory_id,
      c.score ?? 0.0,
    ]);
    const contentMap: Record<number, string> = {};
    for (const c of candidates) contentMap[c.memory_id] = c.content ?? "";
    const reranked = await rerankResults(query, rankedPairs, contentMap, rerankAlpha);
    const candMap = new Map(candidates.map((c) => [c.memory_id, c]));
    candidates = reranked
      .map(([mid, score]): Candidate | undefined => {
        const c = candMap.get(mid);
        if (!c) return undefined;
        return { ...c, score };
      })
      .filter((c): c is Candidate => c !== undefined);
  }

  // 6. Per-type pool guarantee for instruction/preference queries.
  // ENGRAM (arxiv 2511.12960): typed memory pools prevent instruction/
  // preference memories from being drowned out by episodic memories.
  // Reserves 2 slots for tag-matched memories when intent matches.
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:298-313
  const tagForIntent = _TYPE_INTENTS[intent];
  if (
    tagForIntent &&
    qEmb !== null &&
    typeof store.searchByTagVector === "function"
  ) {
    const existingIds = new Set(candidates.map((c) => c.memory_id));
    const typed = await store.searchByTagVector(qEmb, tagForIntent, {
      domain,
      limit: 2,
    });
    for (const t of typed) {
      const mid = t["id"] as number | undefined ?? t.memory_id;
      if (mid !== undefined && !existingIds.has(mid)) {
        const entry: Candidate = {
          ...t,
          memory_id: mid,
        };
        candidates.unshift(entry); // Front of list = high rank
        existingIds.add(mid);
      }
    }
  }

  // 7. Abstention gate — DISABLED.
  // v0.1 model regresses BEAM by -0.191 MRR on every category.
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:316-326

  // 8. MMR diversity reranking — DISABLED after ablation.
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:327-338

  // 9. Chronological reranking for event ordering queries.
  // ChronoRAG (Chen et al., 2025): blend relevance rank with
  // chronological rank via RRF (Cormack et al., 2009).
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:340-344
  if (intent === QueryIntent.EVENT_ORDER && candidates.length > 1) {
    candidates = chronologicalRerank(candidates, 0.5, 60) as Candidate[];
  }

  // 10. Titans test-time learning (Behrouz et al., NeurIPS 2025)
  // source: cortex@ed33435 mcp_server/core/pg_recall.py:346-358
  if (momentumState !== null) {
    const titans = getTitans();
    const resultEmbs: number[][] = [];
    for (const r of candidates.slice(0, 10)) {
      if (typeof store.getMemory !== "function") break;
      const mem = await store.getMemory(r.memory_id);
      if (mem && Array.isArray(mem["embedding"])) {
        resultEmbs.push(mem["embedding"] as number[]);
      }
    }
    const surprise = titans.update(qEmb, resultEmbs);
    momentumState["momentum"] = surprise;
  }

  return candidates.slice(0, topK);
}
