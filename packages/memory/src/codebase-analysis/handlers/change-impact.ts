/**
 * change-impact.ts — change_impact handler (ADR-0046 Phase 4).
 *
 * Report which Cortex memories reference code that changed in a commit.
 *
 * Flow:
 *   1. Call AP's detect_changes for changed symbols/files between two refs.
 *   2. Optionally expand via get_impact for each changed symbol (downstream
 *      call-graph reach).
 *   3. Match the impacted qualnames and file paths against recent memories
 *      (pure-logic matcher in this module — port of change_impact_matcher.py).
 *   4. Return a deterministic report; caller decides whether to bump heat.
 *
 * Requires an mcpClientPool wired at the composition root (IngestDeps).
 * When pool is null OR graph path is unresolved, returns {status:"skipped"}.
 *
 * Layer: codebase-analysis/handlers (composition root wires pool + store).
 * Allowed imports: ingest-helpers, remember/storage types, node stdlib.
 *
 * source: cortex@ed33435 mcp_server/handlers/change_impact.py
 * source: cortex@ed33435 mcp_server/core/change_impact_matcher.py
 */

import type { MemoryStore } from "../../remember/storage/memory-store.js";
import {
  callUpstream,
  findCachedGraph,
  normaliseMcpPayload,
  type McpClientPool,
} from "./ingest-helpers.js";

// ── Named constants ───────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/change_impact.py:36 — _IMPACT_BOOST
const IMPACT_BOOST = 0.15;
// source: cortex@ed33435 mcp_server/handlers/change_impact.py:37 — _MAX_HEAT_BUMPS
const MAX_HEAT_BUMPS = 20;
// source: cortex@ed33435 mcp_server/handlers/change_impact.py:38 — _MAX_MEMORIES_SCANNED
const MAX_MEMORIES_SCANNED = 1000;

// ── Dependency injection type ─────────────────────────────────────────────────

export interface ChangeImpactDeps {
  store:         MemoryStore;
  mcpClientPool: McpClientPool | null;
  /**
   * Root path for graph-path cache lookup.
   * Caller should pass the project root so findCachedGraph can locate the
   * pre-indexed graph for this codebase.
   */
  projectRoot?:  string;
}

// ── Handler args + response ───────────────────────────────────────────────────

export interface ChangeImpactArgs {
  base?:            string;
  head?:            string;
  expand_impact?:   boolean;
  apply_heat_bump?: boolean;
}

export interface ImpactMatchResult {
  memory_id:       number | string;
  matched_symbols: string[];
  matched_files:   string[];
  match_count:     number;
}

export interface ChangeImpactResponse {
  status:      "ok" | "skipped";
  reason?:     string;
  detail?:     string;
  base?:       string;
  head?:       string;
  impact?: {
    symbols:  string[];
    files:    string[];
    expanded: boolean;
  };
  matches?:     ImpactMatchResult[];
  heat_bumped?: number;
}

// ── AP payload normalisation ──────────────────────────────────────────────────

/**
 * Normalise AP's detect_changes response to (symbols, files) arrays.
 *
 * AP returns either a list of {symbol, file, kind} rows or a wrapped
 * {changes: [...]} object; we tolerate both.
 *
 * postcondition: symbols and files are deduplicated string arrays.
 *
 * source: cortex@ed33435 mcp_server/handlers/change_impact.py::_extract_symbols_and_files:77-99
 */
function extractSymbolsAndFiles(payload: unknown): { symbols: string[]; files: string[] } {
  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(payload)) {
    rows = payload.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object");
  } else if (payload !== null && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const inner = p["changes"] ?? p["rows"] ?? p["content"];
    if (Array.isArray(inner)) {
      rows = inner.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object");
    }
  }

  const symbols: string[] = [];
  const files:   string[] = [];
  const seenS = new Set<string>();
  const seenF = new Set<string>();

  for (const r of rows) {
    const q = String(r["qualified_name"] ?? r["symbol"] ?? "");
    const f = String(r["file_path"]      ?? r["file"]   ?? "");
    if (q && !seenS.has(q)) { seenS.add(q); symbols.push(q); }
    if (f && !seenF.has(f)) { seenF.add(f); files.push(f); }
  }
  return { symbols, files };
}

// ── AP impact collection ──────────────────────────────────────────────────────

/**
 * Call detect_changes (and optionally get_impact) against the AP server.
 *
 * precondition:  pool is non-null; graphPath is a valid LadybugDB directory.
 * postcondition: returns deduplicated (symbols, files) covering direct +
 *   optionally transitive impact.
 *
 * source: cortex@ed33435 mcp_server/handlers/change_impact.py::_collect_impact:102-129
 */
async function collectImpact(
  pool: McpClientPool,
  graphPath: string,
  base: string,
  head: string,
  expand: boolean,
): Promise<{ symbols: string[]; files: string[] }> {
  const rawPayload = await callUpstream(
    "codebase",
    "detect_changes",
    { graph_path: graphPath, base, head },
    pool,
  );
  const normalised = normaliseMcpPayload(rawPayload);
  const { symbols, files } = extractSymbolsAndFiles(normalised);

  if (!expand || symbols.length === 0) {
    return { symbols, files };
  }

  // Expand via get_impact for each direct symbol; dedupe
  // source: cortex@ed33435 mcp_server/handlers/change_impact.py:118-128
  const seen = new Set<string>(symbols);
  for (const sym of [...symbols]) {
    let resp: unknown;
    try {
      resp = await callUpstream(
        "codebase",
        "get_impact",
        { graph_path: graphPath, symbol_id: sym },
        pool,
      );
    } catch {
      continue;
    }
    const more = extractSymbolsAndFiles(normaliseMcpPayload(resp));
    for (const q of more.symbols) {
      if (!seen.has(q)) { seen.add(q); symbols.push(q); }
    }
  }

  return { symbols, files };
}

// ── Pure matcher ──────────────────────────────────────────────────────────────

/**
 * Return the basename of a file path (works for / and \ separators).
 *
 * source: cortex@ed33435 mcp_server/core/change_impact_matcher.py::_basename:39-42
 */
function pathBasename(p: string): string {
  if (!p) return "";
  return p.split(/[/\\]/).at(-1) ?? "";
}

/**
 * Return the tail identifier of a dotted qualified name.
 * e.g. "foo.Bar.baz" → "baz"
 *
 * source: cortex@ed33435 mcp_server/core/change_impact_matcher.py::_tail_of_qualname:32-37
 */
function tailOfQualname(q: string): string {
  return q.includes(".") ? (q.split(".").at(-1) ?? q) : q;
}

/**
 * Match memories against the impact set.
 *
 * A memory matches if:
 *   - its content mentions any impacted symbol (or its tail name), OR
 *   - any impacted file path (or its basename), OR
 *   - its tags list intersects the impacted-file basenames.
 *
 * Match is case-insensitive. Results are ordered by descending match_count
 * then ascending id (stable across runs).
 *
 * precondition:  impactedSymbols and impactedFiles are string arrays.
 * postcondition: result is sorted by (-match_count, id); no duplicates.
 *
 * source: cortex@ed33435 mcp_server/core/change_impact_matcher.py::match_memories:45-98
 */
function matchMemories(
  impactedSymbols: string[],
  impactedFiles:   string[],
  memories: Array<Record<string, unknown>>,
): ImpactMatchResult[] {
  const symTerms = impactedSymbols
    .filter((q) => q)
    .map((q) => ({ full: q, tail: tailOfQualname(q) }));

  const fileTerms = impactedFiles
    .filter((p) => p)
    .map((p) => ({ full: p, base: pathBasename(p) }));

  const out: ImpactMatchResult[] = [];

  for (const mem of memories) {
    const mid = mem["memory_id"] ?? mem["id"];
    if (mid == null) continue;

    const content = String(mem["content"] ?? "").toLowerCase();
    let rawTags = mem["tags"] ?? [];
    if (typeof rawTags === "string") {
      try { rawTags = JSON.parse(rawTags) as unknown[]; } catch { rawTags = []; }
    }
    const tags = new Set<string>(
      Array.isArray(rawTags) ? rawTags.map((t) => String(t).toLowerCase()) : [],
    );

    const matchedSymbols: string[] = [];
    for (const { full, tail } of symTerms) {
      if (content.includes(full.toLowerCase()) || (tail && content.includes(tail.toLowerCase()))) {
        matchedSymbols.push(full);
      }
    }

    const matchedFiles: string[] = [];
    for (const { full, base } of fileTerms) {
      if (content.includes(full.toLowerCase()) || (base && content.includes(base.toLowerCase()))) {
        matchedFiles.push(full);
      } else if (base && tags.has(base.toLowerCase())) {
        matchedFiles.push(full);
      }
    }

    const total = matchedSymbols.length + matchedFiles.length;
    if (total === 0) continue;

    out.push({
      memory_id:       mid as number | string,
      matched_symbols: matchedSymbols,
      matched_files:   matchedFiles,
      match_count:     total,
    });
  }

  out.sort((a, b) => b.match_count - a.match_count || String(a.memory_id).localeCompare(String(b.memory_id)));
  return out;
}

// ── Heat bumping ──────────────────────────────────────────────────────────────

/**
 * Bump heat on the first MAX_HEAT_BUMPS matches. Returns count bumped.
 *
 * precondition:  store.getMemory and store.bumpHeatRaw are available.
 * postcondition: each bumped memory's heat_base = min(1.0, current + IMPACT_BOOST).
 *
 * source: cortex@ed33435 mcp_server/handlers/change_impact.py::_apply_heat_bumps:132-149
 */
function applyHeatBumps(store: MemoryStore, matches: ImpactMatchResult[]): number {
  let bumped = 0;
  for (const m of matches.slice(0, MAX_HEAT_BUMPS)) {
    const mid = Number(m.memory_id);
    if (!Number.isFinite(mid) || mid <= 0) continue;
    try {
      const mem = store.getMemory(mid);
      if (!mem) continue;
      const newHeat = Math.min(1.0, (mem.heat ?? 0) + IMPACT_BOOST);
      store.bumpHeatRaw(mid, newHeat);
      bumped++;
    } catch {
      // silenced — heat bump is best-effort
    }
  }
  return bumped;
}

// ── Public handler ────────────────────────────────────────────────────────────

/**
 * changeImpactHandler — report memories touched by a commit's code changes.
 *
 * precondition:  deps.store is a live MemoryStore; deps.mcpClientPool is the
 *   wired AP pool (or null to skip); deps.projectRoot is the codebase root.
 * postcondition:
 *   - When pool is null or graph path is unresolved: returns {status:"skipped"}.
 *   - Otherwise: returns {status:"ok", impact, matches, heat_bumped}.
 *   - matches is deterministically sorted by (-match_count, memory_id).
 *   - When apply_heat_bump=true: bumpHeatRaw called for up to 20 matches.
 *
 * source: cortex@ed33435 mcp_server/handlers/change_impact.py::handler:152-217
 */
export async function changeImpactHandler(
  args: ChangeImpactArgs,
  deps: ChangeImpactDeps,
): Promise<ChangeImpactResponse> {
  const { store, mcpClientPool, projectRoot = process.cwd() } = deps;

  if (mcpClientPool === null) {
    return {
      status: "skipped",
      reason: "ap_disabled",
      detail:
        "McpClientPool not injected. Wire a real pool via IngestDeps.mcpClientPool " +
        "to compute change impact.",
    };
  }

  // Resolve graph path from cached ingest memory
  const graphPath = findCachedGraph(store, projectRoot);
  if (!graphPath) {
    return {
      status: "skipped",
      reason: "graph_path_unset",
      detail:
        "No cached graph path found for this project. Run ingest_codebase first to " +
        "index the codebase, then retry change_impact.",
    };
  }

  const base   = String(args.base   ?? "HEAD~1");
  const head   = String(args.head   ?? "HEAD");
  const expand = Boolean(args.expand_impact   ?? false);
  const applyBump = Boolean(args.apply_heat_bump ?? false);

  let symbols: string[];
  let files:   string[];
  try {
    const result = await collectImpact(mcpClientPool, graphPath, base, head, expand);
    symbols = result.symbols;
    files   = result.files;
  } catch (err) {
    return {
      status: "skipped",
      reason: "ap_call_failed",
      detail: String(err instanceof Error ? err.message : err),
    };
  }

  // Fetch recent memories for matching
  const storeExt = store as unknown as {
    getAllMemoriesForDecay?: () => Array<Record<string, unknown>>;
  };
  const allMemories = (storeExt.getAllMemoriesForDecay?.() ?? [])
    .slice(0, MAX_MEMORIES_SCANNED);

  const matches = matchMemories(symbols, files, allMemories);
  const bumped  = applyBump ? applyHeatBumps(store, matches) : 0;

  return {
    status: "ok",
    base,
    head,
    impact: { symbols, files, expanded: expand },
    matches,
    heat_bumped: bumped,
  };
}

/** Schema metadata for MCP registry. */
export const schema = {
  title: "Change impact",
  description:
    // source: cortex@ed33435 mcp_server/handlers/change_impact.py — schema description
    "Report which Cortex memories reference code that changed in a commit. " +
    "Uses automatised-pipeline's detect_changes and " +
    "optionally get_impact to compute the symbol/file impact set, then " +
    "matches against recent memories. Read-only by default; pass " +
    // source: cortex@ed33435 mcp_server/handlers/change_impact.py:36-37 — IMPACT_BOOST, MAX_HEAT_BUMPS
    "apply_heat_bump=true to nudge heat on the top matches. " +
    "Requires AP enabled (mcpClientPool injected at composition root).",
};
