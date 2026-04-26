/**
 * Navigation orchestration: builds the SR graph from memory records and
 * drives BFS traversal to produce NavigationResponse.
 *
 * This layer corresponds to the composition logic in the navigate_memory
 * handler (navigate_memory.py) — it takes pre-fetched memory records,
 * builds the temporal co-access graph, runs BFS, and assembles the
 * response. No I/O.
 *
 * source: handler + helpers in mcp_server/handlers/navigate_memory.py.
 * source: cognitive_map.py pure-logic functions (ported to node-traversal.ts).
 */

import {
  buildTemporalCoAccess,
  computeSrScores,
  navigateFrom,
  projectTo2d,
} from "./node-traversal.js";
import type {
  BFSNavigationResult,
  NavigationResponse,
  SRGraph,
} from "./types.js";

// ── Memory record type (minimal — callers provide richer records) ──────────

export interface MemoryRecord {
  id: number;
  content: string;
  lastAccessed?: string;
  heat?: number;
  domain?: string;
  tags?: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Ensure the start memory appears in the candidate list.
 * If not present, prepend it.
 *
 * source: _build_sr_graph in navigate_memory.py.
 */
function ensureStartIncluded(
  startId: number,
  startMem: MemoryRecord,
  allMems: MemoryRecord[],
): MemoryRecord[] {
  if (allMems.some((m) => m.id === startId)) return allMems;
  return [startMem, ...allMems];
}

/**
 * Attach memory content and metadata to BFS navigation results.
 *
 * source: _enrich_neighbors in navigate_memory.py.
 */
function enrichNeighbors(
  navigation: BFSNavigationResult,
  memoryIndex: Map<number, MemoryRecord>,
): NavigationResponse["neighbors"] {
  const entries = [...navigation.entries()].sort(
    (a, b) => a[1].distance - b[1].distance,
  );

  const result: NavigationResponse["neighbors"] = [];
  for (const [mid, navInfo] of entries) {
    const mem = memoryIndex.get(mid);
    if (!mem) continue;
    result.push({
      memoryId: mid,
      srDistance: navInfo.distance,
      hops: navInfo.hops,
      path: navInfo.path,
      content: mem.content.slice(0, 200),
      heat: Math.round((mem.heat ?? 0) * 10000) / 10000,
      domain: mem.domain,
      tags: mem.tags ?? [],
    });
  }
  return result;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface NavigationOptions {
  maxDepth?: number;
  include2dMap?: boolean;
  windowHours?: number;
}

/**
 * Perform SR-based navigation starting from `startMem`.
 *
 * Takes the full set of recently-accessed memories (caller-supplied, no I/O
 * in this function), builds the temporal co-access graph, runs BFS, and
 * returns the enriched NavigationResponse.
 *
 * @param startMem     - Seed memory record.
 * @param allMems      - All recently-accessed memories to build the graph from.
 * @param options      - Navigation parameters.
 * @returns NavigationResponse.
 */
export function navigate(
  startMem: MemoryRecord,
  allMems: MemoryRecord[],
  options: NavigationOptions = {},
): NavigationResponse {
  const maxDepth = Math.min(options.maxDepth ?? 2, 4);
  const windowHours = options.windowHours ?? 2.0;
  const include2dMap = options.include2dMap ?? false;

  const candidates = ensureStartIncluded(startMem.id, startMem, allMems);
  const srGraph: SRGraph = buildTemporalCoAccess(candidates, windowHours);
  const navigation = navigateFrom(startMem.id, srGraph, maxDepth);

  if (navigation.size === 0) {
    return {
      startMemoryId: startMem.id,
      neighbors: [],
      total: 0,
      srGraphSize: srGraph.size,
      reason: "no_co_access_neighbors_found",
    };
  }

  const memoryIndex = new Map<number, MemoryRecord>(
    candidates.map((m) => [m.id, m]),
  );

  const neighbors = enrichNeighbors(navigation, memoryIndex);

  const response: NavigationResponse = {
    startMemoryId: startMem.id,
    startContent: startMem.content,
    neighbors,
    total: neighbors.length,
    maxDepth,
    srGraphSize: srGraph.size,
  };

  if (include2dMap && neighbors.length > 0) {
    const allIds = [startMem.id, ...neighbors.map((n) => n.memoryId)];
    const coords = projectTo2d(srGraph, allIds);
    const coordinates2d: Record<string, [number, number]> = {};
    for (const [mid, xy] of coords.entries()) {
      coordinates2d[String(mid)] = xy;
    }
    response.coordinates2d = coordinates2d;
  }

  return response;
}

/**
 * Compute SR affinity scores for a set of seed memories against a
 * pre-built SR graph. Used by recall pipelines that want spreading scores
 * without full BFS traversal.
 *
 * source: compute_sr_scores in cognitive_map.py.
 */
export function scoreCandidates(
  seedMemoryIds: number[],
  srGraph: SRGraph,
  topK = 20,
): Array<[number, number]> {
  return computeSrScores(seedMemoryIds, srGraph, topK);
}
