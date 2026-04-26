/**
 * memory-store.ts — Abstract MemoryStore interface.
 *
 * Ports: infrastructure/memory_store.py (~100 LOC)
 *
 * This interface is the contract every storage adapter must satisfy.
 * All methods are synchronous to match better-sqlite3's synchronous API.
 * PostgreSQL adapters wrap async operations in a sync thread pool
 * (see pg-store.ts).
 *
 * ADR-0003 applies: adapter preconditions must NOT be stronger than
 * this interface's preconditions. Every concrete adapter must accept
 * the same range of inputs.
 *
 * Atomicity guarantees (required by task spec):
 *   - insertMemory: MUST be atomic. A partial insert (row written but
 *     FTS/vec tables not updated) must be rolled back.
 *   - deleteMemory: MUST be atomic. FTS and vec rows deleted in the
 *     same transaction as the main row.
 *   - bumpHeatRaw: read-your-writes — a subsequent getMemory call on
 *     the same connection sees the updated heat.
 *   - No duplicate inserts on retry: callers are responsible for
 *     idempotency; the interface does not deduplicate. (The write gate
 *     is the dedup layer.)
 *
 * Source: infrastructure/memory_store.py, infrastructure/pg_store.py,
 *         infrastructure/sqlite_store.py
 */

import type { MemoryInsertData, MemoryItem } from "../types.js";

// ── Entity and relationship types ───────────────────────────────────────────

export interface EntityRecord {
  id: number;
  name: string;
  type: string;
  domain: string;
  heat: number;
  archived: boolean;
  created_at: string;
  last_accessed: string;
}

export interface RelationshipRecord {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relationship_type: string;
  weight: number;
  is_causal: boolean;
  confidence: number;
  created_at: string;
}

// ── VecSearchResult ─────────────────────────────────────────────────────────

/** A (memory_id, distance) pair from vector similarity search. */
export type VecHit = [number, number];

// ── BatchHeatUpdate ─────────────────────────────────────────────────────────

/** Input type for updateMemoriesHeatBatch. */
export type HeatUpdate = [number, number]; // [memory_id, new_heat_base]

// ── MemoryStore interface ───────────────────────────────────────────────────

/**
 * MemoryStore — storage backend contract.
 *
 * Invariants:
 *   I1. insertMemory is atomic: either the full row (incl. FTS, vec) is
 *       written or nothing is. Returns a positive integer ID.
 *   I2. getMemory(id) returns null iff no row with that id exists.
 *   I3. deleteMemory(id) removes the main row AND associated FTS/vec rows
 *       atomically. Returns true iff a row was actually deleted.
 *   I4. bumpHeatRaw(id, h) writes heat_base ∈ [0,1]; a subsequent
 *       getMemory on the same connection sees the new heat (read-your-writes).
 *   I5. All methods accept the widest reasonable range (ADR-0003): numeric
 *       ids are positive integers; heat values are clamped to [0,1]
 *       internally (not preconditions).
 */
export interface MemoryStore {
  // ── Memory CRUD ────────────────────────────────────────────────────────

  /**
   * Insert a memory and return its integer ID.
   * precondition:  data.content is non-empty.
   * postcondition: returned id > 0; row exists in memories table.
   * Atomicity: row + FTS + vec in one transaction (invariant I1).
   */
  insertMemory(data: MemoryInsertData): number;

  /**
   * Retrieve a memory by id.
   * postcondition: returns null iff id not found (invariant I2).
   */
  getMemory(memoryId: number): MemoryItem | null;

  /**
   * Hard-delete a memory row and all associated index rows.
   * postcondition: returns true iff a row was deleted (invariant I3).
   * Atomicity: main + FTS + vec in one transaction.
   */
  deleteMemory(memoryId: number): boolean;

  /**
   * Canonical A3 heat writer. Writes heat_base AND refreshes heat_base_set_at.
   * precondition:  heat ∈ [0, 1] (clamped internally — not a hard precondition).
   * postcondition: memories.heat_base = clamp(heat, 0, 1) for the given id.
   * source: docs/program/phase-3-a3-migration-design.md §3.1
   */
  bumpHeatRaw(memoryId: number, newHeatBase: number): void;

  /** Thin wrapper: calls bumpHeatRaw. Kept for backward compat. */
  updateMemoryHeat(memoryId: number, heat: number): void;

  /**
   * Batch heat writer. Single commit for up to N rows.
   * postcondition: returns the number of rows updated.
   * source: issue #13; phase-3-a3-migration-design.md §3.2
   */
  updateMemoriesHeatBatch(updates: HeatUpdate[]): number;

  /** Update importance for a single memory row. */
  updateMemoryImportance(memoryId: number, importance: number): void;

  /** Increment access_count and refresh last_accessed. */
  updateMemoryAccess(memoryId: number): void;

  /**
   * Update metamemory fields: access_count, useful_count, confidence.
   * postcondition: all three fields are written in a single UPDATE.
   */
  updateMemoryMetamemory(
    memoryId: number,
    accessCount: number,
    usefulCount: number,
    confidence: number,
  ): void;

  /** Set is_protected flag. */
  setMemoryProtected(memoryId: number, protected_: boolean): void;

  /** Set is_stale flag (soft-delete marker). */
  markMemoryStale(memoryId: number, stale: boolean): void;

  // ── Homeostatic state ──────────────────────────────────────────────────

  /** Fetch per-domain homeostatic scaling factor, defaulting to 1.0. */
  getHomeostaticFactor(domain: string): number;

  /** Upsert per-domain homeostatic factor. Clamped to (0, 10). */
  setHomeostaticFactor(domain: string, factor: number): void;

  // ── Vector / FTS search ────────────────────────────────────────────────

  /**
   * Return top-k nearest memories by embedding cosine distance.
   * precondition:  embedding is a valid float32 buffer; topK > 0.
   * postcondition: returned array length <= topK.
   */
  searchVectors(
    embedding: Buffer,
    topK: number,
    minHeat?: number,
  ): VecHit[];

  // ── Entity graph ───────────────────────────────────────────────────────

  /** Lookup an entity by name. Returns null if not found. */
  getEntityByName(name: string): EntityRecord | null;

  /** Upsert an entity; return its id. */
  upsertEntity(name: string, type: string, domain: string): number;

  /** Link a memory to an entity. Idempotent (ON CONFLICT DO NOTHING). */
  linkMemoryEntity(memoryId: number, entityId: number): void;

  /** Upsert a typed relationship between two entities. */
  upsertRelationship(
    sourceEntityId: number,
    targetEntityId: number,
    relationshipType: string,
    weight?: number,
  ): void;

  // ── Schema matching (for write gate) ──────────────────────────────────

  /** Return all schema records for a domain. */
  getSchemasForDomain(domain: string): Array<Record<string, unknown>>;

  // ── Oscillatory state (for write gate phase gating) ───────────────────

  /** Load oscillatory clock state JSON string. Returns null if none. */
  loadOscillatoryState(): string | null;

  /** Persist oscillatory clock state JSON string. */
  saveOscillatoryState(stateJson: string): void;

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Close the underlying connection / pool. */
  close(): void;
}
