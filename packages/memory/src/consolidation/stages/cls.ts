/**
 * CLS cycle: episodic -> semantic pattern extraction.
 *
 * Includes causal edge discovery from entity co-occurrences via the PC algorithm.
 *
 * Returns include a diagnostic `reason_for_zero` field when the cycle
 * produces no mutations (all mutational counters zero), distinguishing
 * early-return from a genuine "nothing to do" pass (issue #14 P2, darval).
 *
 * // source: issue #13 — previous cap of 500 saw ~2% of a 25k-episodic
 *   store and produced 0 patterns by construction. 2000 matches plasticity
 *   sampling and keeps PC algorithm's O(E^2) worst case tractable on a
 *   10k-entity vocabulary.
 *
 * // source: PC algorithm lower bound — need ≥3 observations per variable
 *   for conditional independence tests. Minimum cluster size = 3.
 *
 * Port of: mcp_server/handlers/consolidation/cls.py
 */

import {
  computeCoOccurrenceMatrix,
  discoverCausalEdges as _discoverCausalEdgesImpl,
} from "../causal-graph.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// source: issue #13 — previous cap of 500 saw ~2% of a 25k-episodic corpus; raised to 2000 after profiling.
const EPISODIC_SAMPLE_CAP = 2000; // source: issue #13
const SEMANTICS_SAMPLE_CAP = 2000; // source: issue #13

const MIN_PATTERN_SIZE = 3;
const CLUSTER_THRESHOLD = 0.6;

// source: cortex@f2b9f99 mcp_server/handlers/consolidation/cls.py — schema is capped at 500 chars
const SCHEMA_MAX_CHARS = 500;

// source: cortex@f2b9f99 mcp_server/handlers/consolidation/cls.py — max 10 unique tags per semantic memory
const TAGS_MAX_COUNT = 10;

// Source: PC algorithm lower bound — need ≥3 observations per variable
// to distinguish dependence from sampling noise; need ≥5 active variables
// for the independence tests to produce any non-trivial edge.
const PC_MIN_OBSERVATIONS = 3;
const MIN_ENTITIES_FOR_PC = 5;

// ── Store / Engine Interfaces ─────────────────────────────────────────────────

export interface ClsStore {
  getEpisodicMemories(limit: number): Promise<Record<string, unknown>[]>;
  getSemanticMemories(limit: number): Promise<Record<string, unknown>[]>;
  getAllEntities(opts: { minHeat: number }): Promise<Record<string, unknown>[]>;
  insertMemory(mem: Record<string, unknown>): Promise<number>;
  insertRelationship(rel: Record<string, unknown>): Promise<void>;
}

export interface ClsEmbeddingEngine {
  encode(text: string): Promise<number[]>;
  similarity(a: number[], b: number[]): number;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClsZeroReason =
  | "empty_episodic_scan"
  | "below_min_pattern_size"
  | "insufficient_pairs"
  | "no_qualifying_entities"
  | "passed_through";

export interface ClsStageResult {
  patterns_found: number;
  new_semantics_created: number;
  skipped_inconsistent: number;
  skipped_duplicate: number;
  causal_edges_found: number;
  episodic_scanned: number;
  reason_for_zero?: ClsZeroReason;
  duration_ms?: number;
}

export interface ClsSettings {
  [key: string]: unknown;
}

const EMPTY_CLS_STATS: Omit<ClsStageResult, "reason_for_zero"> = {
  patterns_found: 0,
  new_semantics_created: 0,
  skipped_inconsistent: 0,
  skipped_duplicate: 0,
  causal_edges_found: 0,
  episodic_scanned: 0,
};

// ── Passed-through diagnostic log ─────────────────────────────────────────────

/**
 * Emit an INFO log when the stage finished as a genuine no-op.
 *
 * Issue #14 P2 (darval): operators need to grep
 * `stage=<name> reason=passed_through` to distinguish "quiet store"
 * runs from early-return runs. Only fires when the classified reason
 * is `passed_through` on either field (`reason_for_zero` or
 * `reason_for_inaction`).
 *
 * Precondition: stats carries reason_for_zero or reason_for_inaction.
 * Postcondition: logs iff reason === "passed_through".
 */
function logIfPassedThrough(
  stageName: string,
  stats: Partial<ClsStageResult> & { reason_for_inaction?: string },
  durationMs: number,
  scanned: number,
): void {
  const reason = stats.reason_for_zero ?? stats.reason_for_inaction;
  if (reason !== "passed_through") return;
  console.info(
    `stage=${stageName} reason=passed_through scanned=${scanned} duration_ms=${durationMs}`,
  );
}

// ── Entity mention counting ───────────────────────────────────────────────────

/**
 * Count how many episodic memories mention each entity.
 *
 * Single pass over the episodic sample with precomputed lowercase
 * content and lowercase entity names (replaces the old O(N_ep × N_ent)
 * loop that called .lower() on every cell).
 *
 * Precondition: entityNames is non-empty.
 * Postcondition: every entry in entityNames has a count in the returned map.
 */
function countEntityMentions(
  entityNames: readonly string[],
  episodic: readonly Record<string, unknown>[],
): Map<string, number> {
  const contentLowered = episodic.map((m) =>
    ((m["content"] as string | undefined) ?? "").toLowerCase(),
  );
  const counts = new Map<string, number>();
  for (const name of entityNames) {
    const nameLow = name.toLowerCase();
    counts.set(name, contentLowered.filter((c) => c.includes(nameLow)).length);
  }
  return counts;
}

// ── Greedy clustering ─────────────────────────────────────────────────────────

/**
 * Greedy clustering by embedding similarity.
 *
 * Groups memories where any pair within the cluster has similarity >= threshold.
 * This is a simple single-linkage approach. O(n^2) — bounded by EPISODIC_SAMPLE_CAP.
 *
 * Invariant: uses the same CLUSTER_THRESHOLD as computeConsolidationPlan so the
 * classification reflects the same pairing regime the cycle actually ran under.
 */
async function clusterBySimilarity(
  memories: readonly Record<string, unknown>[],
  embeddings: ClsEmbeddingEngine,
  threshold: number,
): Promise<number[][]> {
  const clusters: number[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < memories.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [i];
    assigned.add(i);

    const embI = memories[i]?.["embedding"] as number[] | undefined;
    if (!embI) continue;

    for (let j = i + 1; j < memories.length; j++) {
      if (assigned.has(j)) continue;
      const embJ = memories[j]?.["embedding"] as number[] | undefined;
      if (!embJ) continue;
      if (embeddings.similarity(embI, embJ) >= threshold) {
        cluster.push(j);
        assigned.add(j);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

// ── Consolidation plan ────────────────────────────────────────────────────────

interface ConsolidationPlan {
  patterns_found: number;
  new_semantics: Array<{
    schema: string;
    tags: string[];
    source_memory_ids: number[];
  }>;
  skipped_inconsistent: number;
  skipped_duplicate: number;
}

/**
 * Plan which episodic memories to consolidate into semantics.
 *
 * Precondition: episodic.length > 0; embeddings provides encode/similarity.
 * Postcondition: returns ConsolidationPlan with new_semantics for each cluster
 *   of size >= MIN_PATTERN_SIZE that is not a duplicate of existing semantics.
 */
async function computeConsolidationPlan(
  episodic: readonly Record<string, unknown>[],
  existingSemantics: readonly Record<string, unknown>[],
  embeddings: ClsEmbeddingEngine,
): Promise<ConsolidationPlan> {
  const clusters = await clusterBySimilarity(episodic, embeddings, CLUSTER_THRESHOLD);
  const existingContents = new Set(
    existingSemantics.map((s) => (s["content"] as string | undefined) ?? ""),
  );

  const newSemantics: ConsolidationPlan["new_semantics"] = [];
  let patternsFound = 0;
  let skippedDuplicate = 0;

  for (const cluster of clusters) {
    if (cluster.length < MIN_PATTERN_SIZE) continue;
    patternsFound++;

    const members = cluster
      .map((i) => episodic[i])
      .filter((m): m is Record<string, unknown> => m !== undefined);
    // source: cortex@f2b9f99 mcp_server/handlers/consolidation/cls.py — 500-char schema cap
    const schema = members
      .map((m) => (m["content"] as string | undefined) ?? "")
      .join(" | ")
      .slice(0, SCHEMA_MAX_CHARS);

    if (existingContents.has(schema)) {
      skippedDuplicate++;
      continue;
    }

    const allTags = members.flatMap((m) => {
      const t = m["tags"];
      if (Array.isArray(t)) return t as string[];
      return [];
    });
    const uniqueTags = [...new Set(allTags)].slice(0, TAGS_MAX_COUNT);

    newSemantics.push({
      schema,
      tags: uniqueTags,
      source_memory_ids: members.map((m) => m["id"] as number),
    });
  }

  return {
    patterns_found: patternsFound,
    new_semantics: newSemantics,
    skipped_inconsistent: 0,
    skipped_duplicate: skippedDuplicate,
  };
}

// ── Create semantic memories ──────────────────────────────────────────────────

/**
 * Create new semantic memories from the consolidation plan.
 *
 * Precondition: store supports insertMemory and insertRelationship.
 * Postcondition: returns count of successfully created semantic memories;
 *   individual failures are swallowed (non-fatal).
 */
async function createSemanticMemories(
  store: ClsStore,
  embeddings: ClsEmbeddingEngine,
  plan: ConsolidationPlan,
): Promise<number> {
  let created = 0;
  for (const semantic of plan.new_semantics) {
    try {
      const emb = await embeddings.encode(semantic.schema);
      const memId = await store.insertMemory({
        content: semantic.schema,
        embedding: emb,
        tags: semantic.tags,
        domain: "",
        directory: "",
        source: "cls-consolidation",
        importance: 0.7,
        surprise: 0.0,
        emotional_valence: 0.0,
        confidence: 0.8,
        heat: 0.6,
        store_type: "semantic",
      });
      for (const sourceId of semantic.source_memory_ids) {
        if (sourceId == null) continue;
        try {
          await store.insertRelationship({
            source_entity_id: sourceId,
            target_entity_id: memId,
            relationship_type: "derived_from",
            weight: 1.0,
            confidence: 0.8,
          });
        } catch {
          // ignore link failures
        }
      }
      created++;
    } catch {
      // ignore individual memory failures
    }
  }
  return created;
}

// ── Causal edge discovery ─────────────────────────────────────────────────────

/**
 * Discover causal edges from entity co-occurrences (PC algorithm).
 *
 * Gates on minimum signal before running the O(E²) independence tests:
 * the PC algorithm needs at least PC_MIN_OBSERVATIONS mentions per entity
 * in the sample to distinguish correlation from chance, so if fewer than
 * MIN_ENTITIES_FOR_PC entities clear that threshold, skip the analysis
 * entirely (issue #13 Phase D).
 *
 * Precondition: episodic is non-empty; store supports getAllEntities.
 * Postcondition: returns (edges_stored, qualifying_count).
 *   edges_stored — number of causal/correlation edges persisted.
 *   qualifying_count — number of entities whose mention count reached
 *   PC_MIN_OBSERVATIONS. Surfaced for issue #14 P2 diagnostics so the
 *   handler can distinguish "insufficient_pairs" from "no_qualifying_entities".
 */
async function discoverCausalEdges(
  store: ClsStore,
  episodic: readonly Record<string, unknown>[],
): Promise<[number, number]> {
  try {
    const allEntities = await store.getAllEntities({ minHeat: 0.0 });
    const entityNames = allEntities
      .map((e) => e["name"] as string | undefined)
      .filter((n): n is string => Boolean(n));

    if (!entityNames.length || !episodic.length) return [0, 0];

    const entityCounts = countEntityMentions(entityNames, episodic);
    const qualifying = [...entityCounts.values()].filter(
      (c) => c >= PC_MIN_OBSERVATIONS,
    ).length;

    if (qualifying < MIN_ENTITIES_FOR_PC) return [0, qualifying];

    // Restrict vocabulary to entities that meet the minimum so the
    // co-occurrence matrix is E_qualifying^2, not E_all^2.
    const activeNames = entityNames.filter(
      (n) => (entityCounts.get(n) ?? 0) >= PC_MIN_OBSERVATIONS,
    );
    const coMatrix = computeCoOccurrenceMatrix(episodic, activeNames);

    const activeCountsMap = new Map<string, number>(
      activeNames.map((n) => [n, entityCounts.get(n) ?? 0]),
    );

    // Build first-seen timestamps from episodic memory created_at fields.
    const entityFirstSeen = new Map<string, string>();
    for (const mem of episodic) {
      const createdAt = mem["created_at"] as string | undefined;
      if (!createdAt) continue;
      const content = ((mem["content"] as string | undefined) ?? "").toLowerCase();
      for (const name of activeNames) {
        if (content.includes(name.toLowerCase()) && !entityFirstSeen.has(name)) {
          entityFirstSeen.set(name, createdAt);
        }
      }
    }

    const edges = _discoverCausalEdgesImpl(
      activeNames,
      coMatrix,
      activeCountsMap,
      episodic.length,
      { entityFirstSeen },
    );

    // Persist discovered edges as relationships
    let count = 0;
    for (const edge of edges) {
      try {
        const src = allEntities.find((e) => e["name"] === edge["source"]);
        const tgt = allEntities.find((e) => e["name"] === edge["target"]);
        if (!src || !tgt) continue;
        await store.insertRelationship({
          source_entity_id: src["id"],
          target_entity_id: tgt["id"],
          relationship_type: edge["is_directed"] ? "causes" : "correlates_with",
          weight: edge["strength"],
          confidence: edge["is_directed"] ? 0.6 : 0.3,
        });
        count++;
      } catch {
        // non-fatal
      }
    }

    return [count, qualifying];
  } catch {
    return [0, 0];
  }
}

// ── Count multi-member clusters ───────────────────────────────────────────────

/**
 * Count clusters with >= 2 members by re-running greedy clustering.
 *
 * Invariant: uses the same CLUSTER_THRESHOLD as computeConsolidationPlan
 * so the classification reflects the same pairing regime the cycle ran under.
 *
 * Precondition: episodic may be empty.
 * Postcondition: returns count of clusters with >= 2 members, or 0 on error.
 */
async function countMultiMemberClusters(
  episodic: readonly Record<string, unknown>[],
  embeddings: ClsEmbeddingEngine,
): Promise<number> {
  try {
    const clusters = await clusterBySimilarity(episodic, embeddings, CLUSTER_THRESHOLD);
    return clusters.filter((c) => c.length >= 2).length;
  } catch {
    return 0;
  }
}

// ── Zero-reason classifier ────────────────────────────────────────────────────

/**
 * Classify the early-return path when every mutational counter is zero.
 *
 * Precondition: stats carries the 5 mutational counters plus episodic_scanned;
 *   qualifyingCount is the number of entities that passed the PC observation
 *   threshold inside discoverCausalEdges.
 *
 * Postcondition: returns null when any mutational counter is non-zero
 *   (diagnostic is additive — absent whenever the cycle produced output).
 *   Otherwise returns one of the enumerated reasons below.
 *
 * Priority (first match wins — most informative signal takes precedence):
 *   1. below_min_pattern_size — clustering produced >= 1 multi-member cluster
 *      but none reached MIN_PATTERN_SIZE.
 *   2. insufficient_pairs — no embedding pair crossed threshold AND no entity
 *      has enough mentions for the PC gate.
 *   3. no_qualifying_entities — some entities qualify but fewer than
 *      MIN_ENTITIES_FOR_PC; cluster pipeline produced no pairs.
 *   4. passed_through — every branch ran to completion and found nothing new.
 */
async function classifyClsZeroReason(
  stats: ClsStageResult,
  episodic: readonly Record<string, unknown>[],
  embeddings: ClsEmbeddingEngine,
  qualifyingCount: number,
): Promise<ClsZeroReason | null> {
  const counters = [
    stats.patterns_found,
    stats.new_semantics_created,
    stats.skipped_inconsistent,
    stats.skipped_duplicate,
    stats.causal_edges_found,
  ];
  if (counters.some((c) => c !== 0)) return null;

  // All mutational counters zero: recompute clustering to inspect pair-level signal.
  // This path only runs when the stage produced no mutations so the O(n^2) replay
  // is bounded by the no-op case.
  const multiMember = await countMultiMemberClusters(episodic, embeddings);

  if (multiMember > 0) return "below_min_pattern_size";
  if (qualifyingCount === 0) return "insufficient_pairs";
  if (qualifyingCount < MIN_ENTITIES_FOR_PC) return "no_qualifying_entities";
  return "passed_through";
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run CLS consolidation: episodic → semantic pattern extraction.
 *
 * Verification ablation hook: when CORTEX_CONSOLIDATION_DISABLED=1 is set
 * (E2 N-scan condition cortex_flat), returns the zero state immediately.
 * No episodic-to-semantic abstraction runs; the flat-importance store is
 * never enriched with patterns.
 * // source: tasks/verification-protocol.md E2; benchmarks/lib/n_scan_runner.py
 *
 * Pattern extraction (computeConsolidationPlan) and causal-edge discovery
 * (discoverCausalEdges) sample up to 2000 episodic memories each — raised
 * from 500 after Feynman's audit of darval's 66K run in issue #13 showed
 * 500 sampled 2% of the episodic store and produced 0 patterns by construction.
 *
 * Postcondition (issue #14 P2): the returned object always carries the 6
 * numeric counters. When every mutational counter is zero, an additive
 * reason_for_zero key classifies the early-return path: one of
 * empty_episodic_scan, below_min_pattern_size, insufficient_pairs,
 * no_qualifying_entities, passed_through. When any mutational counter is
 * non-zero, reason_for_zero is omitted.
 *
 * Precondition: store and embeddings are valid.
 * Postcondition: all 6 counters present in result; reason_for_zero iff all mutational counters zero.
 */
export async function runClsCycle(
  store: ClsStore,
  _settings: ClsSettings,
  embeddings: ClsEmbeddingEngine,
): Promise<ClsStageResult> {
  // Ablation hook: CORTEX_CONSOLIDATION_DISABLED=1 disables the full cycle.
  if (
    typeof process !== "undefined" &&
    process.env["CORTEX_CONSOLIDATION_DISABLED"] === "1"
  ) {
    return { ...EMPTY_CLS_STATS };
  }

  const episodic = await store.getEpisodicMemories(EPISODIC_SAMPLE_CAP);
  const existingSemantics = await store.getSemanticMemories(SEMANTICS_SAMPLE_CAP);

  if (!episodic.length) {
    const stats: ClsStageResult = {
      ...EMPTY_CLS_STATS,
      reason_for_zero: "empty_episodic_scan",
    };
    logIfPassedThrough("cls", stats, 0, 0);
    return stats;
  }

  const plan = await computeConsolidationPlan(episodic, existingSemantics, embeddings);
  const created = await createSemanticMemories(store, embeddings, plan);
  const [causalEdgesFound, qualifyingCount] = await discoverCausalEdges(store, episodic);

  const stats: ClsStageResult = {
    patterns_found: plan.patterns_found,
    new_semantics_created: created,
    skipped_inconsistent: plan.skipped_inconsistent,
    skipped_duplicate: plan.skipped_duplicate,
    causal_edges_found: causalEdgesFound,
    episodic_scanned: episodic.length,
  };

  const reason = await classifyClsZeroReason(stats, episodic, embeddings, qualifyingCount);
  if (reason !== null) {
    stats.reason_for_zero = reason;
    logIfPassedThrough("cls", stats, 0, episodic.length);
  }

  return stats;
}
