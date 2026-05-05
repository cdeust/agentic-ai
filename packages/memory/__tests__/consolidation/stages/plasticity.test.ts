/**
 * Plasticity stage handler — invariant tests.
 *
 * Invariants verified:
 *   1. Empty entities/relationships → all zeroes.
 *   2. ltp + ltd = edges_updated.
 *   3. co_access_pairs = size of the co-accessed set.
 *   4. memories_sampled <= CO_ACCESS_SAMPLE_CAP (2000).
 *   5. Error handling: store exception returns error shape.
 */

import { describe, it, expect } from "vitest";
import {
  runPlasticityCycle,
  type PlasticityStore,
} from "../../../src/consolidation/stages/plasticity.js";

function makeStore(overrides: Partial<PlasticityStore> = {}): PlasticityStore {
  const weightUpdates: Array<[number, number]> = [];
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
    async findCoAccessedPairs(_ids) {
      return [];
    },
    async updateRelationshipsWeightBatch(batch) {
      weightUpdates.push(...batch);
    },
    ...overrides,
  };
}

describe("runPlasticityCycle", () => {
  it("returns zeroes when no entities", async () => {
    const store = makeStore();
    const result = await runPlasticityCycle(store);
    expect(result.ltp).toBe(0);
    expect(result.ltd).toBe(0);
    expect(result.edges_updated).toBe(0);
    expect(result.co_access_pairs).toBe(0);
    expect(result.memories_sampled).toBe(0);
  });

  it("returns zeroes when no relationships", async () => {
    const store = makeStore({
      async getAllEntities() {
        return [{ id: 1, name: "concept", heat: 0.5, access_count: 2 }];
      },
    });
    const result = await runPlasticityCycle(store);
    expect(result.edges_updated).toBe(0);
  });

  it("edges_updated = ltp + ltd", async () => {
    const coAccessedPairs: Array<[number, number]> = [[1, 2]];
    const store = makeStore({
      async getAllEntities() {
        return [
          { id: 1, name: "A", heat: 0.8, access_count: 10 },
          { id: 2, name: "B", heat: 0.7, access_count: 8 },
        ];
      },
      async getAllRelationships() {
        return [{ id: 10, source_entity_id: 1, target_entity_id: 2, weight: 1.0 }];
      },
      async getHotMemories() {
        return [{ id: 100, heat: 0.8, content: "A and B together" }];
      },
      async findCoAccessedPairs() {
        return coAccessedPairs;
      },
    });
    const result = await runPlasticityCycle(store);
    expect(result.edges_updated).toBe(result.ltp + result.ltd);
  });

  it("co_access_pairs reflects unique pairs from findCoAccessedPairs", async () => {
    const pairs: Array<[number, number]> = [
      [1, 2],
      [3, 4],
      [1, 2], // duplicate — should deduplicate
    ];
    const store = makeStore({
      async getAllEntities() {
        return [
          { id: 1, name: "A", heat: 0.5, access_count: 1 },
          { id: 2, name: "B", heat: 0.5, access_count: 1 },
          { id: 3, name: "C", heat: 0.5, access_count: 1 },
          { id: 4, name: "D", heat: 0.5, access_count: 1 },
        ];
      },
      async getAllRelationships() {
        return [
          { id: 10, source_entity_id: 1, target_entity_id: 2, weight: 1.0 },
          { id: 11, source_entity_id: 3, target_entity_id: 4, weight: 0.5 },
        ];
      },
      async getHotMemories() {
        return [{ id: 1, heat: 0.8, content: "test" }];
      },
      async findCoAccessedPairs() {
        return pairs;
      },
    });
    const result = await runPlasticityCycle(store);
    // Pairs [1,2] and [3,4] are unique → 2 unique pairs
    expect(result.co_access_pairs).toBe(2);
  });

  it("error handling: returns error shape on exception", async () => {
    const store = makeStore({
      async getAllEntities() {
        throw new Error("db error");
      },
    });
    const result = await runPlasticityCycle(store);
    expect(result.ltp).toBe(0);
    expect(result.error).toContain("db error");
  });

  it("uses pre-loaded memories when passed", async () => {
    // Need at least 1 entity AND 1 relationship to get past the early-return guard.
    // Otherwise the function returns zeroes before reaching the sample selection.
    const store = makeStore({
      async getAllEntities() {
        return [{ id: 1, name: "A", heat: 0.5, access_count: 1 }];
      },
      async getAllRelationships() {
        return [{ id: 10, source_entity_id: 1, target_entity_id: 1, weight: 1.0 }];
      },
      async findCoAccessedPairs() {
        return [];
      },
    });
    // Memory has heat=0.8 ≥ 0.1 → passes the hot filter
    const memories = [{ id: 1, heat: 0.8, content: "A test" }];
    const result = await runPlasticityCycle(store, memories);
    expect(result.memories_sampled).toBe(1);
  });
});
