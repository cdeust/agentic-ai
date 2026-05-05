/**
 * Pruning cycle: microglial complement-dependent edge and entity elimination.
 *
 * Weak edges are removed, and orphaned entities are archived (heat set to 0).
 *
 * Port of: mcp_server/handlers/consolidation/pruning.py
 *
 * // source: Serrano MA, Boguna M, Vespignani A (2009) disparity filter.
 *   PNAS 106(16):6483-6488.
 */

import {
  identifyPrunableEdges,
  identifyOrphanedEntities,
} from "../microglial-pruning.js";

// ── Store interface ───────────────────────────────────────────────────────────

export interface PruningStore {
  getAllEntities(opts: { minHeat: number }): Promise<Record<string, unknown>[]>;
  getAllRelationships(): Promise<Record<string, unknown>[]>;
  getHotMemories(opts: { minHeat: number; limit: number }): Promise<Record<string, unknown>[]>;
  deleteRelationshipsBatch(ids: readonly number[]): Promise<number>;
  archiveEntitiesBatch(ids: readonly number[]): Promise<number>;
}

export interface PruningStageResult {
  edges_pruned: number;
  entities_archived: number;
  duration_ms?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format relationship rows into edge dicts for the pruning core.
 *
 * Precondition: relationships is a list of raw relationship rows.
 * Postcondition: returns edge dicts with source_entity_id, target_entity_id,
 *   weight, hours_since_co_access, id.
 */
function formatEdges(relationships: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return relationships.map((r) => ({
    source_entity_id: r["source_entity_id"],
    target_entity_id: r["target_entity_id"],
    weight: (r["weight"] as number | undefined) ?? 1.0,
    hours_since_co_access: 48, // source: pruning.py — default dwell for pruning gate
    id: r["id"],
  }));
}

/**
 * Delete prunable edges in a single batched DELETE.
 *
 * Source: issue #13 — was per-row DELETE inside a loop.
 *
 * Precondition: store.deleteRelationshipsBatch is available.
 * Postcondition: returns count of deleted edges.
 */
async function pruneEdges(
  store: PruningStore,
  prunable: readonly Record<string, unknown>[],
): Promise<number> {
  const ids = prunable
    .map((e) => e["id"] as number | undefined)
    .filter((id): id is number => id != null)
    .map((id) => Number(id));
  return store.deleteRelationshipsBatch(ids);
}

/**
 * Collect entity IDs still connected by non-pruned edges.
 *
 * Precondition: relationships is the full pre-pruning list; prunedIds is the set
 *   of pruned edge ids.
 * Postcondition: returns entity IDs that remain connected after pruning.
 */
function collectActiveEdgeEntities(
  relationships: readonly Record<string, unknown>[],
  prunedIds: ReadonlySet<number>,
): Set<number> {
  const active = new Set<number>();
  for (const r of relationships) {
    const rid = r["id"] as number | undefined;
    if (rid != null && prunedIds.has(rid)) continue;
    const src = r["source_entity_id"] as number | undefined;
    const tgt = r["target_entity_id"] as number | undefined;
    if (src != null) active.add(src);
    if (tgt != null) active.add(tgt);
  }
  return active;
}

/**
 * Collect entity IDs mentioned in hot memories.
 *
 * Precondition: store.getHotMemories is available.
 * Postcondition: returns set of entity IDs found by name in hot memory content.
 */
async function collectMemoryEntityIds(
  store: PruningStore,
  entities: readonly Record<string, unknown>[],
): Promise<Set<number>> {
  const memoryEntityIds = new Set<number>();
  const hotMems = await store.getHotMemories({ minHeat: 0.01, limit: 200 });
  for (const ent of entities) {
    const name = (ent["name"] as string | undefined) ?? "";
    if (!name) continue;
    const nameLow = name.toLowerCase();
    const found = hotMems.some((m) =>
      ((m["content"] as string | undefined) ?? "").toLowerCase().includes(nameLow),
    );
    if (found) {
      memoryEntityIds.add(ent["id"] as number);
    }
  }
  return memoryEntityIds;
}

/**
 * Find and archive orphaned entities after pruning.
 *
 * Precondition: prunable contains the edges that will be deleted; relationships
 *   is the pre-pruning full list; entities is the full entity list.
 * Postcondition: returns count of archived entities.
 */
async function archiveOrphans(
  store: PruningStore,
  entities: readonly Record<string, unknown>[],
  relationships: readonly Record<string, unknown>[],
  prunable: readonly Record<string, unknown>[],
): Promise<number> {
  const prunedIds = new Set<number>(
    prunable.map((e) => e["id"] as number).filter((id) => id != null),
  );
  const activeEdgeEntities = collectActiveEdgeEntities(relationships, prunedIds);
  const memoryEntityIds = await collectMemoryEntityIds(store, entities);

  const orphans = identifyOrphanedEntities(
    entities,
    activeEdgeEntities,
    memoryEntityIds,
  );

  const ids = orphans
    .map((o) => o["id"] as number | undefined)
    .filter((id): id is number => id != null)
    .map((id) => Number(id));
  return store.archiveEntitiesBatch(ids);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run microglial pruning: eliminate weak edges and orphaned entities.
 *
 * Precondition: store is a valid PruningStore.
 * Postcondition: returned object contains edges_pruned and entities_archived.
 *   Both are non-negative. Errors are swallowed (non-fatal, returns zeroes).
 */
export async function runPruningCycle(store: PruningStore): Promise<PruningStageResult> {
  try {
    const entities = await store.getAllEntities({ minHeat: 0.0 });
    const relationships = await store.getAllRelationships();

    if (!entities.length) {
      return { edges_pruned: 0, entities_archived: 0 };
    }

    const edgeDicts = formatEdges(relationships);
    const entityHeat = new Map<number, number>(
      entities.map((e) => [e["id"] as number, (e["heat"] as number | undefined) ?? 0]),
    );
    const entityProtected = new Map<number, boolean>(
      entities.map((e) => [e["id"] as number, Boolean(e["is_protected"])]),
    );

    const prunable = identifyPrunableEdges(edgeDicts, entityHeat, entityProtected);
    const edgesPruned = await pruneEdges(store, prunable);
    const entitiesArchived = await archiveOrphans(store, entities, relationships, prunable);

    return { edges_pruned: edgesPruned, entities_archived: entitiesArchived };
  } catch {
    return { edges_pruned: 0, entities_archived: 0 };
  }
}
