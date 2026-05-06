/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * LoCoMo benchmark runner — PostgreSQL backend.
 *
 * This runner uses the SAME PostgreSQL stored procedure as Python's bench:
 *   recall_memories(query_text, query_emb, ...) → rows ordered by score
 *
 * This is the parity-critical path. The SQLite runner (locomo-runner.ts)
 * uses a different fusion algorithm (WRRF vs TMM) and cannot produce
 * identical rankings to Python. This PG runner CAN.
 *
 * source: cortex@82b15b3 benchmarks/lib/bench_db.py:BenchmarkDB.recall()
 *   delegates to mcp_server.core.pg_recall.recall() which calls
 *   store.recall_memories() → PL/pgSQL recall_memories() stored procedure.
 *
 * Requires: DATABASE_URL env var pointing to the Cortex PostgreSQL instance
 *   with pgvector and the recall_memories function installed.
 */

import { recall } from "@agentic/memory/recall/pg-recall.js";
import type { PgStore, PgRecallMemoriesParams } from "@agentic/memory/recall/pg-recall.js";
import type { Candidate } from "@agentic/memory/recall/recall-pipeline-stages.js";
import { PgMemoryStore } from "@agentic/memory/remember/storage/pg-store.js";
import {
  TransformersEmbeddingEngine,
  toRecallEmbeddingEngine,
  _resetPipelineCache,
} from "@agentic/memory/infrastructure/transformers-embedding-engine.js";
import { buildEntitySummary, detectEntityFlags } from "@agentic/memory/remember/memory-ingest.js";
import type { EmbeddingEngine as CoreEmbeddingEngine } from "@agentic/core";
import {
  CATEGORY_NAMES,
  extractSessions,
  parseEvidenceRefs,
  type LocomoConversation,
} from "./locomo-loader.js";
import type { QuestionResult } from "./scoring.js";

// source: cortex@82b15b3 run_benchmark.py:73 — same top_k
const TOP_K = 10;
// source: cortex@82b15b3 mcp_server/core/pg_recall.py:203 — WRRF k constant
const WRRF_K = 60;

interface SeededState {
  readonly midToSidx: Map<number, number>;
}

/**
 * Adapt PgMemoryStore to the PgStore interface required by recall().
 *
 * recallMemories() delegates to the PostgreSQL recall_memories() stored
 * procedure via PgMemoryStore.recallMemoriesAsync().
 *
 * This is the EXACT same retrieval path as Python's bench:
 *   Python: store.recall_memories(...) → PL/pgSQL recall_memories()
 *   TS: this.recallMemories() → PgMemoryStore.recallMemoriesAsync() → PL/pgSQL recall_memories()
 *
 * source: cortex@82b15b3 mcp_server/infrastructure/pg_store.py:recall_memories
 */
function makePgStoreAdapter(pgStore: PgMemoryStore): PgStore {
  return {
    async recallMemories(params: PgRecallMemoriesParams): Promise<Candidate[]> {
      const rows = await pgStore.recallMemoriesAsync({
        queryText: params.query_text,
        // Convert number[] embedding to Buffer
        queryEmbedding: params.query_embedding !== null
          ? Buffer.from(new Float32Array(params.query_embedding).buffer)
          : null,
        intent: params.intent,
        domain: params.domain,
        directory: params.directory,
        agentTopic: params.agent_topic,
        minHeat: params.min_heat,
        maxResults: params.max_results,
        wrrfK: params.wrrf_k,
        weights: {
          vector: params.weights["vector"],
          fts: params.weights["fts"],
          heat: params.weights["heat"],
          ngram: params.weights["ngram"],
          recency: params.weights["recency"],
        },
        includeGlobals: params.include_globals,
      });

      // Map PG row → Candidate
      // source: cortex@82b15b3 mcp_server/infrastructure/pg_schema.py:919-930
      return rows.map((r) => ({
        memory_id: r.memory_id,
        content: r.content,
        score: r.score,
        heat: r.heat,
        domain: r.domain,
        created_at: r.created_at,
        tags: r.tags as string,
        emotional_valence: r.emotional_valence,
      } satisfies Candidate));
    },

    async getMemory(id: number): Promise<Record<string, unknown> | null> {
      const mem = await pgStore.getMemoryAsync(id);
      return mem as Record<string, unknown> | null;
    },

    // ReconsolidationStore stubs — PG bench doesn't need reconsolidation writes.
    bumpHeatRaw: (_memoryId: number, _newHeatBase: number) => { /* no-op */ },
    updateMemoryAccess: (_memoryId: number) => { /* no-op */ },
  };
}

// Speaker turn pattern for decomposition — matches Python's _SPEAKER_LINE_RE.
// source: cortex@82b15b3 mcp_server/core/memory_decomposer.py:139
//   _SPEAKER_LINE_RE = re.compile(r"^\[([^\]]+)\]:\s*", re.MULTILINE)
const SPEAKER_LINE_RE = /^(\[([^\]]+)\]:|(?:Human|Assistant|User|AI):)/m;
// source: cortex@82b15b3 mcp_server/core/memory_ingest.py:TURNS_PER_CHUNK_DEFAULT
const TURNS_PER_CHUNK = 6;

/**
 * Decompose a session's content at speaker-turn boundaries.
 * Returns chunks (at most TURNS_PER_CHUNK turns each).
 * Mirrors Python's decompose_memory / _chunk_by_turns behavior.
 *
 * source: cortex@82b15b3 mcp_server/core/memory_decomposer.py:decompose_memory
 */
function decomposeSession(content: string): string[] {
  if (!SPEAKER_LINE_RE.test(content)) return [content];
  const lines = content.split("\n");
  const chunks: string[] = [];
  let buffer: string[] = [];
  let turnCount = 0;

  for (const line of lines) {
    if (SPEAKER_LINE_RE.test(line)) {
      turnCount++;
      if (turnCount > TURNS_PER_CHUNK && buffer.length > 0) {
        const chunk = buffer.join("\n").trim();
        if (chunk) chunks.push(chunk);
        buffer = [];
        turnCount = 1;
      }
    }
    buffer.push(line);
  }
  if (buffer.length > 0) {
    const chunk = buffer.join("\n").trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks : [content];
}

async function seedConversation(
  pgStore: PgMemoryStore,
  conv: LocomoConversation,
  embedder: CoreEmbeddingEngine | null,
): Promise<SeededState> {
  const sessions = extractSessions(conv.conversation);
  const midToSidx = new Map<number, number>();

  // Decompose each session into chunks and insert each chunk separately.
  // This mirrors Python's ingest_memories_batch with decompose=True.
  // source: cortex@82b15b3 benchmarks/lib/bench_db.py:load_memories
  //   calls ingest_memories_batch(..., decompose=True, is_benchmark=True)
  // source: cortex@82b15b3 mcp_server/core/memory_ingest.py:ingest_memory
  //   decomposes content → chunks → encode+insert per chunk

  for (const s of sessions) {
    const chunks = decomposeSession(s.content);
    for (const chunk of chunks) {
      // Detect entity flags and build entity summary prefix for the embedding.
      // source: cortex@82b15b3 mcp_server/core/memory_ingest.py:63-68
      //   entity_summary = build_entity_summary(entities)
      //   embed_text = f"{entity_summary}\n{chunk_content}" if entity_summary else chunk_content
      const entityFlags = detectEntityFlags(chunk);
      const entitySummary = buildEntitySummary(entityFlags);
      const embedText = entitySummary ? `${entitySummary}\n${chunk}` : chunk;

      // Encode embedding for this chunk with entity prefix
      let emb: Buffer | null = null;
      if (embedder !== null) {
        const vec = await embedder.embed(embedText.slice(0, 2000)); // source: cortex@82b15b3 mcp_server/core/memory_ingest.py:72 — text[:2000] char cap
        emb = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
      }

      const mid = await pgStore.insertMemoryAsync({
        content: chunk,
        domain: "locomo",
        source: `session_${s.session_idx}`,
        tags: ["locomo"],
        created_at: s.date,
        is_benchmark: true,
      });

      if (mid > 0) {
        // All chunks from session_i map to session_idx i.
        // source: cortex@82b15b3 mcp_server/core/memory_ingest.py:183-189
        //   for mid in ids: source_map[mid] = source
        midToSidx.set(mid, s.session_idx);

        // Store embedding separately via upsertEmbedding.
        // Python: store.insert_memory({'embedding': emb, ...}) stores inline.
        // TS: PG INSERT doesn't include embedding; must call upsertEmbedding.
        if (emb !== null) {
          await pgStore.upsertEmbedding(mid, emb);
        }
      }
    }
  }

  return { midToSidx };
}

async function evaluateQuestion(
  pgStoreAdapter: PgStore,
  recallEmbedder: ReturnType<typeof toRecallEmbeddingEngine> | null,
  state: SeededState,
  qa: LocomoConversation["qa"][number],
): Promise<QuestionResult | null> {
  const refs = parseEvidenceRefs(qa.evidence);
  const targetSessions = new Set(refs.map(([sidx]) => sidx));
  if (targetSessions.size === 0) return null;
  const category = CATEGORY_NAMES[qa.category ?? 0] ?? `unknown_${qa.category ?? 0}`;

  // source: cortex@82b15b3 benchmarks/lib/bench_db.py:recall()
  //   pg_recall(..., top_k=10, domain="locomo", min_heat=0.01,
  //             rerank=True, rerank_alpha=0.70, include_globals=False)
  const candidates = await recall(qa.question, pgStoreAdapter, recallEmbedder, {
    topK: TOP_K,
    domain: "locomo",
    minHeat: 0.01,    // source: cortex@82b15b3 mcp_server/core/pg_recall.py:197
    rerank: true,     // Python bench uses rerank=True (default)
    rerankAlpha: 0.70, // source: cortex@82b15b3 mcp_server/core/pg_recall.py:202
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

export interface RunPgOptions {
  readonly limit?: number | null;
  readonly onProgress?: (current: number, total: number) => void;
  readonly databaseUrl?: string;
}

/**
 * Run LoCoMo via the PostgreSQL recall_memories stored procedure.
 *
 * This is the parity path — produces the same rankings as Python's bench
 * when given the same input data, because it calls the same PL/pgSQL function.
 *
 * precondition: databaseUrl points to the Cortex PostgreSQL instance with
 *   recall_memories() installed.
 * postcondition: clears all is_benchmark=TRUE memories before returning.
 */
export async function runLocomoPg(
  conversations: readonly LocomoConversation[],
  options: RunPgOptions = {},
): Promise<QuestionResult[]> {
  const dbUrl = options.databaseUrl
    ?? process.env["DATABASE_URL"]
    ?? "postgresql://localhost:5432/cortex"; // source: cortex@82b15b3 mcp_server/infrastructure/config.py — default DATABASE_URL
  const limit = options.limit ?? null;
  const slice = limit !== null && limit > 0 ? conversations.slice(0, limit) : conversations;

  const pgStore = new PgMemoryStore(dbUrl);
  const coreEmbedder: CoreEmbeddingEngine = new TransformersEmbeddingEngine();
  const recallEmbedder = toRecallEmbeddingEngine(coreEmbedder);

  // Warm up the embedding model
  await coreEmbedder.embed("warmup");

  try {
    const all: QuestionResult[] = [];
    for (let i = 0; i < slice.length; i++) {
      const conv = slice[i];
      if (!conv) continue;

      // Clear previous conversation's memories
      await pgStore.clearBenchmarkMemoriesAsync();

      const state = await seedConversation(pgStore, conv, coreEmbedder);
      const pgStoreAdapter = makePgStoreAdapter(pgStore);

      for (const qa of conv.qa) {
        const r = await evaluateQuestion(pgStoreAdapter, recallEmbedder, state, qa);
        if (r) all.push(r);
      }
      options.onProgress?.(i + 1, slice.length);
    }

    // Final cleanup
    await pgStore.clearBenchmarkMemoriesAsync();
    return all;
  } finally {
    _resetPipelineCache();
    await pgStore.close();
  }
}
