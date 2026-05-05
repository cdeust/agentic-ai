/**
 * GET /api/memories/facets — aggregate counts so filter chips show
 * ALL options up-front rather than only what's been paged through.
 *
 * Three SQL queries total, each indexed; ~5-50 ms even at 1M memories.
 *
 * Port of: mcp_server/handlers/memories_facets.py
 * source: cortex@ed33435 mcp_server/handlers/memories_facets.py
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface DomainCount {
  name: string;
  count: number;
}

export interface MemoriesFacetsResult {
  total: number;
  domains: DomainCount[];
  stages: {
    labile: number;
    early_ltp: number;
    late_ltp: number;
    consolidated: number;
    reconsolidating: number;
  };
  emotions: {
    urgent: number;
    positive: number;
    negative: number;
    neutral: number;
  };
  global: number;
  protected: number;
  hot: number;
}

// ── SQL constants ──────────────────────────────────────────────────────────

/**
 * Q1: per-domain counts sorted desc.
 * source: cortex@ed33435 mcp_server/handlers/memories_facets.py:39
 */
export const DOMAIN_COUNTS_SQL =
  "SELECT COALESCE(NULLIF(domain, ''), '__unknown__') AS dom, " +
  "COUNT(*) AS c " +
  "FROM memories WHERE NOT is_stale " +
  "GROUP BY dom ORDER BY c DESC LIMIT 200";

/**
 * Q2: per-stage + global + protected + hot + total in one pass.
 * source: cortex@ed33435 mcp_server/handlers/memories_facets.py:48
 */
export const AGGREGATE_SQL =
  "SELECT " +
  "  COUNT(*) AS total, " +
  "  COUNT(*) FILTER (WHERE consolidation_stage = 'labile')          AS s_labile, " +
  "  COUNT(*) FILTER (WHERE consolidation_stage = 'early_ltp')       AS s_early, " +
  "  COUNT(*) FILTER (WHERE consolidation_stage = 'late_ltp')        AS s_late, " +
  "  COUNT(*) FILTER (WHERE consolidation_stage = 'consolidated')    AS s_cons, " +
  "  COUNT(*) FILTER (WHERE consolidation_stage = 'reconsolidating') AS s_recon, " +
  "  COUNT(*) FILTER (WHERE is_global = TRUE)     AS n_global, " +
  "  COUNT(*) FILTER (WHERE is_protected = TRUE)  AS n_protected, " +
  "  COUNT(*) FILTER (WHERE heat_base >= 0.5)     AS n_hot, " +
  "  COUNT(*) FILTER (WHERE importance >= 0.75)                                                  AS e_urgent, " +
  "  COUNT(*) FILTER (WHERE emotional_valence >= 0.25 AND importance < 0.75)                     AS e_pos, " +
  "  COUNT(*) FILTER (WHERE emotional_valence <= -0.25 AND importance < 0.75)                    AS e_neg, " +
  "  COUNT(*) FILTER (WHERE emotional_valence > -0.25 AND emotional_valence < 0.25 AND importance < 0.75) AS e_neutral " +
  "FROM memories WHERE NOT is_stale";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Safely extract a numeric field. */
function num(row: Record<string, unknown>, key: string): number {
  return Number(row[key] ?? 0);
}

// ── Core logic ─────────────────────────────────────────────────────────────

/**
 * Compute facet counts from pre-fetched rows.
 *
 * precondition: domainRows rows have {dom, c} fields;
 *   agg is a single row with the aggregate columns.
 * postcondition: returns a fully-populated MemoriesFacetsResult.
 *
 * Port of: mcp_server/handlers/memories_facets.py::serve (aggregation logic)
 * source: cortex@ed33435 mcp_server/handlers/memories_facets.py:36
 */
export function computeFacets(
  domainRows: Record<string, unknown>[],
  agg: Record<string, unknown>,
): MemoriesFacetsResult {
  const domains: DomainCount[] = domainRows.map((r) => ({
    name: String(r["dom"] ?? "__unknown__"),
    count: Number(r["c"] ?? 0),
  }));

  return {
    total: num(agg, "total"),
    domains,
    stages: {
      labile: num(agg, "s_labile"),
      early_ltp: num(agg, "s_early"),
      late_ltp: num(agg, "s_late"),
      consolidated: num(agg, "s_cons"),
      reconsolidating: num(agg, "s_recon"),
    },
    emotions: {
      urgent: num(agg, "e_urgent"),
      positive: num(agg, "e_pos"),
      negative: num(agg, "e_neg"),
      neutral: num(agg, "e_neutral"),
    },
    global: num(agg, "n_global"),
    protected: num(agg, "n_protected"),
    hot: num(agg, "n_hot"),
  };
}
