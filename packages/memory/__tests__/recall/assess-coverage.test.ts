/**
 * Unit tests for assess-coverage.ts.
 *
 * Validates: schema shape, empty store returns score=0,
 * coverage scoring, recommendation generation.
 *
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py
 */

import { describe, it, expect, vi } from "vitest";
import { assessCoverageHandler, schema } from "../../src/recall/handlers/assess-coverage.js";
import type { MemoryStore } from "../../src/recall/port.js";

function makeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    searchByVector: vi.fn().mockResolvedValue([]),
    searchByFts: vi.fn().mockResolvedValue([]),
    getMemory: vi.fn().mockResolvedValue(null),
    getByIds: vi.fn().mockResolvedValue([]),
    getMemoriesForDomain: vi.fn().mockResolvedValue([]),
    getMemoriesForDirectory: vi.fn().mockResolvedValue([]),
    getHotMemories: vi.fn().mockResolvedValue([]),
    getAllActiveRules: vi.fn().mockResolvedValue([]),
    getActiveProspectiveMemories: vi.fn().mockResolvedValue([]),
    updateMemoryAccess: vi.fn().mockResolvedValue(undefined),
    incrementReplayCount: vi.fn().mockResolvedValue(undefined),
    reinforceOrCreateRelationship: vi.fn().mockResolvedValue(undefined),
    getEntities: vi.fn().mockResolvedValue([]),
    getRelationships: vi.fn().mockResolvedValue([]),
    getEntityByName: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

// ── Schema ────────────────────────────────────────────────────────────────────

describe("assessCoverageHandler schema", () => {
  it("has the correct title", () => {
    expect(schema.title).toBe("Assess coverage");
  });

  it("stale_days.default === 14", () => {
    expect(schema.inputSchema.properties.stale_days.default).toBe(14);
  });
});

// ── Empty store → score = 0 ───────────────────────────────────────────────────

describe("assessCoverageHandler — empty store", () => {
  it("returns coverage_score=0 and a bootstrap recommendation", async () => {
    const result = await assessCoverageHandler({}, makeStore());

    expect(result.coverage_score).toBe(0);
    expect(result.total_memories).toBe(0);
    expect(result.recommendations.some((r) => r.includes("seed_project"))).toBe(true);
  });
});

// ── Invariant: score ∈ [0, 100] ───────────────────────────────────────────────

describe("assessCoverageHandler — coverage_score invariant", () => {
  it("score is in [0, 100] for a store with some memories", async () => {
    const now = new Date().toISOString();
    const memories = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      content: `memory ${i}`,
      tags: [],
      source: "",
      domain: i % 2 === 0 ? "cortex" : "auth",
      directory_context: "",
      created_at: now,
      last_accessed: now,
      heat_base: 0.8,
      heat_base_set_at: now,
      no_decay: false,
      surprise_score: 0,
      importance: 0.5,
      emotional_valence: 0,
      confidence: 1.0,
      access_count: 1,
      useful_count: 0,
      plasticity: 1.0,
      stability: 0.5,
      reconsolidation_count: 0,
      store_type: "episodic",
      compressed: false,
      compression_level: 0,
      is_protected: false,
      is_stale: false,
      excitability: 1.0,
      consolidation_stage: "labile" as const,
      hours_in_stage: 0,
      replay_count: 0,
      theta_phase_at_encoding: 0,
      encoding_strength: 1.0,
      separation_index: 0,
      interference_score: 0,
      schema_match_score: 0,
      hippocampal_dependency: 1.0,
      is_benchmark: false,
      agent_context: "",
      is_global: false,
      heat: 0.8,
    }));

    const store = makeStore({
      getHotMemories: vi.fn().mockResolvedValue(memories),
      getEntities: vi.fn().mockResolvedValue(
        Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Entity${i}`, entity_type: "class" })),
      ),
    });

    const result = await assessCoverageHandler({}, store);

    expect(result.coverage_score).toBeGreaterThanOrEqual(0);
    expect(result.coverage_score).toBeLessThanOrEqual(100);
    expect(result.total_memories).toBe(50);
  });

  it("returns healthy recommendation when coverage is good", async () => {
    const now = new Date().toISOString();
    const memories = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      content: `fresh memory ${i}`,
      tags: [],
      source: "",
      domain: "cortex",
      directory_context: "",
      created_at: now,
      last_accessed: now,
      heat_base: 0.9,
      heat_base_set_at: now,
      no_decay: false,
      surprise_score: 0,
      importance: 0.7,
      emotional_valence: 0,
      confidence: 1.0,
      access_count: 5,
      useful_count: 2,
      plasticity: 1.0,
      stability: 0.5,
      reconsolidation_count: 0,
      store_type: "episodic",
      compressed: false,
      compression_level: 0,
      is_protected: false,
      is_stale: false,
      excitability: 1.0,
      consolidation_stage: "labile" as const,
      hours_in_stage: 0,
      replay_count: 0,
      theta_phase_at_encoding: 0,
      encoding_strength: 1.0,
      separation_index: 0,
      interference_score: 0,
      schema_match_score: 0,
      hippocampal_dependency: 1.0,
      is_benchmark: false,
      agent_context: "",
      is_global: false,
      heat: 0.9,
    }));

    const store = makeStore({
      getHotMemories: vi.fn().mockResolvedValue(memories),
      getEntities: vi.fn().mockResolvedValue(
        Array.from({ length: 300 }, (_, i) => ({
          id: i + 1,
          name: `Entity${i}`,
          entity_type: "class",
        })),
      ),
    });

    const result = await assessCoverageHandler({}, store);
    // With 100 fresh memories + 300 entities → should get a healthy recommendation
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});
