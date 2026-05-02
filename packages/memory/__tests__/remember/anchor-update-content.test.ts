/**
 * anchor-update-content.test.ts
 *
 * Integration tests for the anchor handler's updateMemoryContent wiring.
 * Uses SqliteMemoryStore in-memory.
 *
 * Postconditions verified:
 *   1. anchor() writes the [ANCHOR: reason] prefix to content via updateMemoryContent.
 *   2. anchor() writes the _anchor and _anchor:<reason> tags via updateMemoryContent.
 *   3. Re-anchoring does not double-prefix the content.
 *   4. updateMemoryContent in SqliteMemoryStore writes content + tags atomically.
 *   5. updateMemoryContent leaves other fields unchanged.
 *
 * source: cortex@f2b9f99 mcp_server/handlers/anchor.py:141-156
 */

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { anchor } from "../../src/remember/handlers/anchor.js";
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

describe("anchor handler — updateMemoryContent wiring", () => {
  it("persists [ANCHOR: reason] prefix to content", () => {
    const r = remember({ content: "Load-bearing decision.", force: true }, store);
    expect(r.memory_id).toBeDefined();
    const memoryId = r.memory_id as number;

    anchor({ memory_id: memoryId, reason: "Architecture decision" }, store);

    const mem = store.getMemory(memoryId);
    expect(mem).not.toBeNull();
    if (mem !== null) {
      expect(mem.content).toMatch(/^\[ANCHOR: Architecture decision\]/);
    }
  });

  it("persists _anchor tag to the row", () => {
    const r = remember({ content: "Critical fact.", force: true }, store);
    const memoryId = r.memory_id as number;

    anchor({ memory_id: memoryId, reason: "Critical" }, store);

    const mem = store.getMemory(memoryId);
    expect(mem).not.toBeNull();
    if (mem !== null) {
      expect(mem.tags).toContain("_anchor");
    }
  });

  it("persists _anchor:<reason> tag to the row", () => {
    const r = remember({ content: "Invariant.", force: true }, store);
    const memoryId = r.memory_id as number;

    anchor({ memory_id: memoryId, reason: "InvariantReason" }, store);

    const mem = store.getMemory(memoryId);
    if (mem !== null) {
      expect(mem.tags.some((t) => t.startsWith("_anchor:InvariantReason"))).toBe(true);
    }
  });

  it("does not prefix content twice on re-anchor", () => {
    const r = remember({ content: "Fact.", force: true }, store);
    const memoryId = r.memory_id as number;

    anchor({ memory_id: memoryId, reason: "First" }, store);
    anchor({ memory_id: memoryId, reason: "First" }, store);

    const mem = store.getMemory(memoryId);
    if (mem !== null) {
      // buildAnchorContent skips the prefix if content already starts with [ANCHOR:
      const prefixCount = (mem.content.match(/\[ANCHOR:/gu) ?? []).length;
      expect(prefixCount).toBe(1);
    }
  });
});

describe("SqliteMemoryStore.updateMemoryContent", () => {
  it("updates content and tags atomically", () => {
    const memId = store.insertMemory({ content: "Original.", tags: ["old"] });

    store.updateMemoryContent(memId, "[ANCHOR: reason] Original.", ["old", "_anchor", "_anchor:reason"]);

    const mem = store.getMemory(memId);
    expect(mem).not.toBeNull();
    if (mem !== null) {
      expect(mem.content).toBe("[ANCHOR: reason] Original.");
      expect(mem.tags).toContain("_anchor");
      expect(mem.tags).toContain("old");
    }
  });

  it("overwrites existing tags completely", () => {
    const memId = store.insertMemory({ content: "Fact.", tags: ["tag1", "tag2"] });

    store.updateMemoryContent(memId, "Updated fact.", ["new-tag"]);

    const mem = store.getMemory(memId);
    if (mem !== null) {
      expect(mem.tags).toEqual(["new-tag"]);
    }
  });

  it("is a no-op for non-existent id (does not throw)", () => {
    expect(() => store.updateMemoryContent(99999, "content", [])).not.toThrow();
  });

  it("does not modify importance or is_protected", () => {
    const memId = store.insertMemory({
      content: "Preserve fields.",
      importance: 0.8,
      is_protected: false,
    });

    store.updateMemoryContent(memId, "New content.", ["t"]);

    const mem = store.getMemory(memId);
    if (mem !== null) {
      expect(mem.importance).toBeCloseTo(0.8, 3);
      expect(mem.is_protected).toBe(false);
    }
  });
});
