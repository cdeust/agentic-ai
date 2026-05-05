/**
 * In-memory MemoryStore stub for parity tests.
 *
 * Implements the MemoryStore port with seeded data. All reads are
 * synchronous under the hood; the async wrapper satisfies the interface.
 *
 * This stub has NO side effects outside its own in-memory state.
 */

import type {
  EmbeddingEngine,
  FtsSearchResult,
  MemoryStore,
  VectorSearchResult,
} from "../../src/recall/port.js";
import type { MemoryItem } from "../../src/recall/types.js";
import { cosineSimilarity } from "../../src/recall/vector-similarity.js";

// ── Seed data factory ──────────────────────────────────────────────────────

// Stable created_at sentinel — using new Date().toISOString() here makes every
// captured fixture diff against itself across runs (the value is embedded in
// the recall handler's output). Frozen at the day this fixture set was first
// captured to keep recall_*.tsoutput.json deterministic under git.
// source: 2026-05-05 — recall fixture stabilization
export const SEED_MEMORY_CREATED_AT = "2026-05-05T00:00:00.000Z";

export function makeSeedMemory(
  id: number,
  content: string,
  overrides: Partial<MemoryItem> = {},
): MemoryItem {
  return {
    id,
    content,
    heat: overrides.heat ?? 0.8,
    domain: overrides.domain ?? "cortex",
    tags: overrides.tags ?? ["test"],
    store_type: overrides.store_type ?? "episodic",
    created_at: overrides.created_at ?? SEED_MEMORY_CREATED_AT,
    importance: overrides.importance ?? 0.5,
    surprise_score: overrides.surprise_score ?? 0.0,
    embedding: overrides.embedding ?? null,
    ...overrides,
  };
}

// ── Stub implementation ────────────────────────────────────────────────────

export class InMemoryStore implements MemoryStore {
  private readonly memories: Map<number, MemoryItem>;
  private rules: unknown[] = [];
  private triggers: unknown[] = [];
  public accessLog: Array<{ id: number; type: "access" | "replay" }> = [];
  public relationshipLog: Array<{ a: string; b: string; lr: number }> = [];

  constructor(seeds: MemoryItem[] = []) {
    this.memories = new Map(seeds.map((m) => [m.id, m]));
  }

  setRules(rules: unknown[]): void {
    this.rules = rules;
  }

  setTriggers(triggers: unknown[]): void {
    this.triggers = triggers;
  }

  addMemory(mem: MemoryItem): void {
    this.memories.set(mem.id, mem);
  }

  async searchByVector(
    embedding: number[],
    topK: number,
    minHeat: number,
  ): Promise<VectorSearchResult[]> {
    const results: VectorSearchResult[] = [];
    for (const mem of this.memories.values()) {
      if (mem.heat < minHeat) continue;
      if (!mem.embedding || mem.embedding.length === 0) continue;
      const sim = cosineSimilarity(embedding, mem.embedding);
      const distance = 1 - sim;
      results.push({ memory_id: mem.id, distance });
    }
    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, topK);
  }

  async searchByFts(query: string, limit: number): Promise<FtsSearchResult[]> {
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const results: FtsSearchResult[] = [];
    for (const mem of this.memories.values()) {
      const contentLower = mem.content.toLowerCase();
      const matchCount = queryWords.filter((w) => contentLower.includes(w)).length;
      if (matchCount > 0) {
        results.push({ memory_id: mem.id, score: matchCount / queryWords.length });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async getMemory(id: number): Promise<MemoryItem | null> {
    return this.memories.get(id) ?? null;
  }

  async getByIds(ids: number[]): Promise<MemoryItem[]> {
    return ids.flatMap((id) => {
      const m = this.memories.get(id);
      return m ? [m] : [];
    });
  }

  async getMemoriesForDomain(
    domain: string,
    minHeat: number,
    limit: number,
  ): Promise<MemoryItem[]> {
    return Array.from(this.memories.values())
      .filter((m) => m.domain === domain && m.heat >= minHeat)
      .sort((a, b) => b.heat - a.heat)
      .slice(0, limit);
  }

  async getMemoriesForDirectory(
    directory: string,
    minHeat: number,
  ): Promise<MemoryItem[]> {
    return Array.from(this.memories.values()).filter(
      (m) =>
        m.heat >= minHeat &&
        Array.isArray(m.tags) &&
        m.tags.some((t) => t.includes(directory)),
    );
  }

  async getHotMemories(minHeat: number, limit: number): Promise<MemoryItem[]> {
    return Array.from(this.memories.values())
      .filter((m) => m.heat >= minHeat)
      .sort((a, b) => b.heat - a.heat)
      .slice(0, limit);
  }

  async getAllActiveRules(): Promise<unknown[]> {
    return this.rules;
  }

  async getActiveProspectiveMemories(): Promise<unknown[]> {
    return this.triggers;
  }

  async updateMemoryAccess(memoryId: number): Promise<void> {
    this.accessLog.push({ id: memoryId, type: "access" });
  }

  async incrementReplayCount(memoryId: number): Promise<void> {
    this.accessLog.push({ id: memoryId, type: "replay" });
  }

  async reinforceOrCreateRelationship(
    entityA: string,
    entityB: string,
    learningRate: number,
  ): Promise<void> {
    this.relationshipLog.push({ a: entityA, b: entityB, lr: learningRate });
  }
}

// ── Null embedding engine ─────────────────────────────────────────────────

/**
 * A no-op EmbeddingEngine stub. Returns null for all encodes.
 *
 * Use when testing the text-signal (BM25/heat) path without vectors.
 */
export class NullEmbeddingEngine implements EmbeddingEngine {
  readonly dimensions = 384;

  async encode(_text: string): Promise<number[] | null> {
    return null;
  }

  similarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b);
  }
}

/**
 * A deterministic EmbeddingEngine stub that returns a fixed random-ish
 * vector derived from the text content hash.
 *
 * Use when testing the vector-signal path end-to-end in tests.
 */
export class DeterministicEmbeddingEngine implements EmbeddingEngine {
  readonly dimensions: number;

  constructor(dim = 8) {
    this.dimensions = dim;
  }

  async encode(text: string): Promise<number[] | null> {
    return textToVec(text, this.dimensions);
  }

  similarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b);
  }
}

/** Hash a string into a deterministic float vector of given dimension. */
export function textToVec(text: string, dim: number): number[] {
  const vec: number[] = [];
  for (let i = 0; i < dim; i++) {
    let h = 0;
    for (let j = 0; j < text.length; j++) {
      h = (h * 31 + text.charCodeAt(j) + i * 17) & 0x7fffffff;
    }
    vec.push((h % 1000) / 1000 - 0.5);
  }
  return vec;
}
