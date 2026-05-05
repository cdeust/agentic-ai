/**
 * Handler: unified_search — RRF-fuse Cortex memory recall with AP code search.
 *
 * Port of: cortex@ed33435 mcp_server/handlers/unified_search.py
 *
 * Liskov audit 2026-05-04 corrections:
 *   - status, sources, counts, k restored to response
 *   - AP-search leg restored (calls CodebasePort.searchCodebase)
 *   - Graceful degradation when codebasePort absent (matches Python ap_client is None guard)
 *
 * RRF formula: score(d) = Σ_r 1 / (k + rank_r(d))
 * source: Cormack, Clarke, Buettcher (2009) SIGIR — K=60 canonical value.
 * source: cortex@ed33435 mcp_server/handlers/unified_search.py — canonical contract
 * source: MCP_TOOLS.md §unified_search — return shape and parameters
 */

import { z } from "zod";
import { rrfFuseIds, DEFAULT_RRF_K } from "../../recall/rrf.js";
import type { MemoryRecord } from "../types.js";
import type { MemoryPort } from "./narrative.js";
import type { CodebasePort, SearchCodebaseInput } from "@agentic/core";

// source: mcp_server/handlers/narrative.py:87 — limit=200
const MEMORY_FETCH_LIMIT = 200;
// source: mcp_server/handlers/narrative.py:89 — min_heat=0.1
const HOT_MEMORY_MIN_HEAT = 0.1;
// source: cortex@ed33435 mcp_server/handlers/unified_search.py:ap_limit=20
const AP_SEARCH_LIMIT = 20; // source: cortex@ed33435 mcp_server/handlers/unified_search.py:ap_limit=20
// source: MCP_TOOLS.md §unified_search max_results upper bound
const MAX_RESULTS_CAP = 50; // source: MCP_TOOLS.md §unified_search max=50
// source: MCP_TOOLS.md §unified_search max_results lower bound
const MIN_RESULTS = 1; // source: MCP_TOOLS.md §unified_search min=1
// source: packages/memory/src/recall/multi-signal-fusion.ts::buildRecallResult — 4 decimal places
const SCORE_DECIMAL_SHIFT = 10000; // source: multi-signal-fusion.ts — round to 4 decimal places

export const UnifiedSearchRequestSchema = z.object({
  query:       z.string().min(1),
  domain:      z.string().optional(),
  max_results: z.number().int().min(MIN_RESULTS).max(MAX_RESULTS_CAP).default(10),
  // source: Cormack, Clarke, Buettcher (2009) SIGIR — K=60 canonical
  k:           z.number().int().min(1).default(DEFAULT_RRF_K),
  // source: cortex@ed33435 unified_search.py — optional graph_path for AP leg
  graph_path:  z.string().optional(),
});
export type UnifiedSearchRequest = z.infer<typeof UnifiedSearchRequestSchema>;

export interface UnifiedSearchResult {
  source: "cortex" | "ap";
  score: number;
  content: string;
  tags: string[];
  heat: number;
}

/**
 * UnifiedSearchResponse matches cortex@ed33435 unified_search.py response contract.
 * source: cortex@ed33435 mcp_server/handlers/unified_search.py — response shape lines 84-101
 */
export interface UnifiedSearchResponse {
  status: "ok" | "error";
  results: UnifiedSearchResult[];
  query: string;
  total: number;
  sources: string[];
  counts: { cortex: number; ap: number };
  k: number;
}

export interface UnifiedSearchDeps {
  memoryPort: MemoryPort;
  /**
   * Optional AP code search port. When absent, AP leg is skipped.
   * source: cortex@ed33435 unified_search.py — ap_client is None guard
   */
  codebasePort?: CodebasePort;
}

function scoreRecord(query: string, record: MemoryRecord): number {
  const queryTokens = new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const contentLower = record.content.toLowerCase();
  if (queryTokens.size === 0) return 0;
  let hits = 0;
  for (const token of queryTokens) if (contentLower.includes(token)) hits++;
  return hits / queryTokens.size;
}

function apSymbolToResult(symbol: Record<string, unknown>, score: number): UnifiedSearchResult {
  const name = typeof symbol["name"] === "string" ? symbol["name"] : "";
  const kind = typeof symbol["kind"] === "string" ? symbol["kind"] : "";
  const filePath = typeof symbol["filePath"] === "string" ? symbol["filePath"] : "";
  return {
    source: "ap",
    score: Math.round(score * SCORE_DECIMAL_SHIFT) / SCORE_DECIMAL_SHIFT,
    content: `${filePath}::${name} [${kind}]`,
    tags: ["code-symbol", kind].filter(Boolean),
    heat: 0.0,
  };
}

/**
 * RRF-fuse Cortex memory recall with AP code symbol search.
 *
 * Precondition:  deps.memoryPort is valid; rawArgs passes UnifiedSearchRequestSchema.
 * Postcondition:
 *   status = "ok"; results ordered by descending RRF score bounded to max_results.
 *   sources = ranking signal names contributed.
 *   counts.cortex = raw Cortex memories fetched.
 *   counts.ap = raw AP symbols fetched (0 if AP leg inactive).
 *   k = RRF k parameter used.
 *
 * source: cortex@ed33435 mcp_server/handlers/unified_search.py — contract lines 58-101
 */
export async function unifiedSearchHandler(
  deps: UnifiedSearchDeps,
  rawArgs: unknown,
): Promise<UnifiedSearchResponse> {
  const args: UnifiedSearchRequest = UnifiedSearchRequestSchema.parse(rawArgs ?? {});
  const { query, domain, max_results, k, graph_path } = args;
  const { memoryPort, codebasePort } = deps;

  let memories: MemoryRecord[];
  if (domain) {
    memories = memoryPort.getMemoriesForDomain(domain, 0.0, MEMORY_FETCH_LIMIT);
  } else {
    memories = memoryPort.getHotMemories(HOT_MEMORY_MIN_HEAT, MEMORY_FETCH_LIMIT);
  }

  const textScores = memories.map((m, idx): [number, number] => [idx, scoreRecord(query, m)]);
  const heatScores = memories.map((m, idx): [number, number] => [idx, m.heat]);
  const textRanked = textScores.sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const heatRanked = heatScores.sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const cortexCount = memories.length;

  let apSymbols: Record<string, unknown>[] = [];
  const activeRankLists: [string, number[]][] = [["text", textRanked], ["heat", heatRanked]];

  if (codebasePort !== undefined && graph_path !== undefined && graph_path.length > 0) {
    try {
      const apInput: SearchCodebaseInput = { graphPath: graph_path, query, limit: AP_SEARCH_LIMIT };
      const apResult = await codebasePort.searchCodebase(apInput);
      apSymbols = apResult.results as Record<string, unknown>[];
      // source: cortex@ed33435 unified_search.py — ap result offset by cortex_count
      const apRanked = apSymbols.map((_, i) => cortexCount + i);
      activeRankLists.push(["ap", apRanked]);
    } catch {
      // AP leg failure non-fatal — graceful degradation
      // source: cortex@ed33435 unified_search.py — ap_client call wrapped in try/except
    }
  }

  // source: Cormack, Clarke, Buettcher (2009) SIGIR
  const fused = rrfFuseIds(activeRankLists, k);

  const results: UnifiedSearchResult[] = fused
    .slice(0, max_results)
    .flatMap(([idx, score]): UnifiedSearchResult[] => {
      if (idx < cortexCount) {
        const record = memories[idx];
        if (!record) return [];
        return [{
          source: "cortex",
          score: Math.round(score * SCORE_DECIMAL_SHIFT) / SCORE_DECIMAL_SHIFT,
          content: record.content,
          tags: Array.isArray(record.tags) ? record.tags : [],
          heat: record.heat,
        }];
      }
      const sym = apSymbols[idx - cortexCount];
      if (!sym) return [];
      return [apSymbolToResult(sym, score)];
    });

  return {
    status: "ok",
    results,
    query,
    total: results.length,
    sources: activeRankLists.map(([name]) => name),
    counts: { cortex: cortexCount, ap: apSymbols.length },
    k,
  };
}
