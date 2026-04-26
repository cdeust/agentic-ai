/**
 * Knowledge graph pruning via disparity filter and orphan detection.
 *
 * Edge pruning uses the multiscale backbone extraction algorithm from:
 * // source: Serrano MA, Boguna M, Vespignani A (2009) "Extracting the multiscale
 *   backbone of complex weighted networks." PNAS 106(16):6483-6488.
 *
 * For each edge (i,j) with weight w_ij, the disparity filter computes a
 * p-value alpha_ij = (1 - p_ij)^{k_i - 1} where p_ij = w_ij / strength(i).
 * Edges kept when alpha < threshold at EITHER endpoint (statistically
 * significant at either end).
 *
 * Temporal decay follows:
 * // source: Aggarwal & Subbian (2014): effective weight decays exponentially
 *   with hours since last co-access, half-life = 168h (7 days).
 *
 * Port of: mcp_server/core/microglial_pruning.py
 * Pure business logic — no I/O.
 */

// ── Defaults ──────────────────────────────────────────────────────────────────

// Standard significance level (Serrano 2009)
const ALPHA_THRESHOLD = 0.05;
// 7 days (Aggarwal & Subbian 2014)
const TEMPORAL_HALF_LIFE_HOURS = 168.0;
const MIN_ENTITY_HEAT = 0.02;
const MIN_ACCESS_COUNT = 2;
const PROTECTION_ACCESS_THRESHOLD = 5;

// ── Temporal Decay ────────────────────────────────────────────────────────────

/**
 * Exponential temporal decay: exp(-lambda * hours).
 *
 * lambda = ln(2) / half_life so that weight halves every half_life hours.
 * // source: Aggarwal & Subbian (2014).
 */
function temporalDecay(hours: number, halfLife: number): number {
  if (hours <= 0) return 1.0;
  const lam = Math.log(2) / halfLife;
  return Math.exp(-lam * hours);
}

// ── Adjacency Building ────────────────────────────────────────────────────────

interface AdjacencyResult {
  adj: Map<number, Map<number, number>>;
  strength: Map<number, number>;
  degree: Map<number, number>;
}

function buildAdjacency(
  edges: readonly Record<string, unknown>[],
  halfLife: number,
): AdjacencyResult {
  const adj = new Map<number, Map<number, number>>();

  for (const edge of edges) {
    const src = edge["source_entity_id"] as number;
    const tgt = edge["target_entity_id"] as number;
    const rawW = (edge["weight"] as number | undefined) ?? 1.0;
    const hours = (edge["hours_since_co_access"] as number | undefined) ?? 0;
    const wEff = rawW * temporalDecay(hours, halfLife);

    if (!adj.has(src)) adj.set(src, new Map());
    if (!adj.has(tgt)) adj.set(tgt, new Map());
    adj.get(src)!.set(tgt, wEff);
    adj.get(tgt)!.set(src, wEff);
  }

  const strength = new Map<number, number>();
  const degree = new Map<number, number>();
  for (const [node, neighbors] of adj) {
    let sum = 0;
    for (const w of neighbors.values()) sum += w;
    strength.set(node, sum);
    degree.set(node, neighbors.size);
  }

  return { adj, strength, degree };
}

// ── Disparity Filter ──────────────────────────────────────────────────────────

/**
 * Compute disparity filter p-value: alpha = (1 - p)^{k - 1}.
 *
 * // source: Serrano et al. (2009) Eq. 2. Under the null hypothesis of uniform
 *   weight distribution across k edges, alpha is the probability of
 *   observing a normalized weight >= p.
 *
 * For k <= 1, every edge is significant (alpha = 0).
 */
function disparityAlpha(p: number, k: number): number {
  if (k <= 1) return 0.0;
  return Math.pow(1.0 - p, k - 1);
}

function classifyPruneReasons(
  edge: Record<string, unknown>,
  entityHeat: Map<number, number>,
  alphaSrc: number,
  alphaTgt: number,
): string[] {
  const reasons = ["disparity_insignificant"];
  const hours = (edge["hours_since_co_access"] as number | undefined) ?? 0;
  if (hours > TEMPORAL_HALF_LIFE_HOURS) reasons.push("stale");
  const srcHeat = entityHeat.get(edge["source_entity_id"] as number) ?? 0;
  const tgtHeat = entityHeat.get(edge["target_entity_id"] as number) ?? 0;
  if (srcHeat < 0.1 && tgtHeat < 0.1) reasons.push("cold_endpoints");
  // suppress unused variable warnings
  void alphaSrc;
  void alphaTgt;
  return reasons;
}

/**
 * Identify edges to prune via Serrano et al. (2009) disparity filter.
 *
 * Steps:
 *   1. Apply temporal decay to raw weights (Aggarwal & Subbian 2014).
 *   2. For each edge, compute disparity alpha at both endpoints.
 *   3. Keep edge if alpha < threshold at EITHER endpoint.
 *   4. Never prune edges touching protected entities.
 *
 * Returns list of edge dicts augmented with prune_reason metadata.
 */
export function identifyPrunableEdges(
  edges: readonly Record<string, unknown>[],
  entityHeat: Map<number, number>,
  entityProtected: Map<number, boolean>,
  alphaThreshold = ALPHA_THRESHOLD,
  halfLife = TEMPORAL_HALF_LIFE_HOURS,
): Array<Record<string, unknown> & { prune_reason: string[] }> {
  if (edges.length === 0) return [];

  const { adj, strength, degree } = buildAdjacency(edges, halfLife);

  const prunable: Array<Record<string, unknown> & { prune_reason: string[] }> = [];

  for (const edge of edges) {
    const src = edge["source_entity_id"] as number;
    const tgt = edge["target_entity_id"] as number;

    if (entityProtected.get(src) || entityProtected.get(tgt)) continue;

    const wEff = adj.get(src)?.get(tgt) ?? 0.0;
    const sSrc = strength.get(src) ?? 0.0;
    const sTgt = strength.get(tgt) ?? 0.0;
    const kSrc = degree.get(src) ?? 0;
    const kTgt = degree.get(tgt) ?? 0;

    const pSrc = sSrc > 0 ? wEff / sSrc : 1.0;
    const pTgt = sTgt > 0 ? wEff / sTgt : 1.0;

    const alphaSrc = disparityAlpha(pSrc, kSrc);
    const alphaTgt = disparityAlpha(pTgt, kTgt);

    const significant = alphaSrc < alphaThreshold || alphaTgt < alphaThreshold;
    if (significant) continue;

    const reasons = classifyPruneReasons(edge, entityHeat, alphaSrc, alphaTgt);
    prunable.push({ ...edge, prune_reason: reasons });
  }

  return prunable;
}

// ── Orphan Detection ──────────────────────────────────────────────────────────

function isOrphanCandidate(
  ent: Record<string, unknown>,
  edgeIds: ReadonlySet<number>,
  memIds: ReadonlySet<number>,
  minHeat: number,
  minAccess: number,
): boolean {
  if (ent["is_protected"]) return false;
  if ((ent["access_count"] as number | undefined) ?? 0 >= PROTECTION_ACCESS_THRESHOLD) return false;
  const id = ent["id"] as number;
  if (edgeIds.has(id) || memIds.has(id)) return false;
  if ((ent["heat"] as number | undefined) ?? 0 >= minHeat) return false;
  return ((ent["access_count"] as number | undefined) ?? 0) < minAccess;
}

/**
 * Identify entities to archive (disconnected, cold, low-access).
 */
export function identifyOrphanedEntities(
  entities: readonly Record<string, unknown>[],
  edgeEntityIds: ReadonlySet<number>,
  memoryEntityIds: ReadonlySet<number>,
  minHeat = MIN_ENTITY_HEAT,
  minAccessCount = MIN_ACCESS_COUNT,
): Array<Record<string, unknown> & { archive_reason: string[] }> {
  return entities
    .filter((ent) =>
      isOrphanCandidate(ent, edgeEntityIds, memoryEntityIds, minHeat, minAccessCount),
    )
    .map((ent) => ({ ...ent, archive_reason: ["orphaned", "cold", "low_access"] }));
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface PruningStats {
  edges_to_prune: number;
  entities_to_archive: number;
  total_edges: number;
  total_entities: number;
  edge_prune_pct: number;
  entity_archive_pct: number;
  edge_reasons: Record<string, number>;
}

/** Compute pruning summary statistics. */
export function computePruningStats(
  prunableEdges: readonly Record<string, unknown>[],
  orphanedEntities: readonly Record<string, unknown>[],
  totalEdges: number,
  totalEntities: number,
): PruningStats {
  const edgeReasons: Record<string, number> = {};
  for (const e of prunableEdges) {
    const reasons = (e["prune_reason"] as string[] | undefined) ?? [];
    for (const r of reasons) {
      edgeReasons[r] = (edgeReasons[r] ?? 0) + 1;
    }
  }

  return {
    edges_to_prune: prunableEdges.length,
    entities_to_archive: orphanedEntities.length,
    total_edges: totalEdges,
    total_entities: totalEntities,
    edge_prune_pct: Math.round(prunableEdges.length / Math.max(totalEdges, 1) * 100 * 10) / 10,
    entity_archive_pct: Math.round(orphanedEntities.length / Math.max(totalEntities, 1) * 100 * 10) / 10,
    edge_reasons: edgeReasons,
  };
}
