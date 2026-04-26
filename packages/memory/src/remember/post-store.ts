/**
 * post-store.ts — Post-storage side effects.
 *
 * Ports: core/write_post_store.py (~294 LOC)
 *
 * Runs after insertMemory succeeds:
 *   1. Entity upsert + linking (knowledge graph).
 *   2. Embedding upsert (port-pending: requires EmbeddingEngine).
 *   3. Schema matching update (port-pending: requires schema_engine).
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

import type { MemoryStore } from "./storage/memory-store.js";

export interface PostStoreOptions {
  memoryId: number;
  content: string;
  domain: string;
  entityNames: string[];
  schemaMatchScore?: number;
  schemaId?: string | null;
}

export interface PostStoreResult {
  entitiesLinked: number;
  embeddingUpserted: boolean; // port-pending
  schemaMatched: boolean; // port-pending
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
 * Run all post-store side effects for a freshly inserted memory.
 *
 * precondition:  memoryId is a valid id returned by store.insertMemory.
 * postcondition: returns a PostStoreResult; never throws (invariant above).
 *
 * source: core/write_post_store.py:run_post_store
 */
export function postStore(
  opts: PostStoreOptions,
  store: MemoryStore,
): PostStoreResult {
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

  // port-pending: embedding upsert (requires sentence-transformers port)
  // When ported: call embeddingEngine.encode(content) and store.upsertEmbedding(memoryId, vec)
  const embeddingUpserted = false;

  // port-pending: schema matching (requires schema_engine port)
  // When ported: call schema_engine.find_best_matching_schema(entityNames, tags, schemas)
  const schemaMatched = false;

  return {
    entitiesLinked,
    embeddingUpserted,
    schemaMatched,
    errors,
  };
}
