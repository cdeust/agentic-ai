/**
 * LoCoMo benchmark runner — runs the dataset through the TS Cortex
 * pure retrieval pipeline (recall() from pg-recall.ts) and emits
 * per-question hit ranks.
 *
 * Single concern: benchmark evaluation orchestration (seed, evaluate, collect).
 * The SQLite-to-PgStore infrastructure adapter is in sqlite-pgstore-adapter.ts.
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
 *
 * Split (2026-05-06): adapter extracted to sqlite-pgstore-adapter.ts to
 * satisfy coding-standards §4.1 (500-line file limit).
 * source: coding-standards §4.1; Fowler (2018), Refactoring §6.1.
 */

import { recall } from "@agentic/memory/recall/pg-recall.js";
import type { PgStore } from "@agentic/memory/recall/pg-recall.js";
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
import { makePgStore } from "./sqlite-pgstore-adapter.js";

// source: cortex@1ef1376 run_benchmark.py:73 — same top_k passed to recall.
const TOP_K = 10;

// Cap conversations seeded per run when --limit is given.
const DEFAULT_LIMIT: number | null = null;

// WRRF constant from Cormack et al. (SIGIR 2009) — same default as pg-recall.ts
// source: cortex@ed33435 mcp_server/core/pg_recall.py:203
const WRRF_K = 60;

interface SeededState {
  /** Map of memory_id → originating session_idx, mirrors source_map in Python. */
  readonly midToSidx: Map<number, number>;
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
