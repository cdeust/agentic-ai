/**
 * pg-store-auxiliary.test.ts — Tests for pg-store-auxiliary.ts
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py
 */
import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  insertProspectiveMemory, getActiveProspectiveMemories,
  triggerProspectiveMemory, deactivateProspectiveMemory,
  insertCheckpoint, getCurrentEpoch, incrementEpoch,
  insertArchive, initEngramSlots, countMemoriesInSlot,
  insertSchema, deleteSchema,
} from "../../../src/remember/storage/pg-store-auxiliary.js";

function mc(rows: unknown[] = [], rowCount = 0): PoolClient {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) } as unknown as PoolClient;
}

describe("insertProspectiveMemory", () => {
  it("returns id", async () => {
    const client = mc([{ id: 42 }]);
    expect(await insertProspectiveMemory(client, { content: "x", trigger_condition: "y", trigger_type: "z" })).toBe(42);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("INSERT INTO prospective_memories");
  });
  it("throws when no id", async () => {
    await expect(insertProspectiveMemory(mc([]), { content: "x", trigger_condition: "y", trigger_type: "z" })).rejects.toThrow();
  });
});

describe("getActiveProspectiveMemories", () => {
  it("queries WHERE is_active", async () => {
    const client = mc([]);
    await getActiveProspectiveMemories(client);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("WHERE is_active");
  });
});

describe("triggerProspectiveMemory", () => {
  it("increments triggered_count", async () => {
    const client = mc();
    await triggerProspectiveMemory(client, 7);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("triggered_count = triggered_count + 1");
  });
});

describe("deactivateProspectiveMemory", () => {
  it("sets is_active = FALSE", async () => {
    const client = mc();
    await deactivateProspectiveMemory(client, 3);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("is_active = FALSE");
  });
});

describe("insertCheckpoint", () => {
  it("deactivates previous checkpoints first", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({ rows: [{ id: 1 }] }),
    } as unknown as PoolClient;
    expect(await insertCheckpoint(client, {})).toBe(1);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("UPDATE checkpoints SET is_active = FALSE");
  });
});

describe("getCurrentEpoch", () => {
  it("returns 0 for null", async () => { expect(await getCurrentEpoch(mc([{ e: null }]))).toBe(0); });
  it("returns value", async () => { expect(await getCurrentEpoch(mc([{ e: 5 }]))).toBe(5); });
});

describe("incrementEpoch", () => {
  it("inserts epoch-sentinel with newEpoch = prev + 1", async () => {
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ e: 2 }] }).mockResolvedValueOnce({ rows: [] }),
    } as unknown as PoolClient;
    expect(await incrementEpoch(client)).toBe(3);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain("epoch-sentinel");
  });
});

describe("insertArchive", () => {
  it("inserts and returns id", async () => {
    const client = mc([{ id: 10 }]);
    expect(await insertArchive(client, { original_memory_id: 5, content: "old" }, vi.fn().mockReturnValue(null))).toBe(10);
  });
});

describe("initEngramSlots", () => {
  it("no-ops when existing >= numSlots", async () => {
    const client = mc([{ c: 10 }]);
    await initEngramSlots(client, 5);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("countMemoriesInSlot", () => {
  it("uses AND id != excludeId when provided", async () => {
    const client = mc([{ c: 3 }]);
    await countMemoriesInSlot(client, 0, 7);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("AND id != $2");
  });
  it("omits exclusion when excludeId is null", async () => {
    const client = mc([{ c: 5 }]);
    await countMemoriesInSlot(client, 0);
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toContain("id !=");
  });
});

describe("insertSchema", () => {
  it("inserts and returns id", async () => {
    expect(await insertSchema(mc([{ id: 20 }]), { schema_id: "abc" })).toBe(20);
  });
  it("falls through to update on error code 23505", async () => {
    const err = Object.assign(new Error("unique"), { code: "23505" });
    const client = {
      query: vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 5 }] }),
    } as unknown as PoolClient;
    expect(await insertSchema(client, { schema_id: "abc" })).toBe(5);
  });
});

describe("deleteSchema", () => {
  it("returns true when deleted", async () => { expect(await deleteSchema(mc([], 1), "abc")).toBe(true); });
  it("returns false when not found", async () => { expect(await deleteSchema(mc([], 0), "abc")).toBe(false); });
});
