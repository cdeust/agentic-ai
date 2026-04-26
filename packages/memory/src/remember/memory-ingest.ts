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

import type { MemoryStore } from "./storage/memory-store.js";

// ── Chunking helpers ────────────────────────────────────────────────────────

const SPEAKER_TURN_RE = /^(Human|Assistant|User|AI):/m;

interface Chunk {
  content: string;
  entities: Record<string, boolean>;
}

/**
 * Decompose content into structural chunks.
 *
 * Uses speaker-turn boundaries for conversation content,
 * heading boundaries for markdown. Returns the whole content as a
 * single chunk when no structural boundary is detected.
 *
 * precondition:  content is non-empty.
 * postcondition: every chunk.content is a non-empty string; ∑len(chunks) ≈ len(content).
 * source: core/memory_decomposer.py (decompose_memory)
 */
function decomposeContent(
  content: string,
  turnsPerChunk: number,
): Chunk[] {
  // Detect if content is a conversation transcript.
  if (SPEAKER_TURN_RE.test(content)) {
    return decomposeConversation(content, turnsPerChunk);
  }
  // Detect markdown headings.
  if (/^#{1,6}\s+\S/m.test(content)) {
    return decomposeMarkdown(content);
  }
  // No structural signal: treat as single chunk.
  return [{ content, entities: {} }];
}

function decomposeConversation(content: string, turnsPerChunk: number): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let turnCount = 0;

  for (const line of lines) {
    if (SPEAKER_TURN_RE.test(line)) {
      turnCount++;
      if (turnCount > turnsPerChunk && buffer.length > 0) {
        chunks.push({ content: buffer.join("\n").trim(), entities: {} });
        buffer = [];
        turnCount = 1;
      }
    }
    buffer.push(line);
  }

  if (buffer.length > 0) {
    const remaining = buffer.join("\n").trim();
    if (remaining) chunks.push({ content: remaining, entities: {} });
  }

  return chunks.length > 0 ? chunks : [{ content, entities: {} }];
}

function decomposeMarkdown(content: string): Chunk[] {
  const sections = content.split(/(?=^#{1,6}\s+\S)/m).filter(Boolean);
  const chunks = sections
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => ({ content: s, entities: {} }));
  return chunks.length > 0 ? chunks : [{ content, entities: {} }];
}

// ── Entity detection heuristics ─────────────────────────────────────────────
// Lightweight client-side heuristics. The full entity-extraction pipeline
// (knowledge_graph.extract_entities) is invoked via store post-insert
// in the remember handler.

function detectEntityFlags(content: string): Record<string, boolean> {
  const lower = content.toLowerCase();
  return {
    has_preference:
      /\b(prefer|recommend|suggest|better to|should use)\b/.test(lower),
    has_instruction:
      /\b(always|never|make sure|ensure|remember to|don't forget)\b/.test(lower),
    has_decision: /\b(decided|decision|chose|choosing|going with|selected)\b/.test(
      lower,
    ),
    has_activity:
      /\b(working on|implementing|refactoring|debugging|reviewing)\b/.test(lower),
  };
}

// ── Embedding stub ──────────────────────────────────────────────────────────
// port-pending: sentence-transformers is not yet ported.
// The EmbeddingEngine interface is defined here; callers inject a real or stub impl.

export interface EmbeddingEngine {
  encode(text: string): Buffer | null;
  similarity(a: Buffer, b: Buffer): number;
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
 * source: core/memory_ingest.py:ingest_memory
 */
export function ingestMemory(
  memory: IngestMemoryInput,
  store: MemoryStore,
  embeddings: EmbeddingEngine | null,
  options: IngestOptions = {},
): number[] {
  const {
    domain = "",
    decompose = true,
    turnsPerChunk = 6,
    isBenchmark = false,
  } = options;

  const rawContent = memory.content ?? "";
  if (!rawContent.trim()) return [];

  const chunks: Chunk[] = decompose
    ? decomposeContent(rawContent, turnsPerChunk)
    : [{ content: rawContent, entities: {} }];

  const ids: number[] = [];

  for (const chunk of chunks) {
    const chunkContent = chunk.content;
    // Detect entity flags for this chunk.
    const entities = detectEntityFlags(chunkContent);

    // Build embedding text: entity-summary prefix improves targeting.
    const entitySummary = buildEntitySummary(entities);
    const embedText = entitySummary
      ? `${entitySummary}\n${chunkContent}`
      : chunkContent;
    const emb =
      embeddings !== null ? embeddings.encode(embedText.slice(0, 2000)) : null;

    // Build tag list, extending with entity-derived tags.
    const tags = [...(memory.tags ?? [])];
    if (entities["has_preference"]) tags.push("preference");
    if (entities["has_instruction"]) tags.push("instruction");
    if (entities["has_decision"]) tags.push("decision");
    if (entities["has_activity"]) tags.push("activity");

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
    const isDecision = Boolean(entities["has_decision"]);
    const autoProtect = isDecision && !isBenchmark;
    // source: Adcock et al. 2006: reward-motivated → ~1.5x recall boost
    const importanceBoost = isDecision ? 1.5 : 1.0;

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
      importance: Math.min((memory.importance ?? 0.5) * importanceBoost, 1.0),
      store_type: memory.store_type ?? "episodic",
      is_protected: autoProtect,
      agent_context: agentCtx,
      is_global: isGlobal,
      is_benchmark: isBenchmark,
    });
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
 * source: core/memory_ingest.py:ingest_memories_batch
 */
export function ingestMemoriesBatch(
  memories: IngestMemoryInput[],
  store: MemoryStore,
  embeddings: EmbeddingEngine | null,
  options: IngestOptions = {},
): { ids: number[]; sourceMap: Map<number, string> } {
  const allIds: number[] = [];
  const sourceMap = new Map<number, string>();

  for (const mem of memories) {
    const source = mem.source ?? "";
    const inserted = ingestMemory(mem, store, embeddings, options);
    for (const mid of inserted) {
      sourceMap.set(mid, source);
    }
    allIds.push(...inserted);
  }

  return { ids: allIds, sourceMap };
}

// ── Entity summary helper ───────────────────────────────────────────────────

/**
 * Build a short prefix summarising detected entity categories.
 *
 * postcondition: returns "" iff no flags are true.
 * source: core/memory_decomposer.py:build_entity_summary
 */
export function buildEntitySummary(
  entities: Record<string, boolean>,
): string {
  const parts: string[] = [];
  if (entities["has_decision"]) parts.push("decision");
  if (entities["has_instruction"]) parts.push("instruction");
  if (entities["has_preference"]) parts.push("preference");
  if (entities["has_activity"]) parts.push("activity");
  return parts.length > 0 ? `[${parts.join(", ")}]` : "";
}
