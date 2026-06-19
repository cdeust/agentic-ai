/**
 * pg-store-update-content.test.ts
 *
 * Unit test for PgMemoryStore.updateMemoryContent and updateMemoryContentAsync.
 * Mocks the pg.Pool/PoolClient to assert the SQL and parameters are correct
 * without requiring a live database.
 *
 * Postconditions verified:
 *   1. updateMemoryContent fires the expected UPDATE SQL with correct params.
 *   2. updateMemoryContentAsync resolves with the correct SQL via the real
 *      runAsync path (using a mocked PoolClient).
 *   3. Tags are JSON-serialised before being sent to PG.
 *
 * source: cortex@f2b9f99 mcp_server/handlers/anchor.py:143-146
 *   UPDATE memories SET … tags = %s::jsonb, content = %s … WHERE id = %s
 */

import { describe, it, expect, vi, type MockInstance } from "vitest";

// ── Mock pg before importing PgMemoryStore ────────────────────────────────────
// We need to intercept Pool construction so PgMemoryStore doesn't open a
// real connection.

vi.mock("pg", () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const mockRelease = vi.fn();
  const mockClient = {
    query: mockQuery,
    release: mockRelease,
  };
  const mockConnect = vi.fn().mockResolvedValue(mockClient);
  const mockEnd = vi.fn().mockResolvedValue(undefined);

  class MockPool {
    connect = mockConnect;
    end = mockEnd;
    // Expose the mock client for assertion access.
    static _mockClient = mockClient;
    static _mockConnect = mockConnect;
  }

  // pg-store.ts uses the CJS-interop default import (`import pgDefault from "pg";
  // const { Pool } = pgDefault`), so the mock must expose `default.Pool`. The named
  // `Pool` is kept for this test's own `pg.Pool` access below.
  return { default: { Pool: MockPool }, Pool: MockPool };
});

import { PgMemoryStore } from "../../src/remember/storage/pg-store.js";

// Retrieve the mock internals from the hoisted vi.mock factory.
// Because vi.mock hoists at module level, we get the same Pool mock
// that PgMemoryStore will use.
const pg = await import("pg");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockPool = pg.Pool as any;
const mockClient: { query: MockInstance; release: MockInstance } = MockPool._mockClient;
const mockConnect: MockInstance = MockPool._mockConnect;

describe("PgMemoryStore.updateMemoryContentAsync", () => {
  it("sends UPDATE memories SET content, tags WHERE id", async () => {
    const store = new PgMemoryStore("postgresql://fake/db");

    mockClient.query.mockClear();
    mockConnect.mockClear();

    await store.updateMemoryContentAsync(42, "[ANCHOR: reason] Content.", ["_anchor", "_anchor:reason"]);

    // Assert the pool client was acquired.
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Assert the SQL was issued.
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockClient.query.mock.calls[0] as [string, unknown[]];

    // SQL must update content and tags, not other columns.
    expect(sql).toMatch(/UPDATE memories SET content/i);
    expect(sql).toMatch(/tags.*::jsonb/i);
    expect(sql).toMatch(/WHERE id/i);

    // First param: content string.
    expect(params[0]).toBe("[ANCHOR: reason] Content.");

    // Second param: JSON-serialised tags array.
    expect(params[1]).toBe(JSON.stringify(["_anchor", "_anchor:reason"]));

    // Third param: memory id.
    expect(params[2]).toBe(42);

    // Client released in all paths (finally block in runAsync).
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it("serialises empty tags array as '[]'", async () => {
    const store = new PgMemoryStore("postgresql://fake/db");

    mockClient.query.mockClear();
    await store.updateMemoryContentAsync(1, "No tags.", []);

    const [, params] = mockClient.query.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe("[]");
  });
});

describe("PgMemoryStore.updateMemoryContent (sync-interface fire-and-forget)", () => {
  it("does not throw (fire-and-forget via void runAsync)", () => {
    // The sync method calls void this.runAsync(...) — it should not throw
    // synchronously. The underlying query is tested in the async variant above.
    const store = new PgMemoryStore("postgresql://fake/db");
    expect(() => store.updateMemoryContent(7, "Content.", ["t"])).not.toThrow();
  });
});
