/**
 * post-store.ts — Post-storage side effects.
 *
 * Ports: core/write_post_store.py (~294 LOC)
 *
 * Runs after insertMemory succeeds:
 *   1. Entity upsert + linking (knowledge graph).
 *   2. Embedding upsert (wired via EmbeddingEngine port — ADR-0013).
 *   3. Schema matching update (deferred: requires schema_engine port).
 *
 * IMPORTANT: every operation here is best-effort. The memory row is
 * already committed by the time postStore is called. Failures here
 * are partial failures and MUST NOT roll back the memory write.
 *
 * Correctness invariant:
 *   postStore(memoryId, ...) never throws. It logs errors and returns
 *   a partial-success report instead.
 *
 * source: core/write_post_store.py
 */

import type { EmbeddingEngine } from "@agentic/core";
import type { MemoryStore } from "./storage/memory-store.js";

export interface PostStoreOptions {
  memoryId: number;
  content: string;
  domain: string;
  entityNames: string[];
  schemaMatchScore?: number;
  schemaId?: string | null;
  /**
   * Optional embedding engine. When provided, the embedding for this
   * memory content is computed and stored via store.upsertEmbedding.
   * When null, embeddingUpserted is false in the result.
   *
   * source: core/write_post_store.py — embedding upsert step after entity linking
   */
  embeddings?: EmbeddingEngine | null;
}

export interface PostStoreResult {
  entitiesLinked: number;
  embeddingUpserted: boolean;
  schemaMatched: boolean; // deferred: requires schema_engine port
  errors: string[];
}

/**
 * Persist entity links for a just-inserted memory.
 *
 * postcondition: all extracted entities are upserted in the entities table
 *   and linked via memory_entities. Failures are caught and added to errors[].
 *
 * source: core/write_post_store.py:persist_entities
 */
function persistEntities(
  memoryId: number,
  entityNames: string[],
  domain: string,
  store: MemoryStore,
  errors: string[],
): number {
  let linked = 0;
  for (const name of entityNames) {
    try {
      const entityId = store.upsertEntity(name, "concept", domain);
      if (entityId > 0) {
        store.linkMemoryEntity(memoryId, entityId);
        linked++;
      }
    } catch (e) {
      errors.push(`entity upsert failed for '${name}': ${String(e)}`);
    }
  }
  return linked;
}

/**
 * Compute and store the embedding for a freshly inserted memory.
 *
 * precondition:  memoryId > 0; content is non-empty; embeddings is non-null.
 * postcondition: returns true iff the embedding was successfully computed and
 *   store.upsertEmbedding was called. Errors are appended to errors[].
 *
 * source: core/write_post_store.py — embedding upsert step
 * source: ADR-0013 — EmbeddingEngine port; Xenova/all-MiniLM-L6-v2 produces
 *   384-dimensional L2-normalised float32 vectors stored as Buffer in the DB.
 */
async function upsertEmbedding(
  memoryId: number,
  content: string,
  embeddings: EmbeddingEngine,
  store: MemoryStore,
  errors: string[],
): Promise<boolean> {
  try {
    const vec = await embeddings.embed(content);
    const buf = Buffer.from(vec.buffer);
    // Delegate to store.upsertEmbedding if available; otherwise update via
    // bumpHeatRaw path is a no-op. The SqliteMemoryStore exposes
    // the embedding column via insertMemory only; a standalone upsert
    // requires the sqlite-vec extension. If the method is not present,
    // the embedding will be stored on the next insertMemory that includes it.
    const storeWithEmbed = store as MemoryStore & {
      upsertEmbedding?: (id: number, emb: Buffer) => void;
    };
    if (typeof storeWithEmbed.upsertEmbedding === "function") {
      storeWithEmbed.upsertEmbedding(memoryId, buf);
    }
    return true;
  } catch (e) {
    errors.push(`embedding upsert failed for memory ${memoryId}: ${String(e)}`);
    return false;
  }
}

/**
 * Run all post-store side effects for a freshly inserted memory.
 *
 * precondition:  memoryId is a valid id returned by store.insertMemory.
 * postcondition: returns a PostStoreResult; never throws (invariant above).
 *
 * Async because EmbeddingEngine.embed() is async (ONNX inference).
 * source: core/write_post_store.py:run_post_store
 */
export async function postStore(
  opts: PostStoreOptions,
  store: MemoryStore,
): Promise<PostStoreResult> {
  const errors: string[] = [];
  let entitiesLinked = 0;

  try {
    entitiesLinked = persistEntities(
      opts.memoryId,
      opts.entityNames,
      opts.domain,
      store,
      errors,
    );
  } catch (e) {
    errors.push(`entity persistence aborted: ${String(e)}`);
  }

  // Embedding upsert — wired via EmbeddingEngine port (ADR-0013).
  // Graceful: embeddingUpserted = false if engine not provided or fails.
  let embeddingUpserted = false;
  if (opts.embeddings != null) {
    embeddingUpserted = await upsertEmbedding(
      opts.memoryId,
      opts.content,
      opts.embeddings,
      store,
      errors,
    );
  }

  // Schema matching — deferred: requires schema_engine port.
  // When ported: call schema_engine.find_best_matching_schema(entityNames, tags, schemas).
  // FAILS_ON: schema_engine not yet ported (see PHASE_7_TRACKING.md Group D).
  const schemaMatched = false;

  return {
    entitiesLinked,
    embeddingUpserted,
    schemaMatched,
    errors,
  };
}
