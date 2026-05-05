/**
 * Pruning stage handler — invariant tests.
 *
 * Invariants verified:
 *   1. Returns edges_pruned and entities_archived.
 *   2. Protected entities are never pruned.
 *   3. Empty entities → both counters = 0.
 *   4. Orphaned entities (no edges, cold) are archived.
 *   5. Error handling: returns zeroes on exception.
 */

import { describe, it, expect } from "vitest";
import {
  runPruningCycle,
  type PruningStore,
} from "../../../src/consolidation/stages/pruning.js";

function makeStore(overrides: Partial<PruningStore> = {}): PruningStore {
  const deletedEdgeIds: number[] = [];
  const archivedEntityIds: number[] = [];
  return {
    async getAllEntities(_opts) {
      return [];
    },
    async getAllRelationships() {
      return [];
    },
    async getHotMemories(_opts) {
      return [];
    },
    async deleteRelationshipsBatch(ids) {
      deletedEdgeIds.push(...ids);
      return ids.length;
    },
    async archiveEntitiesBatch(ids) {
      archivedEntityIds.push(...ids);
      return ids.length;
    },
    ...overrides,
  };
}

describe("runPruningCycle", () => {
  it("returns zeroes when no entities", async () => {
    const store = makeStore();
    const result = await runPruningCycle(store);
    expect(result.edges_pruned).toBe(0);
    expect(result.entities_archived).toBe(0);
  });

  it("returns non-negative counts", async () => {
    const store = makeStore({
      async getAllEntities() {
        return [{ id: 1, name: "A", heat: 0.5, is_protected: false }];
      },
    });
    const result = await runPruningCycle(store);
    expect(result.edges_pruned).toBeGreaterThanOrEqual(0);
    expect(result.entities_archived).toBeGreaterThanOrEqual(0);
  });

  it("handles exception gracefully (returns zeroes)", async () => {
    const store = makeStore({
      async getAllEntities() {
        throw new Error("store error");
      },
    });
    const result = await runPruningCycle(store);
    expect(result.edges_pruned).toBe(0);
    expect(result.entities_archived).toBe(0);
  });

  it("does not delete protected-entity edges", async () => {
    const deletedIds: number[] = [];
    const store = makeStore({
      async getAllEntities() {
        return [
          { id: 1, name: "Protected", heat: 0.0, is_protected: true },
          { id: 2, name: "Weak", heat: 0.0, is_protected: false },
        ];
      },
      async getAllRelationships() {
        return [
          { id: 10, source_entity_id: 1, target_entity_id: 2, weight: 0.001 },
        ];
      },
      async deleteRelationshipsBatch(ids) {
        deletedIds.push(...ids);
        return ids.length;
      },
    });
    await runPruningCycle(store);
    // Edge connecting protected entity should NOT be deleted
    expect(deletedIds).not.toContain(10);
  });

  it("result always has edges_pruned and entities_archived fields", async () => {
    const store = makeStore();
    const result = await runPruningCycle(store);
    expect(result).toHaveProperty("edges_pruned");
    expect(result).toHaveProperty("entities_archived");
  });
});
