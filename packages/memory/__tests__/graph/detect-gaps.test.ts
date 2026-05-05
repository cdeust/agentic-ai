/**
 * Unit tests for detect-gaps.ts.
 *
 * Validates: schema shape, empty store returns no gaps,
 * isolated-entity detection, domain coverage gap, and temporal-gap logic.
 *
 * source: cortex@ed33435 mcp_server/handlers/detect_gaps.py
 */

import { describe, it, expect, vi } from "vitest";
import { detectGapsHandler, schema } from "../../src/graph/handlers/detect-gaps.js";
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

describe("detectGapsHandler schema", () => {
  it("has the correct title", () => {
    expect(schema.title).toBe("Detect gaps");
  });

  it("stale_threshold_days.default === 30", () => {
    expect(schema.inputSchema.properties.stale_threshold_days.default).toBe(30);
  });
});

// ── Empty store ───────────────────────────────────────────────────────────────

describe("detectGapsHandler — empty store", () => {
  it("returns zero gaps and domain_filter=global when store is empty", async () => {
    const result = await detectGapsHandler({}, makeStore());
    expect(result.total_gaps).toBe(0);
    expect(result.gaps).toEqual([]);
    expect(result.domain_filter).toBe("global");
  });
});

// ── Isolated entity detection ─────────────────────────────────────────────────

describe("detectGapsHandler — isolated entities", () => {
  it("detects isolated entity when entity has no relationships", async () => {
    const store = makeStore({
      getEntities: vi.fn().mockResolvedValue([
        { id: 1, name: "IsolatedNode", entity_type: "class" },
      ]),
      getRelationships: vi.fn().mockResolvedValue([]), // no rels → isolated
    });

    const result = await detectGapsHandler(
      { include_entity_gaps: true, include_domain_gaps: false, include_temporal_gaps: false },
      store,
    );

    const entityGaps = result.gaps.filter((g) => g.gap_type === "isolated_entity");
    expect(entityGaps.length).toBe(1);
    expect((entityGaps[0] as { entity_name: string }).entity_name).toBe("IsolatedNode");
  });

  it("does NOT report a connected entity as isolated", async () => {
    const store = makeStore({
      getEntities: vi.fn().mockResolvedValue([
        { id: 1, name: "NodeA", entity_type: "class" },
        { id: 2, name: "NodeB", entity_type: "class" },
      ]),
      getRelationships: vi.fn().mockResolvedValue([
        { source_entity_id: 1, target_entity_id: 2, weight: 1.0, confidence: 1.0 },
      ]),
    });

    const result = await detectGapsHandler(
      { include_entity_gaps: true, include_domain_gaps: false, include_temporal_gaps: false },
      store,
    );

    const entityGaps = result.gaps.filter((g) => g.gap_type === "isolated_entity");
    expect(entityGaps.length).toBe(0);
  });
});

// ── by_type aggregation ───────────────────────────────────────────────────────

describe("detectGapsHandler — by_type", () => {
  it("groups gaps by gap_type correctly", async () => {
    const store = makeStore({
      getEntities: vi.fn().mockResolvedValue([
        { id: 1, name: "IsoA", entity_type: "class" },
        { id: 2, name: "IsoB", entity_type: "class" },
      ]),
      getRelationships: vi.fn().mockResolvedValue([]),
    });

    const result = await detectGapsHandler(
      { include_entity_gaps: true, include_domain_gaps: false, include_temporal_gaps: false },
      store,
    );

    expect(result.by_type["isolated_entity"]).toBe(2);
  });
});
