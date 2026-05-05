/**
 * pg-store-entities.test.ts — Tests for pg-store-entities.ts
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py
 */
import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  updateEntitiesHeatBatch, archiveEntitiesBatch, insertEntity,
  getEntityByName, getAllEntities, insertMemoryEntity,
  listMemoryEntityEdges, getEntityIdsForMemories, getMemoriesMentioningEntity,
} from "../../../src/remember/storage/pg-store-entities.js";

function mc(rows: unknown[] = [], rowCount = 0): PoolClient {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) } as unknown as PoolClient;
}

describe("updateEntitiesHeatBatch", () => {
  it("returns 0 for empty", async () => {
    const client = mc();
    expect(await updateEntitiesHeatBatch(client, [])).toBe(0);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
  it("uses UNNEST for batch update", async () => {
    const client = mc();
    await updateEntitiesHeatBatch(client, [[1, 0.5], [2, 0.8]]);
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("UNNEST($1::int[])");
    expect(sql).toContain("UNNEST($2::real[])");
  });
});

describe("archiveEntitiesBatch", () => {
  it("sets heat = 0", async () => {
    const client = mc();
    await archiveEntitiesBatch(client, [1, 2, 3]);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("SET heat = 0");
  });
});

describe("insertEntity", () => {
  it("returns existing id on case-insensitive match", async () => {
    const client = mc([{ id: 7 }]);
    expect(await insertEntity(client, { name: "Python", type: "language" })).toBe(7);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
  it("inserts when no existing entity", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 99 }] }),
    } as unknown as PoolClient;
    expect(await insertEntity(client, { name: "Rust", type: "language" })).toBe(99);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain("INSERT INTO entities");
  });
});

describe("getEntityByName", () => {
  it("uses LOWER(name) = LOWER($1)", async () => {
    const client = mc([]);
    await getEntityByName(client, "FooBar");
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("LOWER(name) = LOWER($1)");
  });
});

describe("getAllEntities", () => {
  it("excludes archived by default", async () => {
    const client = mc([]);
    await getAllEntities(client);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("NOT archived");
  });
});

describe("insertMemoryEntity", () => {
  it("uses ON CONFLICT DO NOTHING", async () => {
    const client = mc();
    await insertMemoryEntity(client, 1, 2);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("ON CONFLICT DO NOTHING");
  });
});

describe("listMemoryEntityEdges", () => {
  it("filters null rows", async () => {
    const client = mc([{ memory_id: 1, entity_id: 2 }, { memory_id: null, entity_id: 3 }]);
    expect(await listMemoryEntityEdges(client)).toHaveLength(1);
  });
});

describe("getEntityIdsForMemories", () => {
  it("returns empty map for empty input", async () => {
    expect((await getEntityIdsForMemories(mc(), [])).size).toBe(0);
  });
  it("groups by memory_id", async () => {
    const client = mc([{ memory_id: 1, entity_id: 10 }, { memory_id: 1, entity_id: 11 }]);
    const result = await getEntityIdsForMemories(client, [1]);
    expect(result.get(1)?.has(10)).toBe(true);
    expect(result.get(1)?.has(11)).toBe(true);
  });
});

describe("getMemoriesMentioningEntity", () => {
  it("uses FTS first", async () => {
    const client = mc([{ id: 1 }]);
    await getMemoriesMentioningEntity(client, "TypeScript");
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("phraseto_tsquery");
  });
  it("falls back to ILIKE on FTS miss", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 2 }] }),
    } as unknown as PoolClient;
    await getMemoriesMentioningEntity(client, "Rust");
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain("ILIKE");
  });
});
