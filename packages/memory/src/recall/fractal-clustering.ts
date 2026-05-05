/**
 * Fractal clustering primitives — Union-Find, agglomerative clustering, centroids.
 *
 * Extracted from fractal.ts to keep each module under 300 lines.
 * Used by fractal.ts for hierarchy construction.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/fractal_clustering.py
 */

// ── Union-Find ────────────────────────────────────────────────────────────

/**
 * Disjoint-set data structure with path compression and union by rank.
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py:17-38
 */
export class UnionFind {
  readonly parent: number[];
  readonly rank: number[];

  /** precondition: n >= 0. postcondition: n singletons. */
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  /**
   * Find with path compression (two-pass halving).
   * Invariant: every node on the path points to its grandparent after the call.
   * Termination: parent[x] === x at the root; path length strictly decreases.
   */
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x] ?? x] ?? x;
      x = this.parent[x] ?? x;
    }
    return x;
  }

  /** Union by rank. Postcondition: find(x) === find(y) after the call. */
  union(x: number, y: number): void {
    let rx = this.find(x);
    let ry = this.find(y);
    if (rx === ry) return;
    if (this.rank[rx]! < this.rank[ry]!) {
      [rx, ry] = [ry, rx];
    }
    this.parent[ry] = rx;
    if (this.rank[rx] === this.rank[ry]) {
      this.rank[rx]!++;
    }
  }
}

// ── Clustering ────────────────────────────────────────────────────────────

type SimilarityFn = (a: unknown, b: unknown) => number;

/**
 * Union all pairs whose embeddings exceed the similarity threshold.
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py:44-61
 */
function mergeSimilarPairs(
  memories: Record<string, unknown>[],
  uf: UnionFind,
  similarityFn: SimilarityFn,
  threshold: number,
): void {
  const n = memories.length;
  for (let i = 0; i < n; i++) {
    const embI = memories[i]?.["embedding"];
    if (embI === undefined || embI === null) continue;
    for (let j = i + 1; j < n; j++) {
      const embJ = memories[j]?.["embedding"];
      if (embJ === undefined || embJ === null) continue;
      if (similarityFn(embI, embJ) >= threshold) {
        uf.union(i, j);
      }
    }
  }
}

/**
 * Single-linkage agglomerative clustering via Union-Find.
 *
 * precondition:  each memory has an "embedding" field; threshold ∈ [0, 1].
 * postcondition: every memory appears in exactly one cluster.
 *
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py:64-92
 */
export function agglomerativeCluster(
  memories: Record<string, unknown>[],
  similarityFn: SimilarityFn,
  threshold = 0.6, // source: cortex@ed33435 mcp_server/core/fractal_clustering.py:67
): Array<Record<string, unknown>[]> {
  const n = memories.length;
  if (n === 0) return [];
  if (n === 1) return [memories];

  const uf = new UnionFind(n);
  mergeSimilarPairs(memories, uf, similarityFn, threshold);

  const groups = new Map<number, Record<string, unknown>[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(memories[i]!);
  }
  return Array.from(groups.values());
}

// ── Centroid computation ──────────────────────────────────────────────────

/**
 * Compute mean centroid of float32 arrays.
 *
 * precondition:  embeddings is a non-empty array; dim > 0.
 * postcondition: returns a Uint8Array of float32 bytes (length = dim * 4),
 *   or null if no valid embeddings. Centroid is L2-normalized.
 *
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py:98-123
 */
export function computeCentroid(
  embeddings: Array<Uint8Array | number[] | null | undefined>,
  dim: number,
): Uint8Array | null {
  const valid: number[][] = [];
  for (const emb of embeddings) {
    if (!emb) continue;
    let floats: number[];
    if (emb instanceof Uint8Array) {
      if (emb.byteLength < dim * 4) continue;
      const view = new DataView(emb.buffer, emb.byteOffset, dim * 4);
      floats = Array.from({ length: dim }, (_, i) => view.getFloat32(i * 4, true));
    } else {
      if ((emb as number[]).length < dim) continue;
      floats = (emb as number[]).slice(0, dim);
    }
    valid.push(floats);
  }

  if (valid.length === 0) return null;

  const n = valid.length;
  const centroid = Array.from({ length: dim }, (_, d) =>
    valid.reduce((sum, v) => sum + (v[d] ?? 0), 0) / n,
  );

  const magnitude = Math.sqrt(centroid.reduce((s, c) => s + c * c, 0));
  const normed = magnitude > 0 ? centroid.map((c) => c / magnitude) : centroid;

  const out = new Uint8Array(dim * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < dim; i++) {
    view.setFloat32(i * 4, normed[i] ?? 0, true);
  }
  return out;
}

// ── Hierarchy building helpers ────────────────────────────────────────────

/**
 * Build Level 1 cluster data from raw agglomerative groups.
 *
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py:129-160
 */
export function buildL1Clusters(
  l1Raw: Array<Record<string, unknown>[]>,
  embeddingDim: number,
): [Array<Record<string, unknown>>, Record<string, Record<string, unknown>>] {
  const level1: Array<Record<string, unknown>> = [];
  const clusterMap: Record<string, Record<string, unknown>> = {};

  for (let i = 0; i < l1Raw.length; i++) {
    const cluster = l1Raw[i]!;
    const clusterId = `L1-${i}`;
    const embeddings = cluster.map((m) => m["embedding"] as Uint8Array | number[] | null);
    const centroid = computeCentroid(embeddings, embeddingDim);

    const avgHeat = cluster.length > 0
      ? cluster.reduce((s, m) => s + ((m["heat"] as number | undefined) ?? 0.5), 0) / cluster.length
      : 0;

    const clusterData: Record<string, unknown> = {
      cluster_id: clusterId,
      level: 1,
      memory_ids: cluster.filter((m) => m["id"] !== undefined && m["id"] !== null).map((m) => m["id"]),
      centroid,
      size: cluster.length,
      avg_heat: avgHeat,
    };
    level1.push(clusterData);
    clusterMap[clusterId] = clusterData;
  }

  return [level1, clusterMap];
}

/**
 * Find the most common directory/domain among a cluster's member memories.
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py:201-213
 */
function findDominantDirectory(
  clusterData: Record<string, unknown>,
  memories: Record<string, unknown>[],
): string {
  const dirs: Record<string, number> = {};
  const memIds = (clusterData["memory_ids"] as unknown[]) ?? [];
  for (const mid of memIds) {
    const mem = memories.find((m) => m["id"] === mid);
    if (mem) {
      const d = ((mem["directory_context"] ?? mem["domain"]) as string | undefined) ?? "global";
      dirs[d] = (dirs[d] ?? 0) + 1;
    }
  }
  if (Object.keys(dirs).length === 0) return "global";
  return Object.keys(dirs).reduce((a, b) => (dirs[a]! >= dirs[b]! ? a : b));
}

/**
 * Build Level 2 root clusters by grouping L1 clusters by directory/domain.
 *
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py:163-198
 */
export function buildL2Clusters(
  level1: Record<string, unknown>[],
  memories: Record<string, unknown>[],
  embeddingDim: number,
): [Array<Record<string, unknown>>, Record<string, Record<string, unknown>>] {
  const dirGroups = new Map<string, Record<string, unknown>[]>();
  for (const clusterData of level1) {
    const dominantDir = findDominantDirectory(clusterData, memories);
    if (!dirGroups.has(dominantDir)) dirGroups.set(dominantDir, []);
    dirGroups.get(dominantDir)!.push(clusterData);
  }

  const level2: Array<Record<string, unknown>> = [];
  const clusterMap: Record<string, Record<string, unknown>> = {};
  let j = 0;

  for (const [dirKey, l1Group] of dirGroups) {
    const clusterId = `L2-${j++}`;
    const l1Centroids = l1Group
      .filter((c) => c["centroid"])
      .map((c) => c["centroid"] as Uint8Array | number[]);
    const centroid = l1Centroids.length > 0 ? computeCentroid(l1Centroids, embeddingDim) : null;

    const clusterData: Record<string, unknown> = {
      cluster_id: clusterId,
      level: 2,
      directory: dirKey,
      child_clusters: l1Group.map((c) => c["cluster_id"]),
      total_memories: l1Group.reduce((s, c) => s + ((c["size"] as number | undefined) ?? 0), 0),
      centroid,
    };
    level2.push(clusterData);
    clusterMap[clusterId] = clusterData;
  }

  return [level2, clusterMap];
}
