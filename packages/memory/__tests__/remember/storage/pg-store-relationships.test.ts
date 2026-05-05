/**
 * pg-store-relationships.test.ts — Tests for pg-store-relationships.ts
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py
 */
import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  updateRelationshipsWeightBatch, deleteRelationshipsBatch,
  insertRelationship, getRelationshipsForEntity,
  getAllRelationships, reinforceOrCreateRelationship,
} from "../../../src/remember/storage/pg-store-relationships.js";

function mc(rows: unknown[] = [], rowCount = 0): PoolClient {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) } as unknown as PoolClient;
}

describe("updateRelationshipsWeightBatch", () => {
  it("returns 0 for empty", async () => { expect(await updateRelationshipsWeightBatch(mc(), [])).toBe(0); });
  it("uses UNNEST for batch update", async () => {
    const client = mc();
    await updateRelationshipsWeightBatch(client, [[1, 0.9]]);
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("UNNEST($1::int[])");
    expect(sql).toContain("UNNEST($2::real[])");
  });
});

describe("deleteRelationshipsBatch", () => {
  it("uses ANY($1::int[])", async () => {
    const client = mc([], 3);
    await deleteRelationshipsBatch(client, [10, 20, 30]);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("ANY($1::int[])");
  });
});

describe("insertRelationship", () => {
  it("includes last_reinforced and returns id", async () => {
    const client = mc([{ id: 55 }]);
    expect(await insertRelationship(client, { source_entity_id: 1, target_entity_id: 2, relationship_type: "co_retrieval" })).toBe(55);
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("last_reinforced");
    expect(sql).toContain("RETURNING id");
  });
});

describe("getRelationshipsForEntity", () => {
  it("outgoing filters source_entity_id = $1", async () => {
    const client = mc([]);
    await getRelationshipsForEntity(client, 1, "outgoing");
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("source_entity_id = $1");
  });
  it("incoming filters target_entity_id = $1", async () => {
    const client = mc([]);
    await getRelationshipsForEntity(client, 1, "incoming");
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("target_entity_id = $1");
  });
  it("both uses OR condition", async () => {
    const client = mc([]);
    await getRelationshipsForEntity(client, 5);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("OR r.target_entity_id = $1");
  });
});

describe("getAllRelationships", () => {
  it("selects release_probability, facilitation, depression, last_reinforced", async () => {
    const client = mc([]);
    await getAllRelationships(client);
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    for (const col of ["release_probability", "facilitation", "depression", "last_reinforced"]) {
      expect(sql).toContain(col);
    }
  });
});

describe("reinforceOrCreateRelationship", () => {
  it("no-ops when source entity not found", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 2 }] }),
    } as unknown as PoolClient;
    await reinforceOrCreateRelationship(client, "missing", "target");
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
  it("uses ON CONFLICT upsert for co_retrieval", async () => {
    let calls = 0;
    const client = {
      query: vi.fn().mockImplementation(() => {
        calls++;
        if (calls <= 2) return Promise.resolve({ rows: [{ id: calls }] });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    } as unknown as PoolClient;
    await reinforceOrCreateRelationship(client, "A", "B", 0.1, "co_retrieval");
    const allSql = (client.query as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    const upsert = allSql.find((s) => s.includes("ON CONFLICT") && s.includes("co_retrieval"));
    expect(upsert).toBeDefined();
    expect(upsert).toContain("LEAST(2.0, relationships.weight + EXCLUDED.weight)");
  });
});
