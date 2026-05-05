/**
 * routes/memories.ts — GET /api/memories + GET /api/memories/facets
 *
 * TS port of:
 *   cortex@ed33435 mcp_server/handlers/memories_page.py  (serve)
 *   cortex@ed33435 mcp_server/handlers/memories_facets.py (serve)
 *
 * Keyset-paged memory listing for the Knowledge and Board tabs.
 * /api/memories/facets returns aggregate counts for filter chips.
 *
 * Layer: handlers — reads the memory SQLite directly via better-sqlite3.
 *
 * precondition:  dbPath points to a readable SQLite file with a `memories` table.
 * postcondition: /api/memories returns paginated rows;
 *   /api/memories/facets returns domain/stage/tag counts.
 */

import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";

// ── Named constants ───────────────────────────────────────────────────────────
const IMPORTANCE_DEFAULT = 0.5; // source: cortex@ed33435 mcp_server/server/http_dashboard_data.py:104 — default importance=0.5
const PAGE_LIMIT_DEFAULT = 50;  // source: cortex@ed33435 mcp_server/handlers/memories_page.py — default page_size=50
const PAGE_LIMIT_MAX = 200;     // source: cortex@ed33435 mcp_server/handlers/memories_page.py — max page_size=200
const CONTENT_LIMIT = 200;      // source: cortex@ed33435 mcp_server/server/http_dashboard_data.py:39 — format_memory(m, 200)
const HTTP_500 = 500;           // source: RFC 7231 §6.6 — Internal Server Error

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemoryRow {
  id: string;
  content: string;
  heat: number;
  importance: number;
  store_type: string | null;
  tags: string | null;
  created_at: string | null;
  domain: string | null;
  surprise_score: number;
  emotional_valence: number;
  compression_level: number;
  is_compressed: number;
  is_protected: number;
  is_global: number;
  access_count: number;
  consolidation_stage: string | null;
  source: string | null;
  agent_context: string | null;
  replay_count: number;
  hours_in_stage: number;
  reconsolidation_count: number;
  confidence: number;
  encoding_strength: number;
  schema_match_score: number;
  interference_score: number;
  hippocampal_dependency: number;
  plasticity: number;
  stability: number;
  last_accessed: string | null;
  stage_entered_at: string | null;
  theta_phase_at_encoding: number;
  excitability: number;
  separation_index: number;
}

// source: cortex@ed33435 mcp_server/server/http_dashboard_data.py:94-132 (format_memory)
// Rounding factor 10000 = 4 decimal places, matching round(..., 4) in Python. source: cortex@ed33435 mcp_server/server/http_dashboard_data.py:105 (round(m.get("heat", 0), 4))
// hours_in_stage uses 100 = 2 decimal places. source: cortex@ed33435 mcp_server/server/http_dashboard_data.py:127 (round(..., 2))
function formatMemory(m: MemoryRow, contentLimit: number): Record<string, unknown> {
  const parseTags = (t: string | null): string[] => {
    if (!t) return [];
    if (t.startsWith("[")) {
      try { return JSON.parse(t) as string[]; } catch { return []; }
    }
    return [];
  };
  // All round(x, 4) → multiply by 10000 then divide. source: cortex@ed33435 mcp_server/server/http_dashboard_data.py:105 (round(m.get("heat", 0), 4))
  // round(hours_in_stage, 2) → multiply by 100. source: cortex@ed33435 mcp_server/server/http_dashboard_data.py:127
  const R4 = 10000; // 4 decimal places // source: Python round(..., 4) equivalent
  const R2 = 100;   // 2 decimal places // source: Python round(..., 2) equivalent
  return {
    id: m.id,
    content: (m.content ?? "").slice(0, contentLimit),
    heat: Math.round((m.heat ?? 0) * R4) / R4,
    importance: Math.round((m.importance ?? IMPORTANCE_DEFAULT) * R4) / R4,
    store_type: m.store_type ?? "episodic",
    tags: parseTags(m.tags),
    created_at: m.created_at ?? "",
    domain: m.domain ?? "",
    surprise_score: Math.round((m.surprise_score ?? 0) * R4) / R4,
    emotional_valence: Math.round((m.emotional_valence ?? 0) * R4) / R4,
    compression_level: m.compression_level ?? 0,
    is_compressed: Boolean(m.is_compressed),
    is_protected: Boolean(m.is_protected),
    access_count: m.access_count ?? 0,
    consolidation_stage: m.consolidation_stage ?? "labile",
    source: m.source ?? "",
    agent_context: m.agent_context ?? "",
    is_global: Boolean(m.is_global),
    replay_count: m.replay_count ?? 0,
    hours_in_stage: Math.round((m.hours_in_stage ?? 0) * R2) / R2,
    reconsolidation_count: m.reconsolidation_count ?? 0,
    confidence: Math.round((m.confidence ?? 1.0) * R4) / R4,
    encoding_strength: Math.round((m.encoding_strength ?? 1.0) * R4) / R4,
    schema_match_score: Math.round((m.schema_match_score ?? 0) * R4) / R4,
    interference_score: Math.round((m.interference_score ?? 0) * R4) / R4,
    hippocampal_dependency: Math.round((m.hippocampal_dependency ?? 1.0) * R4) / R4,
    plasticity: Math.round((m.plasticity ?? 1.0) * R4) / R4,
    stability: Math.round((m.stability ?? 0) * R4) / R4,
    last_accessed: m.last_accessed ?? "",
    stage_entered_at: m.stage_entered_at ?? "",
    theta_phase: Math.round((m.theta_phase_at_encoding ?? 0) * R4) / R4,
    excitability: Math.round((m.excitability ?? 1.0) * R4) / R4,
    separation_index: Math.round((m.separation_index ?? 0) * R4) / R4,
  };
}

export interface MemoriesRouteDeps {
  dbPath: string;
}

/**
 * Register /api/memories and /api/memories/facets.
 *
 * precondition:  fastify instance is not yet started.
 * postcondition: two routes registered.
 */
export async function registerMemoriesRoutes(
  fastify: FastifyInstance,
  deps: MemoriesRouteDeps,
): Promise<void> {
  /**
   * GET /api/memories[?domain=<d>&stage=<s>&after=<id>&limit=<n>]
   *
   * Keyset-paged listing. `after` is the last-seen row id for cursor pagination.
   * source: cortex@ed33435 mcp_server/handlers/memories_page.py (serve)
   */
  fastify.get<{
    Querystring: { domain?: string; stage?: string; after?: string; limit?: string };
  }>("/api/memories", async (req, reply) => {
    try {
      const { domain, stage, after, limit: limitStr } = req.query;
      // source: cortex@ed33435 mcp_server/handlers/memories_page.py — page_size default 50, max 200
      const limit = Math.min(PAGE_LIMIT_MAX, Math.max(1, parseInt(limitStr ?? String(PAGE_LIMIT_DEFAULT), 10)));

      const db = new Database(deps.dbPath, { readonly: true, fileMustExist: true });
      const conditions: string[] = ["NOT is_benchmark", "NOT is_stale"];
      const params: unknown[] = [];

      if (domain) { conditions.push("domain = ?"); params.push(domain); }
      if (stage) { conditions.push("consolidation_stage = ?"); params.push(stage); }
      if (after) { conditions.push("rowid > (SELECT rowid FROM memories WHERE id = ?)"); params.push(after); }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit);

      const rows = db.prepare(
        `SELECT * FROM memories ${where} ORDER BY heat DESC LIMIT ?`
      ).all(...params) as MemoryRow[];

      const total = (db.prepare(`SELECT COUNT(*) as c FROM memories ${where.replace(/LIMIT \?/, "")}`).get(...params.slice(0, -1)) as { c: number } | undefined)?.c ?? 0;
      db.close();

      return reply.send({
        memories: rows.map((m) => formatMemory(m, CONTENT_LIMIT)), // source: cortex@ed33435 mcp_server/server/http_dashboard_data.py:39 — format_memory(m, 200) for recent_memories
        total,
        has_more: rows.length === limit,
        next_after: rows.length > 0 ? (rows[rows.length - 1]?.id ?? null) : null,
      });
    } catch (err) {
      return reply.status(HTTP_500).send({ error: err instanceof Error ? err.constructor.name : "UnknownError" }); // source: RFC 7231 §6.6 — 500 Internal Server Error; error class name only to avoid leaking internals (CWE-209)
    }
  });

  /**
   * GET /api/memories/facets — aggregate counts for filter chips.
   * source: cortex@ed33435 mcp_server/handlers/memories_facets.py (serve)
   */
  fastify.get("/api/memories/facets", async (_req, reply) => {
    try {
      const db = new Database(deps.dbPath, { readonly: true, fileMustExist: true });

      interface DomainCount { domain: string; count: number; }
      interface StageCount { consolidation_stage: string; count: number; }

      const byDomain = db.prepare(
        "SELECT domain, COUNT(*) as count FROM memories WHERE NOT is_benchmark AND NOT is_stale GROUP BY domain ORDER BY count DESC"
      ).all() as DomainCount[];

      const byStage = db.prepare(
        "SELECT consolidation_stage, COUNT(*) as count FROM memories WHERE NOT is_benchmark AND NOT is_stale GROUP BY consolidation_stage"
      ).all() as StageCount[];

      const totals = db.prepare(
        "SELECT COUNT(*) as total, SUM(is_protected) as protected, SUM(is_global) as global FROM memories WHERE NOT is_benchmark AND NOT is_stale"
      ).get() as { total: number; protected: number; global: number } | undefined;

      db.close();
      return reply.send({
        by_domain: byDomain,
        by_stage: byStage,
        totals: totals ?? { total: 0, protected: 0, global: 0 },
      });
    } catch (err) {
      return reply.status(HTTP_500).send({ error: err instanceof Error ? err.constructor.name : "UnknownError" }); // source: RFC 7231 §6.6 — 500 Internal Server Error; error class name only to avoid leaking internals (CWE-209)
    }
  });
}
