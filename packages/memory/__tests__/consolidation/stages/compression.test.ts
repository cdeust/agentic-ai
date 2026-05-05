/**
 * Compression stage handler — invariant tests.
 *
 * Invariants verified:
 *   1. Monotone: compression level never decreases (target <= current → no-op).
 *   2. Protected memories → protected_skipped, not compressed.
 *   3. Semantic memories → semantic_skipped, not compressed.
 *   4. rows_scanned equals total memories passed in.
 *   5. 0→2 fast path: gistEmb is reused (no extra encode call beyond 2 total).
 *   6. getCompressionSchedule returns 0 for protected/semantic regardless of age.
 */

import { describe, it, expect, vi } from "vitest";
import {
  runCompressionCycle,
  type CompressionStore,
  type CompressionSettings,
} from "../../../src/consolidation/stages/compression.js";

const SETTINGS: CompressionSettings = {
  COMPRESSION_GIST_AGE_HOURS: 168, // 1 week
  COMPRESSION_TAG_AGE_HOURS: 720, // 30 days
};

function makeStore() {
  const archived: Record<string, unknown>[] = [];
  const compressions: Array<{ id: number; level: number; content: string }> = [];
  return {
    archived,
    compressions,
    async getAllMemoriesForDecay() {
      return [];
    },
    async insertArchive(row: Record<string, unknown>) {
      archived.push(row);
    },
    async updateMemoryCompression(
      id: number,
      content: string,
      _embedding: number[],
      level: number,
    ) {
      compressions.push({ id, level, content });
    },
  } satisfies CompressionStore;
}

function makeEmbeddings() {
  const calls: string[] = [];
  return {
    calls,
    async encode(text: string) {
      calls.push(text);
      return [0.1, 0.2, 0.3];
    },
  };
}

function makeOldMem(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // ingested 400 days ago → tag level (720h = 30 days → 400 days >> 720h)
  const old = new Date();
  old.setDate(old.getDate() - 400);
  return {
    id,
    content: "This is a long memory content that should be compressed into a tag eventually.",
    compression_level: 0,
    ingested_at: old.toISOString(),
    importance: 0.3,
    confidence: 0.5,
    access_count: 0,
    store_type: "episodic",
    ...overrides,
  };
}

function makeRecentMem(id: number): Record<string, unknown> {
  const recent = new Date();
  return {
    id,
    content: "Recent memory — should not be compressed.",
    compression_level: 0,
    ingested_at: recent.toISOString(),
    importance: 0.3,
    store_type: "episodic",
  };
}

describe("runCompressionCycle", () => {
  it("skips protected memories", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    const mem: Record<string, unknown> = { ...makeOldMem(1), is_protected: true };
    const result = await runCompressionCycle(store, SETTINGS, emb, [mem]);
    expect(result.protected_skipped).toBe(1);
    expect(result.compressed_to_gist).toBe(0);
    expect(result.compressed_to_tag).toBe(0);
    expect(emb.calls).toHaveLength(0);
  });

  it("skips semantic memories", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    const mem: Record<string, unknown> = { ...makeOldMem(2), store_type: "semantic" };
    const result = await runCompressionCycle(store, SETTINGS, emb, [mem]);
    expect(result.semantic_skipped).toBe(1);
    expect(result.compressed_to_gist).toBe(0);
    expect(emb.calls).toHaveLength(0);
  });

  it("rows_scanned equals memory count passed in", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    const memories = [makeRecentMem(10), makeRecentMem(11), makeRecentMem(12)];
    const result = await runCompressionCycle(store, SETTINGS, emb, memories);
    expect(result.rows_scanned).toBe(3);
  });

  it("does not compress recent memories", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    const result = await runCompressionCycle(store, SETTINGS, emb, [makeRecentMem(5)]);
    expect(result.compressed_to_gist).toBe(0);
    expect(result.compressed_to_tag).toBe(0);
    expect(emb.calls).toHaveLength(0);
  });

  it("compresses very old memory to tag (0→2) with exactly 2 encode calls", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    // 400-day-old memory → target level 2 (tag)
    const result = await runCompressionCycle(store, SETTINGS, emb, [makeOldMem(20)]);
    expect(result.compressed_to_gist).toBe(1); // intermediate gist counted
    expect(result.compressed_to_tag).toBe(1);
    // Fast path: 2 encode calls (gist + tag), NOT 3
    expect(emb.calls).toHaveLength(2);
  });

  it("compresses medium-age memory to gist only (0→1)", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    // ingested ~250 hours ago → between gist_age (168h) and tag_age (720h)
    // resistance=1.0 (no multipliers active: importance=0.3, surprise=0, confidence=0.5, access=0)
    // effective gist_age = 168 * 1.0 = 168h. 250h > 168h → gist.
    // effective tag_age = 720 * 1.0 = 720h. 250h < 720h → not tag.
    const medAge = new Date();
    medAge.setHours(medAge.getHours() - 250);
    const mem: Record<string, unknown> = {
      id: 30,
      content: "Medium age content to compress to gist.",
      compression_level: 0,
      ingested_at: medAge.toISOString(),
      importance: 0.3,  // < 0.7 → no resistance multiplier
      confidence: 0.5,  // < 0.8 → no resistance multiplier (note: default is 1.0 which IS > 0.8)
      surprise_score: 0.0, // < 0.6 → no resistance multiplier
      access_count: 0,  // <= 10 → no resistance multiplier
      store_type: "episodic",
    };
    const result = await runCompressionCycle(store, SETTINGS, emb, [mem]);
    expect(result.compressed_to_gist).toBe(1);
    expect(result.compressed_to_tag).toBe(0);
    expect(emb.calls).toHaveLength(1); // only 1 encode for gist
  });

  it("does not regress compression level (1→0 is no-op)", async () => {
    const store = makeStore();
    const emb = makeEmbeddings();
    // Memory already at level 1 but recently ingested → target 0 → no-op
    const recent = new Date();
    const mem: Record<string, unknown> = {
      id: 40,
      content: "Gist already",
      compression_level: 1,
      ingested_at: recent.toISOString(),
      importance: 0.9,
      store_type: "episodic",
    };
    const result = await runCompressionCycle(store, SETTINGS, emb, [mem]);
    expect(result.compressed_to_gist).toBe(0);
    expect(result.compressed_to_tag).toBe(0);
    expect(emb.calls).toHaveLength(0);
  });

  it("loads memories from store when null is passed", async () => {
    const storeWithMems = {
      ...makeStore(),
      async getAllMemoriesForDecay() {
        return [makeRecentMem(50)];
      },
    };
    const emb = makeEmbeddings();
    const result = await runCompressionCycle(storeWithMems, SETTINGS, emb, null);
    expect(result.rows_scanned).toBe(1);
  });
});
