/**
 * admission.ts — Per-tool admission control (semaphore-bounded concurrency).
 *
 * Ports: handlers/admission.py (96 LOC, 5 functions)
 *        handlers/latency_class.py (123 LOC, 3 functions)
 *
 * Per-tool semaphore bounds concurrency so one client cannot exhaust
 * the pool by hammering a single tool.
 *
 * Design (bounded-buffer M/M/c/K per Kleinrock 1975):
 *   interactive — hot-path tools. Default semaphore: 4 concurrent.
 *   batch       — long-running writers. Default semaphore: 1 concurrent.
 *
 * Per-tool overrides tune budget up/down from class defaults.
 *
 * source: cortex@ed33435 mcp_server/handlers/admission.py
 * source: cortex@ed33435 mcp_server/handlers/latency_class.py
 * source: docs/program/phase-5-pool-admission-design.md §1.1 and §1.4
 * source: ADR-0045 R6
 */

// ── Latency classes ───────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/latency_class.py

export type LatencyClass = "interactive" | "batch";

// source: cortex@ed33435 mcp_server/handlers/latency_class.py:DEFAULT_SEMAPHORE
export const DEFAULT_SEMAPHORE: Record<LatencyClass, number> = {
  interactive: 4,
  batch: 1,
};

// Canonical tool → class map.
// source: cortex@ed33435 mcp_server/handlers/latency_class.py:_LATENCY_CLASS
const LATENCY_CLASS: Record<string, LatencyClass> = {
  // Interactive (hot path)
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
  wiki_read: "interactive",
  wiki_list: "interactive",
  wiki_link: "interactive",
  wiki_write: "interactive",
  wiki_adr: "interactive",
  // Batch (long-running)
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

// Per-tool overrides on top of class defaults.
// source: cortex@ed33435 mcp_server/handlers/admission.py:_OVERRIDES
const OVERRIDES: Record<string, number> = {
  // Higher budget: read-only / very cheap
  recall: 8,
  memory_stats: 8,
  detect_domain: 8,
  list_domains: 8,
  query_methodology: 8,
  // Lower budget: mutations need slightly more care
  remember: 4,
};

/**
 * Classify a tool into its latency class.
 *
 * Falls back to heuristic: batch markers or interactive by default.
 * source: cortex@ed33435 mcp_server/handlers/latency_class.py:classify
 */
export function classify(toolName: string): LatencyClass {
  if (toolName in LATENCY_CLASS) return LATENCY_CLASS[toolName] as LatencyClass;
  const n = toolName.toLowerCase();
  const batchMarkers = [
    "ingest", "consolidate", "rebuild", "seed",
    "backfill", "reindex", "purge", "pipeline",
  ];
  if (batchMarkers.some((m) => n.includes(m))) return "batch";
  return "interactive";
}

/**
 * Return the declared budget for a tool.
 * source: cortex@ed33435 mcp_server/handlers/admission.py:_budget_for
 */
export function budgetFor(toolName: string): number {
  if (toolName in OVERRIDES) return OVERRIDES[toolName] as number;
  return DEFAULT_SEMAPHORE[classify(toolName)];
}

// ── Semaphore implementation ──────────────────────────────────────────────

/**
 * Minimal async semaphore (Node.js has no built-in asyncio.Semaphore).
 *
 * pre:  capacity is a positive integer.
 * post: at most `capacity` concurrent acquisitions are held at any time.
 *       Waiters are queued in FIFO order.
 */
class AsyncSemaphore {
  private capacity: number;
  private current: number = 0;
  private waiters: Array<() => void> = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  acquire(): Promise<void> {
    if (this.current < this.capacity) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Handoff: keep current count steady — the waiter is now the holder
      next();
    } else {
      this.current--;
    }
  }
}

// Process-local semaphore cache — one per tool name.
// source: cortex@ed33435 mcp_server/handlers/admission.py:_SEMS
const SEMS = new Map<string, AsyncSemaphore>();

/**
 * Lazy-init per-tool semaphore on first use.
 * source: cortex@ed33435 mcp_server/handlers/admission.py:_get_semaphore
 */
function getSemaphore(toolName: string): AsyncSemaphore {
  let sem = SEMS.get(toolName);
  if (!sem) {
    sem = new AsyncSemaphore(budgetFor(toolName));
    SEMS.set(toolName, sem);
  }
  return sem;
}

/**
 * Acquire per-tool admission semaphore for the call duration.
 *
 * Blocks when the tool's concurrent-call budget is exhausted. No
 * timeout — the admission semaphore is the backpressure signal.
 *
 * source: cortex@ed33435 mcp_server/handlers/admission.py:admit
 *
 * Usage:
 *   const release = await admit("recall");
 *   try { result = await doWork(); } finally { release(); }
 */
export async function admit(toolName: string): Promise<() => void> {
  const sem = getSemaphore(toolName);
  await sem.acquire();
  return () => sem.release();
}

/**
 * Return current budget for observability + tests.
 * source: cortex@ed33435 mcp_server/handlers/admission.py:current_budget
 */
export function currentBudget(toolName: string): number {
  return budgetFor(toolName);
}

/**
 * Drop all cached semaphores. For tests only.
 * source: cortex@ed33435 mcp_server/handlers/admission.py:reset_semaphores
 */
export function resetSemaphores(): void {
  SEMS.clear();
}

/**
 * Return all registered tool names. For tests and audits.
 * source: cortex@ed33435 mcp_server/handlers/latency_class.py:all_registered_tools
 */
export function allRegisteredTools(): string[] {
  return Object.keys(LATENCY_CLASS).sort();
}
