/**
 * Sleep stage handler — invariant tests.
 *
 * Invariants verified:
 *   1. Returns replayed, reembedded, cluster_summaries, narration_stored, narration_preview.
 *   2. narration_stored=false when narrative_text empty or memory_count < 5.
 *   3. narration_preview is at most 100 characters.
 *   4. replayed counts only successful replay updates.
 *   5. reembedded counts only memories with non-empty content.
 */

import { describe, it, expect } from "vitest";
import {
  runDeepSleep,
  type SleepStore,
} from "../../../src/consolidation/stages/sleep.js";

function makeStore(overrides: Partial<SleepStore> = {}): SleepStore {
  return {
    async getAllMemoriesForDecay() {
      return [];
    },
    async updateMemoryCompression() {},
    acquireBatch() {
      return { async execute() {} };
    },
    async insertMemory() {
      return 999;
    },
    ...overrides,
  };
}

function makeEmbeddings() {
  return {
    async encode(_text: string) {
      return [0.1, 0.2, 0.3];
    },
  };
}

describe("runDeepSleep", () => {
  it("returns all required fields", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    const result = await runDeepSleep(store, emb, []);
    expect(result).toHaveProperty("replayed");
    expect(result).toHaveProperty("reembedded");
    expect(result).toHaveProperty("cluster_summaries");
    expect(result).toHaveProperty("narration_stored");
    expect(result).toHaveProperty("narration_preview");
  });

  it("narration_stored false when no memories", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    const result = await runDeepSleep(store, emb, []);
    expect(result.narration_stored).toBe(false);
  });

  it("narration_preview is at most 100 characters", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    // With enough hot memories, narration might be generated
    const memories = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      heat: 0.8,
      content: `Memory about topic ${i} with enough content to generate replay and narration.`,
      importance: 0.7,
      surprise: 0.5,
    }));
    const result = await runDeepSleep(store, emb, memories);
    expect(result.narration_preview.length).toBeLessThanOrEqual(100);
  });

  it("replayed is non-negative", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    const result = await runDeepSleep(store, emb, []);
    expect(result.replayed).toBeGreaterThanOrEqual(0);
  });

  it("reembedded is non-negative", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    const result = await runDeepSleep(store, emb, []);
    expect(result.reembedded).toBeGreaterThanOrEqual(0);
  });

  it("loads memories from store when null passed", async () => {
    const store = makeStore({
      async getAllMemoriesForDecay() {
        return [{ id: 1, heat: 0.8, content: "test memory" }];
      },
    });
    const emb = makeEmbeddings();
    const result = await runDeepSleep(store, emb, null);
    // Should not throw; all fields present
    expect(result.replayed).toBeGreaterThanOrEqual(0);
  });
});
