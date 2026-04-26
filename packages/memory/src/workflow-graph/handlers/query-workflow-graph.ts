/**
 * Handler for the query_workflow_graph tool (Gap 1).
 *
 * Returns a typed subgraph from the already-built workflow graph via a
 * declarative filter. Filters:
 *   node_kind     — keep nodes of one or more kinds
 *   edge_kind     — keep edges of one or more kinds
 *   neighbour_of  — k-hop neighbourhood around a specific node id
 *   depth         — 1 or 2 (guards against N² blowup on a 27k-node graph)
 *   domain        — restrict to one domain
 *   limit_nodes   — hard cap on returned nodes (default 500, max 5000)
 *
 * Pure composition root. No I/O itself.
 *
 * source: Cortex mcp_server/handlers/query_workflow_graph.py
 */

import type { WorkflowGraphPayload } from "./workflow-graph.js";

// Node-count caps — measured 2026-04-23 on Cortex's 27k-node graph:
// 500 nodes serialise to ≈120 KB, 5000 ≈1.2 MB.
// source: Cortex query_workflow_graph.py _DEFAULT_LIMIT / _MAX_LIMIT
const _DEFAULT_LIMIT = 500;
const _MAX_LIMIT = 5000;

export const schema = {
  title: "Query the Claude workflow graph",
  description:
    "Return a typed subgraph of the unified workflow graph — the same graph " +
    "the browser visualization renders, but filtered down to the slice a " +
    "downstream tool actually needs. Filters: node_kind (one or more of domain, " +
    "skill, command, hook, agent, tool_hub, file, memory, discussion, entity, " +
    "mcp, symbol), edge_kind (one or more of in_domain, tool_used_file, calls, " +
    "imports, defined_in, member_of, about_entity, triggered_hook, " +
    "invoked_skill, spawned_agent, invoked_mcp, …), neighbour_of (a node id; " +
    "returns the k-hop subgraph around it), depth (1 or 2 hops — default 1), " +
    "domain (restrict to one project), limit_nodes (cap, default 500, max 5000).",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      node_kind: {
        type: ["string", "array"],
        items: { type: "string" },
        description: "Keep nodes of this kind (one or a list). Omit for every kind.",
      },
      edge_kind: {
        type: ["string", "array"],
        items: { type: "string" },
        description: "Keep edges of this kind (one or a list). Omit for every kind.",
      },
      neighbour_of: {
        type: "string",
        description:
          "Return the k-hop subgraph around this node id. " +
          "Example ids: symbol:abc123, file:deadbeef, domain:cortex.",
      },
      depth: {
        type: "integer",
        minimum: 1,
        maximum: 2,
        default: 1,
        description: "BFS depth for neighbour_of. 1 = direct neighbours, 2 = two hops.",
      },
      domain: {
        type: "string",
        description: "Restrict to one project's subgraph.",
      },
      limit_nodes: {
        type: "integer",
        minimum: 1,
        maximum: 5000,
        default: 500,
        description: "Hard cap on returned nodes. Trimmed nodes get reported in meta.truncated_nodes.",
      },
    },
  },
} as const;

// ── Filter utilities ──────────────────────────────────────────────────────

function asSet(value: unknown): Set<string> | null {
  /** Normalise a string-or-array filter argument to a Set, or null. */
  if (value == null) return null;
  if (typeof value === "string") return value ? new Set([value]) : null;
  if (Array.isArray(value)) {
    const out = new Set(
      (value as unknown[]).map(String).filter(Boolean),
    );
    return out.size > 0 ? out : null;
  }
  return null;
}

function edgeKindOf(e: Record<string, unknown>): string {
  return String(e["kind"] ?? e["type"] ?? "");
}

function nodeKindOf(n: Record<string, unknown>): string {
  return String(n["kind"] ?? n["type"] ?? "");
}

function edgeEndpoints(e: Record<string, unknown>): [string, string] {
  const s = e["source"];
  const t = e["target"];
  const sId = typeof s === "object" && s !== null
    ? String((s as Record<string, unknown>)["id"] ?? "")
    : String(s ?? "");
  const tId = typeof t === "object" && t !== null
    ? String((t as Record<string, unknown>)["id"] ?? "")
    : String(t ?? "");
  return [sId, tId];
}

function bfsNeighbourhood(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[],
  seed: string,
  depth: number,
): [reached: Set<string>, keptEdges: Record<string, unknown>[]] {
  /**
   * Return (node_ids, surviving_edges) for a k-hop BFS around seed.
   *
   * Edges whose both endpoints are in the surviving set are kept.
   * Undirected BFS: both forward and reverse edges expand the frontier.
   */
  if (depth < 1) return [new Set([seed]), []];
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const [s, t] = edgeEndpoints(e);
    if (!s || !t) continue;
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s)!.push(t);
    adj.get(t)!.push(s);
  }
  let frontier = new Set([seed]);
  const reached = new Set([seed]);
  for (let i = 0; i < depth; i++) {
    const nextFrontier = new Set<string>();
    for (const nid of frontier) {
      for (const other of adj.get(nid) ?? []) {
        if (!reached.has(other)) nextFrontier.add(other);
      }
    }
    for (const n of nextFrontier) reached.add(n);
    if (nextFrontier.size === 0) break;
    frontier = nextFrontier;
  }
  const keptEdges = edges.filter((e) => {
    const [s, t] = edgeEndpoints(e);
    return reached.has(s) && reached.has(t);
  });
  return [reached, keptEdges];
}

function pruneDanglingEdges(
  edges: Record<string, unknown>[],
  nodeIds: Set<string>,
): Record<string, unknown>[] {
  /** Drop edges whose either endpoint is outside nodeIds. */
  return edges.filter((e) => {
    const [s, t] = edgeEndpoints(e);
    return nodeIds.has(s) && nodeIds.has(t);
  });
}

function capNodesByHeat(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[],
  limit: number,
): [nodes: Record<string, unknown>[], edges: Record<string, unknown>[], truncated: number] {
  /** Trim nodes to limit rows ranked by heat (desc). */
  if (nodes.length <= limit) return [nodes, edges, 0];
  const sorted = [...nodes].sort(
    (a, b) =>
      (parseFloat(String(b["heat"] ?? b["size"] ?? 0)) || 0) -
      (parseFloat(String(a["heat"] ?? a["size"] ?? 0)) || 0),
  );
  const truncated = nodes.length - limit;
  const kept = sorted.slice(0, limit);
  const keptIds = new Set(kept.map((n) => String(n["id"] ?? "")));
  return [kept, pruneDanglingEdges(edges, keptIds), truncated];
}

function buildMeta(
  graph: WorkflowGraphPayload,
  opts: {
    nodeKinds: Set<string> | null;
    edgeKinds: Set<string> | null;
    neighbourOf: string | null;
    depth: number;
    limitNodes: number;
    truncated: number;
  },
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...(graph.meta ?? {}) };
  meta["filtered"] = true;
  meta["filter"] = {
    node_kind: opts.nodeKinds ? [...opts.nodeKinds].sort() : null,
    edge_kind: opts.edgeKinds ? [...opts.edgeKinds].sort() : null,
    neighbour_of: opts.neighbourOf,
    depth: opts.neighbourOf ? opts.depth : null,
    limit_nodes: opts.limitNodes,
  };
  if (opts.truncated > 0) {
    meta["truncated_nodes"] = opts.truncated;
  }
  return meta;
}

export function applyFilters(
  graph: WorkflowGraphPayload,
  opts: {
    nodeKinds: Set<string> | null;
    edgeKinds: Set<string> | null;
    neighbourOf: string | null;
    depth: number;
    limitNodes: number;
  },
): WorkflowGraphPayload {
  /**
   * Apply BFS → edge_kind → node_kind → cap in that order.
   *
   * BFS runs over the FULL edge set so hop-count reflects structural
   * reachability; edge_kind then slices edges inside the reached radius.
   * The output subgraph may violate validateGraph (a node_kind={'symbol'}
   * slice drops every in_domain edge) — by design: this is a data query,
   * not a renderable full graph.
   */
  let nodes: Record<string, unknown>[] = [...(graph.nodes ?? [])];
  let edges: Record<string, unknown>[] = [
    ...(graph.edges ?? graph.links ?? []),
  ];

  if (opts.neighbourOf) {
    const [reached, keptEdges] = bfsNeighbourhood(
      nodes,
      edges,
      opts.neighbourOf,
      opts.depth,
    );
    nodes = nodes.filter((n) => reached.has(String(n["id"] ?? "")));
    edges = keptEdges;
  }

  if (opts.edgeKinds !== null) {
    edges = edges.filter((e) => opts.edgeKinds!.has(edgeKindOf(e)));
  }

  if (opts.nodeKinds !== null) {
    nodes = nodes.filter((n) => opts.nodeKinds!.has(nodeKindOf(n)));
    edges = pruneDanglingEdges(edges, new Set(nodes.map((n) => String(n["id"] ?? ""))));
  }

  const [cappedNodes, cappedEdges, truncated] = capNodesByHeat(
    nodes,
    edges,
    opts.limitNodes,
  );

  const meta = buildMeta(graph, { ...opts, truncated });

  return { nodes: cappedNodes, edges: cappedEdges, links: cappedEdges, meta };
}

export interface QueryWorkflowGraphArgs {
  node_kind?: string | string[];
  edge_kind?: string | string[];
  neighbour_of?: string;
  depth?: number;
  domain?: string;
  limit_nodes?: number;
}

export function queryWorkflowGraph(
  graph: WorkflowGraphPayload,
  args: QueryWorkflowGraphArgs = {},
): WorkflowGraphPayload {
  /**
   * Apply the requested filter to an already-built graph payload.
   *
   * In the Python original this is an async handler that builds the graph
   * itself; in the TS port it accepts a pre-built payload so the build
   * step can be tested separately and the handler is a pure function.
   */
  const depthRaw = args.depth;
  const depth =
    depthRaw != null
      ? Math.max(1, Math.min(2, Math.trunc(Number(depthRaw))))
      : 1;

  const limitRaw = args.limit_nodes;
  const limitNodes = Math.max(
    1,
    Math.min(
      _MAX_LIMIT,
      limitRaw != null ? Math.trunc(Number(limitRaw)) : _DEFAULT_LIMIT,
    ),
  );

  return applyFilters(graph, {
    nodeKinds: asSet(args.node_kind),
    edgeKinds: asSet(args.edge_kind),
    neighbourOf: args.neighbour_of ?? null,
    depth,
    limitNodes,
  });
}
