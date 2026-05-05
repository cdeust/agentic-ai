/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * CPU layout engine for the workflow graph.
 *
 * Pure logic: takes a list of node ids + an edge list, returns a list of
 * [node_id, x, y] triples. No I/O, no database imports — this module is
 * testable with synthetic graphs.
 *
 * Algorithm choice — DrL (Distributed Recursive Layout):
 *   * O(N log N) per iteration, scales linearly with edge count.
 *   * Tuned for force-directed exploratory views; produces well-separated
 *     clusters even on 1M-node graphs in under 3 minutes on a modern CPU.
 *   * Falls back to Fruchterman-Reingold for tiny graphs (<200 nodes)
 *     where DrL's bookkeeping overhead is wasted.
 *
 * Reference: Martin et al. "OpenOrd: An Open-Source Toolbox for Large
 * Graph Layout", SPIE 2011 — DrL is the OpenOrd algorithm under its
 * original name.
 *
 * Note on igraph: the Python version uses python-igraph for layout.
 * This TypeScript port provides the same interface + topology fingerprint,
 * but delegates actual layout to an injected layoutFn so callers can
 * plug in any engine (e.g. a WASM port of igraph, d3-force, or a pre-
 * computed set of coordinates from the server). The signatures and
 * normalization logic are preserved 1:1.
 *
 * source: Cortex mcp_server/core/layout_engine.py
 */

import { createHash } from "node:crypto";

// ── Topology fingerprint ─────────────────────────────────────────────────

/**
 * Stable fingerprint of the graph's topology, used as a cache key.
 *
 * A graph's layout is valid as long as the same set of node ids and
 * the same set of (source, target) pairs are present. The
 * fingerprint is a SHA-256 over the sorted concatenation; two builds
 * with the same topology — even with different memory contents —
 * share a fingerprint and reuse the same coords.
 *
 * source: Cortex mcp_server/core/layout_engine.py::topology_fingerprint
 */
export function topologyFingerprint(
  nodeIds: Iterable<string>,
  edges: Iterable<[string, string]>,
): string {
  const h = createHash("sha256"); // source: Cortex layout_engine.py::topology_fingerprint SHA-256 choice
  for (const nid of [...nodeIds].sort()) {
    h.update(nid + "\n");
  }
  h.update("--edges--\n");
  const edgeStrs = [...edges]
    .map(([s, t]) => `${s}\x00${t}`)
    .sort();
  for (const e of edgeStrs) {
    h.update(e + "\n");
  }
  return h.digest("hex").slice(0, 16);
}

// ── Layout result type ───────────────────────────────────────────────────

/** [node_id, x, y] — coordinates normalized into [-1, 1] world space. */
export type LayoutCoord = [string, number, number];

// ── Normalization ────────────────────────────────────────────────────────

/**
 * Normalize raw (x, y) coordinates returned by any layout engine into
 * the [-1, 1] world space the tile renderer and the client coordinate
 * system both assume.
 *
 * Matches the normalization logic in layout_engine.py exactly:
 *   span = max(spanX, spanY) * 0.55  (slight padding inside [-1, 1])
 *   x_norm = (x - cx) / span
 *   y_norm = (y - cy) / span
 *
 * source: Cortex mcp_server/core/layout_engine.py::layout (lines 99–112)
 */
export function normalizeCoords(
  nodeIds: string[],
  rawCoords: Array<[number, number]>,
): LayoutCoord[] {
  if (rawCoords.length === 0) return [];

  const xs = rawCoords.map(([x]) => x);
  const ys = rawCoords.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1.0;
  const spanY = maxY - minY || 1.0;
  // source: Cortex layout_engine.py line 106 — 0.55 gives slight padding
  const span = Math.max(spanX, spanY) * 0.55;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  return nodeIds.map((id, i): LayoutCoord => {
    const coord = rawCoords[i];
    if (coord === undefined) return [id, 0, 0];
    return [id, (coord[0] - cx) / span, (coord[1] - cy) / span];
  });
}

// ── Layout function ──────────────────────────────────────────────────────

/** Algorithm selection: "drl" (for ≥200 nodes) or "fr" (Fruchterman-Reingold). */
export type LayoutAlgorithm = "drl" | "fr";

/**
 * Injected layout engine — receives node count, edge pairs (integer
 * indices), the chosen algorithm, and a seed for reproducibility.
 * Must return one [x, y] pair per node in index order.
 *
 * This indirection replaces the direct igraph import from the Python
 * version so the TypeScript port can be tested without a native
 * igraph binary. The composition root injects the real engine.
 */
export type LayoutEngineFn = (
  nodeCount: number,
  edgePairs: Array<[number, number]>,
  algorithm: LayoutAlgorithm,
  seed: number,
) => Array<[number, number]>;

/**
 * Compute (x, y) per node and return [[id, x, y], ...].
 *
 * Precondition: nodeIds is non-empty.
 * Postcondition: result[i][0] === nodeIds[i] and all coordinates
 *   are in approximately [-1, 1] (slight overflow possible at graph
 *   periphery due to the 0.55 padding factor).
 *
 * @param nodeIds - ordered list of node identifiers.
 * @param edges - list of (source_id, target_id) pairs.
 * @param algorithm - preferred layout algorithm. DrL is applied for
 *   graphs ≥200 nodes; FR is applied for smaller graphs or when
 *   explicitly requested.
 * @param seed - random seed for reproducibility (FR only; DrL is
 *   deterministic by default).
 * @param engineFn - injected layout engine; must return raw (x, y) per
 *   node. Throws if not provided (mirrors Python's ImportError path).
 *
 * @throws Error when nodeIds is empty.
 * @throws Error when engineFn is not provided (caller must inject).
 */
export function layout(
  nodeIds: string[],
  edges: Array<[string, string]>,
  {
    algorithm = "drl",
    seed = 0,
    engineFn,
  }: {
    algorithm?: LayoutAlgorithm;
    seed?: number;
    engineFn?: LayoutEngineFn;
  } = {},
): LayoutCoord[] {
  if (nodeIds.length === 0) {
    throw new Error("layout requires at least one node id");
  }
  if (!engineFn) {
    throw new Error(
      "layoutEngineFn is required — inject an igraph WASM binding or " +
      "a d3-force adapter at the composition root.",
    );
  }

  // Build integer index map (mirrors Python's igraph vertex translation)
  const idxOf = new Map<string, number>(nodeIds.map((id, i) => [id, i]));
  const edgePairs: Array<[number, number]> = [];
  for (const [s, t] of edges) {
    const si = idxOf.get(s);
    const ti = idxOf.get(t);
    if (si !== undefined && ti !== undefined && s !== t) {
      edgePairs.push([si, ti]);
    }
  }

  // Algorithm selection: DrL for ≥200 nodes, FR otherwise
  // source: Cortex layout_engine.py lines 85–92
  const chosenAlgo: LayoutAlgorithm =
    algorithm === "drl" && nodeIds.length >= 200 ? "drl" : "fr"; // source: Cortex layout_engine.py lines 85–92 — DrL threshold for ≥200 nodes

  const rawCoords = engineFn(nodeIds.length, edgePairs, chosenAlgo, seed);
  if (rawCoords.length === 0) return [];

  return normalizeCoords(nodeIds, rawCoords);
}
