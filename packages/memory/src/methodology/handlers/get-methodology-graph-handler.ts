/**
 * Handler for the get_methodology_graph tool — graph data for visualization.
 *
 * Port of: mcp_server/handlers/get_methodology_graph.py
 * source: cortex@ed33435 mcp_server/handlers/get_methodology_graph.py
 */

import { READ_ONLY } from "../../shared/tool-meta.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface MethodologyGraphArgs {
  domain?: string;
}

export interface GraphNode {
  quality?: number;
  [k: string]: unknown;
}

export interface GraphEdge {
  weight?: number;
  [k: string]: unknown;
}

export interface MethodologyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta?: Record<string, unknown>;
  truncated_nodes?: number;
  truncated_edges?: number;
}

export interface ProfileStore {
  loadProfiles(): Record<string, unknown>;
}

export interface GraphBuilder {
  buildGraph(
    profiles: Record<string, unknown>,
    domain: string | undefined,
  ): MethodologyGraph;
}

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/get_methodology_graph.py:41
const MAX_NODES = 200;
// source: cortex@ed33435 mcp_server/handlers/get_methodology_graph.py:42
const MAX_EDGES = 500;

// ── Schema ─────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/get_methodology_graph.py:9

export const schema = {
  title: "Get methodology graph",
  annotations: READ_ONLY,
  description:
    "Build the methodology map as JSON graph data {nodes, edges, " +
    "meta} suitable for force-directed visualization. Nodes: " +
    "domains, concepts, memories, entities. Edges: cross-domain " +
    "bridges, co-activation strengths, semantic relationships. " +
    "Output is capped (200 nodes / 500 edges, highest-quality first) " +
    "so the payload stays embeddable in a single MCP response. Use " +
    "this to feed a CUSTOM client visualizer. Distinct from " +
    "`open_visualization` (launches the bundled browser UI on " +
    "127.0.0.1:3458, no JSON returned), `list_domains` (text-only " +
    "domain overview), and `get_causal_chain` (entity-graph BFS, " +
    "not the unified methodology map). Read-only on profiles.json + " +
    "memories. Latency <100ms. Returns {nodes, edges, meta, " +
    "truncated_nodes?, truncated_edges?}.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      domain: {
        type: "string",
        description:
          "Restrict the graph to a single cognitive domain. Omit for the full cross-domain graph.",
        examples: ["cortex", "auth-service"],
      },
    },
  },
} as const;

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Build the methodology graph with size-cap.
 *
 * precondition: profileStore.loadProfiles() returns a valid profiles dict.
 * postcondition: returns graph with ≤200 nodes (highest quality first)
 *   and ≤500 edges (highest weight first); truncation counts present
 *   when caps were applied.
 *
 * Port of: mcp_server/handlers/get_methodology_graph.py::handler
 * source: cortex@ed33435 mcp_server/handlers/get_methodology_graph.py:45
 */
export async function handler(
  args: MethodologyGraphArgs | null | undefined,
  profileStore: ProfileStore,
  graphBuilder: GraphBuilder,
): Promise<MethodologyGraph> {
  const a = args ?? {};
  const profiles = profileStore.loadProfiles();
  const graph = graphBuilder.buildGraph(profiles, a.domain);

  let { nodes, edges } = graph;

  // Cap output size to prevent multi-megabyte responses
  // source: cortex@ed33435 mcp_server/handlers/get_methodology_graph.py:52
  if (nodes.length > MAX_NODES) {
    nodes = [...nodes].sort((a, b) => Number(b.quality ?? 0) - Number(a.quality ?? 0));
    graph.truncated_nodes = nodes.length - MAX_NODES;
    nodes = nodes.slice(0, MAX_NODES);
  }
  if (edges.length > MAX_EDGES) {
    edges = [...edges].sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0));
    graph.truncated_edges = edges.length - MAX_EDGES;
    edges = edges.slice(0, MAX_EDGES);
  }

  return { ...graph, nodes, edges };
}
