/**
 * memory-ingest.ts — Ingestion pipeline for a single memory item.
 *
 * Ports: core/memory_ingest.py (~120 LOC)
 *
 * Handles the write path for memories that may need structural decomposition.
 * Speaker-turn chunking for conversations; heading chunking for markdown.
 * Each chunk gets entity-enriched embeddings for better retrieval.
 *
 * Correctness invariants:
 *   I1. ingestMemory returns [] iff content is empty after trimming.
 *   I2. Every returned id is a positive integer referencing a row
 *       written atomically by store.insertMemory.
 *   I3. Entity-extraction failures MUST NOT block ingest (fire-and-forget).
 *
 * Source:
 *   core/memory_ingest.py
 *
 * Paper backing (WHY decisions deserve protection):
 *   McGaugh 2004: emotionally significant → ~2x retention
 *   Adcock et al. 2006: reward-motivated → ~1.5x recall boost
 *   Schultz 1997: decision = resolved prediction error = DA burst
 *   Frey & Morris 1997: synaptic tagging — strong events promote weak traces.
 *   Wegner 1987: Transactive Memory Systems — team knowledge needs coordination.
 */

import type { EmbeddingEngine } from "@agentic/core";
import type { MemoryStore } from "./storage/memory-store.js";

// ── Constants ───────────────────────────────────────────────────────────────

// source: Cortex mcp_server/infrastructure/embedding_engine.py:encode() — text.slice(0, 2000) char cap
const EMBED_MAX_CHARS = 2000;

// source: Cortex mcp_server/core/memory_ingest.py:TURNS_PER_CHUNK_DEFAULT
const DEFAULT_TURNS_PER_CHUNK = 6;

// source: Adcock et al. 2006: reward-motivated → ~1.5x recall boost
// source: Cortex mcp_server/core/memory_ingest.py:DECISION_IMPORTANCE_BOOST
const DECISION_IMPORTANCE_BOOST = 1.5;

// source: Cortex mcp_server/infrastructure/sqlite_store.py default importance = 0.5
const DEFAULT_IMPORTANCE = 0.5;

// ── Decomposition + entity extraction (delegated to 1:1 port) ──────────────
//
// The earlier in-file `decomposeContent` + `detectEntityFlags` + local
// `buildEntitySummary` were stub TS versions that diverged from the Python
// source: they returned empty entities (no persons/quoted_terms), only
// flag-style booleans, and produced a different summary format
// ("[decision, instruction]" instead of "People: X | Topics: Y | Type: Z").
//
// The full 1:1 port lives in memory-decomposer.ts and is now used directly
// here. Removing the stubs eliminates the drift Feynman traced as one of
// two structural causes for the cortex-bench MRR gap.
//
// source: cortex@ed33435 mcp_server/core/memory_decomposer.py:decompose_memory
//   + extract_conversational_entities + build_entity_summary
import {
  decomposeMemory,
  extractConversationalEntities,
  buildEntitySummary as buildEntitySummaryFromEntities,
  type ConversationalEntities,
  type MemoryChunk,
} from "./memory-decomposer.js";

// Backwards-compatibility shim: existing callers that imported
// `detectEntityFlags(content) -> Record<string, boolean>` get the same
// flag map but now derived from the full extractor so persons and
// quoted_terms are also available downstream when needed.
//
// postcondition: returned object has the four `has_*` keys plus the
//   per-call dynamic keys produced by extractConversationalEntities.
//
// source: cortex@ed33435 mcp_server/core/memory_decomposer.py:147 (extract_conversational_entities)
export function detectEntityFlags(content: string): ConversationalEntities {
  return extractConversationalEntities(content);
}

// ── Main ingestion function ─────────────────────────────────────────────────

export interface IngestOptions {
  domain?: string;
  decompose?: boolean;
  turnsPerChunk?: number;
  isBenchmark?: boolean;
}

export interface IngestMemoryInput {
  content: string;
  tags?: string[];
  source?: string;
  heat?: number;
  importance?: number;
  store_type?: string;
  agent_context?: string;
  is_global?: boolean;
  created_at?: string;
}

/**
 * Ingest a memory, optionally decomposing at structural boundaries.
 *
 * precondition:  memory.content is non-empty after trimming; store is connected.
 * postcondition:
 *   - Returns [] iff content is empty (invariant I1).
 *   - Every returned id is a row in the memories table (invariant I2).
 *   - Entity extraction failures do NOT abort ingest (invariant I3).
 *
 * Async because EmbeddingEngine.embed() is async (ONNX model inference).
 * source: core/memory_ingest.py:ingest_memory
 */
export async function ingestMemory(
  memory: IngestMemoryInput,
  store: MemoryStore,
  embeddings: EmbeddingEngine | null,
  options: IngestOptions = {},
): Promise<number[]> {
  const {
    domain = "",
    decompose = true,
    turnsPerChunk = DEFAULT_TURNS_PER_CHUNK,
    isBenchmark = false,
  } = options;

  const rawContent = memory.content ?? "";
  if (!rawContent.trim()) return [];

  // source: cortex@ed33435 mcp_server/core/memory_decomposer.py:decompose_memory
  //   The Python ingest path always calls decompose_memory which returns
  //   MemoryChunk objects with full ConversationalEntities (persons,
  //   quoted_terms, has_*). The TS port now uses the same code path.
  const chunks: MemoryChunk[] = decompose
    ? decomposeMemory(rawContent, turnsPerChunk)
    : [{ content: rawContent, entities: extractConversationalEntities(rawContent) }];

  const ids: number[] = [];

  for (const chunk of chunks) {
    const chunkContent = chunk.content;
    // Use the entities the decomposer already extracted — they include
    // persons + quoted_terms + flags. The previous code threw these away
    // and re-ran a flag-only regex pass, dropping all named-entity signal
    // before the embedding was computed.
    const entities = chunk.entities;

    // Build embedding text: entity-summary prefix improves targeting.
    // Format matches Python: "People: ... | Topics: ... | Type: ..."
    // source: cortex@ed33435 mcp_server/core/memory_decomposer.py:build_entity_summary
    const entitySummary = buildEntitySummaryFromEntities(entities);
    const embedText = entitySummary
      ? `${entitySummary}\n${chunkContent}`
      : chunkContent;

    // Encode via the async EmbeddingEngine.embed() — returns Float32Array.
    // Convert to Buffer for MemoryInsertData compatibility (Buffer over wire/storage).
    // source: Cortex mcp_server/infrastructure/embedding_engine.py:encode — returns bytes
    let emb: Buffer | null = null;
    if (embeddings !== null) {
      const vec = await embeddings.embed(embedText.slice(0, EMBED_MAX_CHARS));
      emb = Buffer.from(vec.buffer);
    }

    // Build tag list, extending with entity-derived tags.
    const tags = [...(memory.tags ?? [])];
    if (entities.has_preference) tags.push("preference");
    if (entities.has_instruction) tags.push("instruction");
    if (entities.has_decision) tags.push("decision");
    if (entities.has_activity) tags.push("activity");

    // ── Decision auto-protection ──────────────────────────────────────────
    // Decisions carry resolved prediction error (dopamine burst),
    // warranting stronger consolidation and protection from decay.
    //
    // Paper backing (WHY decisions deserve protection):
    //   McGaugh 2004: emotionally significant → ~2x retention
    //   Adcock et al. 2006: reward-motivated → ~1.5x recall boost
    //   Schultz 1997: decision = resolved prediction error = DA burst
    //
    // Detection: regex heuristic above (engineering heuristic, NOT
    // paper-prescribed — labelled as such in the Python source).
    //
    // Protection: is_protected=True survives decay (Frey & Morris 1997
    // synaptic tagging — strong events promote weak traces).
    const isDecision = Boolean(entities.has_decision);
    const autoProtect = isDecision && !isBenchmark;
    const importanceBoost = isDecision ? DECISION_IMPORTANCE_BOOST : 1.0;

    // ── Team memory propagation (TMS) ────────────────────────────────────
    // Wegner 1987 Transactive Memory Systems: team knowledge requires
    // coordination — important discoveries should be visible across
    // agent boundaries. Protected/decision memories auto-propagate
    // to team scope via is_global flag.
    //
    // Zhang et al. ACL 2024: specialized agents with shared directory
    // outperform shared-everything by 10-15%.
    const agentCtx = memory.agent_context ?? "";
    let isGlobal = memory.is_global ?? false;
    if (autoProtect && agentCtx && !isBenchmark) {
      isGlobal = true; // TMS coordination: decisions propagate
    }

    const mid = store.insertMemory({
      content: chunkContent,
      embedding: emb ?? undefined,
      domain,
      source: memory.source ?? "",
      tags,
      created_at: memory.created_at,
      heat: memory.heat ?? 1.0,
      importance: Math.min((memory.importance ?? DEFAULT_IMPORTANCE) * importanceBoost, 1.0),
      store_type: memory.store_type ?? "episodic",
      is_protected: autoProtect,
      agent_context: agentCtx,
      is_global: isGlobal,
      is_benchmark: isBenchmark,
    });

    // If the store exposes upsertEmbedding (SQLite path), call it explicitly.
    // insertMemory stores the embedding field in the row but SQLite's vec table
    // requires a separate upsertEmbedding call.  The Python source stores
    // embeddings inline in insert_memory (PG column) but for the SQLite adapter
    // we must call upsertEmbedding after insert.
    // source: cortex@82b15b3 mcp_server/core/memory_ingest.py:119 (embed stored inline)
    // source: packages/memory/src/remember/storage/sqlite-store.ts:insertMemory (no vec upsert)
    if (emb !== null && typeof (store as unknown as Record<string, unknown>)["upsertEmbedding"] === "function") {
      (store as unknown as { upsertEmbedding(id: number, emb: Buffer): void }).upsertEmbedding(mid, emb);
    }

    ids.push(mid);
  }

  return ids;
}

// ── Batch ingestion ─────────────────────────────────────────────────────────

/**
 * Batch ingest memories with structure-aware decomposition.
 *
 * postcondition:
 *   - ids is the flat list of all inserted memory IDs.
 *   - sourceMap maps each memory_id to the source string from its input.
 *
 * Async because ingestMemory is async (EmbeddingEngine.embed() is async).
 * source: core/memory_ingest.py:ingest_memories_batch
 */
export async function ingestMemoriesBatch(
  memories: IngestMemoryInput[],
  store: MemoryStore,
  embeddings: EmbeddingEngine | null,
  options: IngestOptions = {},
): Promise<{ ids: number[]; sourceMap: Map<number, string> }> {
  const allIds: number[] = [];
  const sourceMap = new Map<number, string>();

  for (const mem of memories) {
    const source = mem.source ?? "";
    const inserted = await ingestMemory(mem, store, embeddings, options);
    for (const mid of inserted) {
      sourceMap.set(mid, source);
    }
    allIds.push(...inserted);
  }

  return { ids: allIds, sourceMap };
}

// ── Entity summary helper ───────────────────────────────────────────────────

/**
 * Re-export the canonical 1:1 port of build_entity_summary from
 * memory-decomposer.ts. The previous local implementation diverged from
 * Python: it returned "[decision, instruction]" instead of the
 * Python-format "People: ... | Topics: ... | Type: ...". Backwards-compat
 * for any caller that imported `buildEntitySummary` from this module.
 *
 * source: cortex@ed33435 mcp_server/core/memory_decomposer.py:build_entity_summary
 */
export { buildEntitySummary } from "./memory-decomposer.js";
