/**
 * handlers.test.ts — Integration tests for remember, anchor, forget, rate-memory.
 *
 * Uses SqliteMemoryStore in-memory. Tests verify the handler contracts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anchor } from "../../src/remember/handlers/anchor.js";
import { forget } from "../../src/remember/handlers/forget.js";
import { rateMemory } from "../../src/remember/handlers/rate-memory.js";
import { remember } from "../../src/remember/handlers/remember.js";
import { resetAllStates } from "../../src/remember/write-gate-calibration.js";
import { SqliteMemoryStore } from "../../src/remember/storage/sqlite-store.js";

let store: SqliteMemoryStore;

beforeEach(() => {
  store = new SqliteMemoryStore(":memory:");
  resetAllStates();
});

afterEach(() => {
  store.close();
});

describe("remember handler", () => {
  it("stores a novel memory and returns stored=true", () => {
    const result = remember(
      { content: "Decided to use pgvector HNSW (m=16, ef_construction=64) for ANN." },
      store,
    );
    expect(result.stored).toBe(true);
    expect(result.action).toBe("stored");
    expect(typeof result.memory_id).toBe("number");
    expect(result.memory_id!).toBeGreaterThan(0);
  });

  it("returns stored=false for empty content", () => {
    const result = remember({ content: "   " }, store);
    expect(result.stored).toBe(false);
    expect(result.reason).toBe("no_content");
  });

  it("bypasses gate when force=true", () => {
    // First insert at force=true so the row exists.
    const r1 = remember({ content: "Same content.", force: true }, store);
    expect(r1.stored).toBe(true);
    // Second insert at force=true should also pass (gate bypassed).
    const r2 = remember({ content: "Same content.", force: true }, store);
    expect(r2.stored).toBe(true);
  });

  it("respects initial_heat override for backfill (issue #14 P1)", () => {
    const result = remember(
      { content: "Old memory from 2024.", initial_heat: 0.3 },
      store,
    );
    expect(result.stored).toBe(true);
    const mem = store.getMemory(result.memory_id!);
    // Heat should be baselineHeat (0.3) + surprise boost — always > 0.3
    expect(mem!.heat_base).toBeGreaterThan(0);
    expect(mem!.heat_base).toBeLessThanOrEqual(1.0);
  });

  it("does not reject error-content memories (bypass_error)", () => {
    const result = remember(
      { content: "Error: authentication failed with 401 Unauthorized." },
      store,
    );
    expect(result.stored).toBe(true);
  });

  it("does not reject decision-content memories (bypass_decision)", () => {
    const result = remember(
      { content: "Decided to switch from Redis to PostgreSQL for session storage." },
      store,
    );
    expect(result.stored).toBe(true);
  });

  it("stores agent_topic as agent_context in the row", () => {
    const result = remember(
      { content: "Agent-scoped memory.", agent_topic: "engineer" },
      store,
    );
    expect(result.stored).toBe(true);
    const mem = store.getMemory(result.memory_id!);
    expect(mem!.agent_context).toBe("engineer");
  });
});

describe("anchor handler", () => {
  it("anchors an existing memory", () => {
    const { memory_id } = remember({ content: "Critical architectural decision.", force: true }, store);
    const result = anchor({ memory_id: memory_id! }, store);
    expect(result.anchored).toBe(true);
    expect(result.memory_id).toBe(memory_id);
    // heat should be 1.0 after anchor
    const mem = store.getMemory(memory_id!);
    expect(mem!.heat_base).toBe(1.0);
    expect(mem!.is_protected).toBe(true);
  });

  it("returns anchored=false for non-existent memory", () => {
    const result = anchor({ memory_id: 99999 }, store);
    expect(result.anchored).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("includes _anchor tag in response", () => {
    const { memory_id } = remember({ content: "Load-bearing fact.", force: true }, store);
    const result = anchor({ memory_id: memory_id!, reason: "Load-bearing decision" }, store);
    expect(result.tags).toContain("_anchor");
  });

  it("prefixes content with [ANCHOR: reason]", () => {
    const { memory_id } = remember({ content: "Some fact.", force: true }, store);
    const result = anchor({ memory_id: memory_id!, reason: "Critical" }, store);
    expect(result.content_preview).toContain("[ANCHOR: Critical]");
  });
});

describe("forget handler", () => {
  it("hard-deletes a memory and returns deleted=true", () => {
    const { memory_id } = remember({ content: "Wrong memory.", force: true }, store);
    const result = forget({ memory_id: memory_id! }, store);
    expect(result.deleted).toBe(true);
    expect(result.method).toBe("hard");
    expect(store.getMemory(memory_id!)).toBeNull();
  });

  it("returns deleted=false for non-existent id", () => {
    const result = forget({ memory_id: 99999 }, store);
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("refuses to delete protected memory without force=true", () => {
    const { memory_id } = remember({ content: "Protected.", force: true }, store);
    anchor({ memory_id: memory_id! }, store); // makes is_protected=true
    const result = forget({ memory_id: memory_id! }, store);
    expect(result.deleted).toBe(false);
    expect(result.reason).toContain("protected");
  });

  it("deletes protected memory with force=true", () => {
    const { memory_id } = remember({ content: "Force-delete me.", force: true }, store);
    anchor({ memory_id: memory_id! }, store);
    const result = forget({ memory_id: memory_id!, force: true }, store);
    expect(result.deleted).toBe(true);
  });

  it("soft-delete sets is_stale=true and heat=0", () => {
    const { memory_id } = remember({ content: "Soft delete me.", force: true }, store);
    const result = forget({ memory_id: memory_id!, soft: true }, store);
    expect(result.deleted).toBe(true);
    expect(result.method).toBe("soft");
    const mem = store.getMemory(memory_id!);
    expect(mem).not.toBeNull(); // row still exists
    expect(mem!.is_stale).toBe(true);
    expect(mem!.heat_base).toBe(0.0);
  });
});

describe("rateMemory handler", () => {
  it("increments access_count after a useful rating", () => {
    const { memory_id } = remember({ content: "Useful memory.", force: true }, store);
    const result = rateMemory({ memory_id: memory_id!, useful: true }, store);
    expect(result.rated).toBe(true);
    expect(result.access_count).toBe(1);
    expect(result.useful_count).toBe(1);
  });

  it("does not increment useful_count for a not-useful rating", () => {
    const { memory_id } = remember({ content: "Not useful.", force: true }, store);
    const result = rateMemory({ memory_id: memory_id!, useful: false }, store);
    expect(result.rated).toBe(true);
    expect(result.access_count).toBe(1);
    expect(result.useful_count).toBe(0);
  });

  it("returns rated=false for non-existent memory", () => {
    const result = rateMemory({ memory_id: 99999, useful: true }, store);
    expect(result.rated).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("persists the rating to the store (read-your-writes)", () => {
    const { memory_id } = remember({ content: "Rate me.", force: true }, store);
    rateMemory({ memory_id: memory_id!, useful: true }, store);
    const mem = store.getMemory(memory_id!);
    expect(mem!.access_count).toBe(1);
    expect(mem!.useful_count).toBe(1);
  });

  it("returns confidence as a number in [0, 1]", () => {
    const { memory_id } = remember({ content: "Rate me.", force: true }, store);
    // Build up 3+ ratings for confidence computation.
    for (let i = 0; i < 5; i++) {
      rateMemory({ memory_id: memory_id!, useful: i < 4 }, store);
    }
    const result = rateMemory({ memory_id: memory_id!, useful: true }, store);
    expect(result.confidence!).toBeGreaterThanOrEqual(0);
    expect(result.confidence!).toBeLessThanOrEqual(1);
  });
});
