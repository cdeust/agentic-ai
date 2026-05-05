/**
 * Deep sleep cycle: dream replay, cluster summarization, re-embedding, narration.
 *
 * Simulates offline consolidation by enriching hot memories, fixing stale
 * embeddings, and generating auto-narration as semantic memory.
 *
 * Port of: mcp_server/handlers/consolidation/sleep.py
 */

import { runSleepCompute } from "../sleep-compute.js";

// ── Store / Engine interfaces ─────────────────────────────────────────────────

export interface SleepStore {
  getAllMemoriesForDecay(): Promise<Record<string, unknown>[]>;
  updateMemoryCompression(
    id: number,
    content: string,
    embedding: number[],
    compressionLevel: number,
  ): Promise<void>;
  acquireBatch(): {
    execute(sql: string, params: unknown[]): Promise<void>;
  };
  insertMemory(mem: Record<string, unknown>): Promise<number>;
}

export interface SleepEmbeddingEngine {
  encode(text: string): Promise<number[]>;
}

export interface SleepStageResult {
  replayed: number;
  reembedded: number;
  cluster_summaries: number;
  narration_stored: boolean;
  narration_preview: string;
  duration_ms?: number;
}

// ── Dream replay ──────────────────────────────────────────────────────────────

/**
 * Update enriched content for replayed memories.
 *
 * Precondition: replayUpdates contains valid { memory_id, enriched_content } entries.
 * Postcondition: returns count of successfully updated memories;
 *   individual failures are logged and swallowed (non-fatal).
 */
async function applyDreamReplay(
  store: SleepStore,
  embeddings: SleepEmbeddingEngine,
  replayUpdates: readonly { memory_id: unknown; enriched_content: string }[],
): Promise<number> {
  let count = 0;
  for (const upd of replayUpdates) {
    try {
      const newContent = upd.enriched_content;
      const newEmb = await embeddings.encode(newContent);
      await store.updateMemoryCompression(upd.memory_id as number, newContent, newEmb, 0);
      count++;
    } catch {
      // non-fatal: individual replay failure must not block the cycle
    }
  }
  return count;
}

// ── Stale embedding repair ────────────────────────────────────────────────────

/**
 * Re-embed memories with stale or missing embeddings.
 *
 * Phase 5: batched UPDATEs run on the batch pool.
 *
 * Precondition: staleItems contains { memory_id, content } entries.
 * Postcondition: returns count of successfully re-embedded memories;
 *   individual failures are logged and swallowed (non-fatal).
 */
async function fixStaleEmbeddings(
  store: SleepStore,
  embeddings: SleepEmbeddingEngine,
  staleItems: readonly { memory_id: unknown; content: string }[],
): Promise<number> {
  let count = 0;
  const conn = store.acquireBatch();
  for (const item of staleItems) {
    try {
      const content = item.content;
      if (!content) continue;
      const newEmb = await embeddings.encode(content);
      if (newEmb && newEmb.length > 0) {
        await conn.execute("UPDATE memories SET embedding = $1 WHERE id = $2", [
          newEmb,
          item.memory_id,
        ]);
        count++;
      }
    } catch {
      // non-fatal
    }
  }
  return count;
}

// ── Narration storage ─────────────────────────────────────────────────────────

/**
 * Store auto-narration as a semantic memory if meaningful.
 *
 * Gates on narrative_text being non-empty and memory_count >= 5.
 *
 * Precondition: store.insertMemory and embeddings.encode are available.
 * Postcondition: returns true iff narration was stored; false on empty or error.
 */
async function storeNarration(
  store: SleepStore,
  embeddings: SleepEmbeddingEngine,
  narration: { narrative_text?: string; memory_count?: number; [key: string]: unknown },
): Promise<boolean> {
  const narrativeText = narration.narrative_text ?? "";
  if (!narrativeText || (narration.memory_count ?? 0) < 5) return false;

  try {
    const emb = await embeddings.encode(narrativeText);
    await store.insertMemory({
      content: narrativeText,
      embedding: emb,
      tags: ["auto-narration", "sleep-compute"],
      domain: "",
      directory: "",
      source: "sleep-compute",
      importance: 0.6,
      surprise: 0.0,
      emotional_valence: 0.0,
      confidence: 0.7,
      heat: 0.5,
      store_type: "semantic",
    });
    return true;
  } catch {
    // non-fatal: narration storage failure must not block the cycle
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run deep sleep compute: dream replay, summarization, re-embedding, narration.
 *
 * `memories` may be pre-loaded by the consolidate handler (issue #13).
 * When null, loads all memories for decay from the store.
 *
 * Precondition: store is a valid SleepStore; embeddings provides encode().
 * Postcondition: returned object contains replayed, reembedded, cluster_summaries,
 *   narration_stored, narration_preview. All counts are non-negative.
 */
export async function runDeepSleep(
  store: SleepStore,
  embeddings: SleepEmbeddingEngine,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<SleepStageResult> {
  const mems =
    memories !== null
      ? (memories as Record<string, unknown>[])
      : await store.getAllMemoriesForDecay();

  const plan = runSleepCompute(mems, [], "");

  const replayed = await applyDreamReplay(store, embeddings, plan.replay_updates);
  const reembedded = await fixStaleEmbeddings(store, embeddings, plan.stale_embeddings);
  const narrationStored = await storeNarration(store, embeddings, plan.narration);

  const narrativeText = plan.narration.narrative_text ?? "";
  return {
    replayed,
    reembedded,
    cluster_summaries: plan.cluster_summaries.length,
    narration_stored: narrationStored,
    narration_preview: narrativeText.slice(0, 100),
  };
}
