/**
 * Consolidation engine — episodic-to-semantic distillation orchestration.
 *
 * Orchestrates the full consolidation cycle:
 *   1. Pattern detection in episodic memories (Go-CLS clustering)
 *   2. Consistency checking (contradiction detection)
 *   3. Schema abstraction (generalized knowledge extraction)
 *   4. Duplicate detection (avoid redundant semantics)
 *
 * Port of: mcp_server/core/consolidation_engine.py
 * Pure business logic — receives data, returns actions to take.
 * The caller (handler/infrastructure) executes the I/O.
 */

import { classifyMemory } from "../wiki/page-classifier.js";
import {
  abstractToSchema,
  checkConsistency,
  clusterBySimilarity,
  filterRecurringPatterns,
} from "../recall/dual-store-cls-abstraction.js";

type SimilarityFn = (a: unknown, b: unknown) => number;

// ── Consolidation Actions ─────────────────────────────────────────────────────

function isDuplicateSchema(
  clusterMems: Record<string, unknown>[],
  existingSemantics: Record<string, unknown>[],
  similarityFn: SimilarityFn,
  dedupThreshold: number,
): boolean {
  const clusterEmbedding = (clusterMems[0] ?? {})["embedding"];
  for (const existing of existingSemantics) {
    if (
      existing["content"] &&
      similarityFn(existing["embedding"], clusterEmbedding) > dedupThreshold
    ) {
      return true;
    }
  }
  return false;
}

function collectCommonTags(clusterMems: Record<string, unknown>[]): string[] {
  const allTags = new Map<string, number>();
  for (const mem of clusterMems) {
    const tags = (mem["tags"] ?? []) as string[];
    for (const tag of tags) {
      if (typeof tag === "string") {
        allTags.set(tag, (allTags.get(tag) ?? 0) + 1);
      }
    }
  }
  const n = clusterMems.length;
  const common = Array.from(allTags.entries())
    .filter(([, c]) => c >= Math.max(1, n * 0.5))
    .map(([t]) => t);
  return Array.from(new Set(["semantic", "auto-abstracted", ...common]));
}

export interface ConsolidationPlan {
  new_semantics: Array<{
    schema: string;
    source_memory_ids: unknown[];
    tags: string[];
    count: number;
    session_count: number;
  }>;
  patterns_found: number;
  skipped_inconsistent: number;
  skipped_duplicate: number;
}

/**
 * Plan CLS consolidation actions without executing I/O.
 *
 * @returns ConsolidationPlan with new_semantics, patterns_found, skipped counts.
 *
 * Precondition: episodicMemories and existingSemantics are arrays;
 *   similarityFn(a,b) returns a value in [0,1].
 * Postcondition: sum(new_semantics.length + skipped_inconsistent + skipped_duplicate)
 *   === patterns_found.
 */
export function planClsConsolidation(
  episodicMemories: Record<string, unknown>[],
  existingSemantics: Record<string, unknown>[],
  similarityFn: SimilarityFn,
  clusterThreshold: number = 0.6,
  dedupThreshold: number = 0.85,
  minOccurrences: number = 3,
  minSessions: number = 2,
): ConsolidationPlan {
  const clusters = clusterBySimilarity(episodicMemories, similarityFn, clusterThreshold);
  const patterns = filterRecurringPatterns(clusters, minOccurrences, minSessions);

  return processPatterns(patterns, existingSemantics, similarityFn, dedupThreshold);
}

function tryAbstractPattern(
  pattern: Record<string, unknown>,
  existingSemantics: Record<string, unknown>[],
  similarityFn: SimilarityFn,
  dedupThreshold: number,
): Record<string, unknown> | null {
  const clusterMems = pattern["memories"] as Record<string, unknown>[];
  const schema = abstractToSchema(clusterMems);
  if (!schema) return null;
  if (isDuplicateSchema(clusterMems, existingSemantics, similarityFn, dedupThreshold)) {
    return null;
  }
  return {
    schema,
    source_memory_ids: pattern["memory_ids"] as unknown[],
    tags: collectCommonTags(clusterMems),
    count: pattern["count"] as number,
    session_count: pattern["session_count"] as number,
  };
}

function processPatterns(
  patterns: Record<string, unknown>[],
  existingSemantics: Record<string, unknown>[],
  similarityFn: SimilarityFn,
  dedupThreshold: number,
): ConsolidationPlan {
  const newSemantics: ConsolidationPlan["new_semantics"] = [];
  let skippedInconsistent = 0;
  let skippedDuplicate = 0;

  for (const pattern of patterns) {
    const mems = pattern["memories"] as Record<string, unknown>[];
    if (!checkConsistency(mems).consistent) {
      skippedInconsistent++;
      continue;
    }
    const result = tryAbstractPattern(pattern, existingSemantics, similarityFn, dedupThreshold);
    if (result === null) {
      skippedDuplicate++;
    } else {
      newSemantics.push(result as ConsolidationPlan["new_semantics"][0]);
    }
  }

  return {
    new_semantics: newSemantics,
    patterns_found: patterns.length,
    skipped_inconsistent: skippedInconsistent,
    skipped_duplicate: skippedDuplicate,
  };
}

// ── Duplicate Detection ───────────────────────────────────────────────────────

/**
 * Find pairs of near-duplicate memories.
 *
 * @returns List of [keep_id, remove_id] pairs.
 *   The memory with higher heat is kept.
 *
 * Precondition: memories is an array; similarityFn(a,b) returns a value in [0,1].
 * Postcondition: each memory ID appears in at most one pair as remove_id.
 * Invariant (per i): seen.size grows monotonically; no j < i is revisited.
 */
export function findNearDuplicates(
  memories: Record<string, unknown>[],
  similarityFn: SimilarityFn,
  threshold: number = 0.95,
): Array<[unknown, unknown]> {
  const duplicates: Array<[unknown, unknown]> = [];
  const seen = new Set<number>();

  for (let i = 0; i < memories.length; i++) {
    if (seen.has(i)) continue;
    const memI = memories[i];
    if (!memI) continue;
    for (let j = i + 1; j < memories.length; j++) {
      if (seen.has(j)) continue;
      const memJ = memories[j];
      if (!memJ) continue;
      const embA = memI["embedding"];
      const embB = memJ["embedding"];
      if (embA == null || embB == null) continue;
      if (similarityFn(embA, embB) >= threshold) {
        const heatI = (memI["heat"] as number | undefined) ?? 0;
        const heatJ = (memJ["heat"] as number | undefined) ?? 0;
        if (heatI >= heatJ) {
          duplicates.push([memI["id"], memJ["id"]]);
        } else {
          duplicates.push([memJ["id"], memI["id"]]);
        }
        seen.add(j);
      }
    }
  }

  return duplicates;
}

// ── Action Log Summarization ──────────────────────────────────────────────────

/**
 * Summarize a group of related actions into a single memory.
 *
 * @returns Summary text or null if group is too small.
 *
 * Precondition: actions is an array; minActions >= 1.
 * Postcondition: returns null if actions.length < minActions; otherwise non-empty string.
 */
export function summarizeActionGroup(
  actions: Record<string, unknown>[],
  minActions: number = 3,
): string | null {
  if (actions.length < minActions) return null;

  const typeCounts = new Map<string, number>();
  const filesTouched = new Set<string>();

  for (const action of actions) {
    const actionType = (action["type"] ?? "unknown") as string;
    typeCounts.set(actionType, (typeCounts.get(actionType) ?? 0) + 1);
    if (action["file"]) filesTouched.add(action["file"] as string);
  }

  const parts = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([atype, count]) => `${count}x ${atype}`);

  let summary = `Session activity: ${parts.join(", ")}`;
  if (filesTouched.size > 0) {
    const sorted = Array.from(filesTouched).sort().slice(0, 5);
    let fileList = sorted.join(", ");
    if (filesTouched.size > 5) fileList += ` (+${filesTouched.size - 5} more)`;
    summary += `. Files: ${fileList}`;
  }

  return summary;
}

// ── Entity Classification Enhancement ─────────────────────────────────────────

/**
 * Determine if an episodic memory should be reclassified as semantic.
 *
 * An episodic memory graduates to semantic when:
 *   - Accessed >= 5 times (frequent retrieval)
 *   - Or there are >= 3 related semantic memories (integration pressure)
 *   - And it's already classified as semantic by content analysis
 *
 * Precondition: memory is a non-null object.
 * Postcondition: returns false if memory is already semantic.
 */
export function shouldReclassify(
  memory: Record<string, unknown>,
  accessCount: number = 0,
  relatedSemantics: number = 0,
): boolean {
  if (memory["store_type"] === "semantic") return false;

  const content = (memory["content"] ?? "") as string;
  let tags = (memory["tags"] ?? []) as string[];
  if (typeof tags === "string") {
    tags = (tags as string).split(",");
  }

  const contentClass = classifyMemory(content, tags);
  if (contentClass !== "semantic") return false;

  return accessCount >= 5 || relatedSemantics >= 3;
}
