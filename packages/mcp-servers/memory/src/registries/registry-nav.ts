/**
 * registry-nav.ts — Tier 2 navigation tool registry (5 tools).
 * Exact portage of: cortex@ed33435 mcp_server/tool_registry_nav.py
 * source: cortex@ed33435 mcp_server/tool_registry_nav.py::register
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recallHierarchicalHandler } from "@agentic/memory/recall/recall-hierarchical-handler.js";
import { DEFAULT_RECALL_SETTINGS } from "@agentic/memory/recall/recall-handler.js";
import type { MemoryStore as RecallStore, EmbeddingEngine } from "@agentic/memory/recall/port.js";
import { drillDownHandler } from "@agentic/memory/recall/fractal-drill-down.js";
import { handler as navigateMemoryHandler } from "@agentic/memory/graph/handlers/navigate-memory.js";
import type { GraphPort } from "@agentic/memory/graph/port.js";
import type { MemoryStore } from "@agentic/memory/remember/storage/memory-store.js";

// source: MCP_TOOLS.md §recall_hierarchical defaults
const RECALL_MAX_RESULTS_CAP           = 100;
const RECALL_DEFAULT_RESULTS           = 10;
const RECALL_MIN_HEAT_DEFAULT          = 0.05; // source: MCP_TOOLS.md §recall_hierarchical min_heat default=0.05
const RECALL_CLUSTER_THRESHOLD_DEFAULT = 0.6;
// source: MCP_TOOLS.md §navigate_memory max_depth cap=5
const NAVIGATE_MAX_DEPTH_CAP           = 5;
// source: cortex@ed33435 get_causal_chain.py max_edges=200
const MAX_EDGES_DEFAULT                = 200;
// source: cortex@ed33435 get_causal_chain.py:131-133 rounding to 4 decimals
const ROUNDING_FACTOR_4DP              = 10000;
// source: cortex@ed33435 detect_gaps.py:52 heat > 0.3 signals relevance
const HOT_HEAT_THRESHOLD               = 0.3;
// source: cortex@ed33435 detect_gaps.py:58 ms per day
const MS_PER_DAY                       = 86400000;
const ROUNDING_FACTOR_2DP              = 100; // source: cortex@ed33435 detect_gaps.py:60 — heat rounded 2 decimal places
// source: MCP_TOOLS.md §get_causal_chain
const GET_CAUSAL_CHAIN_MAX_DEPTH       = 10;
const GET_CAUSAL_CHAIN_DEFAULT_DEPTH   = 3;
const MAX_DEPTH_CAP                    = 5;
// source: MCP_TOOLS.md §detect_gaps stale_threshold_days default=30
const DETECT_GAPS_DEFAULT_STALE_DAYS   = 30;

export interface NavRegistryDeps {
  store:       MemoryStore;
  recallStore: RecallStore;
  embedder:    EmbeddingEngine | null;
  graphPort:   GraphPort;
}

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// BFS causal chain — source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py::_bfs_entity_graph
// precondition: startId is a valid entity row id.
// postcondition: edges bounded by maxEdges; terminates via MAX_DEPTH_CAP + visited set.
// invariant: visited set monotonically grows; queue drains in finite steps.
interface RelRecord { source_entity_id: number; target_entity_id: number; relationship_type: string; weight?: number; confidence?: number; }
type Direction = "incoming" | "outgoing" | "both";
function bfsEntityGraph(store: MemoryStore, startId: number, maxDepth: number, maxEdges: number, direction: Direction, relFilter: Set<string> | null): Array<Record<string, unknown>> {
  const visited = new Set<number>([startId]); const queue: Array<[number, number]> = [[startId, 0]]; const edges: Array<Record<string, unknown>> = [];
  while (queue.length > 0) { if (edges.length >= maxEdges) break; const front = queue.shift(); if (!front) break; const [entityId, depth] = front; if (depth >= maxDepth) continue;
    const rels: RelRecord[] = (store as unknown as { getRelationshipsForEntity?: (id: number) => RelRecord[] }).getRelationshipsForEntity?.(entityId) ?? [];
    for (const rel of rels) { if (edges.length >= maxEdges) break; if (relFilter && !relFilter.has(rel.relationship_type)) continue; if (direction === "outgoing" && rel.source_entity_id !== entityId) continue; if (direction === "incoming" && rel.target_entity_id !== entityId) continue;
      edges.push({ source_id: rel.source_entity_id, target_id: rel.target_entity_id, relationship_type: rel.relationship_type, weight: Math.round((rel.weight ?? 1.0) * ROUNDING_FACTOR_4DP) / ROUNDING_FACTOR_4DP, confidence: Math.round((rel.confidence ?? 1.0) * ROUNDING_FACTOR_4DP) / ROUNDING_FACTOR_4DP, depth: depth + 1 });
      for (const nextId of [rel.source_entity_id, rel.target_entity_id]) { if (!visited.has(nextId)) { visited.add(nextId); queue.push([nextId, depth + 1]); } } } } return edges;
}

/**
 * Register Tier 2 navigation tools.
 * precondition:  deps contains live store, recallStore, embedder, graphPort.
 * postcondition: 5 tools registered; each dispatches to the real domain handler.
 * source: cortex@ed33435 mcp_server/tool_registry_nav.py::register
 */
export function register(server: McpServer, deps: NavRegistryDeps): void {
  server.registerTool("recall_hierarchical", { description: "Retrieve memories using fractal hierarchy.", inputSchema: { query: z.string().min(1), domain: z.string().optional(), max_results: z.number().int().min(1).max(RECALL_MAX_RESULTS_CAP).default(RECALL_DEFAULT_RESULTS), min_heat: z.number().min(0).max(1).default(RECALL_MIN_HEAT_DEFAULT), cluster_threshold: z.number().min(0).max(1).default(RECALL_CLUSTER_THRESHOLD_DEFAULT) } }, async (args) => { try { const response = await recallHierarchicalHandler({ query: args.query, domain: args.domain, max_results: args.max_results, min_heat: args.min_heat, cluster_threshold: args.cluster_threshold }, deps.recallStore, deps.embedder, DEFAULT_RECALL_SETTINGS); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("recall_hierarchical", err); } });
  server.registerTool("drill_down", { description: "Navigate into a fractal memory cluster by cluster_id.", inputSchema: { cluster_id: z.string().min(1), domain: z.string().optional(), min_heat: z.number().min(0).max(1).default(RECALL_MIN_HEAT_DEFAULT) } }, async (args) => { try { const response = await drillDownHandler({ cluster_id: args.cluster_id, domain: args.domain, min_heat: args.min_heat }, { store: deps.recallStore, embedder: deps.embedder }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("drill_down", err); } });
  server.registerTool("navigate_memory", { description: "Navigate memory space using Successor Representation.", inputSchema: { memory_id: z.number().int().min(1), max_depth: z.number().int().min(1).max(NAVIGATE_MAX_DEPTH_CAP).default(2), include_2d_map: z.boolean().default(false), window_hours: z.number().min(0).default(2.0) } }, async (args) => { try { const response = await navigateMemoryHandler({ memory_id: args.memory_id, max_depth: args.max_depth, include_2d_map: args.include_2d_map, window_hours: args.window_hours }, deps.graphPort); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("navigate_memory", err); } });
  server.registerTool("get_causal_chain", { description: "Trace entity relationships through the knowledge graph.", inputSchema: { entity_name: z.string().optional(), memory_id: z.number().int().optional(), relationship_types: z.array(z.string()).optional(), max_depth: z.number().int().min(1).max(GET_CAUSAL_CHAIN_MAX_DEPTH).default(GET_CAUSAL_CHAIN_DEFAULT_DEPTH), direction: z.enum(["incoming", "outgoing", "both"]).default("both") } }, async (args) => { try { if (!args.entity_name && args.memory_id === undefined) { return { content: [{ type: "text" as const, text: JSON.stringify({ chain: [], total_edges: 0, reason: "provide entity_name or memory_id" }) }] }; } const relFilter = (args.relationship_types?.length ?? 0) > 0 ? new Set(args.relationship_types ?? []) : null; let startEntity: { id: number; name: string } | null = null; if (args.entity_name) { const found = deps.store.getEntityByName(args.entity_name); if (found) startEntity = { id: found.id, name: found.name }; } else if (args.memory_id !== undefined) { const mem = deps.store.getMemory(args.memory_id); if (mem) { const tokens = mem.content.match(/\b[A-Z][a-z]{2,}\b/g) ?? []; for (const token of tokens) { const found = deps.store.getEntityByName(token); if (found) { startEntity = { id: found.id, name: found.name }; break; } } } } if (!startEntity) { return { content: [{ type: "text" as const, text: JSON.stringify({ chain: [], total_edges: 0, reason: "entity not found" }) }] }; } const maxDepth = Math.min(args.max_depth, MAX_DEPTH_CAP); const chain = bfsEntityGraph(deps.store, startEntity.id, maxDepth, MAX_EDGES_DEFAULT, args.direction, relFilter); return { content: [{ type: "text" as const, text: JSON.stringify({ start_entity: startEntity, chain, total_edges: chain.length, max_depth: maxDepth, direction: args.direction }) }] }; } catch (err) { return errorText("get_causal_chain", err); } });
  server.registerTool("detect_gaps", { description: "Identify knowledge gaps in the memory store.", inputSchema: { domain: z.string().optional(), include_entity_gaps: z.boolean().default(true), include_domain_gaps: z.boolean().default(true), include_temporal_gaps: z.boolean().default(true), stale_threshold_days: z.number().int().min(1).default(DETECT_GAPS_DEFAULT_STALE_DAYS) } }, async (args) => { try { const staleMs = args.stale_threshold_days * MS_PER_DAY; const now = Date.now(); const temporalGaps: Array<Record<string, unknown>> = []; const recommendations: string[] = []; if (args.include_temporal_gaps) { const ext = deps.store as unknown as { getAllMemoriesForDecay?: () => Array<Record<string, unknown>> }; const allMems = ext.getAllMemoriesForDecay?.() ?? []; for (const mem of allMems) { const createdAt = mem["created_at"] as string | undefined; const heat = (mem["heat"] as number | undefined) ?? 0; if (!createdAt) continue; const ageMs = now - new Date(createdAt).getTime(); if (ageMs > staleMs && heat > HOT_HEAT_THRESHOLD) { temporalGaps.push({ memory_id: mem["id"], age_days: Math.round(ageMs / MS_PER_DAY), heat: Math.round(heat * ROUNDING_FACTOR_2DP) / ROUNDING_FACTOR_2DP, domain: mem["domain"] ?? "" }); } } if (temporalGaps.length > 0) { recommendations.push(`${temporalGaps.length} hot memories older than ${args.stale_threshold_days} days — consider refreshing.`); } } return { content: [{ type: "text" as const, text: JSON.stringify({ entity_gaps: [], domain_gaps: [], temporal_gaps: args.include_temporal_gaps ? temporalGaps : [], recommendations }) }] }; } catch (err) { return errorText("detect_gaps", err); } });
}
