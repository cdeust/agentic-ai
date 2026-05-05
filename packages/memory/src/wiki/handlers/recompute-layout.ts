/**
 * POST /api/recompute_layout — orchestrate the layout pipeline.
 *
 * Composition root: pulls the cached graph from the standalone server's
 * in-memory cache, asks core.layout_engine to compute (x, y), and
 * persists the result via infrastructure.layout_pg_store.
 *
 * The handler is synchronous in v1 — at 1M nodes a DrL pass takes
 * roughly 90s on an M-series Mac, ~3 min on older Intel.
 *
 * Port of: mcp_server/handlers/recompute_layout.py
 * source: cortex@ed33435 mcp_server/handlers/recompute_layout.py
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface GraphData {
  nodes?: Array<{ id: string; kind?: string; [k: string]: unknown }>;
  edges?: Array<{
    source: string | { id?: string };
    target: string | { id?: string };
    [k: string]: unknown;
  }>;
}

export interface LayoutStore {
  readLayoutVersion(): Promise<{ fingerprint: string; count: number; version: number } | null>;
  writeLayout(
    coords: Record<string, { x: number; y: number }>,
    kinds: Record<string, string>,
    topologyFingerprint: string,
  ): Promise<number>;
}

export interface LayoutEngine {
  topologyFingerprint(nodeIds: string[], edges: Array<[string, string]>): string;
  layout(nodeIds: string[], edges: Array<[string, string]>): Promise<Record<string, { x: number; y: number }>>;
}

export type RecomputeLayoutResult =
  | {
      status: "ok";
      node_count: number;
      edge_count: number;
      elapsed_ms: number;
      topology_fingerprint: string;
      layout_version: number;
      cached: boolean;
    }
  | { status: "error"; reason: string; detail?: string };

// ── Topology extraction ────────────────────────────────────────────────────

/**
 * Pull ids + edges + kind map out of the cached /api/graph payload.
 *
 * Port of: mcp_server/handlers/recompute_layout.py::_extract_topology
 * source: cortex@ed33435 mcp_server/handlers/recompute_layout.py:21
 */
export function extractTopology(
  graphData: GraphData,
): { nodeIds: string[]; edges: Array<[string, string]>; kinds: Record<string, string> } {
  const nodesIn = graphData.nodes ?? [];
  const edgesIn = graphData.edges ?? [];

  const nodeIds = nodesIn.filter((n) => n.id).map((n) => n.id);
  const kinds: Record<string, string> = {};
  for (const n of nodesIn) {
    if (n.id) kinds[n.id] = n.kind ?? "unknown";
  }

  const edges: Array<[string, string]> = [];
  for (const e of edgesIn) {
    let s = e.source;
    let t = e.target;
    if (typeof s === "object" && s !== null) s = (s as { id?: string }).id ?? "";
    if (typeof t === "object" && t !== null) t = (t as { id?: string }).id ?? "";
    if (s && t && s !== t) edges.push([s as string, t as string]);
  }

  return { nodeIds, edges, kinds };
}

// ── Main run function ──────────────────────────────────────────────────────

/**
 * Run the layout pass against the currently-cached graph.
 *
 * precondition: graphCache has a valid {data} shape or is null.
 * postcondition: on success — coords persisted to store, returns ok status;
 *   on "same fingerprint" — returns cached=true with existing version;
 *   on error — returns {status: "error", reason}.
 *
 * Port of: mcp_server/handlers/recompute_layout.py::run_recompute
 * source: cortex@ed33435 mcp_server/handlers/recompute_layout.py:46
 */
export async function runRecompute(
  graphCache: { data: GraphData } | null | undefined,
  store: LayoutStore,
  layoutEngine: LayoutEngine,
): Promise<RecomputeLayoutResult> {
  if (!graphCache?.data) {
    return { status: "error", reason: "no_graph_cached" };
  }

  const { nodeIds, edges, kinds } = extractTopology(graphCache.data);
  if (nodeIds.length === 0) {
    return { status: "error", reason: "empty_graph" };
  }

  const fp = layoutEngine.topologyFingerprint(nodeIds, edges);

  // Skip-if-fresh: if the cached layout's fingerprint matches the
  // current graph's, nothing has changed topologically.
  // source: cortex@ed33435 mcp_server/handlers/recompute_layout.py:86
  let existing: { fingerprint: string; count: number; version: number } | null = null;
  try {
    existing = await store.readLayoutVersion();
  } catch {
    existing = null;
  }

  if (existing && existing.fingerprint === fp) {
    return {
      status: "ok",
      node_count: existing.count,
      edge_count: edges.length,
      elapsed_ms: 0,
      topology_fingerprint: fp,
      layout_version: existing.version,
      cached: true,
    };
  }

  const t0 = performance.now();
  let coords: Record<string, { x: number; y: number }>;
  try {
    coords = await layoutEngine.layout(nodeIds, edges);
  } catch (exc) {
    return {
      status: "error",
      reason: "layout_failed",
      detail: String(exc),
    };
  }

  const layoutVersion = await store.writeLayout(coords, kinds, fp);
  const elapsedMs = Math.round(performance.now() - t0);

  return {
    status: "ok",
    node_count: nodeIds.length,
    edge_count: edges.length,
    elapsed_ms: elapsedMs,
    topology_fingerprint: fp,
    layout_version: layoutVersion,
    cached: false,
  };
}
