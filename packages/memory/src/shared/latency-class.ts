/**
 * Phase 5: latency-class registry for MCP tool handlers.
 *
 * Each tool declares which connection pool it may acquire:
 *
 *   interactive — hot-path (recall, remember, anchor, ...).
 *                 Bounded to interactive_pool (max=8, timeout=5s).
 *                 Admission semaphore default: Semaphore(4) per tool.
 *
 *   batch       — long-running writers (consolidate, wiki_pipeline,
 *                 seed_project, ingest_*).
 *                 Bounded to batch_pool (max=2, timeout=30min).
 *                 Admission semaphore default: Semaphore(1) per tool.
 *
 * Port of: mcp_server/handlers/latency_class.py
 * source: cortex@ed33435 mcp_server/handlers/latency_class.py
 * source: docs/program/phase-5-pool-admission-design.md §1.1, ADR-0045 R6
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type LatencyClass = "interactive" | "batch";

// ── Registry ──────────────────────────────────────────────────────────────

/**
 * Canonical tool → class map. Any tool not listed here falls through to
 * the classify() heuristic.
 * source: cortex@ed33435 mcp_server/handlers/latency_class.py:36
 */
const LATENCY_CLASS: Record<string, LatencyClass> = {
  // ── Interactive (hot path) ────────────────────────────────────────
  recall: "interactive",
  recall_hierarchical: "interactive",
  remember: "interactive",
  anchor: "interactive",
  forget: "interactive",
  checkpoint: "interactive",
  detect_domain: "interactive",
  list_domains: "interactive",
  explore_features: "interactive",
  query_methodology: "interactive",
  memory_stats: "interactive",
  get_causal_chain: "interactive",
  get_methodology_graph: "interactive",
  get_project_story: "interactive",
  get_rules: "interactive",
  navigate_memory: "interactive",
  drill_down: "interactive",
  detect_gaps: "interactive",
  rate_memory: "interactive",
  validate_memory: "interactive",
  narrative: "interactive",
  open_visualization: "interactive",
  assess_coverage: "interactive",
  add_rule: "interactive",
  create_trigger: "interactive",
  sync_instructions: "interactive",
  // Wiki read/navigate stays interactive (single-page granularity)
  wiki_read: "interactive",
  wiki_list: "interactive",
  wiki_link: "interactive",
  wiki_write: "interactive",
  wiki_adr: "interactive",
  // ── Batch (long-running) ──────────────────────────────────────────
  consolidate: "batch",
  seed_project: "batch",
  codebase_analyze: "batch",
  backfill_memories: "batch",
  import_sessions: "batch",
  rebuild_profiles: "batch",
  record_session_end: "batch",
  ingest_codebase: "batch",
  ingest_prd: "batch",
  wiki_reindex: "batch",
  wiki_purge: "batch",
};

// Default semaphore capacity per class. Per-tool overrides live in the
// admission middleware (step 5).
// source: cortex@ed33435 mcp_server/handlers/latency_class.py:85
export const DEFAULT_SEMAPHORE: Record<LatencyClass, number> = {
  interactive: 4,
  batch: 1,
};

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Return the latency class for a tool.
 *
 * Falls back to heuristic: names containing "ingest", "consolidate",
 * "rebuild", "seed", "backfill", "reindex", "purge", "pipeline" are
 * classified as batch; everything else is interactive.
 *
 * precondition: toolName is a non-empty string.
 * postcondition: returns "interactive" or "batch".
 *
 * Port of: mcp_server/handlers/latency_class.py::classify
 * source: cortex@ed33435 mcp_server/handlers/latency_class.py:92
 */
export function classify(toolName: string): LatencyClass {
  if (toolName in LATENCY_CLASS) {
    return LATENCY_CLASS[toolName] as LatencyClass;
  }
  // Heuristic fallback
  const n = toolName.toLowerCase();
  const batchMarkers = [
    "ingest",
    "consolidate",
    "rebuild",
    "seed",
    "backfill",
    "reindex",
    "purge",
    "pipeline",
  ];
  for (const marker of batchMarkers) {
    if (n.includes(marker)) return "batch";
  }
  return "interactive";
}

/**
 * Return every tool name in the registry. For tests and audits.
 *
 * Port of: mcp_server/handlers/latency_class.py::all_registered_tools
 * source: cortex@ed33435 mcp_server/handlers/latency_class.py:121
 */
export function allRegisteredTools(): string[] {
  return Object.keys(LATENCY_CLASS).sort();
}
