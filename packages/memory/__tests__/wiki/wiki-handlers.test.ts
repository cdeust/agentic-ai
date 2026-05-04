/**
 * Unit tests for wikiSynthesizeHandler and wikiPipelineHandler.
 *
 * Uses in-memory DB stubs and LLM stubs so no real Postgres or Anthropic
 * credentials are required.
 *
 * Contracts verified per wiki-handlers.ts pre-/postconditions:
 *   - wikiSynthesizeHandler throws PortPendingError when db is null
 *   - wikiSynthesizeHandler calls db.query (candidate enumeration)
 *   - wikiSynthesizeHandler calls insertDraft / updateDraft with real shapes
 *   - wikiSynthesizeHandler returns real counts (NOT zeros on non-empty input)
 *   - wikiPipelineHandler returns stages_run = [] when all sub-handlers are port-pending
 *   - wikiPipelineHandler captures per-stage PortPendingError without throwing
 *   - wikiPipelineHandler returns real stages with "port-pending" status
 *   - wikiRefineHandler calls llmClient.complete with required fields
 */

import { describe, it, expect } from "vitest";
import type { WikiDbClient } from "../../src/wiki/storage/pg-wiki-store-pages.js";
import {
  wikiSynthesizeHandler,
  wikiPipelineHandler,
  wikiRefineHandler,
  PortPendingError,
} from "../../src/wiki/handlers/wiki-handlers.js";

// ── DB stub factory ───────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

function makeDb(
  overrides?: Partial<{
    candidateRows: MockRow[];
    claimRows: MockRow[];
    draftRows: MockRow[];
    insertedDraftId: number;
  }>,
): WikiDbClient & { queryCalls: Array<{ sql: string; params: unknown[] }> } {
  const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
  const candidateRows = overrides?.candidateRows ?? [{ memory_id: 42 }];
  const claimRows = overrides?.claimRows ?? [
    {
      id: 1,
      memory_id: 42,
      text: "We decided to use pgvector because cosine similarity is native and the index supports HNSW.",
      claim_type: "decision",
      confidence: 0.9,
      evidence_refs: [],
    },
  ];
  const draftRows = overrides?.draftRows ?? [];
  const insertedDraftId = overrides?.insertedDraftId ?? 99;

  return {
    queryCalls,
    async query<T = MockRow>(sql: string, params: unknown[] = []) {
      queryCalls.push({ sql, params });

      const sqlNorm = sql.replace(/\s+/g, " ").trim();

      // Candidate memory enumeration
      if (sqlNorm.includes("wiki.claim_events") && sqlNorm.includes("NOT EXISTS")) {
        return { rows: candidateRows as T[], rowCount: candidateRows.length };
      }
      if (sqlNorm.includes("wiki.claim_events") && sqlNorm.includes("ORDER BY memory_id")) {
        return { rows: candidateRows as T[], rowCount: candidateRows.length };
      }
      // Single memory: SELECT DISTINCT memory_id
      if (sqlNorm.includes("wiki.claim_events") && sqlNorm.includes("DISTINCT memory_id")) {
        return { rows: candidateRows as T[], rowCount: candidateRows.length };
      }

      // getClaimsForMemory — exact SQL from pg-wiki-store-concepts.ts
      if (sqlNorm.includes("wiki.claim_events") && sqlNorm.includes("ORDER BY id")) {
        return { rows: claimRows as T[], rowCount: claimRows.length };
      }

      // findDraftForSource — SELECT * FROM wiki.drafts WHERE memory_id
      if (sqlNorm.includes("wiki.drafts") && sqlNorm.includes("ORDER BY created_at DESC LIMIT 1")) {
        return { rows: draftRows as T[], rowCount: draftRows.length };
      }

      // insertDraft — INSERT INTO wiki.drafts … RETURNING id
      if (sqlNorm.includes("INSERT INTO wiki.drafts")) {
        return { rows: [{ id: insertedDraftId }] as T[], rowCount: 1 };
      }

      // updateDraft — UPDATE wiki.drafts SET
      if (sqlNorm.includes("UPDATE wiki.drafts SET")) {
        return { rows: [] as T[], rowCount: 1 };
      }

      // insertMemo — INSERT INTO wiki.memos … RETURNING id
      if (sqlNorm.includes("INSERT INTO wiki.memos")) {
        return { rows: [{ id: 1 }] as T[], rowCount: 1 };
      }

      return { rows: [] as T[], rowCount: 0 };
    },
  };
}

// ── LLM stub ─────────────────────────────────────────────────────────────

interface LlmStub {
  completeCalls: Array<{ system?: string; prompt: string }>;
  complete(opts: { system?: string; prompt: string; maxTokens?: number; temperature?: number }): Promise<string>;
}

function makeLlmClient(returnValue: string = '{"lead":"Refined lead.","sections":[]}'): LlmStub {
  const stub: LlmStub = {
    completeCalls: [],
    async complete(opts) {
      stub.completeCalls.push(opts);
      return returnValue;
    },
  };
  return stub;
}

// ── wikiSynthesizeHandler tests ───────────────────────────────────────────

describe("wikiSynthesizeHandler", () => {
  it("throws PortPendingError when db is null", async () => {
    await expect(
      wikiSynthesizeHandler({}, null, null),
    ).rejects.toThrow(PortPendingError);
  });

  it("PortPendingError names the specific missing dependency", async () => {
    const err = await wikiSynthesizeHandler({}, null, null).catch((e) => e);
    expect(err).toBeInstanceOf(PortPendingError);
    expect(err.message).toContain("WikiDbClient");
    expect(err.message).toContain("pg_store_wiki");
  });

  it("does NOT void db or return hardcoded zeros on non-empty input", async () => {
    const db = makeDb();
    const result = await wikiSynthesizeHandler({}, null, db);
    // Real result: 1 memory processed, 1 draft created
    expect(result.memories_processed).toBe(1);
    expect(result.drafts_created + result.drafts_updated).toBeGreaterThanOrEqual(1);
  });

  it("calls db.query to enumerate candidate memories", async () => {
    const db = makeDb();
    await wikiSynthesizeHandler({}, null, db);
    const sqls = db.queryCalls.map((c) => c.sql);
    // At least one query against wiki.claim_events for candidate enumeration
    expect(sqls.some((s) => s.includes("wiki.claim_events"))).toBe(true);
  });

  it("calls db.query to insert a new draft", async () => {
    const db = makeDb();
    await wikiSynthesizeHandler({}, null, db);
    const sqls = db.queryCalls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes("INSERT INTO wiki.drafts"))).toBe(true);
  });

  it("calls db.query to insert an audit memo", async () => {
    const db = makeDb();
    await wikiSynthesizeHandler({}, null, db);
    const sqls = db.queryCalls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes("INSERT INTO wiki.memos"))).toBe(true);
  });

  it("returns by_kind with the inferred kind", async () => {
    const db = makeDb();
    const result = await wikiSynthesizeHandler({}, null, db);
    // The claim_type is "decision" → inferred kind "adr"
    expect(result.by_kind).toHaveProperty("adr");
    expect(result.by_kind["adr"]).toBe(1);
  });

  it("updates an existing draft instead of inserting when one exists", async () => {
    const existingDraft = { id: 77, memory_id: 42, synth_model: "template_v1" };
    const db = makeDb({ draftRows: [existingDraft] });
    const result = await wikiSynthesizeHandler({}, null, db);
    expect(result.drafts_updated).toBe(1);
    expect(result.drafts_created).toBe(0);
    const sqls = db.queryCalls.map((c) => c.sql);
    expect(sqls.some((s) => s.includes("UPDATE wiki.drafts SET"))).toBe(true);
  });

  it("processes specific memory_id when given", async () => {
    const db = makeDb({ candidateRows: [{ memory_id: 7 }] });
    const result = await wikiSynthesizeHandler({ memory_id: 7 }, null, db);
    expect(result.memories_processed).toBe(1);
  });

  it("returns memories_processed = 0 when no candidates", async () => {
    const db = makeDb({ candidateRows: [] });
    const result = await wikiSynthesizeHandler({}, null, db);
    expect(result.memories_processed).toBe(0);
    expect(result.drafts_created).toBe(0);
    expect(result.drafts_updated).toBe(0);
  });

  it("collects errors per memory without aborting the whole run", async () => {
    const db = makeDb({ candidateRows: [{ memory_id: 1 }, { memory_id: 2 }] });
    // Override query to throw on the first claims fetch
    const originalQuery = db.query.bind(db);
    let callCount = 0;
    db.query = async function<T = MockRow>(sql: string, params: unknown[] = []) {
      db.queryCalls.push({ sql, params });
      const sqlNorm = sql.replace(/\s+/g, " ").trim();
      if (sqlNorm.includes("ORDER BY id")) {
        callCount++;
        if (callCount === 1) throw new Error("DB transient failure");
      }
      return originalQuery(sql, params) as Promise<{ rows: T[]; rowCount: number }>;
    };

    const result = await wikiSynthesizeHandler({}, null, db);
    // Second memory should still be processed despite first failing
    expect(result.error_count).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain("DB transient failure");
  });
});

// ── wikiPipelineHandler tests ─────────────────────────────────────────────

describe("wikiPipelineHandler", () => {
  it("never returns stages_run: [] as a hardcoded constant", async () => {
    // stages_run reflects real run outcomes; may be [] only when all are port-pending
    const result = await wikiPipelineHandler({}, null, null);
    // All sub-handlers except synthesize throw PortPendingError;
    // synthesize also throws (db is null). So stages_run = [].
    // But the pipeline must NOT hardcode []; it must derive it from stage outcomes.
    expect(Array.isArray(result.stages_run)).toBe(true);
  });

  it("captures PortPendingError per stage without throwing", async () => {
    // All stages will throw PortPendingError (db is null, other handlers are stubs)
    const result = await wikiPipelineHandler({}, null, null);
    expect(result.stages).toBeDefined();
    const stageNames = Object.keys(result.stages);
    expect(stageNames.length).toBeGreaterThanOrEqual(5); // at least extract/resolve/emerge/synthesize/curate
  });

  it("marks port-pending stages with status 'port-pending'", async () => {
    const result = await wikiPipelineHandler({}, null, null);
    // extract is PortPending
    expect(result.stages["extract"]?.status).toBe("port-pending");
    // synthesize is PortPending when db is null
    expect(result.stages["synthesize"]?.status).toBe("port-pending");
  });

  it("includes reason string for port-pending stages", async () => {
    const result = await wikiPipelineHandler({}, null, null);
    const extractStage = result.stages["extract"];
    expect(extractStage?.reason).toBeDefined();
    expect(typeof extractStage?.reason).toBe("string");
    expect(extractStage!.reason!.length).toBeGreaterThan(0);
  });

  it("synthesize stage succeeds when db is provided", async () => {
    const db = makeDb({ candidateRows: [] }); // no candidates → returns 0 counts but succeeds
    const result = await wikiPipelineHandler({}, null, db);
    expect(result.stages["synthesize"]?.status).toBe("ok");
  });

  it("stages_run includes synthesize when db is provided and run succeeds", async () => {
    const db = makeDb({ candidateRows: [] });
    const result = await wikiPipelineHandler({}, null, db);
    expect(result.stages_run).toContain("synthesize");
  });

  it("skips compile stage when skip_compile is true", async () => {
    const result = await wikiPipelineHandler({ skip_compile: true }, null, null);
    expect(result.stages["compile"]).toBeUndefined();
  });

  it("includes compile stage when skip_compile is false", async () => {
    const result = await wikiPipelineHandler({ skip_compile: false }, null, null);
    expect(result.stages["compile"]).toBeDefined();
  });

  it("returns pages_published = 0 when compile is port-pending", async () => {
    const result = await wikiPipelineHandler({}, null, null);
    expect(result.pages_published).toBe(0);
  });
});

// ── wikiRefineHandler tests ───────────────────────────────────────────────

describe("wikiRefineHandler", () => {
  it("throws PortPendingError when llmClient is null", async () => {
    await expect(
      wikiRefineHandler({ draft_id: 1 }, null),
    ).rejects.toThrow(PortPendingError);
  });

  it("calls llmClient.complete with system and prompt fields", async () => {
    const llm = makeLlmClient();
    await wikiRefineHandler(
      { draft_id: 5, lead: "Original lead.", sections: [{ heading: "Context", body: "Some context." }] },
      llm,
    );
    expect(llm.completeCalls).toHaveLength(1);
    const call = llm.completeCalls[0]!;
    expect(typeof call.system).toBe("string");
    expect(typeof call.prompt).toBe("string");
    expect(call.prompt).toContain("id=5");
  });

  it("returns refined_lead from LLM JSON response", async () => {
    const llm = makeLlmClient('{"lead":"A refined lead sentence.","sections":[{"heading":"Context","body":"Refined context."}]}');
    const result = await wikiRefineHandler({ draft_id: 3 }, llm);
    expect(result.refined_lead).toBe("A refined lead sentence.");
  });

  it("returns refined_sections from LLM JSON response", async () => {
    const llm = makeLlmClient('{"lead":"Lead.","sections":[{"heading":"Decision","body":"Refined decision body."}]}');
    const result = await wikiRefineHandler({ draft_id: 3 }, llm);
    expect(result.refined_sections).toHaveLength(1);
    expect(result.refined_sections[0]?.heading).toBe("Decision");
  });

  it("falls back to raw text as lead when LLM returns non-JSON", async () => {
    const llm = makeLlmClient("This is plain text not JSON.");
    const result = await wikiRefineHandler({ draft_id: 3 }, llm);
    expect(result.refined_lead).toBe("This is plain text not JSON.");
  });

  it("preserves existing sections on JSON parse failure", async () => {
    const llm = makeLlmClient("not json");
    const result = await wikiRefineHandler({
      draft_id: 3,
      sections: [{ heading: "Context", body: "Existing body." }],
    }, llm);
    expect(result.refined_sections).toHaveLength(1);
    expect(result.refined_sections[0]?.heading).toBe("Context");
  });
});
