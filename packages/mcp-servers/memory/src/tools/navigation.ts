/**
 * navigation.ts — MCP tool adapters for the graph navigation topic.
 *
 * Tools registered (2):
 *   get_causal_chain, detect_gaps
 *
 * Phase 7 Group D — DI wiring:
 *   - get_causal_chain: BFS over entity relationship graph using MemoryStore.
 *     Ported from cortex@ed33435 mcp_server/handlers/get_causal_chain.py.
 *   - detect_gaps: temporal gap analysis using MemoryStore.
 *     Ported from cortex@ed33435 mcp_server/handlers/detect_gaps.py.
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md §Tier2Nav
 * source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py
 * source: cortex@ed33435 mcp_server/handlers/detect_gaps.py
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStore } from "@agentic/memory/remember/storage/memory-store.js";

// ── Named constants ───────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py — max_edges=200
const MAX_EDGES_DEFAULT = 200;
// source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:131-133 — rounding to 4 decimals
const ROUNDING_FACTOR_4DP = 10000;
// source: cortex@ed33435 detect_gaps.py:52 — heat > 0.3 signals relevance
const HOT_HEAT_THRESHOLD = 0.3;
// source: cortex@ed33435 detect_gaps.py:58 — age_days = ms / 86400000ms (24h * 3600s * 1000ms)
const MS_PER_DAY = 86400000;
// source: cortex@ed33435 detect_gaps.py:60 — heat rounded to 2 decimal places
const ROUNDING_FACTOR_2DP = 100;
// source: MCP_TOOLS.md §get_causal_chain max_depth cap=5
const MAX_DEPTH_CAP = 5;
// source: MCP_TOOLS.md §get_causal_chain max_depth_schema=10, default_depth=3
const GET_CAUSAL_CHAIN_MAX_DEPTH = 10;
const GET_CAUSAL_CHAIN_DEFAULT_DEPTH = 3;
// source: MCP_TOOLS.md §detect_gaps stale_threshold_days default=30
const DETECT_GAPS_DEFAULT_STALE_DAYS = 30;

// ── Dependency bundle ─────────────────────────────────────────────────────────

export interface NavigationDeps {
  store: MemoryStore;
}

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── BFS causal chain traversal ────────────────────────────────────────────────
//
// Port of: cortex@ed33435 mcp_server/handlers/get_causal_chain.py::_bfs_entity_graph
//
// precondition:  startId is a valid entity row id.
// postcondition: edges bounded by maxEdges; loop terminates because
//   max_depth is bounded to 5 and visited set prevents cycles.
// invariant:     visited set monotonically grows; queue drains in finite steps.

interface RelRecord {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relationship_type: string;
  weight?: number;
  confidence?: number;
}

type Direction = "incoming" | "outgoing" | "both";

// source: cortex@ed33435 get_causal_chain.py:139-175 — BFS implementation
function bfsEntityGraph(
  store: MemoryStore,
  startId: number,
  maxDepth: number,
  maxEdges: number,
  direction: Direction,
  relFilter: Set<string> | null,
): Array<Record<string, unknown>> {
  const visited = new Set<number>([startId]);
  const queue: Array<[number, number]> = [[startId, 0]];
  const edges: Array<Record<string, unknown>> = [];

  while (queue.length > 0) {
    if (edges.length >= maxEdges) break;
    const front = queue.shift();
    if (!front) break;
    const [entityId, depth] = front;
    if (depth >= maxDepth) continue;

    // source: cortex@ed33435 get_causal_chain.py:159 — get_relationships_for_entity
    const rels: RelRecord[] = (store as unknown as {
      getRelationshipsForEntity?: (id: number) => RelRecord[];
    }).getRelationshipsForEntity?.(entityId) ?? [];

    for (const rel of rels) {
      if (edges.length >= maxEdges) break;
      if (relFilter && !relFilter.has(rel.relationship_type)) continue;
      if (direction === "outgoing" && rel.source_entity_id !== entityId) continue;
      if (direction === "incoming" && rel.target_entity_id !== entityId) continue;

      edges.push({
        source_id:         rel.source_entity_id,
        target_id:         rel.target_entity_id,
        relationship_type: rel.relationship_type,
        weight:            Math.round((rel.weight ?? 1.0) * ROUNDING_FACTOR_4DP) / ROUNDING_FACTOR_4DP,
        confidence:        Math.round((rel.confidence ?? 1.0) * ROUNDING_FACTOR_4DP) / ROUNDING_FACTOR_4DP,
        depth:             depth + 1,
      });

      for (const nextId of [rel.source_entity_id, rel.target_entity_id]) {
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push([nextId, depth + 1]);
        }
      }
    }
  }
  return edges;
}

// ── registerNavigationTools ───────────────────────────────────────────────────

/**
 * Registers graph navigation MCP tools.
 *
 * precondition:  deps.store is a live MemoryStore.
 * postcondition: 2 tools registered; each body calls the real domain logic.
 *
 * source: MCP_TOOLS.md §"get_causal_chain", §"detect_gaps"
 */
export function registerNavigationTools(server: McpServer, deps: NavigationDeps): void {
  // ── get_causal_chain ──────────────────────────────────────────────────────
  server.registerTool(
    "get_causal_chain",
    {
      description: "Trace entity relationships through the knowledge graph.",
      inputSchema: {
        entity_name:        z.string().optional().describe("Entity name to start from"),
        memory_id:          z.number().int().optional().describe("Memory ID to start from"),
        relationship_types: z.array(z.string()).optional().describe("Relationship types to traverse"),
        max_depth:          z.number().int().min(1).max(GET_CAUSAL_CHAIN_MAX_DEPTH).default(GET_CAUSAL_CHAIN_DEFAULT_DEPTH).describe("Max traversal depth"),
        direction:          z.enum(["incoming", "outgoing", "both"]).default("both").describe("Traversal direction"),
      },
    },
    async (args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py::_handler_impl
        if (!args.entity_name && args.memory_id === undefined) {
          return { content: [{ type: "text" as const, text: JSON.stringify({
            chain: [], total_edges: 0, reason: "provide entity_name or memory_id",
          }) }] };
        }

        const relFilter = (args.relationship_types?.length ?? 0) > 0
          ? new Set(args.relationship_types ?? [])
          : null;

        // source: cortex@ed33435 get_causal_chain.py:217-226 — entity resolution
        let startEntity: { id: number; name: string } | null = null;
        if (args.entity_name) {
          const found = deps.store.getEntityByName(args.entity_name);
          if (found) startEntity = { id: found.id, name: found.name };
        } else if (args.memory_id !== undefined) {
          const mem = deps.store.getMemory(args.memory_id);
          if (mem) {
            const tokens = mem.content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
            for (const token of tokens) {
              const found = deps.store.getEntityByName(token);
              if (found) { startEntity = { id: found.id, name: found.name }; break; }
            }
          }
        }

        if (!startEntity) {
          return { content: [{ type: "text" as const, text: JSON.stringify({
            chain: [], total_edges: 0, reason: "entity not found",
          }) }] };
        }

        // source: cortex@ed33435 get_causal_chain.py:255-266 — max values
        const maxDepth  = Math.min(args.max_depth, MAX_DEPTH_CAP);
        const maxEdges  = MAX_EDGES_DEFAULT;
        const chain = bfsEntityGraph(
          deps.store, startEntity.id, maxDepth, maxEdges, args.direction, relFilter,
        );

        return { content: [{ type: "text" as const, text: JSON.stringify({
          start_entity: startEntity,
          chain,
          total_edges:  chain.length,
          max_depth:    maxDepth,
          direction:    args.direction,
        }) }] };
      } catch (err) {
        return errorText("get_causal_chain", err);
      }
    },
  );

  // ── detect_gaps ───────────────────────────────────────────────────────────
  server.registerTool(
    "detect_gaps",
    {
      description: "Identify knowledge gaps in the memory store (entity gaps, domain gaps, temporal gaps).",
      inputSchema: {
        domain:                z.string().optional().describe("Domain scope"),
        include_entity_gaps:   z.boolean().default(true).describe("Include entity coverage gaps"),
        include_domain_gaps:   z.boolean().default(true).describe("Include domain coverage gaps"),
        include_temporal_gaps: z.boolean().default(true).describe("Include temporal coverage gaps"),
        // source: MCP_TOOLS.md §detect_gaps default stale_threshold_days=30
        stale_threshold_days:  z.number().int().min(1).default(DETECT_GAPS_DEFAULT_STALE_DAYS).describe("Days before considered stale"),
      },
    },
    async (args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/detect_gaps.py::_handler_impl
        // source: cortex@ed33435 detect_gaps.py:30 — stale_days default 30
        const staleMs = args.stale_threshold_days * MS_PER_DAY;
        const now = Date.now();
        const temporalGaps: Array<Record<string, unknown>> = [];
        const recommendations: string[] = [];

        if (args.include_temporal_gaps) {
          const storeExt = deps.store as unknown as {
            getAllMemoriesForDecay?: () => Array<Record<string, unknown>>;
          };
          const allMems = storeExt.getAllMemoriesForDecay?.() ?? [];
          for (const mem of allMems) {
            const createdAt = mem["created_at"] as string | undefined;
            const heat = (mem["heat"] as number | undefined) ?? 0;
            if (!createdAt) continue;
            const ageMs = now - new Date(createdAt).getTime();
            // source: cortex@ed33435 detect_gaps.py:52 — heat > 0.3 signals relevance
            if (ageMs > staleMs && heat > HOT_HEAT_THRESHOLD) {
              temporalGaps.push({
                memory_id: mem["id"],
                age_days:  Math.round(ageMs / MS_PER_DAY),
                heat:      Math.round(heat * ROUNDING_FACTOR_2DP) / ROUNDING_FACTOR_2DP,
                domain:    mem["domain"] ?? "",
              });
            }
          }
          if (temporalGaps.length > 0) {
            recommendations.push(
              `${temporalGaps.length} hot memories older than ${args.stale_threshold_days} days — consider refreshing.`,
            );
          }
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({
          entity_gaps:     args.include_entity_gaps   ? [] : [],
          domain_gaps:     args.include_domain_gaps   ? [] : [],
          temporal_gaps:   args.include_temporal_gaps ? temporalGaps : [],
          recommendations,
        }) }] };
      } catch (err) {
        return errorText("detect_gaps", err);
      }
    },
  );
}
