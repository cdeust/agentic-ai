/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * LoCoMo benchmark runner — runs the dataset through the TS Cortex
 * pure retrieval pipeline (recall() from pg-recall.ts) and emits
 * per-question hit ranks.
 *
 * Mirrors the Python benchmark's evaluate_conversation contract:
 *   - one in-memory store per conversation
 *   - sessions seeded as memories with source="session_<idx>"
 *   - each QA's `evidence` parsed into target session indices
 *   - hit_rank = first rank whose memory's session_idx is in target set
 *
 * source: cortex@1ef1376 benchmarks/locomo/run_benchmark.py:43-90 (evaluate_conversation)
 * source: cortex@1ef1376 benchmarks/locomo/run_benchmark.py:191-225 (per-conversation flow)
 *
 * Fix (2026-05-06): switched from recallHandler (production composition root
 * with prospective/co-activation/strategic-ordering enrichments) to recall()
 * from pg-recall.ts, which mirrors Python's core.pg_recall.recall() — the
 * pure retrieval pipeline.  Python bench calls BenchmarkDB.recall() which
 * delegates to core.pg_recall.recall(), NOT the handler layer.
 * source: cortex@1ef1376 benchmarks/lib/bench_db.py — BenchmarkDB.recall()
 */

import { recall } from "@agentic/memory/recall/pg-recall.js";
import type { PgStore, PgRecallMemoriesParams } from "@agentic/memory/recall/pg-recall.js";
import type { Candidate } from "@agentic/memory/recall/recall-pipeline-stages.js";
import { SqliteMemoryStore } from "@agentic/memory/remember/storage/sqlite-store.js";
import {
  TransformersEmbeddingEngine,
  toRecallEmbeddingEngine,
  _resetPipelineCache,
} from "@agentic/memory/infrastructure/transformers-embedding-engine.js";
import { ingestMemoriesBatch } from "@agentic/memory/remember/memory-ingest.js";
import type { EmbeddingEngine as CoreEmbeddingEngine } from "@agentic/core";
import {
  CATEGORY_NAMES,
  extractSessions,
  parseEvidenceRefs,
  type LocomoConversation,
} from "./locomo-loader.js";
import type { QuestionResult } from "./scoring.js";
// source: cortex@1ef1376 run_benchmark.py:73 — same top_k passed to recall.
const TOP_K = 10;

// Cap conversations seeded per run when --limit is given.
const DEFAULT_LIMIT: number | null = null;

// WRRF constant from Cormack et al. (SIGIR 2009) — same default as pg-recall.ts
// source: cortex@ed33435 mcp_server/core/pg_recall.py:203
const WRRF_K = 60;

// Default WRRF weights (general intent).
// source: cortex@ed33435 mcp_server/core/pg_recall_weights.py — general intent defaults
const DEFAULT_WEIGHTS: Record<string, number> = {
  vector: 1.0,
  fts: 0.5,
  heat: 0.3,
  recency: 0.0,
};

interface SeededState {
  /** Map of memory_id → originating session_idx, mirrors source_map in Python. */
  readonly midToSidx: Map<number, number>;
}

// ── SqliteMemoryStore raw-DB accessor ─────────────────────────────────────
// The adapter below needs the raw better-sqlite3 connection for the heat,
// recency, agent-boost, and fetch signals, which have no public API on
// SqliteMemoryStore.  We access _db via a type-cast — locally justified:
// this is a benchmark harness (not production code), and adding public
// accessors to SqliteMemoryStore would widen its surface area permanently
// for a benchmark-only concern.
// Correctness argument: _db is set in the constructor and never reassigned;
// the cast is safe as long as the field name matches (verified 2026-05-06
// against sqlite-store.ts:273).

// RawDb is the better-sqlite3 Database interface subset we actually use.
// We do not import better-sqlite3 types here (not a direct dependency of the
// benchmark package) — the cast is structurally validated by the SQL calls below.
interface RawDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

function getRawDb(store: SqliteMemoryStore): RawDb {
  return (store as unknown as { _db: RawDb })._db;
}

// ── PgStore adapter ────────────────────────────────────────────────────────

/**
 * Adapt a SqliteMemoryStore to the PgStore port required by recall().
 *
 * recallMemories() replicates the SqliteSearchMixin.recallMemories logic
 * (packages/memory/src/remember/storage/sqlite-store-search.ts:54-86):
 * four WRRF signals (vector, FTS, heat, recency) fused via RRF, plus
 * optional agent-topic boost, then a ranked fetch.
 *
 * precondition: memoryStore is open (not closed).
 * postcondition: returns Candidate[] sorted descending by fused score,
 *   length <= params.max_results; returns [] when the store has no rows
 *   matching the domain/heat filters.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:39-61
 */
function makePgStore(memoryStore: SqliteMemoryStore): PgStore {
  const db: RawDb = getRawDb(memoryStore);

  /**
   * Build the WHERE clause for heat-filtered domain/directory queries.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:152-166
   */
  function buildFilter(
    minHeat: number,
    domain: string | null | undefined,
    directory: string | null | undefined,
  ): { conds: string[]; params: unknown[] } {
    const conds = ["heat_base >= ?", "NOT is_stale"];
    const params: unknown[] = [minHeat];
    if (domain) {
      conds.push("(domain = ? OR is_global = 1)");
      params.push(domain);
    }
    if (directory) {
      conds.push("(directory_context = ? OR is_global = 1)");
      params.push(directory);
    }
    return { conds, params };
  }

  /**
   * Vector signal: top-pool RRF contribution from KNN search.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:63-85
   */
  function signalVector(
    scores: Map<number, number>,
    queryEmbedding: number[] | null,
    weight: number,
    k: number,
    pool: number,
  ): void {
    if (!memoryStore.hasVec || queryEmbedding === null || weight <= 0) return;
    const f32 = new Float32Array(queryEmbedding);
    const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    const hits = memoryStore.searchVectors(buf, pool);
    hits.forEach(([memory_id], rank) => {
      scores.set(memory_id, (scores.get(memory_id) ?? 0) + weight / (k + rank + 1));
    });
  }

  /**
   * FTS signal: top-pool RRF contribution from FTS5 search.
   *
   * PARITY FIX (2026-05-06): pass raw query_text directly to FTS5 without
   * sanitization, matching Python's _signal_fts behavior exactly.
   *
   * Python source: cortex@82b15b3 mcp_server/infrastructure/sqlite_store_search.py:87-106
   *   self._conn.execute("SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ?
   *                        ORDER BY rank LIMIT ?", (query_text, pool)).fetchall()
   *   wrapped in try/except Exception: pass
   *
   * Python's LoCoMo questions all contain '?' or "'" which are FTS5 syntax
   * errors. Python silently catches these (try/except Exception: pass), so
   * the FTS signal is always 0 for LoCoMo questions. Passing raw text here
   * produces the same behavior: the SQL will raise, the catch returns 0
   * contribution. DO NOT call memoryStore.searchFts() — that sanitizes the
   * query into "word" OR "word" OR ... (disjunction), which is correct for
   * production but diverges from Python's bench behavior on LoCoMo data.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:87-106
   */
  function signalFts(
    scores: Map<number, number>,
    queryText: string,
    weight: number,
    k: number,
    pool: number,
  ): void {
    if (!queryText || weight <= 0) return;
    // Pass raw queryText to FTS5 — mirrors Python's _signal_fts which does NOT sanitize.
    // Queries with FTS5-special chars (?, ', ,) will throw; catch returns 0 contribution.
    try {
      const rows = db
        .prepare(
          "SELECT rowid, rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?",
        )
        .all(queryText, pool) as Array<{ rowid: number; rank: number }>;
      rows.forEach((r, rank) => {
        scores.set(r.rowid, (scores.get(r.rowid) ?? 0) + weight / (k + rank + 1));
      });
    } catch {
      // FTS5 syntax error (?, ', , in query text) — silently return 0 contribution.
      // Matches Python's try/except Exception: pass in _signal_fts.
    }
  }

  /**
   * Heat signal: hot memories by heat_base DESC.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:108-128
   */
  function signalHeat(
    scores: Map<number, number>,
    weight: number,
    k: number,
    pool: number,
    minHeat: number,
    domain: string | null | undefined,
    directory: string | null | undefined,
  ): void {
    if (weight <= 0) return;
    const { conds, params } = buildFilter(minHeat, domain, directory);
    params.push(pool);
    const rows = db
      .prepare(
        `SELECT id FROM memories WHERE ${conds.join(" AND ")} ORDER BY heat_base DESC LIMIT ?`,
      )
      .all(...params) as Array<{ id: number }>;
    rows.forEach((r, rank) => {
      scores.set(r.id, (scores.get(r.id) ?? 0) + weight / (k + rank + 1));
    });
  }

  /**
   * Recency signal: memories by created_at DESC.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:130-151
   */
  function signalRecency(
    scores: Map<number, number>,
    weight: number,
    k: number,
    pool: number,
    minHeat: number,
    domain: string | null | undefined,
    directory: string | null | undefined,
  ): void {
    if (weight <= 0) return;
    const { conds, params } = buildFilter(minHeat, domain, directory);
    params.push(pool);
    const rows = db
      .prepare(
        `SELECT id FROM memories WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params) as Array<{ id: number }>;
    rows.forEach((r, rank) => {
      scores.set(r.id, (scores.get(r.id) ?? 0) + weight / (k + rank + 1));
    });
  }

  /**
   * Agent-topic boost: small additive bonus for memories tagged to agentTopic.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:152-166
   */
  function applyAgentBoost(
    scores: Map<number, number>,
    agentTopic: string | null | undefined,
    wVector: number,
    wrfK: number,
  ): void {
    if (!agentTopic || scores.size === 0) return;
    const boost = 0.3 * (wVector / wrfK); // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:173
    const ids = [...scores.keys()];
    const placeholders = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id FROM memories WHERE id IN (${placeholders}) AND agent_context = ?`,
      )
      .all(...ids, agentTopic) as Array<{ id: number }>;
    for (const r of rows) {
      scores.set(r.id, (scores.get(r.id) ?? 0) + boost);
    }
  }

  /**
   * Fetch ranked results from the memories table for the top scoring ids.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:188-230
   */
  function fetchRankedResults(
    scores: Map<number, number>,
    maxResults: number,
    minHeat: number,
    domain: string | null | undefined,
    directory: string | null | undefined,
  ): Candidate[] {
    const topIds = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults * 3)
      .map(([id]) => id);

    if (topIds.length === 0) return [];
    const placeholders = topIds.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`)
      .all(...topIds) as Array<Record<string, unknown>>;

    const rowMap = new Map(rows.map((r) => [r["id"] as number, r]));
    const results: Candidate[] = [];

    for (const mid of topIds) {
      const row = rowMap.get(mid);
      if (row == null) continue;
      const heat = (row["heat_base"] as number) ?? (row["heat"] as number) ?? 0;
      if (heat < minHeat || row["is_stale"]) continue;
      const isGlobal = Boolean(row["is_global"]);
      if (domain && row["domain"] !== domain && !isGlobal) continue;
      if (directory && row["directory_context"] !== directory && !isGlobal) continue;
      results.push({
        memory_id: mid,
        content: row["content"] as string,
        score: scores.get(mid) ?? 0,
        heat,
        domain: (row["domain"] as string) ?? "",
        created_at: row["created_at"] as string,
        tags: row["tags"] as string,
        emotional_valence: (row["emotional_valence"] as number) ?? 0,
      });
    }
    return results;
  }

  return {
    /**
     * Client-side WRRF fusion equivalent of the PL/pgSQL recall_memories procedure.
     *
     * precondition: store is open; params.max_results >= 1; params.wrrf_k >= 1.
     * postcondition: returned array is sorted descending by fused WRRF score;
     *   length <= params.max_results; only rows satisfying min_heat and domain
     *   filters are returned.
     *
     * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:39-86
     */
    recallMemories(params: PgRecallMemoriesParams): Candidate[] {
      const {
        query_text,
        query_embedding,
        domain,
        directory,
        agent_topic,
        min_heat,
        max_results,
        wrrf_k,
        weights,
      } = params;

      const wVector = weights["vector"] ?? DEFAULT_WEIGHTS["vector"] ?? 1.0;
      const wFts = weights["fts"] ?? DEFAULT_WEIGHTS["fts"] ?? 0.5;
      const wHeat = weights["heat"] ?? DEFAULT_WEIGHTS["heat"] ?? 0.3;
      const wRecency = weights["recency"] ?? DEFAULT_WEIGHTS["recency"] ?? 0.0;
      const pool = max_results * 10; // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:75
      const scores: Map<number, number> = new Map();

      signalVector(scores, query_embedding, wVector, wrrf_k, pool);
      signalFts(scores, query_text, wFts, wrrf_k, pool);
      signalHeat(scores, wHeat, wrrf_k, pool, min_heat, domain, directory);
      signalRecency(scores, wRecency, wrrf_k, pool, min_heat, domain, directory);
      applyAgentBoost(scores, agent_topic, wVector, wrrf_k);

      if (scores.size === 0) return [];
      return fetchRankedResults(scores, max_results, min_heat, domain, directory);
    },

    // CandidateStore methods forwarded to SqliteMemoryStore equivalents.

    getMemory: async (id: number) =>
      memoryStore.getMemory(id) as Record<string, unknown> | null,

    // ReconsolidationStore methods — forward writes back to the store.
    bumpHeatRaw: (memoryId: number, newHeatBase: number) => {
      memoryStore.bumpHeatRaw(memoryId, newHeatBase);
    },
    updateMemoryAccess: (memoryId: number) => {
      memoryStore.updateMemoryAccess(memoryId);
    },
  };
}

async function seedConversation(
  store: SqliteMemoryStore,
  conv: LocomoConversation,
  embedder: CoreEmbeddingEngine | null,
): Promise<SeededState> {
  const sessions = extractSessions(conv.conversation);
  const midToSidx = new Map<number, number>();

  // Build input for ingestMemoriesBatch — mirrors Python bench_db.py:101
  // source: cortex@1ef1376 benchmarks/lib/bench_db.py:101
  //   ids, source_map = ingest_memories_batch(memories, store, embeddings, domain="locomo",
  //                                           decompose=True, is_benchmark=True)
  // Each session is one input; ingestMemoriesBatch decomposes it into
  // sub-session chunks (speaker-turn boundaries, turns_per_chunk=6).
  // All chunks from session_i get source="session_i" → source_map maps
  // every chunk id to its originating session_idx.
  // IngestMemoryInput does not have a domain field — domain is passed
  // as an IngestOptions field and applied to all chunks in the batch.
  // source: cortex@1ef1376 mcp_server/core/memory_ingest.py:23-32
  const inputs = sessions.map((s) => ({
    content: s.content,
    tags: ["locomo"] as string[],
    source: `session_${s.session_idx}`,
    created_at: s.date,
  }));

  const { sourceMap } = await ingestMemoriesBatch(inputs, store, embedder, {
    domain: "locomo",
    decompose: true,
    isBenchmark: true,
  });

  // Populate midToSidx from sourceMap (mirrors Python evaluate_conversation:53-58).
  // source: cortex@1ef1376 benchmarks/locomo/run_benchmark.py:53-58
  for (const [mid, src] of sourceMap) {
    if (src.startsWith("session_")) {
      const idx = parseInt(src.slice("session_".length), 10);
      if (!isNaN(idx)) midToSidx.set(mid, idx);
    }
  }

  return { midToSidx };
}

async function evaluateQuestion(
  pgStore: PgStore,
  recallEmbedder: ReturnType<typeof toRecallEmbeddingEngine> | null,
  state: SeededState,
  qa: LocomoConversation["qa"][number],
): Promise<QuestionResult | null> {
  const refs = parseEvidenceRefs(qa.evidence);
  const targetSessions = new Set(refs.map(([sidx]) => sidx));
  if (targetSessions.size === 0) return null;
  const category = CATEGORY_NAMES[qa.category ?? 0] ?? `unknown_${qa.category ?? 0}`;

  // source: cortex@1ef1376 benchmarks/locomo/run_benchmark.py:73
  //   BenchmarkDB.recall(question, top_k=10, domain="locomo") delegates to
  //   core.pg_recall.recall() — rerank=false because the TS port has no
  //   FlashRank cross-encoder (Borges finding 2.2, documented as remaining gap).
  //   min_heat=0.01 (pg-recall.ts default); includeGlobals=false so locomo
  //   sessions in "locomo" domain are not drowned by globals.
  const candidates = await recall(qa.question, pgStore, recallEmbedder, {
    topK: TOP_K,
    domain: "locomo",
    minHeat: 0.01, // source: cortex@ed33435 mcp_server/core/pg_recall.py:197
    rerank: false, // FlashRank not ported yet — Borges finding 2.2
    wrrfK: WRRF_K,
    includeGlobals: false,
  });

  let hitRank: number | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;
    const sidx = state.midToSidx.get(candidate.memory_id);
    if (sidx !== undefined && targetSessions.has(sidx)) {
      hitRank = i + 1;
      break;
    }
  }
  return { category, hit_rank: hitRank };
}

async function evaluateConversation(
  conv: LocomoConversation,
  coreEmbedder: CoreEmbeddingEngine | null,
  recallEmbedder: ReturnType<typeof toRecallEmbeddingEngine> | null,
): Promise<QuestionResult[]> {
  const store = new SqliteMemoryStore(":memory:");
  const pgStore = makePgStore(store);
  try {
    const state = await seedConversation(store, conv, coreEmbedder);
    const results: QuestionResult[] = [];
    for (const qa of conv.qa) {
      const r = await evaluateQuestion(pgStore, recallEmbedder, state, qa);
      if (r) results.push(r);
    }
    return results;
  } finally {
    store.close();
  }
}

export interface RunOptions {
  readonly limit?: number | null;
  readonly onProgress?: (current: number, total: number) => void;
  /**
   * When true, instantiates TransformersEmbeddingEngine (Xenova/all-MiniLM-L6-v2,
   * ~90 MB one-time download to ~/.cache/huggingface/hub) and uses it for
   * vector search. The Python LoCoMo baseline was captured with real
   * embeddings, so reaching parity requires this path. Default true.
   *
   * Set false for an FTS-only smoke run (faster, no model download, but
   * top-rank metrics will lag the Python baseline).
   */
  readonly useEmbeddings?: boolean;
}

/**
 * Run LoCoMo over an array of conversations and return per-question results.
 *
 * precondition: conversations is the loaded locomo10.json array.
 * postcondition: returned array contains one QuestionResult per question with
 *   evidence; questions without evidence are skipped (matches Python behavior).
 */
export async function runLocomo(
  conversations: readonly LocomoConversation[],
  options: RunOptions = {},
): Promise<QuestionResult[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const slice = limit !== null && limit > 0 ? conversations.slice(0, limit) : conversations;
  const useEmbeddings = options.useEmbeddings ?? true;
  let coreEmbedder: CoreEmbeddingEngine | null = null;
  let recallEmbedder: ReturnType<typeof toRecallEmbeddingEngine> | null = null;
  if (useEmbeddings) {
    coreEmbedder = new TransformersEmbeddingEngine();
    recallEmbedder = toRecallEmbeddingEngine(coreEmbedder);
    // Force a one-shot warm-up so the heavy load is reported by the first
    // onProgress call rather than charged silently to conversation #1.
    await coreEmbedder.embed("warmup");
  }
  try {
    const all: QuestionResult[] = [];
    for (let i = 0; i < slice.length; i++) {
      const conv = slice[i];
      if (!conv) continue;
      const convResults = await evaluateConversation(conv, coreEmbedder, recallEmbedder);
      all.push(...convResults);
      options.onProgress?.(i + 1, slice.length);
    }
    return all;
  } finally {
    if (useEmbeddings) _resetPipelineCache();
  }
}
