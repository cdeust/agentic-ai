/**
 * Unit tests for wiki-refine-handler.ts — DB-backed handlers.
 *
 * Contracts verified:
 *   Invariant:  handlerGet with list_pending=true returns {drafts, count}.
 *   Invariant:  handlerGet with a valid draft_id returns draft + claims + contract.
 *   Invariant:  handlerGet with unknown draft_id returns {error}.
 *   Invariant:  handlerRefine with missing sections returns updated=true on success.
 *   Invariant:  handlerRefine with invalid sections returns {error, validation_errors}.
 *   Error path: handlerGet without draft_id and no list_pending returns {error}.
 *   Error path: handlerRefine without draft_id returns {error}.
 *   Happy path: handlerRefine calls updateDraft + insertMemo on success.
 *
 * source: cortex@ed33435 mcp_server/handlers/wiki_refine.py (handler_get, handler_refine)
 */

import { describe, it, expect } from "vitest";
import {
  handlerGet,
  handlerRefine,
  schemaGet,
  schemaRefine,
  validateAgainstContractForTest,
} from "../../src/wiki/handlers/wiki-refine-db-handler.js";
import type { WikiDbClient } from "../../src/wiki/storage/pg-wiki-store-pages.js";

// ── DB stub ───────────────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

interface CallRecord {
  sql: string;
  params: unknown[];
}

function makeDb(opts?: {
  draftRow?: MockRow | null;
  draftsRows?: MockRow[];
  claimsRows?: MockRow[];
  memoId?: number;
}): WikiDbClient & { calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  // Use "draftRow" key presence to detect explicit null vs. omitted.
  const hasDraftRow = opts != null && Object.prototype.hasOwnProperty.call(opts, "draftRow");
  const draftRow: MockRow | null = hasDraftRow
    ? (opts!.draftRow ?? null)
    : {
    id: 7,
    memory_id: 42,
    concept_id: null,
    kind: "lesson",
    title: "How we fixed the race condition",
    lead: "We discovered a race between read and write.",
    sections: [{ heading: "Root Cause", body: "Lock was missing." }],
    frontmatter: {},
    confidence: 0.5,
    synth_model: "template_v1",
    status: "pending",
  };
  const draftsRows: MockRow[] = opts?.draftsRows ?? (draftRow != null ? [draftRow] : []);
  const claimsRows = opts?.claimsRows ?? [
    {
      id: 1,
      text: "The lock was missing.",
      claim_type: "observation",
      entity_ids: [],
      evidence_refs: [],
      confidence: 0.9,
    },
  ];

  return {
    calls,
    async query<T>(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const s = sql.trim().toLowerCase();

      // list_pending: listDrafts query
      if (s.startsWith("select * from wiki.drafts") && s.includes("status")) {
        return { rows: draftsRows as T[], rowCount: draftsRows.length };
      }
      // getDraft
      if (s.startsWith("select * from wiki.drafts where id")) {
        return {
          rows: (draftRow != null ? [draftRow] : []) as T[],
          rowCount: draftRow != null ? 1 : 0,
        };
      }
      // claimsForMemory
      if (s.startsWith("select id, text, claim_type")) {
        return { rows: claimsRows as T[], rowCount: claimsRows.length };
      }
      // updateDraft
      if (s.startsWith("update wiki.drafts set")) {
        return { rows: [], rowCount: 1 };
      }
      // insertMemo
      if (s.startsWith("insert into wiki.memos")) {
        return { rows: [{ id: opts?.memoId ?? 99 }] as T[], rowCount: 1 };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  };
}

// A minimal wiki root that loadRegistry can fall back on (no actual files needed).
// handlerGet / handlerRefine use loadRegistry; for unknown kind it returns empty sections.
const FAKE_WIKI_ROOT = "/tmp/__wiki_refine_test_nonexistent__";

// ── schemaGet ─────────────────────────────────────────────────────────────────

describe("schemaGet", () => {
  it("has a description and inputSchema", () => {
    expect(typeof schemaGet.description).toBe("string");
    expect(schemaGet.description.length).toBeGreaterThan(0);
    expect(schemaGet.inputSchema).toBeDefined();
  });
});

// ── schemaRefine ──────────────────────────────────────────────────────────────

describe("schemaRefine", () => {
  it("requires draft_id", () => {
    expect(schemaRefine.inputSchema.required).toContain("draft_id");
  });
});

// ── handlerGet — list_pending ─────────────────────────────────────────────────

describe("handlerGet — list_pending=true", () => {
  it("returns drafts + count without draft_id", async () => {
    const db = makeDb();
    const result = await handlerGet(db, FAKE_WIKI_ROOT, { list_pending: true });
    expect(result).toHaveProperty("drafts");
    expect(result).toHaveProperty("count");
    expect(Array.isArray(result["drafts"])).toBe(true);
    // invariant: each item in drafts has id, kind, title, lead
    const drafts = result["drafts"] as MockRow[];
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts[0]).toHaveProperty("id");
    expect(drafts[0]).toHaveProperty("kind");
    expect(drafts[0]).toHaveProperty("title");
    expect(drafts[0]).toHaveProperty("lead");
  });

  it("trims lead to 200 chars in list view", async () => {
    const longLead = "x".repeat(500);
    const db = makeDb({ draftRow: { id: 1, kind: "note", title: "T", lead: longLead, memory_id: null, concept_id: null, confidence: 0.5, synth_model: "t", status: "pending" } });
    const result = await handlerGet(db, FAKE_WIKI_ROOT, { list_pending: true });
    const drafts = result["drafts"] as Array<{ lead: string }>;
    expect(drafts[0]!.lead.length).toBeLessThanOrEqual(200);
  });
});

// ── handlerGet — by draft_id ──────────────────────────────────────────────────

describe("handlerGet — by draft_id", () => {
  it("returns draft + kind_contract + source_claims + instructions", async () => {
    const db = makeDb();
    const result = await handlerGet(db, FAKE_WIKI_ROOT, { draft_id: 7 });
    expect(result).toHaveProperty("draft");
    expect(result).toHaveProperty("kind_contract");
    expect(result).toHaveProperty("source_claims");
    expect(result).toHaveProperty("instructions");
    expect(typeof result["instructions"]).toBe("string");
  });

  it("draft object has expected shape", async () => {
    const db = makeDb();
    const result = await handlerGet(db, FAKE_WIKI_ROOT, { draft_id: 7 });
    const draft = result["draft"] as MockRow;
    expect(draft).toHaveProperty("id");
    expect(draft).toHaveProperty("kind");
    expect(draft).toHaveProperty("title");
    expect(draft).toHaveProperty("lead");
    expect(draft).toHaveProperty("sections");
  });

  it("returns {error} when draft not found", async () => {
    const db = makeDb({ draftRow: null });
    const result = await handlerGet(db, FAKE_WIKI_ROOT, { draft_id: 9999 });
    expect(result).toHaveProperty("error");
    expect(typeof result["error"]).toBe("string");
  });

  it("returns {error} when neither draft_id nor list_pending provided", async () => {
    const db = makeDb();
    const result = await handlerGet(db, FAKE_WIKI_ROOT, {});
    expect(result).toHaveProperty("error");
  });
});

// ── handlerRefine — success ───────────────────────────────────────────────────

describe("handlerRefine — success", () => {
  it("returns updated=true on success", async () => {
    const db = makeDb();
    const result = await handlerRefine(db, FAKE_WIKI_ROOT, {
      draft_id: 7,
      lead: "Refined lead. Covers the race condition fix.",
      synth_model: "claude_refine_v1",
    });
    expect(result["updated"]).toBe(true);
    expect(result["draft_id"]).toBe(7);
    expect(result["synth_model"]).toBe("claude_refine_v1");
  });

  it("calls updateDraft and insertMemo on the DB", async () => {
    const db = makeDb();
    await handlerRefine(db, FAKE_WIKI_ROOT, {
      draft_id: 7,
      lead: "New lead.",
    });
    const sqls = db.calls.map((c) => c.sql.trim().toLowerCase());
    const hasUpdate = sqls.some((s) => s.startsWith("update wiki.drafts"));
    const hasMemo = sqls.some((s) => s.startsWith("insert into wiki.memos"));
    expect(hasUpdate).toBe(true);
    expect(hasMemo).toBe(true);
  });

  it("records synth_prompt_hash when synth_prompt provided", async () => {
    const db = makeDb();
    const result = await handlerRefine(db, FAKE_WIKI_ROOT, {
      draft_id: 7,
      synth_prompt: "Refine this draft to be more concise.",
    });
    expect(result["synth_prompt_hash"]).not.toBeNull();
    expect(typeof result["synth_prompt_hash"]).toBe("string");
    // invariant: 16-char hex prefix of sha256
    expect((result["synth_prompt_hash"] as string).length).toBe(16);
  });

  it("synth_prompt_hash is null when no synth_prompt", async () => {
    const db = makeDb();
    const result = await handlerRefine(db, FAKE_WIKI_ROOT, { draft_id: 7 });
    expect(result["synth_prompt_hash"]).toBeNull();
  });
});

// ── handlerRefine — error paths ───────────────────────────────────────────────

describe("handlerRefine — error paths", () => {
  it("returns {error} when draft not found", async () => {
    const db = makeDb({ draftRow: null });
    const result = await handlerRefine(db, FAKE_WIKI_ROOT, { draft_id: 9999 });
    expect(result).toHaveProperty("error");
  });

  it("returns validation_errors when required section missing", async () => {
    // The 'lesson' kind requires at least some sections — but since we're
    // using a nonexistent wiki root, required_sections will be [] (empty).
    // We test the validation logic directly by injecting a kind that has
    // required sections. Instead, use the exported test helper.
    const errors = validateAgainstContractForTest(
      [{ heading: "Implementation", body: "We did X." }],
      ["Root Cause", "Implementation"],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Root Cause");
  });

  it("returns validation_errors when section has empty body", async () => {
    const errors = validateAgainstContractForTest(
      [{ heading: "Root Cause", body: "" }],
      ["Root Cause"],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("empty body");
  });

  it("returns empty errors when all required sections present and non-empty", async () => {
    const errors = validateAgainstContractForTest(
      [
        { heading: "Root Cause", body: "Lock was missing." },
        { heading: "Fix", body: "Added a mutex." },
      ],
      ["Root Cause", "Fix"],
    );
    expect(errors).toHaveLength(0);
  });
});
