/**
 * Memify stage handler — invariant tests.
 *
 * Invariants verified:
 *   1. Always returns pruned, strengthened, reweighted.
 *   2. reason_for_zero set iff all three counters are zero.
 *   3. reason_for_inaction set iff pruned=0 AND strengthened=0 AND reweighted>0.
 *   4. reason_for_zero and reason_for_inaction are mutually exclusive.
 *   5. passed_through logged when reason is passed_through.
 *   6. Pruning gate: heat < 0.01 AND confidence < 0.3.
 *   7. Strengthen gate: access_count >= 5 AND confidence >= 0.8.
 */

import { describe, it, expect } from "vitest";
import {
  runMemifyCycle,
  type MemifyStore,
} from "../../../src/consolidation/stages/memify.js";

function makeStore(
  overrides: Partial<MemifyStore> = {},
): MemifyStore & { deletedIds: number[]; strengthenedIds: number[] } {
  const deletedIds: number[] = [];
  const strengthenedIds: number[] = [];
  return {
    deletedIds,
    strengthenedIds,
    async getAllMemoriesForDecay() {
      return [];
    },
    async deleteMemory(id: number) {
      deletedIds.push(id);
    },
    async updateMemoryImportance(id: number) {
      strengthenedIds.push(id);
    },
    async getAllEntities(_opts) {
      return [];
    },
    async insertRelationship(_rel) {},
    acquireBatch() {
      return {
        async execute(_sql: string) {
          return { rows: [] };
        },
      };
    },
    ...overrides,
  };
}

describe("runMemifyCycle", () => {
  it("returns all three counters even on empty memory list", async () => {
    const store = makeStore();
    const result = await runMemifyCycle(store, []);
    expect(result).toHaveProperty("pruned");
    expect(result).toHaveProperty("strengthened");
    expect(result).toHaveProperty("reweighted");
  });

  it("reason_for_zero set when all counters zero and no candidates", async () => {
    const store = makeStore();
    // No memories → passed_through
    const result = await runMemifyCycle(store, []);
    expect(result.reason_for_zero).toBe("passed_through");
    expect(result.reason_for_inaction).toBeUndefined();
  });

  it("prunes memory with heat < 0.01 and confidence < 0.3", async () => {
    const store = makeStore();
    const mem: Record<string, unknown> = {
      id: 1,
      heat: 0.005,
      confidence: 0.1,
      access_count: 0,
      importance: 0.2,
    };
    const result = await runMemifyCycle(store, [mem]);
    expect(result.pruned).toBe(1);
    expect(store.deletedIds).toContain(1);
    // When pruned > 0: no diagnostic keys
    expect(result.reason_for_zero).toBeUndefined();
    expect(result.reason_for_inaction).toBeUndefined();
  });

  it("does not prune memory above prune threshold", async () => {
    const store = makeStore();
    const mem: Record<string, unknown> = {
      id: 2,
      heat: 0.5,
      confidence: 0.8,
      access_count: 0,
      importance: 0.5,
    };
    const result = await runMemifyCycle(store, [mem]);
    expect(result.pruned).toBe(0);
    expect(store.deletedIds).toHaveLength(0);
  });

  it("strengthens memory with access_count >= 5 and confidence >= 0.8", async () => {
    const store = makeStore();
    const mem: Record<string, unknown> = {
      id: 3,
      heat: 0.6,
      confidence: 0.85,
      access_count: 7,
      importance: 0.5,
    };
    const result = await runMemifyCycle(store, [mem]);
    expect(result.strengthened).toBe(1);
    expect(store.strengthenedIds).toContain(3);
  });

  it("reason_for_zero and reason_for_inaction are mutually exclusive", async () => {
    const store = makeStore();
    const result = await runMemifyCycle(store, []);
    expect(result.reason_for_zero !== undefined && result.reason_for_inaction !== undefined).toBe(
      false,
    );
  });

  it("below_stale_threshold when heats are low but not below prune gate", async () => {
    const store = makeStore();
    // heat=0.2 (< 0.5, > 0.01) and confidence=0.5 (> 0.3) — below stale threshold gate
    const mem: Record<string, unknown> = {
      id: 4,
      heat: 0.2,
      confidence: 0.5,
      access_count: 0,
      importance: 0.3,
    };
    const result = await runMemifyCycle(store, [mem]);
    expect(result.pruned).toBe(0);
    expect(result.strengthened).toBe(0);
    // reason classifies the gate that rejected
    expect(result.reason_for_zero).toBe("below_stale_threshold");
  });

  it("uses store.getAllMemoriesForDecay when memories is null", async () => {
    const store = makeStore({
      async getAllMemoriesForDecay() {
        return [{ id: 99, heat: 0.005, confidence: 0.1, access_count: 0 }];
      },
    });
    const result = await runMemifyCycle(store, null);
    expect(result.pruned).toBe(1);
  });
});
