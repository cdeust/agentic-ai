/**
 * Dendritic memory clusters — semantic-similarity-based memory grouping.
 *
 * Groups memories onto "branches" based on entity/tag Jaccard similarity.
 * Co-clustered memories benefit from nonlinear amplification during
 * retrieval (see the Poirazi 2003 two-layer neuron model reference).
 *
 * What Kastellakis (2015) describes:
 *   Related synapses physically co-localize on the same dendritic branch.
 *   When co-activated, NMDA-dependent nonlinear events (dendritic spikes)
 *   amplify the signal supralinearly. Clustering is driven by spatiotemporal
 *   coincidence of synaptic inputs, not semantic similarity.
 *
 * What this code does:
 *   Assigns memories to branches via Jaccard similarity of entity/tag sets
 *   (0.7 entity + 0.3 tag weighting). This is a semantic grouping heuristic
 *   that uses dendritic terminology metaphorically.
 *
 * The branch_admission_threshold (0.3), max_branch_size (15), and
 * entity/tag weights are engineering choices.
 *
 * Pure business logic — no I/O.
 *
 * Ablation: CORTEX_ABLATE_DENDRITIC_CLUSTERS=1 causes findBestBranch to
 * return null (guard is in the recall-handler entry point).
 *
 * Port of: cortex@bc0ae4f mcp_server/core/dendritic_clusters.py
 *
 * source: Kastellakis G et al. (2015) "Synaptic clustering within dendrites:
 *         An emerging theory of memory formation."
 *         Progress in Neurobiology 126:19-35.
 *         Poirazi P, Brannon T, Mel BW (2003) "Pyramidal Neuron as a
 *         Two-Layer Neural Network." Neuron 37:989-999.
 */

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * A dendritic branch groups semantically-related memories via Jaccard
 * similarity over entity names and tag strings.
 *
 * D-05 fix: entitySignature was Set<number> (DB auto-increment IDs) in the
 * previous TS port. Python uses set[str] (entity names). Jaccard computed over
 * integer IDs produces numerically different affinity scores than Jaccard over
 * name strings, causing systematically incorrect branch assignments.
 * Fix: entitySignature is now Set<string> (entity names), matching Python.
 * source: cortex@ed33435 mcp_server/core/dendritic_clusters.py:44-67
 *         (entity_signature typed as set[str])
 */
export interface DendriticBranch {
  branchId: string;
  domain: string;
  memoryIds: number[];
  /** Entity names (strings) — NOT entity integer IDs. */
  entitySignature: Set<string>;
  tagSignature: Set<string>;
  avgHeat: number;
  plasticity: number;
  spikeCount: number;
}

export interface FindBranchOptions {
  threshold?: number;
  maxSize?: number;
  /** Pass true for ablation mode (always returns null). */
  disabled?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Minimum Jaccard similarity (0.7 entity + 0.3 tag) for a memory to be
 * admitted to an existing branch.
 * source: cortex@bc0ae4f mcp_server/core/dendritic_computation.py:54
 *         (BRANCH_ADMISSION_THRESHOLD — engineering constant, no paper)
 */
export const BRANCH_ADMISSION_THRESHOLD = 0.3;

/**
 * Weight of entity Jaccard similarity in branch affinity.
 * source: cortex@bc0ae4f mcp_server/core/dendritic_clusters.py:67 (engineering constant, no paper)
 */
const ENTITY_WEIGHT = 0.7;

/**
 * Weight of tag Jaccard similarity in branch affinity.
 * source: cortex@bc0ae4f mcp_server/core/dendritic_clusters.py:67 (engineering constant, no paper)
 */
const TAG_WEIGHT = 0.3;

/**
 * Rounding precision factor for avgHeat (round to 4 decimal places).
 * source: cortex@bc0ae4f mcp_server/core/dendritic_clusters.py:128 (round(new_avg, 4))
 */
const ROUND_4DP = 10000; // source: cortex@bc0ae4f mcp_server/core/dendritic_clusters.py:128 (round(new_avg, 4) → 4 decimal places = 10^4)

/**
 * Maximum memories per branch before splitting.
 * source: cortex@bc0ae4f mcp_server/core/dendritic_computation.py:55
 *         (MAX_BRANCH_SIZE — engineering constant, no paper)
 */
export const MAX_BRANCH_SIZE = 15;

// ── Jaccard similarity ────────────────────────────────────────────────────

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|
 * Returns 0.0 when both sets are empty.
 *
 * post: result is in [0.0, 1.0]
 *
 * source: cortex@bc0ae4f mcp_server/shared/similarity.py::jaccard_similarity
 */
function jaccardSimilarity<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0.0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0.0 : intersection / union;
}

// ── Branch affinity ───────────────────────────────────────────────────────

/**
 * Weighted Jaccard similarity (0.7 entity + 0.3 tag). Heuristic.
 *
 * In biology, dendritic clustering is driven by spatiotemporal coincidence,
 * not semantic similarity. This is a practical engineering proxy.
 *
 * pre:  branch is a valid DendriticBranch; memoryEntities is a Set<string>
 *       of entity names (not IDs) — matching Python set[str] contract.
 * post: returned value is in [0, 1]
 *
 * source: cortex@ed33435 mcp_server/core/dendritic_clusters.py:44-67
 *         Weights 0.7/0.3 — engineering choice (no paper citation)
 */
export function computeBranchAffinity(
  memoryEntities: Set<string>,
  memoryTags: Set<string>,
  branch: DendriticBranch,
): number {
  const entitySim =
    memoryEntities.size > 0 || branch.entitySignature.size > 0
      ? jaccardSimilarity(memoryEntities, branch.entitySignature)
      : 0.0;
  const tagSim =
    memoryTags.size > 0 || branch.tagSignature.size > 0
      ? jaccardSimilarity(memoryTags, branch.tagSignature)
      : 0.0;
  return entitySim * ENTITY_WEIGHT + tagSim * TAG_WEIGHT;
}

// ── Branch selection ──────────────────────────────────────────────────────

/**
 * Find the best branch for a new memory, or null if no match.
 *
 * pre:  branches is a list of DendriticBranch
 * post: returned branch has affinity >= threshold and size < maxSize,
 *       or null if no such branch exists
 *
 * source: cortex@bc0ae4f mcp_server/core/dendritic_clusters.py:70-100
 *
 * @param disabled - Pass true for ablation mode (always returns null).
 */
export function findBestBranch(
  memoryEntities: Set<string>,
  memoryTags: Set<string>,
  branches: DendriticBranch[],
  options?: FindBranchOptions,
): { branch: DendriticBranch | null; score: number } {
  if (options?.disabled) {
    return { branch: null, score: 0.0 };
  }
  const threshold = options?.threshold ?? BRANCH_ADMISSION_THRESHOLD;
  const maxSize = options?.maxSize ?? MAX_BRANCH_SIZE;
  let best: DendriticBranch | null = null;
  let bestScore = 0.0;
  for (const branch of branches) {
    if (branch.memoryIds.length >= maxSize) continue;
    const score = computeBranchAffinity(memoryEntities, memoryTags, branch);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      best = branch;
    }
  }
  return { branch: best, score: bestScore };
}

// ── Branch mutation (immutable) ────────────────────────────────────────────

/**
 * Add a memory to a branch, updating its signatures.
 * Returns a new branch — original is not mutated.
 *
 * source: cortex@bc0ae4f mcp_server/core/dendritic_clusters.py:103-130
 */
export function addMemoryToBranch(
  branch: DendriticBranch,
  memoryId: number,
  memoryEntities: Set<string>,
  memoryTags: Set<string>,
  memoryHeat: number,
): DendriticBranch {
  const newIds = [...branch.memoryIds, memoryId];
  const newEntities = new Set([...branch.entitySignature, ...memoryEntities]);
  const newTags = new Set([...branch.tagSignature, ...memoryTags]);
  const n = newIds.length;
  // source: cortex@bc0ae4f dendritic_clusters.py:128 (round(new_avg, 4))
  const newAvg =
    Math.round(((branch.avgHeat * (n - 1) + memoryHeat) / n) * ROUND_4DP) / ROUND_4DP;
  return {
    branchId: branch.branchId,
    domain: branch.domain,
    memoryIds: newIds,
    entitySignature: newEntities,
    tagSignature: newTags,
    avgHeat: newAvg,
    plasticity: branch.plasticity,
    spikeCount: branch.spikeCount,
  };
}

/**
 * Create a new branch with one founding memory.
 *
 * source: cortex@bc0ae4f mcp_server/core/dendritic_clusters.py:133-149
 */
export function createBranch(
  branchId: string,
  domain: string,
  memoryId: number,
  memoryEntities: Set<string>,
  memoryTags: Set<string>,
  memoryHeat: number,
): DendriticBranch {
  return {
    branchId,
    domain,
    memoryIds: [memoryId],
    entitySignature: new Set(memoryEntities),
    tagSignature: new Set(memoryTags),
    avgHeat: memoryHeat,
    plasticity: 1.0,
    spikeCount: 0,
  };
}
