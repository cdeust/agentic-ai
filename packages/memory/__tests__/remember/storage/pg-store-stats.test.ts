/**
 * pg-store-stats.test.ts — Tests for pg-store-stats.ts
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py
 */
import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  countMemories, getAvgHeat, getDomainCounts,
  updateMemoryConsolidation, insertStageTransitionsBatch,
  saveOscillatoryState, loadOscillatoryState,
  updateMemoryInterference, getEpisodicMemories,
  logConsolidation, getLastConsolidation, countActiveTriggers,
} from "../../../src/remember/storage/pg-store-stats.js";

function mc(rows: unknown[] = [], rowCount = 0): PoolClient {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) } as unknown as PoolClient;
}

describe("countMemories", () => {
  it("queries all status categories in one SELECT", async () => {
    const client = mc([{ total: 100 }]);
    await countMemories(client);
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    for (const col of ["episodic", "semantic", "active", "archived", "stale", "protected"]) {
      expect(sql).toContain(col);
    }
  });
});

describe("getAvgHeat", () => {
  it("returns 0 for null", async () => { expect(await getAvgHeat(mc([{ avg_heat: null }]))).toBe(0.0); });
  it("returns value", async () => { expect(await getAvgHeat(mc([{ avg_heat: 0.75 }]))).toBe(0.75); });
});

describe("getDomainCounts", () => {
  it("uses COALESCE for null domain", async () => {
    const client = mc([{ d: "cortex", c: 50 }]);
    const counts = await getDomainCounts(client);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("COALESCE(domain, 'unclassified')");
    expect(counts["cortex"]).toBe(50);
  });
});

describe("insertStageTransitionsBatch", () => {
  it("returns 0 for empty", async () => { expect(await insertStageTransitionsBatch(mc(), [])).toBe(0); });
  it("uses UNNEST for batch insert", async () => {
    const client = mc();
    await insertStageTransitionsBatch(client, [{ memory_id: 1, from_stage: "labile", to_stage: "early_ltp", hours_in_prev: 2.5 }]);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("UNNEST(");
  });
  it("defaults trigger to cascade", async () => {
    const client = mc();
    await insertStageTransitionsBatch(client, [{ memory_id: 1, from_stage: "labile", to_stage: "early_ltp", hours_in_prev: 1.0 }]);
    const params = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(params[4]).toContain("cascade");
  });
});

describe("updateMemoryConsolidation", () => {
  it("updates all 4 consolidation columns", async () => {
    const client = mc();
    await updateMemoryConsolidation(client, 1, "early_ltp", 3.0, 2, 0.8);
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    for (const col of ["consolidation_stage", "hours_in_stage", "replay_count", "hippocampal_dependency"]) {
      expect(sql).toContain(col);
    }
  });
});

describe("saveOscillatoryState", () => {
  it("upserts id=1 singleton with ON CONFLICT", async () => {
    const client = mc();
    await saveOscillatoryState(client, "{}");
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("ON CONFLICT (id) DO UPDATE");
  });
});

describe("loadOscillatoryState", () => {
  it("returns null when no row", async () => { expect(await loadOscillatoryState(mc([]))).toBeNull(); });
  it("returns state_json string", async () => { expect(await loadOscillatoryState(mc([{ state_json: "{}" }]))).toBe("{}"); });
});

describe("updateMemoryInterference", () => {
  it("updates both columns when separationIndex provided", async () => {
    const client = mc();
    await updateMemoryInterference(client, 1, 0.4, 0.6);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("separation_index");
  });
  it("updates only interference_score when null", async () => {
    const client = mc();
    await updateMemoryInterference(client, 1, 0.4, null);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toContain("separation_index");
  });
});

describe("getEpisodicMemories", () => {
  it("filters store_type = episodic and NOT is_stale", async () => {
    const client = mc([]);
    await getEpisodicMemories(client);
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("store_type = 'episodic'");
    expect(sql).toContain("NOT is_stale");
  });
});

describe("logConsolidation", () => {
  it("inserts and returns id", async () => {
    expect(await logConsolidation(mc([{ id: 7 }]), { memories_added: 10 })).toBe(7);
  });
});

describe("getLastConsolidation", () => {
  it("returns null when empty", async () => { expect(await getLastConsolidation(mc([]))).toBeNull(); });
  it("returns ISO string from Date", async () => {
    const ts = new Date("2024-01-01T00:00:00Z");
    expect(await getLastConsolidation(mc([{ timestamp: ts }]))).toContain("2024-01-01");
  });
});

describe("countActiveTriggers", () => {
  it("queries prospective_memories WHERE is_active", async () => {
    const client = mc([{ c: 3 }]);
    expect(await countActiveTriggers(client)).toBe(3);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("prospective_memories WHERE is_active");
  });
});
