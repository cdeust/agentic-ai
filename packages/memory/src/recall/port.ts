/**
 * RecallPort — the interface that the recall handler depends on.
 *
 * This is the dependency-inversion boundary between the recall subsystem
 * (pure logic) and the persistence layer (pgvector, SQLite, etc.).
 *
 * The actual implementation lives in port/cortex-remember's scope.
 * This file defines the contract so that:
 *   1. recall-handler.ts can compile against it without a DB.
 *   2. Tests can substitute an in-memory mock.
 *   3. The real adapter wires in at the composition root.
 *
 * Port of: mcp_server/infrastructure/memory_store.py (public read methods only)
 *          mcp_server/infrastructure/pg_store.py (method signatures)
 */

import type { MemoryItem } from "./types.js";

// ── Memory search result ───────────────────────────────────────────────────

export interface VectorSearchResult {
  memory_id: number;
  distance: number;
}

export interface FtsSearchResult {
  memory_id: number;
  score: number;
}

// ── MemoryStore port ───────────────────────────────────────────────────────

/**
 * Read-only interface for memory retrieval operations.
 *
 * All methods are async to accommodate both PG and SQLite backends.
 * The recall handler only calls methods on this interface — it is
 * structurally dependent on the port, not on any concrete adapter.
 */
export interface MemoryStore {
  /**
   * Vector (ANN) search over stored embeddings.
   * Returns (memory_id, distance) pairs ordered by ascending distance.
   * Port of: PgStore.search_vectors / SQLiteStore.vec_search
   */
  searchByVector(
    embedding: number[],
    topK: number,
    minHeat: number,
  ): Promise<VectorSearchResult[]>;

  /**
   * Full-text search (BM25/FTS5) over memory content.
   * Returns (memory_id, score) pairs ordered by descending score.
   * Port of: PgStore.search_fts / SQLiteStore.fts_search
   */
  searchByFts(
    query: string,
    limit: number,
  ): Promise<FtsSearchResult[]>;

  /**
   * Fetch a single memory by integer ID. Returns null if not found.
   */
  getMemory(id: number): Promise<MemoryItem | null>;

  /**
   * Fetch multiple memories by IDs in a single round-trip.
   */
  getByIds(ids: number[]): Promise<MemoryItem[]>;

  /**
   * Fetch memories for a domain ordered by descending heat.
   */
  getMemoriesForDomain(
    domain: string,
    minHeat: number,
    limit: number,
  ): Promise<MemoryItem[]>;

  /**
   * Fetch memories scoped to a directory path.
   */
  getMemoriesForDirectory(
    directory: string,
    minHeat: number,
  ): Promise<MemoryItem[]>;

  /**
   * Fetch hot memories (highest heat) across all domains.
   */
  getHotMemories(minHeat: number, limit: number): Promise<MemoryItem[]>;

  /**
   * Get all active neuro-symbolic rules.
   * Returns empty array if rules subsystem is unavailable.
   */
  getAllActiveRules(): Promise<unknown[]>;

  /**
   * Get active prospective-memory triggers.
   */
  getActiveProspectiveMemories(): Promise<unknown[]>;

  /**
   * Increment access_count for a recalled memory.
   */
  updateMemoryAccess(memoryId: number): Promise<void>;

  /**
   * Increment replay_count for a recalled memory (hippocampal replay signal).
   * Biological basis: retrieval = hippocampal replay (McClelland 1995)
   */
  incrementReplayCount(memoryId: number): Promise<void>;

  /**
   * Reinforce or create a Hebbian entity-pair relationship.
   * Used for co-activation strengthening.
   */
  reinforceOrCreateRelationship(
    entityA: string,
    entityB: string,
    learningRate: number,
  ): Promise<void>;

  /**
   * Fetch all entities, optionally filtered by domain.
   * Used by spreading-activation to build the entity graph.
   * Returns empty array if the entities subsystem is unavailable.
   */
  getEntities?(domain?: string): Promise<Array<{
    id: number;
    name: string;
    heat?: number;
    entity_type?: string;
  }>>;

  /**
   * Fetch all entity relationships, optionally filtered by domain.
   * Used by spreading-activation to build the adjacency graph.
   * Returns empty array if unavailable.
   */
  getRelationships?(domain?: string): Promise<Array<{
    source_entity_id: number;
    target_entity_id: number;
    weight?: number;
    confidence?: number;
  }>>;

  /**
   * Look up an entity by name (case-insensitive).
   * Returns null if not found. Used by Wave-2 NL token resolution.
   * source: cortex@bc0ae4f mcp_server/core/recall_pipeline.py:336-368
   */
  getEntityByName?(name: string): Promise<{ id: number; name: string } | null>;
}

// ── EmbeddingEngine port ───────────────────────────────────────────────────

/**
 * Minimal embedding interface needed by the recall handler.
 *
 * This is the STUB port for the recall subsystem. It uses `.encode()` to
 * return number[] | null so the handler can operate without the full
 * @agentic/core EmbeddingEngine (which uses Float32Array and `.embed()`).
 *
 * When Group A (Phase 7) lands and wires the real embedding adapter, the
 * composition root should provide an adapter that translates:
 *   - coreEngine.embed(text) → float[] | null
 *   - coreEngine.dim → dimensions
 *
 * The stub interface is intentionally different from @agentic/core's
 * EmbeddingEngine to avoid a hard dependency on Group A before it is ready.
 *
 * TODO(Group A): flip this import to re-export from @agentic/core once the
 * composition root ships an adapter from Float32Array to number[].
 *
 * source: packages/core/src/ports/embedding.ts (canonical core port)
 * source: docs/PHASE_7_TRACKING.md §Group A (embedding engine port)
 * source: docs/PHASE_7_TRACKING.md §Group B (this stub — recall sub-algorithms)
 */
export interface EmbeddingEngine {
  /** Encode a single text into a float vector. Returns null if unavailable. */
  encode(text: string): Promise<number[] | null>;
  /** Cosine similarity between two vectors. */
  similarity(a: number[], b: number[]): number;
  /** Embedding dimensionality. */
  readonly dimensions: number;
}
