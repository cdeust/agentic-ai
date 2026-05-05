/**
 * pg-store-queries.test.ts — Tests for pg-store-queries.ts
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py
 */
import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  getMemoriesForDomain, getMemoriesForDirectory, getHotMemories,
  getMemoriesCreatedAfter, getMemoriesInTimeWindow, deleteMemoriesByTag,
  searchByTagVector, findCoAccessedPairs, findSharedEntities, iterMemoriesForDecay,
} from "../../../src/remember/storage/pg-store-queries.js";

function mc(rows: unknown[] = [], rowCount = 0): PoolClient {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) } as unknown as PoolClient;
}

describe("getMemoriesForDomain", () => {
  it("includes is_global = TRUE", async () => {
    const client = mc([]);
    await getMemoriesForDomain(client, "cortex");
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("is_global = TRUE");
  });
});

describe("getMemoriesForDirectory", () => {
  it("includes globals filter and directory_context", async () => {
    const client = mc([]);
    await getMemoriesForDirectory(client, "/home/foo");
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("directory_context = $1");
    expect(sql).toContain("is_global = TRUE");
  });
});

describe("getHotMemories", () => {
  it("filters NOT coalesce(is_benchmark, FALSE) by default", async () => {
    const client = mc([]);
    await getHotMemories(client, 0.7, 20);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("NOT coalesce(is_benchmark, FALSE)");
  });
  it("omits benchmark filter when true", async () => {
    const client = mc([]);
    await getHotMemories(client, 0.7, 20, true);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toContain("is_benchmark");
  });
  it("omits LIMIT when limit = 0", async () => {
    const client = mc([]);
    await getHotMemories(client, 0.5, 0);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toContain("LIMIT");
  });
});

describe("getMemoriesCreatedAfter", () => {
  it("uses created_at >= $1 ORDER BY created_at ASC", async () => {
    const client = mc([]);
    await getMemoriesCreatedAfter(client, "2024-01-01T00:00:00Z");
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("created_at >= $1");
    expect(sql).toContain("ORDER BY created_at ASC");
  });
});

describe("getMemoriesInTimeWindow", () => {
  it("uses ABS(EXTRACT(EPOCH FROM", async () => {
    const client = mc([]);
    await getMemoriesInTimeWindow(client, "2024-01-01T12:00:00Z", 30);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("ABS(EXTRACT(EPOCH FROM");
  });
});

describe("deleteMemoriesByTag", () => {
  it("uses tags @> $1::jsonb and returns rowCount", async () => {
    const client = mc([], 3);
    expect(await deleteMemoriesByTag(client, "_anchor")).toBe(3);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("tags @> $1::jsonb");
  });
});

describe("searchByTagVector", () => {
  it("uses embedding <=> when embedding provided", async () => {
    const client = mc([]);
    const emb = Buffer.alloc(8, 0);
    await searchByTagVector(client, emb, "preference", null, 0.01, 3, vi.fn().mockReturnValue("[0.0,0.0]"));
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("embedding <=>");
  });
  it("falls back to heat_base ORDER when no embedding", async () => {
    const client = mc([]);
    await searchByTagVector(client, null, "instruction", null, 0.01, 3, vi.fn());
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("ORDER BY heat_base DESC");
  });
});

describe("findCoAccessedPairs", () => {
  it("returns empty for empty input", async () => {
    expect(await findCoAccessedPairs(mc(), [])).toEqual([]);
  });
  it("uses LEAST/GREATEST for canonical pair", async () => {
    const client = mc([{ a: 1, b: 2 }]);
    expect(await findCoAccessedPairs(client, [10])).toEqual([[1, 2]]);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("LEAST(me1.entity_id, me2.entity_id)");
  });
});

describe("findSharedEntities", () => {
  it("returns empty for empty entityIds", async () => {
    expect(await findSharedEntities(mc(), 1, [])).toEqual([]);
  });
  it("queries memory_entities intersection", async () => {
    const client = mc([{ entity_id: 5 }]);
    expect(await findSharedEntities(client, 10, [5, 6])).toEqual([5]);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("memory_id = $1");
  });
});

describe("iterMemoriesForDecay", () => {
  it("stops on empty page", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }).mockResolvedValueOnce({ rows: [] }),
    } as unknown as PoolClient;
    const chunks: unknown[][] = [];
    for await (const chunk of iterMemoriesForDecay(client, 2)) chunks.push(chunk);
    expect(chunks).toHaveLength(1);
  });
  it("uses ORDER BY id for stable pagination", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of iterMemoriesForDecay(client, 100)) { /* exhaust */ }
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("ORDER BY id");
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("OFFSET $2");
  });
});
