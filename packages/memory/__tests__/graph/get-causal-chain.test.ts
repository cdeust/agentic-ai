/**
 * Unit tests for get-causal-chain.ts.
 *
 * Validates: schema shape, empty result when no entity found,
 * BFS edge collection, direction filtering, and max_edges cap.
 *
 * source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py
 */

import { describe, it, expect, vi } from "vitest";
import { getCausalChainHandler, schema } from "../../src/graph/handlers/get-causal-chain.js";
import type { MemoryStore } from "../../src/recall/port.js"; // source: recall/port.ts — RecallMemoryStore interface for graph handlers

// ── Minimal RecallMemoryStore stub ────────────────────────────────────────────

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

describe("getCausalChainHandler schema", () => {
  it("has the correct title", () => {
    expect(schema.title).toBe("Get causal chain");
  });

  it("max_depth.default === 3", () => {
    expect(schema.inputSchema.properties.max_depth.default).toBe(3);
  });

  it("max_edges.default === 200", () => {
    expect(schema.inputSchema.properties.max_edges.default).toBe(200);
  });
});

// ── Error path: missing args ──────────────────────────────────────────────────

describe("getCausalChainHandler — error paths", () => {
  it("returns reason when neither entity_name nor memory_id is provided", async () => {
    const result = await getCausalChainHandler({}, makeStore());
    expect((result as { reason: string }).reason).toContain("provide entity_name or memory_id");
    expect((result as { chain: unknown[] }).chain).toEqual([]);
  });

  it("returns reason when entity_name not found", async () => {
    const store = makeStore({ getEntityByName: vi.fn().mockResolvedValue(null) });
    const result = await getCausalChainHandler({ entity_name: "UnknownEntity" }, store);
    expect((result as { reason: string }).reason).toContain("entity not found");
  });
});

// ── Happy path: entity found with no relationships ────────────────────────────

describe("getCausalChainHandler — happy path", () => {
  it("returns start_entity and empty chain when no relationships exist", async () => {
    const store = makeStore({
      getEntityByName: vi.fn().mockResolvedValue({ id: 42, name: "TestEntity", entity_type: "class" }),
      getEntities: vi.fn().mockResolvedValue([{ id: 42, name: "TestEntity", entity_type: "class" }]),
      getRelationships: vi.fn().mockResolvedValue([]),
    });

    const result = await getCausalChainHandler({ entity_name: "TestEntity" }, store);

    expect((result as { start_entity: { id: number } }).start_entity.id).toBe(42);
    expect((result as { chain: unknown[] }).chain).toEqual([]);
    expect((result as { total_edges: number }).total_edges).toBe(0);
  });

  it("collects edges from outgoing relationships", async () => {
    const entities = [
      { id: 1, name: "A", entity_type: "class" },
      { id: 2, name: "B", entity_type: "function" },
    ];
    const rels = [
      { source_entity_id: 1, target_entity_id: 2, relationship_type: "imports", weight: 1.0, confidence: 0.9 },
    ];

    const store = makeStore({
      getEntityByName: vi.fn().mockResolvedValue(entities[0]),
      getEntities: vi.fn().mockResolvedValue(entities),
      getRelationships: vi.fn().mockResolvedValue(rels),
      searchByFts: vi.fn().mockResolvedValue([]),
    });

    const result = await getCausalChainHandler(
      { entity_name: "A", max_depth: 2, direction: "outgoing" },
      store,
    );

    const chain = (result as { chain: Array<{ relationship_type: string }> }).chain;
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0]!.relationship_type).toBe("imports");
  });

  it("respects max_edges cap", async () => {
    // Build 10 entities in a linear chain
    const n = 10;
    const entities = Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      name: `E${i + 1}`,
      entity_type: "class",
    }));
    const rels = Array.from({ length: n - 1 }, (_, i) => ({
      source_entity_id: i + 1,
      target_entity_id: i + 2,
      relationship_type: "depends_on",
      weight: 1.0,
      confidence: 1.0,
    }));

    const store = makeStore({
      getEntityByName: vi.fn().mockResolvedValue(entities[0]),
      getEntities: vi.fn().mockResolvedValue(entities),
      getRelationships: vi.fn().mockResolvedValue(rels),
      searchByFts: vi.fn().mockResolvedValue([]),
    });

    const result = await getCausalChainHandler(
      { entity_name: "E1", max_edges: 3, max_depth: 10 },
      store,
    );

    expect((result as { chain: unknown[] }).chain.length).toBeLessThanOrEqual(3);
  });
});
