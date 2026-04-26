/**
 * Pruning stage: microglial pruning of weak entity relationships.
 *
 * Port of: mcp_server/handlers/consolidation/pruning.py
 *
 * // source: Serrano MA, Boguna M, Vespignani A (2009) disparity filter.
 *   PNAS 106(16):6483-6488.
 */

import {
  identifyPrunableEdges,
  identifyOrphanedEntities,
  computePruningStats,
} from "../microglial-pruning.js";

export interface PruningStore {
  getAllEdges(): Promise<Record<string, unknown>[]>;
  getAllEntities(opts: { minHeat: number }): Promise<Record<string, unknown>[]>;
  getEntityMemoryIds(): Promise<Set<number>>;
  deleteEdges(edgeIds: readonly number[]): Promise<void>;
  archiveEntities(entityIds: readonly number[]): Promise<void>;
}

export interface PruningStageResult {
  edges_pruned: number;
  entities_archived: number;
  duration_ms?: number;
}

/** Run microglial pruning of orphan edges and cold entities. */
export async function runPruningCycle(store: PruningStore): Promise<PruningStageResult> {
  const edges = await store.getAllEdges();
  const entities = await store.getAllEntities({ minHeat: 0.0 });
  const memoryEntityIds = await store.getEntityMemoryIds();

  const entityHeat = new Map<number, number>(
    entities.map((e) => [e["id"] as number, (e["heat"] as number | undefined) ?? 0]),
  );
  const entityProtected = new Map<number, boolean>(
    entities.map((e) => [e["id"] as number, Boolean(e["is_protected"])]),
  );
  const edgeEntityIds = new Set<number>(
    edges.flatMap((e) => [
      e["source_entity_id"] as number,
      e["target_entity_id"] as number,
    ]),
  );

  const prunableEdges = identifyPrunableEdges(edges, entityHeat, entityProtected);
  const orphanedEntities = identifyOrphanedEntities(entities, edgeEntityIds, memoryEntityIds);

  const edgeIds = prunableEdges.map((e) => e["id"] as number).filter((id) => id != null);
  const entityIds = orphanedEntities.map((e) => e["id"] as number).filter((id) => id != null);

  await store.deleteEdges(edgeIds);
  await store.archiveEntities(entityIds);

  return {
    edges_pruned: edgeIds.length,
    entities_archived: entityIds.length,
  };
}
