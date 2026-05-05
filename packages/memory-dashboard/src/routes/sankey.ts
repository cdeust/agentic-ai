/**
 * routes/sankey.ts — GET /api/sankey
 *
 * TS port of:
 *   cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:31-110
 *   (serve_sankey, _sankey_transitions, _sankey_timing, _sankey_stage_metrics)
 *
 * Serves the consolidation-pipeline Sankey dataset:
 *   transitions: stage transition counts
 *   timing:      avg/min/max hours between stages
 *   stage_metrics: per-stage aggregate statistics
 *
 * Layer: handlers — reads raw SQL from the memory SQLite, formats response.
 *
 * precondition:  dbPath points to a readable SQLite file with memories +
 *   stage_transitions tables.
 * postcondition: returns { transitions, timing, stage_metrics, total_memories }.
 */

import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";

// ── Named constants ───────────────────────────────────────────────────────────
const R1 = 10;   // source: cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:75 — round(v, 1) → multiply by 10
const R3 = 1000; // source: cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:87 — round(v, 3) → multiply by 1000
const HTTP_500 = 500; // source: RFC 7231 §6.6 — Internal Server Error

// source: cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:30-36
const STAGES = [
  "labile",
  "early_ltp",
  "late_ltp",
  "consolidated",
  "reconsolidating",
] as const;

type Stage = (typeof STAGES)[number];

// source: cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:38-51
const STAGE_METRICS_SQL = `
  SELECT COUNT(*) as count,
    AVG(heat) as avg_heat, AVG(importance) as avg_importance,
    AVG(replay_count) as avg_replay, AVG(access_count) as avg_access,
    AVG(encoding_strength) as avg_encoding,
    AVG(interference_score) as avg_interference,
    AVG(schema_match_score) as avg_schema,
    AVG(hippocampal_dependency) as avg_hippo,
    AVG(plasticity) as avg_plasticity,
    AVG(stability) as avg_stability,
    AVG(hours_in_stage) as avg_hours
  FROM memories
  WHERE consolidation_stage = ?
    AND NOT is_benchmark AND NOT is_stale
`;

interface TransitionRow {
  from_stage: string;
  to_stage: string;
  count: number;
}

interface TimingRow {
  from_stage: string;
  to_stage: string;
  avg_hours: number;
  min_hours: number;
  max_hours: number;
}

export interface SankeyRouteDeps {
  dbPath: string;
}

/**
 * Register GET /api/sankey.
 *
 * precondition:  fastify instance is not yet started.
 * postcondition: one route is registered.
 */
export async function registerSankeyRoutes(
  fastify: FastifyInstance,
  deps: SankeyRouteDeps,
): Promise<void> {
  /**
   * GET /api/sankey — consolidation-pipeline Sankey dataset.
   * source: cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:94-110
   */
  fastify.get("/api/sankey", async (_req, reply) => {
    try {
      const db = new Database(deps.dbPath, { readonly: true, fileMustExist: true });

      // source: cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:54-62
      const transitions = (
        db.prepare(
          "SELECT from_stage, to_stage, COUNT(*) as count FROM stage_transitions GROUP BY from_stage, to_stage ORDER BY from_stage, to_stage"
        ).all() as TransitionRow[]
      ).map((r) => ({ from_stage: r.from_stage, to_stage: r.to_stage, count: r.count }));

      // source: cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:64-81
      const timingRows = db.prepare(
        "SELECT from_stage, to_stage, AVG(hours_in_prev_stage) as avg_hours, MIN(hours_in_prev_stage) as min_hours, MAX(hours_in_prev_stage) as max_hours FROM stage_transitions GROUP BY from_stage, to_stage"
      ).all() as TimingRow[];
      const timing: Record<string, { avg_hours: number; min_hours: number; max_hours: number }> = {};
      for (const r of timingRows) {
        const key = `${r.from_stage}->${r.to_stage}`;
        timing[key] = {
          avg_hours: Math.round((r.avg_hours ?? 0) * R1) / R1,
          min_hours: Math.round((r.min_hours ?? 0) * R1) / R1,
          max_hours: Math.round((r.max_hours ?? 0) * R1) / R1,
        };
      }

      // source: cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:83-92
      const stage_metrics: Record<string, Record<string, number>> = {};
      for (const s of STAGES) {
        const row = db.prepare(STAGE_METRICS_SQL).get(s) as Record<string, number | null> | undefined;
        if (row) {
          stage_metrics[s] = Object.fromEntries(
            // source: cortex@ed33435 mcp_server/server/http_standalone_endpoints.py:87-91 — round(v, 3) → multiply by 1000
            Object.entries(row).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * R3) / R3 : (v ?? 0)])
          );
        }
      }

      const totalRow = db.prepare(
        "SELECT COUNT(*) as c FROM memories WHERE NOT is_benchmark AND NOT is_stale"
      ).get() as { c: number } | undefined;

      db.close();
      return reply.send({
        transitions,
        timing,
        stage_metrics: stage_metrics as Record<Stage, Record<string, number>>,
        total_memories: totalRow?.c ?? 0,
      });
    } catch (err) {
      return reply.status(HTTP_500).send({ error: err instanceof Error ? err.constructor.name : "UnknownError" }); // source: RFC 7231 §6.6 — 500 Internal Server Error; error class name only to avoid leaking internals (CWE-209)
    }
  });
}
