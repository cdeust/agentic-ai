/**
 * Unit tests for memories-page.ts
 * source: cortex@ed33435 mcp_server/handlers/memories_page.py
 */

import { describe, it, expect } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  rowToNode,
  buildQuery,
  serveMemoriesPage,
} from "../../src/recall/handlers/memories-page.js";

// ── Cursor codec ──────────────────────────────────────────────────────────

describe("encodeCursor / decodeCursor", () => {
  it("round-trips a cursor payload", () => {
    const payload = { k: 0.85, id: 42 };
    const encoded = encodeCursor(payload);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(payload);
  });

  it("decodeCursor returns null for empty input", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("decodeCursor returns null for invalid input", () => {
    expect(decodeCursor("not-valid-base64!")).toBeNull();
  });
});

// ── rowToNode ─────────────────────────────────────────────────────────────

describe("rowToNode", () => {
  it("maps heat_base → heat", () => {
    const row = { id: 1, heat_base: 0.75, content: "test", domain: "cortex" };
    const node = rowToNode(row as Record<string, unknown>);
    expect(node.heat).toBe(0.75);
    expect(node.id).toBe("memory:1");
  });

  it("sets emotion=satisfaction for high positive valence", () => {
    const row = { id: 1, emotional_valence: 0.8, importance: 0.5 };
    const node = rowToNode(row as Record<string, unknown>);
    expect(node.emotion).toBe("satisfaction");
  });

  it("sets emotion=urgency when importance >= 0.75", () => {
    const row = { id: 1, emotional_valence: -0.9, importance: 0.8 };
    const node = rowToNode(row as Record<string, unknown>);
    expect(node.emotion).toBe("urgency");
  });

  it("defaults consolidation_stage to labile", () => {
    const node = rowToNode({ id: 1 } as Record<string, unknown>);
    expect(node.stage).toBe("labile");
    expect(node.consolidation_stage).toBe("labile");
  });
});

// ── buildQuery ─────────────────────────────────────────────────────────────

describe("buildQuery", () => {
  it("includes NOT is_stale base condition", () => {
    const q = buildQuery({
      sort: "heat",
      hasCursor: false,
      hasDomain: false,
      hasStage: false,
      hasSearch: false,
      hasMinHeat: false,
      hasEmotion: false,
      protectedOnly: false,
      globalOnly: false,
      includeGlobal: false,
    });
    expect(q).toContain("NOT is_stale");
  });

  it("adds domain filter when hasDomain=true", () => {
    const q = buildQuery({
      sort: "heat",
      hasCursor: false,
      hasDomain: true,
      hasStage: false,
      hasSearch: false,
      hasMinHeat: false,
      hasEmotion: false,
      protectedOnly: false,
      globalOnly: false,
      includeGlobal: false,
    });
    expect(q).toContain("domain");
  });
});

// ── serveMemoriesPage ─────────────────────────────────────────────────────

describe("serveMemoriesPage", () => {
  it("returns empty page when store returns no rows", () => {
    const result = serveMemoriesPage({ sort: "heat" }, (_sql, _params) => []);
    expect(result.items).toEqual([]);
    expect(result.next_cursor).toBeNull();
    expect(result.page_count).toBe(0);
    expect(result.sort).toBe("heat");
  });

  it("sets next_cursor when there are more items than limit", () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: i + 1,
      heat_base: 0.5,
      content: `mem${i}`,
      domain: "test",
    }));
    const result = serveMemoriesPage(
      { limit: 50, sort: "heat" },
      (_sql, _params) => rows as Record<string, unknown>[],
    );
    expect(result.page_count).toBe(50);
    expect(result.next_cursor).not.toBeNull();
  });
});
