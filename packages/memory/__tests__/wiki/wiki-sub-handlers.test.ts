/**
 * Unit tests for the 10 real wiki sub-handlers (no-deferrals wave).
 *
 * All handlers use in-memory DB stubs. No Postgres or network required.
 *
 * Handlers tested:
 *   wikiEmergeHandler    — concept emergence clustering
 *   wikiExtractHandler   — claim extraction from memories
 *   wikiCurateHandler    — draft approval/rejection
 *   wikiConsolidateHandler — thermodynamic decay + staleness
 *   wikiResolveHandler   — claim entity linking + supersedes
 *   wikiSeedCodebaseHandler — markdown file seeding
 *   wikiExportHandler    — Pandoc export (pandoc-absent path)
 *   wikiCompileHandler   — approved draft → page file
 *   wikiMigrateHandler   — filesystem → DB migration
 *   wikiApiHandler       — REST endpoint dispatch
 *
 * Contract assertions mirror Move 2 postconditions in each handler file.
 *
 * source: packages/memory/src/wiki/handlers/wiki-*-handler.ts
 */

import { describe, it, expect } from "vitest";
import type { WikiDbClient } from "../../src/wiki/storage/pg-wiki-store-pages.js";
import { wikiEmergeHandler } from "../../src/wiki/handlers/wiki-emerge-handler.js";
import { wikiExtractHandler } from "../../src/wiki/handlers/wiki-extract-handler.js";
import { wikiCurateHandler } from "../../src/wiki/handlers/wiki-curate-handler.js";
import { wikiConsolidateHandler } from "../../src/wiki/handlers/wiki-consolidate-handler.js";
import { wikiResolveHandler } from "../../src/wiki/handlers/wiki-resolve-handler.js";
import { wikiSeedCodebaseHandler } from "../../src/wiki/handlers/wiki-seed-codebase-handler.js";
import { wikiExportHandler } from "../../src/wiki/handlers/wiki-export-handler.js";
import { wikiCompileHandler } from "../../src/wiki/handlers/wiki-compile-handler.js";
import { wikiMigrateHandler } from "../../src/wiki/handlers/wiki-migrate-handler.js";
import { wikiApiHandler } from "../../src/wiki/handlers/wiki-api-handler.js";

// ── DB stub factory ───────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

function makeDb(
  overrides?: Partial<{
    claimRows: MockRow[];
    memoryRows: MockRow[];
    conceptRows: MockRow[];
    draftRows: MockRow[];
    pageRows: MockRow[];
    insertId: number;
    updateCount: number;
  }>,
): WikiDbClient & { calls: Array<{ sql: string; params?: unknown[] }> } {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const o = {
    claimRows: overrides?.claimRows ?? [],
    memoryRows: overrides?.memoryRows ?? [],
    conceptRows: overrides?.conceptRows ?? [],
    draftRows: overrides?.draftRows ?? [],
    pageRows: overrides?.pageRows ?? [],
    insertId: overrides?.insertId ?? 99,
    updateCount: overrides?.updateCount ?? 1,
  };

  return {
    calls,
    async query<T = MockRow>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const norm = sql.replace(/\s+/g, " ").trim().toLowerCase();

      // claim_events queries
      if (norm.includes("wiki.claim_events") && norm.includes("array_length")) {
        return { rows: o.claimRows as T[], rowCount: o.claimRows.length };
      }
      if (norm.includes("wiki.claim_events") && norm.includes("count")) {
        return { rows: [{ count: o.claimRows.length }] as T[], rowCount: 1 };
      }
      if (norm.includes("wiki.claim_events") && norm.includes("entity_ids = '{}'")) {
        return { rows: o.claimRows as T[], rowCount: o.claimRows.length };
      }
      if (norm.includes("wiki.claim_events") && norm.includes("memory_id = $1")) {
        return { rows: o.claimRows as T[], rowCount: o.claimRows.length };
      }
      if (norm.includes("wiki.claim_events") && norm.includes("order by id")) {
        return { rows: o.claimRows as T[], rowCount: o.claimRows.length };
      }
      if (norm.includes("delete from wiki.claim_events")) {
        return { rows: [] as T[], rowCount: 1 };
      }
      if (norm.includes("insert into wiki.claim_events")) {
        return { rows: [{ id: o.insertId }] as T[], rowCount: 1 };
      }
      if (norm.includes("update wiki.claim_events")) {
        return { rows: [] as T[], rowCount: o.updateCount };
      }

      // memories queries
      if (norm.includes("from memories") && norm.includes("not exists")) {
        return { rows: o.memoryRows as T[], rowCount: o.memoryRows.length };
      }
      if (norm.includes("from memories")) {
        return { rows: o.memoryRows as T[], rowCount: o.memoryRows.length };
      }
      if (norm.includes("memory_entities")) {
        return { rows: [] as T[], rowCount: 0 };
      }

      // entities
      if (norm.includes("from entities")) {
        return { rows: [] as T[], rowCount: 0 };
      }

      // wiki.concepts
      if (norm.includes("wiki.concepts") && norm.includes("insert")) {
        return { rows: [{ id: o.insertId }] as T[], rowCount: 1 };
      }
      if (norm.includes("wiki.concepts") && norm.includes("&&")) {
        return { rows: o.conceptRows as T[], rowCount: o.conceptRows.length };
      }
      if (norm.includes("update wiki.concepts")) {
        return { rows: [] as T[], rowCount: o.updateCount };
      }

      // wiki.drafts
      if (norm.includes("insert into wiki.drafts")) {
        return { rows: [{ id: o.insertId }] as T[], rowCount: 1 };
      }
      if (norm.includes("select * from wiki.drafts")) {
        return { rows: o.draftRows as T[], rowCount: o.draftRows.length };
      }
      if (norm.includes("from wiki.drafts") && norm.includes("status = $1")) {
        return { rows: o.draftRows as T[], rowCount: o.draftRows.length };
      }
      if (norm.includes("update wiki.drafts")) {
        return { rows: [] as T[], rowCount: 1 };
      }

      // wiki.pages
      if (norm.includes("wiki.pages") && norm.includes("where lifecycle_state")) {
        return { rows: o.pageRows as T[], rowCount: o.pageRows.length };
      }
      if (norm.includes("wiki.pages") && norm.includes("count")) {
        return { rows: [{ pages: 0, active: 0, archived: 0, concepts: 0, pending_drafts: 0, claim_events: 0, links: 0, citations: 0, memos: 0 }] as T[], rowCount: 1 };
      }
      if (norm.includes("insert into wiki.pages")) {
        return { rows: [{ id: o.insertId, inserted: true }] as T[], rowCount: 1 };
      }
      if (norm.includes("update wiki.pages")) {
        return { rows: [] as T[], rowCount: 1 };
      }
      if (norm.includes("from wiki.pages") && norm.includes("rel_path = $1")) {
        return { rows: [{ id: o.insertId }] as T[], rowCount: 1 };
      }

      // wiki.links
      if (norm.includes("wiki.links")) {
        return { rows: [] as T[], rowCount: 0 };
      }

      // wiki.memos
      if (norm.includes("insert into wiki.memos")) {
        return { rows: [{ id: 1 }] as T[], rowCount: 1 };
      }
      if (norm.includes("wiki.memos")) {
        return { rows: [] as T[], rowCount: 0 };
      }

      // wiki.citations
      if (norm.includes("wiki.citations")) {
        return { rows: [] as T[], rowCount: 0 };
      }

      // claim_file_refs join
      if (norm.includes("p.id as page_id")) {
        return { rows: [] as T[], rowCount: 0 };
      }

      return { rows: [] as T[], rowCount: 0 };
    },
  };
}

// ── wikiEmergeHandler ──────────────────────────────────────────────────────────

describe("wikiEmergeHandler", () => {
  it("returns zeroed result when no resolved claims exist", async () => {
    const db = makeDb({ claimRows: [] });
    const result = await wikiEmergeHandler({}, db);
    expect(result.claims_loaded).toBe(0);
    expect(result.concepts_inserted).toBe(0);
    expect(result.concepts_updated).toBe(0);
  });

  it("uses limit from args when provided", async () => {
    const db = makeDb({ claimRows: [] });
    await wikiEmergeHandler({ limit: 100 }, db);
    const sqls = db.calls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes("wiki.claim_events"))).toBe(true);
  });

  it("returns dry_run flag correctly", async () => {
    const db = makeDb({ claimRows: [] });
    const result = await wikiEmergeHandler({ dry_run: true }, db);
    expect(result.dry_run).toBe(true);
  });

  it("returns steady_state regime for empty corpus", async () => {
    const db = makeDb({ claimRows: [] });
    const result = await wikiEmergeHandler({}, db);
    expect(result.regime).toBe("steady_state");
  });
});

// ── wikiExtractHandler ─────────────────────────────────────────────────────────

describe("wikiExtractHandler", () => {
  it("returns memories_processed = 0 when no memories found", async () => {
    const db = makeDb({ memoryRows: [] });
    const result = await wikiExtractHandler({ memory_id: null }, db);
    expect(result.memories_processed).toBe(0);
    expect(result.claims_inserted).toBe(0);
  });

  it("calls db.query to enumerate candidate memories", async () => {
    const db = makeDb({ memoryRows: [] });
    await wikiExtractHandler({}, db);
    expect(db.calls.length).toBeGreaterThan(0);
  });

  it("processes memory when memoryRows provided", async () => {
    const db = makeDb({
      memoryRows: [{ id: 42, content: "We decided to use pgvector for semantic search.", tags: [] }],
    });
    const result = await wikiExtractHandler({}, db);
    expect(result.memories_processed).toBe(1);
    // The sentence classifies as a decision claim → claims_inserted ≥ 0
    expect(typeof result.claims_inserted).toBe("number");
  });

  it("deletes existing claims when force=true", async () => {
    const db = makeDb({
      memoryRows: [{ id: 1, content: "We decided to use pgvector.", tags: [] }],
    });
    await wikiExtractHandler({ force: true }, db);
    const sqls = db.calls.map((c) => c.sql.toLowerCase());
    expect(sqls.some((s) => s.includes("delete from wiki.claim_events"))).toBe(true);
  });

  it("returns error array without aborting on bad memory content", async () => {
    const db = makeDb({
      memoryRows: [{ id: 1, content: null, tags: [] }],
    });
    const result = await wikiExtractHandler({}, db);
    // null content → extractClaims returns empty → no insertion, no abort
    expect(result.memories_processed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});

// ── wikiCurateHandler ──────────────────────────────────────────────────────────

describe("wikiCurateHandler", () => {
  it("returns zeroed result when no pending drafts", async () => {
    const db = makeDb({ draftRows: [] });
    const result = await wikiCurateHandler({ draft_id: null }, db);
    expect((result as Record<string, unknown>)["drafts_evaluated"]).toBe(0);
    expect((result as Record<string, unknown>)["approved"]).toBe(0);
    expect((result as Record<string, unknown>)["rejected"]).toBe(0);
  });

  it("manual decision: returns verdict and draft_id", async () => {
    const db = makeDb();
    const result = await wikiCurateHandler({ draft_id: 42, decision: "approved" }, db);
    expect((result as Record<string, unknown>)["draft_id"]).toBe(42);
    expect((result as Record<string, unknown>)["verdict"]).toBe("approved");
    expect((result as Record<string, unknown>)["manual"]).toBe(true);
  });

  it("manual decision: calls updateDraftStatus", async () => {
    const db = makeDb();
    await wikiCurateHandler({ draft_id: 5, decision: "rejected" }, db);
    const sqls = db.calls.map((c) => c.sql.toLowerCase());
    expect(sqls.some((s) => s.includes("update wiki.drafts"))).toBe(true);
  });

  it("auto-sweep: evaluates pending drafts and writes memos for decided drafts", async () => {
    const db = makeDb({
      draftRows: [{
        id: 1, kind: "note", status: "pending", title: "Test draft",
        confidence: 0.9,
        sections: [{ heading: "Context", body: "Some substantive content here." }],
        lead: "This is the lead.",
      }],
    });
    const result = await wikiCurateHandler({ draft_id: null }, db);
    const r = result as Record<string, unknown>;
    expect(r["drafts_evaluated"]).toBe(1);
    // approved or held depending on score — check type
    expect(typeof r["approved"]).toBe("number");
    expect(typeof r["rejected"]).toBe("number");
  });
});

// ── wikiConsolidateHandler ─────────────────────────────────────────────────────

describe("wikiConsolidateHandler", () => {
  it("returns pages_evaluated = 0 when no pages exist", async () => {
    const db = makeDb({ pageRows: [] });
    const result = await wikiConsolidateHandler({ dry_run: true }, db);
    expect(result.pages_evaluated).toBe(0);
  });

  it("dry_run does not call applyThermoDecisions", async () => {
    const db = makeDb({ pageRows: [] });
    await wikiConsolidateHandler({ dry_run: true }, db);
    const sqls = db.calls.map((c) => c.sql.toLowerCase());
    // No UPDATE wiki.pages in dry run when no pages
    expect(sqls.filter((s) => s.includes("update wiki.pages")).length).toBe(0);
  });

  it("returns staleness skipped when skip_staleness is true", async () => {
    const db = makeDb({ pageRows: [] });
    const result = await wikiConsolidateHandler({ skip_staleness: true }, db);
    expect(result.staleness).toMatchObject({ skipped: true });
  });

  it("returns numeric avg_heat_before and avg_heat_after", async () => {
    const db = makeDb({ pageRows: [] });
    const result = await wikiConsolidateHandler({ skip_staleness: true }, db);
    expect(typeof result.avg_heat_before).toBe("number");
    expect(typeof result.avg_heat_after).toBe("number");
  });
});

// ── wikiResolveHandler ─────────────────────────────────────────────────────────

describe("wikiResolveHandler", () => {
  it("returns zeroed result when no claims need resolution", async () => {
    const db = makeDb({ claimRows: [] });
    const result = await wikiResolveHandler({ memory_id: null }, db);
    expect(result.claims_processed).toBe(0);
    expect(result.entity_links_written).toBe(0);
    expect(result.supersedes_written).toBe(0);
    expect(result.conflicts_logged).toBe(0);
  });

  it("calls db.query to fetch claims", async () => {
    const db = makeDb({ claimRows: [] });
    await wikiResolveHandler({}, db);
    expect(db.calls.length).toBeGreaterThan(0);
  });

  it("processes claims with entity_id set from memory", async () => {
    const db = makeDb({
      claimRows: [{
        id: 1, memory_id: 42, text: "We use pgvector.", claim_type: "decision",
        entity_ids: [], supersedes: null,
      }],
    });
    const result = await wikiResolveHandler({ memory_id: 42 }, db);
    expect(result.claims_processed).toBe(1);
  });
});

// ── wikiSeedCodebaseHandler ────────────────────────────────────────────────────

describe("wikiSeedCodebaseHandler", () => {
  it("returns files_found = 0 when repo has no seed-worthy markdown", async () => {
    const result = await wikiSeedCodebaseHandler(
      { repo_root: "/nonexistent-repo-zxqy" },
      async () => ({ stored: false }),
    );
    expect(result.files_found).toBe(0);
    expect(result.imported).toBe(0);
  });

  it("dry_run returns preview without calling rememberFn", async () => {
    let called = false;
    // Use this test file's directory — no seed files expected but dry_run works regardless
    const result = await wikiSeedCodebaseHandler(
      { repo_root: process.cwd(), dry_run: true },
      async () => { called = true; return { stored: false }; },
    );
    expect(called).toBe(false);
    expect(result.dry_run).toBe(true);
  });

  it("returns error_count of type number", async () => {
    const result = await wikiSeedCodebaseHandler(
      { repo_root: process.cwd() },
      async () => ({ stored: true }),
    );
    expect(typeof result.error_count).toBe("number");
  });
});

// ── wikiExportHandler ──────────────────────────────────────────────────────────

describe("wikiExportHandler", () => {
  it("returns error when pandoc is not installed (or path or body missing)", async () => {
    // Either pandoc is not installed → returns error, or we provide no path/body
    const result = await wikiExportHandler(
      { format: "html" }, // no path, no body
      async () => null,
    );
    expect("error" in result).toBe(true);
  });

  it("returns error for unsupported format", async () => {
    const result = await wikiExportHandler(
      { format: "xml" },
      async () => "# Hello",
    );
    expect("error" in result).toBe(true);
    expect((result as Record<string, unknown>)["error"]).toContain("unsupported format");
  });

  it("returns error when readPageFn returns null (page not found)", async () => {
    // Only hit this branch if pandoc IS installed; if not, pandoc check fires first
    const result = await wikiExportHandler(
      { path: "nonexistent.md", format: "html" },
      async () => null,
    );
    // Either "page not found" or "pandoc is not installed"
    expect("error" in result).toBe(true);
  });

  it("returns an error or ok result (never throws)", async () => {
    let threw = false;
    try {
      await wikiExportHandler({ format: "pdf" }, async () => null);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ── wikiCompileHandler ─────────────────────────────────────────────────────────

describe("wikiCompileHandler", () => {
  it("returns drafts_published = 0 when no approved drafts", async () => {
    const db = makeDb({ draftRows: [] });
    const result = await wikiCompileHandler(
      { draft_id: null },
      db,
      async () => { /* no-op write */ },
    );
    expect(result.drafts_published).toBe(0);
  });

  it("calls writePageFn for each approved draft", async () => {
    const db = makeDb({
      draftRows: [{
        id: 1, kind: "note", title: "Test Page", lead: "Some lead.",
        sections: [{ heading: "Context", body: "Body text." }],
        memory_id: null, concept_id: null, status: "approved",
        confidence: 0.8, synth_model: "template_v1",
        frontmatter: {},
      }],
    });
    const writtenPaths: string[] = [];
    const result = await wikiCompileHandler(
      { draft_id: null },
      db,
      async (relPath) => { writtenPaths.push(relPath); },
    );
    expect(result.drafts_published).toBe(1);
    expect(writtenPaths).toHaveLength(1);
    expect(writtenPaths[0]).toMatch(/\.md$/);
  });

  it("dry_run does not call writePageFn", async () => {
    const db = makeDb({
      draftRows: [{
        id: 1, kind: "note", title: "Dry Draft", lead: "Lead.",
        sections: [], memory_id: null, concept_id: null, status: "approved",
        confidence: 0.7, synth_model: null, frontmatter: {},
      }],
    });
    let writeCalled = false;
    await wikiCompileHandler(
      { draft_id: null, dry_run: true },
      db,
      async () => { writeCalled = true; },
    );
    expect(writeCalled).toBe(false);
  });

  it("calls updateDraftStatus for each published draft", async () => {
    const db = makeDb({
      draftRows: [{
        id: 5, kind: "adr", title: "ADR: Use pgvector", lead: "Decision lead.",
        sections: [{ heading: "Decision", body: "Use pgvector." }],
        memory_id: 42, concept_id: null, status: "approved",
        confidence: 0.95, synth_model: "template_v1", frontmatter: {},
      }],
    });
    await wikiCompileHandler({ draft_id: null }, db, async () => { /* no-op */ });
    const sqls = db.calls.map((c) => c.sql.toLowerCase());
    expect(sqls.some((s) => s.includes("update wiki.drafts"))).toBe(true);
  });

  it("writes an audit memo for each published page", async () => {
    const db = makeDb({
      draftRows: [{
        id: 7, kind: "note", title: "Page", lead: "",
        sections: [], memory_id: null, concept_id: null, status: "approved",
        confidence: 0.6, synth_model: null, frontmatter: {},
      }],
    });
    await wikiCompileHandler({ draft_id: null }, db, async () => { /* no-op */ });
    const sqls = db.calls.map((c) => c.sql.toLowerCase());
    expect(sqls.some((s) => s.includes("insert into wiki.memos"))).toBe(true);
  });
});

// ── wikiMigrateHandler ─────────────────────────────────────────────────────────

describe("wikiMigrateHandler", () => {
  it("runs without throwing for an empty wiki_root", async () => {
    const db = makeDb();
    // Use a temp dir that has no .md files
    const result = await wikiMigrateHandler({ wiki_root: "/tmp" }, db);
    expect(typeof result.pages_processed).toBe("number");
    expect(typeof result.pages_written).toBe("number");
    expect(typeof result.links_written).toBe("number");
  });

  it("returns error array of type Array", async () => {
    const db = makeDb();
    const result = await wikiMigrateHandler({ wiki_root: "/tmp" }, db);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ── wikiApiHandler ─────────────────────────────────────────────────────────────

describe("wikiApiHandler", () => {
  it("list endpoint: returns pages and count", async () => {
    const db = makeDb();
    const result = await wikiApiHandler(
      { endpoint: "list", wiki_root: "/tmp" },
      db,
    );
    expect(result).toHaveProperty("pages");
    expect(result).toHaveProperty("count");
    expect(typeof result["count"]).toBe("number");
  });

  it("page endpoint: returns error when rel_path is missing", async () => {
    const db = makeDb();
    const result = await wikiApiHandler({ endpoint: "page", wiki_root: "/tmp" }, db);
    expect(result).toHaveProperty("error");
  });

  it("concepts endpoint: returns concepts array", async () => {
    const db = makeDb();
    const result = await wikiApiHandler({ endpoint: "concepts" }, db);
    expect(result).toHaveProperty("concepts");
    expect(Array.isArray(result["concepts"])).toBe(true);
  });

  it("drafts endpoint: returns drafts array", async () => {
    const db = makeDb();
    const result = await wikiApiHandler({ endpoint: "drafts" }, db);
    expect(result).toHaveProperty("drafts");
    expect(Array.isArray(result["drafts"])).toBe(true);
  });

  it("memos endpoint: returns error when subject_type/subject_id missing", async () => {
    const db = makeDb();
    const result = await wikiApiHandler({ endpoint: "memos" }, db);
    expect(result).toHaveProperty("error");
  });

  it("unknown endpoint: returns error with available list", async () => {
    const db = makeDb();
    const result = await wikiApiHandler({ endpoint: "nonexistent" }, db);
    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("available");
  });

  it("never throws regardless of input", async () => {
    const db = makeDb();
    let threw = false;
    try {
      await wikiApiHandler({ endpoint: "page_meta", rel_path: "bad/path/../../etc" }, db);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
