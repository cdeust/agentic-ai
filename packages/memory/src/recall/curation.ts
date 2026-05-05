/**
 * Active memory curation — merge/link/create decisions and self-improvement.
 *
 * Implements:
 *   - Ingestion decisions: merge near-duplicates, link related, create new
 *   - Contradiction detection: negation + action divergence
 *   - Memify self-improvement: prune, strengthen, reweight, derive
 *
 * Pure business logic — no I/O. Receives data, returns decisions/actions.
 *
 * Port of: cortex@ed33435 mcp_server/core/curation.py
 */

// ── Constants ─────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/curation.py:18-33

const NEGATION_RE = /\b(not|don't|doesn't|no longer|replaced|switched from|deprecated|never|removed|stopped|avoid)\b/i;
const ACTION_RE = /\b(use|using|prefer|run|install|deploy|build|create|configure|set|enable|disable|switch|migrate)\b/gi;

export const MERGE_THRESHOLD = 0.85; // source: cortex@ed33435 mcp_server/core/curation.py:31
export const LINK_LOW = 0.6;         // source: cortex@ed33435 mcp_server/core/curation.py:32
export const LINK_HIGH = 0.85;       // source: cortex@ed33435 mcp_server/core/curation.py:33

// ── Ingestion decisions ───────────────────────────────────────────────────

/**
 * Decide what to do when storing a memory that has similar existing ones.
 *
 * precondition:  similarity ∈ [0, 1].
 * postcondition: returns "merge" | "link" | "create".
 *
 * source: cortex@ed33435 mcp_server/core/curation.py:39-54
 */
export function decideCurationAction(
  similarity: number,
  hasTextualOverlap: boolean,
  mergeThreshold = MERGE_THRESHOLD,
  linkLow = LINK_LOW,
): "merge" | "link" | "create" {
  if (similarity >= mergeThreshold && hasTextualOverlap) return "merge";
  if (similarity >= linkLow) return "link";
  return "create";
}

/**
 * Jaccard similarity between word sets of two texts.
 *
 * postcondition: result ∈ [0, 1].
 * source: cortex@ed33435 mcp_server/core/curation.py:57-63
 */
export function computeTextualOverlap(contentA: string, contentB: string): number {
  const wordsA = new Set((contentA.toLowerCase().match(/\b\w+\b/g) ?? []));
  const wordsB = new Set((contentB.toLowerCase().match(/\b\w+\b/g) ?? []));
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;
  let intersection = 0;
  for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}

/**
 * Merge two memory contents, avoiding pure duplication.
 * source: cortex@ed33435 mcp_server/core/curation.py:66-72
 */
export function mergeContents(existingContent: string, newContent: string): string {
  if (newContent.trim().includes(existingContent.trim())) return newContent;
  if (existingContent.trim().includes(newContent.trim())) return existingContent;
  return `${existingContent}\n${newContent}`;
}

/**
 * Union of tag sets, preserving order.
 * source: cortex@ed33435 mcp_server/core/curation.py:75-83
 */
export function mergeTags(existingTags: string[], newTags: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [...existingTags, ...newTags]) {
    if (!seen.has(tag)) { seen.add(tag); merged.push(tag); }
  }
  return merged;
}

// ── Contradiction detection ───────────────────────────────────────────────

function checkSingleContradiction(
  mem: Record<string, unknown>,
  newHasNegation: boolean,
  newActions: Set<string>,
): Record<string, unknown> | null {
  const existingContent = (mem["content"] as string | undefined) ?? "";
  const existingHasNegation = NEGATION_RE.test(existingContent);
  const memId = mem["id"];

  if (newHasNegation !== existingHasNegation) {
    return {
      memory_id: memId,
      type: "negation_mismatch",
      description: `Negation conflict with memory ${memId}`,
      confidence_penalty: 0.2,
    };
  }

  const existingActions = new Set(
    (existingContent.toLowerCase().match(ACTION_RE) ?? []).map((a) => a.toLowerCase()),
  );
  if (newActions.size > 0 && existingActions.size > 0) {
    let overlap = false;
    for (const a of newActions) { if (existingActions.has(a)) { overlap = true; break; } }
    if (!overlap) {
      return {
        memory_id: memId,
        type: "action_divergence",
        description: `Different actions on similar topic (memory ${memId})`,
        confidence_penalty: 0.1,
      };
    }
  }
  return null;
}

/**
 * Detect potential contradictions between new content and existing memories.
 *
 * postcondition: each returned item has memory_id, type, description, confidence_penalty.
 * source: cortex@ed33435 mcp_server/core/curation.py:118-135
 */
export function detectContradictions(
  newContent: string,
  similarMemories: Record<string, unknown>[],
  _similarityThreshold = 0.7,
): Record<string, unknown>[] {
  const newHasNegation = NEGATION_RE.test(newContent);
  const newActions = new Set(
    (newContent.toLowerCase().match(ACTION_RE) ?? []).map((a) => a.toLowerCase()),
  );

  const contradictions: Record<string, unknown>[] = [];
  for (const mem of similarMemories) {
    const result = checkSingleContradiction(mem, newHasNegation, newActions);
    if (result !== null) contradictions.push(result);
  }
  return contradictions;
}

// ── Memify self-improvement ───────────────────────────────────────────────

/**
 * Identify memories that should be pruned.
 *
 * source: cortex@ed33435 mcp_server/core/curation.py:141-156
 *   heat_threshold=0.01; confidence_threshold=0.3
 */
export function identifyPrunable(
  memories: Record<string, unknown>[],
  heatThreshold = 0.01,
  confidenceThreshold = 0.3,
): number[] {
  return memories
    .filter((m) =>
      ((m["heat"] as number | undefined) ?? 1.0) < heatThreshold &&
      ((m["confidence"] as number | undefined) ?? 1.0) < confidenceThreshold &&
      ((m["access_count"] as number | undefined) ?? 0) === 0,
    )
    .map((m) => m["id"] as number);
}

/**
 * Identify memories that deserve importance boost.
 *
 * source: cortex@ed33435 mcp_server/core/curation.py:159-178
 *   min_access=5; min_confidence=0.8; boost_amount=0.1
 */
export function identifyStrengtheneable(
  memories: Record<string, unknown>[],
  minAccess = 5,
  minConfidence = 0.8,
  boostAmount = 0.1,
): Array<[number, number]> {
  const results: Array<[number, number]> = [];
  for (const mem of memories) {
    if (
      ((mem["access_count"] as number | undefined) ?? 0) >= minAccess &&
      ((mem["confidence"] as number | undefined) ?? 0) >= minConfidence
    ) {
      const current = (mem["importance"] as number | undefined) ?? 0.5;
      const newImportance = Math.min(1.0, current + boostAmount);
      if (newImportance > current) results.push([mem["id"] as number, newImportance]);
    }
  }
  return results;
}

/**
 * Compute relationship weight adjustments based on entity heat.
 *
 * source: cortex@ed33435 mcp_server/core/curation.py:182-209
 *   hot_threshold=0.7; cold_threshold=0.1; hot_boost=0.5; cold_decay=0.9
 */
export function computeRelationshipReweights(
  relationships: Record<string, unknown>[],
  entityHeats: Map<number, number>,
  hotThreshold = 0.7,
  coldThreshold = 0.1,
  hotBoost = 0.5,
  coldDecay = 0.9,
): Array<[number, number]> {
  const updates: Array<[number, number]> = [];
  for (const rel of relationships) {
    const srcHeat = entityHeats.get((rel["source_entity_id"] as number | undefined) ?? 0) ?? 0.5;
    const tgtHeat = entityHeats.get((rel["target_entity_id"] as number | undefined) ?? 0) ?? 0.5;
    const avgHeat = (srcHeat + tgtHeat) / 2;
    const currentWeight = (rel["weight"] as number | undefined) ?? 1.0;

    let newWeight: number;
    if (avgHeat > hotThreshold) {
      newWeight = currentWeight + hotBoost;
    } else if (avgHeat < coldThreshold) {
      newWeight = currentWeight * coldDecay;
    } else {
      continue;
    }
    updates.push([rel["id"] as number, Math.round(newWeight * 1000) / 1000]);
  }
  return updates;
}

/**
 * Generate synthetic facts from high-weight relationships.
 *
 * source: cortex@ed33435 mcp_server/core/curation.py:212-231
 *   weight_threshold=10.0
 */
export function identifyDerivableFacts(
  relationships: Record<string, unknown>[],
  entityNames: Map<number, string>,
  weightThreshold = 10.0,
): string[] {
  const facts: string[] = [];
  for (const rel of relationships) {
    if (((rel["weight"] as number | undefined) ?? 0) >= weightThreshold) {
      const srcName = entityNames.get((rel["source_entity_id"] as number | undefined) ?? 0) ?? "?";
      const tgtName = entityNames.get((rel["target_entity_id"] as number | undefined) ?? 0) ?? "?";
      const relType = (rel["relationship_type"] as string | undefined) ?? "related_to";
      facts.push(
        `${srcName} and ${tgtName} are strongly linked (${relType}, weight=${Number(rel["weight"]).toFixed(1)})`,
      );
    }
  }
  return facts;
}
