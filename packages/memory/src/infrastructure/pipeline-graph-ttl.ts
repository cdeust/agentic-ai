/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Freshness policy for the codebase graph.
 *
 * When a user runs ingest_codebase, the pipeline produces a graph at
 * <output_dir>/graph.ladybug and Cortex memoises the path in a
 * protected memory. The graph is stale when:
 *
 *   - the path no longer exists (someone cleaned /tmp), OR
 *   - the mtime is older than CORTEX_PIPELINE_GRAPH_TTL_HOURS (default 24h).
 *
 * Stale graphs trigger a background re-analysis on the next SessionStart
 * so the following session has a fresh graph — without blocking the
 * current session.
 *
 * source: user directive "codebase analysis feeding the memory and wiki"
 *   — runs automatically, off the hot path.
 *
 * Layer: INFRASTRUCTURE (environment + filesystem stat).
 * source: Cortex mcp_server/infrastructure/pipeline_graph_ttl.py
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Default 24h. Tune via CORTEX_PIPELINE_GRAPH_TTL_HOURS.
// source: Cortex mcp_server/infrastructure/pipeline_graph_ttl.py — _DEFAULT_TTL_HOURS = 24.0
const _DEFAULT_TTL_HOURS = 24.0;

/**
 * Return the configured TTL in hours.
 *
 * precondition:  none.
 * postcondition: returns _DEFAULT_TTL_HOURS if env var is absent or invalid;
 *   returns max(0.0, parseFloat(env)) otherwise.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_graph_ttl.py:graph_ttl_hours
 */
export function graphTtlHours(): number {
  const raw = process.env["CORTEX_PIPELINE_GRAPH_TTL_HOURS"] ?? "";
  if (!raw) {
    return _DEFAULT_TTL_HOURS;
  }
  const parsed = parseFloat(raw);
  if (!isFinite(parsed)) {
    return _DEFAULT_TTL_HOURS;
  }
  return Math.max(0.0, parsed);
}

/**
 * True when the graph is missing or older than the TTL.
 *
 * precondition:  graphPath is a string or null/undefined.
 * postcondition: returns true if graphPath is falsy, the file does not
 *   exist, or the file's mtime age in hours exceeds graphTtlHours().
 *
 * source: Cortex mcp_server/infrastructure/pipeline_graph_ttl.py:graph_is_stale
 */
export function graphIsStale(graphPath: string | null | undefined): boolean {
  if (!graphPath) {
    return true;
  }
  const resolved = path.resolve(graphPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return true;
  }
  const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000; // source: 3_600_000 ms/h = 3600 s/h × 1000 ms/s
  return ageHours > graphTtlHours();
}
