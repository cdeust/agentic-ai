/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Edge construction helpers for the unified graph builder.
 *
 * Handles cross-domain bridges, persistent features, knowledge-graph
 * relationships, cluster assembly, and batch pagination.
 * Pure logic — no I/O.
 *
 * source: Cortex mcp_server/core/graph_builder_edges.py
 */

export type Node = Record<string, unknown>;
export type Edge = Record<string, unknown>;

// ── Colors ────────────────────────────────────────────────────────────────

// source: Cortex mcp_server/core/graph_builder_edges.py — all hex values ported verbatim
export const DOMAIN_COLOR_EDGES = "#6366f1"; // source: Cortex graph_builder_edges.py::DOMAIN_COLOR

export const EDGE_COLORS: Record<string, string> = {
  bridge: "#FF00FF",               // source: Cortex graph_builder_edges.py::EDGE_COLORS
  "persistent-feature": "#ec4899", // source: Cortex graph_builder_edges.py::EDGE_COLORS
  co_occurrence: "#d946ef",        // source: Cortex graph_builder_edges.py::EDGE_COLORS
  imports: "#3b82f6",              // source: Cortex graph_builder_edges.py::EDGE_COLORS
  calls: "#22d3ee",                // source: Cortex graph_builder_edges.py::EDGE_COLORS
  caused_by: "#ff4444",            // source: Cortex graph_builder_edges.py::EDGE_COLORS
  resolved_by: "#22c55e",          // source: Cortex graph_builder_edges.py::EDGE_COLORS
  decided_to_use: "#f59e0b",       // source: Cortex graph_builder_edges.py::EDGE_COLORS
  debugged_with: "#ef4444",        // source: Cortex graph_builder_edges.py::EDGE_COLORS
  preceded_by: "#94a3b8",          // source: Cortex graph_builder_edges.py::EDGE_COLORS
  derived_from: "#a78bfa",         // source: Cortex graph_builder_edges.py::EDGE_COLORS
  "domain-contains": "#06b6d4",    // source: Cortex graph_builder_edges.py::EDGE_COLORS
  "topic-member": "#06b6d480",     // source: Cortex graph_builder_edges.py::EDGE_COLORS
  "co-entity": "#a78bfa",          // source: Cortex graph_builder_edges.py::EDGE_COLORS
};

export const PERSISTENT_COLOR = "#ec4899"; // source: Cortex graph_builder_edges.py::PERSISTENT_COLOR

// ── Bridge edges ──────────────────────────────────────────────────────────

/** Add bridge edges connecting this domain to other domains. */
export function addBridgeEdges(
  dp: Record<string, unknown>,
  hubId: string,
  domainKeys: string[],
  domainHubIds: Record<string, string>,
  edges: Edge[],
): void {
  for (const bridge of ((dp["connectionBridges"] as Record<string, unknown>[]) ?? [])) {
    const toDomain = bridge["toDomain"] as string | undefined;
    if (toDomain && domainKeys.includes(toDomain) && toDomain in domainHubIds) {
      edges.push({
        source: hubId,
        target: domainHubIds[toDomain],
        type: "bridge",
        weight: Number(bridge["weight"] ?? 0.5),
        color: EDGE_COLORS["bridge"],
        label: bridge["pattern"],
      });
    }
  }
}

// ── Persistent feature edges ─────────────────────────────────────────────

/**
 * Add edges for behavioral features that persist across domains.
 *
 * Deduplicates: one edge per domain pair with aggregated weight and count.
 */
export function addPersistentFeatureEdges(
  profiles: Record<string, unknown>,
  domainHubIds: Record<string, string>,
  edges: Edge[],
): void {
  type PairData = { weight: number; count: number; labels: string[] };
  const pairData = new Map<string, PairData>();

  for (const pf of ((profiles["persistentFeatures"] as Record<string, unknown>[]) ?? [])) {
    const pfDomains = (pf["domains"] as string[]) ?? [];
    for (let i = 0; i < pfDomains.length; i++) {
      for (let j = i + 1; j < pfDomains.length; j++) {
        const domI = pfDomains[i];
        const domJ = pfDomains[j];
        if (domI === undefined || domJ === undefined) continue;
        const src = domainHubIds[domI];
        const tgt = domainHubIds[domJ];
        if (src && tgt && src !== tgt) {
          const key = [src, tgt].sort().join("\0");
          if (!pairData.has(key)) {
            pairData.set(key, { weight: 0, count: 0, labels: [] });
          }
          const info = pairData.get(key);
          if (info === undefined) continue;
          info.weight += Number(pf["persistence"] ?? 0);
          info.count += 1;
          const label = String(pf["label"] ?? "");
          if (label && info.labels.length < 3) { // source: Cortex graph_builder_edges.py::add_persistent_feature_edges max 3 labels
            info.labels.push(label);
          }
        }
      }
    }
  }

  for (const [key, info] of pairData) {
    const [src, tgt] = key.split("\0");
    edges.push({
      source: src,
      target: tgt,
      type: "persistent-feature",
      weight: Math.min(info.weight / Math.max(info.count, 1), 1.0),
      color: PERSISTENT_COLOR,
      label: `${info.count} shared features`,
    });
  }
}

// ── Knowledge graph relationships ─────────────────────────────────────────

/**
 * Add edges from knowledge-graph relationships between entities.
 *
 * Excludes co_occurrence relationships from visualization — they represent
 * extraction coincidence (96% of all edges), not semantic structure.
 * Only co_retrieval, derived_from, and other curated types are shown.
 */
export function addRelationshipEdges(
  relationships: Record<string, unknown>[],
  entityIdMap: Map<number | string, string>,
  edges: Edge[],
): void {
  for (const rel of relationships) {
    const relType = String(rel["relationship_type"] ?? rel["type"] ?? "related");
    if (relType === "co_occurrence") continue;

    const srcDbId = (rel["source_entity_id"] ?? rel["source"]) as number | string;
    const tgtDbId = (rel["target_entity_id"] ?? rel["target"]) as number | string;
    const srcNid = entityIdMap.get(srcDbId);
    const tgtNid = entityIdMap.get(tgtDbId);
    if (!srcNid || !tgtNid || srcNid === tgtNid) continue;

    edges.push({
      source: srcNid,
      target: tgtNid,
      type: relType,
      weight: Number(rel["weight"] ?? 0.5),
      color: EDGE_COLORS[relType] ?? "#90a4ae",
      isCausal: Boolean(rel["is_causal"] ?? false),
    });
  }
}

// ── Cluster assembly ─────────────────────────────────────────────────────

/** Group nodes by domain into L1 clusters. */
export function buildClusters(
  nodes: Node[],
  domainHubIds: Record<string, string>,
): Array<Record<string, unknown>> {
  const domainGroups = new Map<string, string[]>();
  for (const node of nodes) {
    const grp = String(node["group"] ?? "_ungrouped");
    if (!domainGroups.has(grp)) domainGroups.set(grp, []);
    const grpList = domainGroups.get(grp);
    if (grpList !== undefined) grpList.push(node["id"] as string);
  }

  const clusters: Array<Record<string, unknown>> = [];
  for (const [grpKey, memberIds] of domainGroups) {
    if (memberIds.length < 2) continue;
    let hubColor = DOMAIN_COLOR_EDGES;
    if (grpKey in domainHubIds) {
      const hubNode = nodes.find((n) => n["id"] === domainHubIds[grpKey]);
      if (hubNode) hubColor = String(hubNode["color"] ?? DOMAIN_COLOR_EDGES);
    }
    clusters.push({
      id: `cluster_${grpKey}`,
      level: "l1",
      member_ids: memberIds,
      domain: grpKey,
      color: hubColor,
      label: grpKey,
    });
  }
  return clusters;
}

// ── Batch pagination ──────────────────────────────────────────────────────

const _SKELETON_TYPES = new Set(["root", "category", "domain", "agent", "type-group"]);

/**
 * Slice nodes/edges into batches.
 *
 * @returns [nodes, edges, clusters, totalBatches]
 */
export function applyBatchPagination(
  nodes: Node[],
  edges: Edge[],
  clusters: Array<Record<string, unknown>>,
  batch: number,
  batchSize: number,
): [Node[], Edge[], Array<Record<string, unknown>>, number] {
  if (batchSize <= 0 || nodes.length === 0) return [nodes, edges, clusters, 1];

  const skeletonNodes = nodes.filter((n) => _SKELETON_TYPES.has(String(n["type"])));
  const childNodes = nodes.filter((n) => !_SKELETON_TYPES.has(String(n["type"])));
  const skeletonIds = new Set(skeletonNodes.map((n) => n["id"] as string));
  const totalBatches = Math.max(1, Math.ceil(childNodes.length / batchSize));

  if (batch === 0) {
    const filteredEdges = edges.filter(
      (e) => skeletonIds.has(e["source"] as string) && skeletonIds.has(e["target"] as string),
    );
    return [skeletonNodes, filteredEdges, clusters, totalBatches];
  }

  const pageStart = (batch - 1) * batchSize;
  const pageNodes = childNodes.slice(pageStart, pageStart + batchSize);
  const pageIds = new Set(pageNodes.map((n) => n["id"] as string));
  const allowedIds = new Set([...pageIds, ...skeletonIds]);
  const filteredEdges = edges.filter(
    (e) =>
      (pageIds.has(e["source"] as string) || pageIds.has(e["target"] as string)) &&
      allowedIds.has(e["source"] as string) &&
      allowedIds.has(e["target"] as string),
  );
  return [pageNodes, filteredEdges, [], totalBatches];
}
