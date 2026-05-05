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
 * Port of: mcp_server/core/curation.py
 * source: cortex@ed33435 mcp_server/core/curation.py
 */

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/core/curation.py:18
const NEGATION_RE =
  /\b(not|don't|doesn't|no longer|replaced|switched from|deprecated|never|removed|stopped|avoid)\b/i;

// source: cortex@ed33435 mcp_server/core/curation.py:24
const ACTION_RE =
  /\b(use|using|prefer|run|install|deploy|build|create|configure|set|enable|disable|switch|migrate)\b/i;

const ACTION_RE_GLOBAL =
  /\b(use|using|prefer|run|install|deploy|build|create|configure|set|enable|disable|switch|migrate)\b/gi;

// source: cortex@ed33435 mcp_server/core/curation.py:31
export const MERGE_THRESHOLD = 0.85;
// source: cortex@ed33435 mcp_server/core/curation.py:32
export const LINK_LOW = 0.6;
// source: cortex@ed33435 mcp_server/core/curation.py:33
export const LINK_HIGH = 0.85;

// ── Ingestion Decisions ────────────────────────────────────────────────────

/**
 * Decide what to do when storing a memory that has similar existing ones.
 *
 * Returns one of: "merge", "link", "create".
 *
 * Port of: mcp_server/core/curation.py::decide_curation_action
 * source: cortex@ed33435 mcp_server/core/curation.py:39
 */
export function decideCurationAction(
  similarity: number,
  hasTextualOverlap: boolean,
  mergeThreshold: number = MERGE_THRESHOLD,
  linkLow: number = LINK_LOW,
): "merge" | "link" | "create" {
  if (similarity >= mergeThreshold && hasTextualOverlap) return "merge";
  if (similarity >= linkLow) return "link";
  return "create";
}

/**
 * Jaccard similarity between word sets of two texts.
 * Port of: mcp_server/core/curation.py::compute_textual_overlap
 * source: cortex@ed33435 mcp_server/core/curation.py:57
 */
export function computeTextualOverlap(contentA: string, contentB: string): number {
  const wordsA = new Set((contentA.toLowerCase().match(/\b\w+\b/g) ?? []));
  const wordsB = new Set((contentB.toLowerCase().match(/\b\w+\b/g) ?? []));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Merge two memory contents, avoiding pure duplication.
 * Port of: mcp_server/core/curation.py::merge_contents
 * source: cortex@ed33435 mcp_server/core/curation.py:66
 */
export function mergeContents(existingContent: string, newContent: string): string {
  if (existingContent.includes(newContent.trim())) return existingContent;
  if (newContent.includes(existingContent.trim())) return newContent;
  return `${existingContent}\n${newContent}`;
}

/**
 * Union of tag sets, preserving order.
 * Port of: mcp_server/core/curation.py::merge_tags
 * source: cortex@ed33435 mcp_server/core/curation.py:75
 */
export function mergeTags(existingTags: string[], newTags: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [...existingTags, ...newTags]) {
    if (!seen.has(tag)) {
      seen.add(tag);
      merged.push(tag);
    }
  }
  return merged;
}

// ── Contradiction Detection ────────────────────────────────────────────────

export interface ContradictionRecord {
  memory_id: number;
  type: "negation_mismatch" | "action_divergence";
  description: string;
  confidence_penalty: number;
}

/**
 * Check one memory for contradiction against new content signals.
 * Port of: mcp_server/core/curation.py::_check_single_contradiction
 * source: cortex@ed33435 mcp_server/core/curation.py:89
 */
function checkSingleContradiction(
  mem: Record<string, unknown>,
  newHasNegation: boolean,
  newActions: Set<string>,
): ContradictionRecord | null {
  const existingContent = String(mem["content"] ?? "");
  const existingHasNegation = NEGATION_RE.test(existingContent);
  const memId = mem["id"] as number;

  if (newHasNegation !== existingHasNegation) {
    return {
      memory_id: memId,
      type: "negation_mismatch",
      description: `Negation conflict with memory ${memId}`,
      confidence_penalty: 0.2, // source: cortex@ed33435 curation.py:103
    };
  }

  const existingActions = new Set<string>(
    (existingContent.toLowerCase().match(ACTION_RE_GLOBAL) ?? []),
  );
  if (
    newActions.size > 0 &&
    existingActions.size > 0 &&
    ![...newActions].some((a) => existingActions.has(a))
  ) {
    return {
      memory_id: memId,
      type: "action_divergence",
      description: `Different actions on similar topic (memory ${memId})`,
      confidence_penalty: 0.1, // source: cortex@ed33435 curation.py:113
    };
  }
  return null;
}

/**
 * Detect potential contradictions between new content and existing memories.
 *
 * Returns list of {memory_id, type, description, confidence_penalty}.
 *
 * Port of: mcp_server/core/curation.py::detect_contradictions
 * source: cortex@ed33435 mcp_server/core/curation.py:118
 */
export function detectContradictions(
  newContent: string,
  similarMemories: Record<string, unknown>[],
  _similarityThreshold: number = 0.7,
): ContradictionRecord[] {
  const newHasNegation = NEGATION_RE.test(newContent);
  const newActions = new Set<string>(
    (newContent.toLowerCase().match(ACTION_RE_GLOBAL) ?? []),
  );

  const contradictions: ContradictionRecord[] = [];
  for (const mem of similarMemories) {
    const result = checkSingleContradiction(mem, newHasNegation, newActions);
    if (result !== null) contradictions.push(result);
  }
  return contradictions;
}

// ── Memify Self-Improvement ────────────────────────────────────────────────

/**
 * Identify memories that should be pruned.
 *
 * Prune criteria: heat < threshold AND confidence < threshold AND access_count == 0.
 *
 * Port of: mcp_server/core/curation.py::identify_prunable
 * source: cortex@ed33435 mcp_server/core/curation.py:142
 */
export function identifyPrunable(
  memories: Record<string, unknown>[],
  heatThreshold: number = 0.01, // source: cortex@ed33435 curation.py:144
  confidenceThreshold: number = 0.3, // source: cortex@ed33435 curation.py:145
): number[] {
  return memories
    .filter(
      (m) =>
        Number(m["heat"] ?? 1.0) < heatThreshold &&
        Number(m["confidence"] ?? 1.0) < confidenceThreshold &&
        Number(m["access_count"] ?? 0) === 0,
    )
    .map((m) => m["id"] as number);
}

/**
 * Identify memories that deserve importance boost.
 *
 * Returns list of [memory_id, new_importance].
 *
 * Port of: mcp_server/core/curation.py::identify_strengtheneable
 * source: cortex@ed33435 mcp_server/core/curation.py:158
 */
export function identifyStrengheneable(
  memories: Record<string, unknown>[],
  minAccess: number = 5, // source: cortex@ed33435 curation.py:160
  minConfidence: number = 0.8, // source: cortex@ed33435 curation.py:161
  boostAmount: number = 0.1, // source: cortex@ed33435 curation.py:162
): Array<[number, number]> {
  const results: Array<[number, number]> = [];
  for (const mem of memories) {
    if (
      Number(mem["access_count"] ?? 0) >= minAccess &&
      Number(mem["confidence"] ?? 0) >= minConfidence
    ) {
      const current = Number(mem["importance"] ?? 0.5);
      const newImportance = Math.min(1.0, current + boostAmount);
      if (newImportance > current) {
        results.push([mem["id"] as number, newImportance]);
      }
    }
  }
  return results;
}

/**
 * Compute relationship weight adjustments based on entity heat.
 *
 * Returns list of [relationship_id, new_weight].
 *
 * Port of: mcp_server/core/curation.py::compute_relationship_reweights
 * source: cortex@ed33435 mcp_server/core/curation.py:182
 */
export function computeRelationshipReweights(
  relationships: Record<string, unknown>[],
  entityHeats: Map<number, number>,
  hotThreshold: number = 0.7, // source: cortex@ed33435 curation.py:186
  coldThreshold: number = 0.1, // source: cortex@ed33435 curation.py:187
  hotBoost: number = 0.5, // source: cortex@ed33435 curation.py:188
  coldDecay: number = 0.9, // source: cortex@ed33435 curation.py:189
): Array<[number, number]> {
  const updates: Array<[number, number]> = [];
  for (const rel of relationships) {
    const srcHeat = entityHeats.get(Number(rel["source_entity_id"] ?? 0)) ?? 0.5;
    const tgtHeat = entityHeats.get(Number(rel["target_entity_id"] ?? 0)) ?? 0.5;
    const avgHeat = (srcHeat + tgtHeat) / 2;
    const currentWeight = Number(rel["weight"] ?? 1.0);

    if (avgHeat > hotThreshold) {
      updates.push([rel["id"] as number, Math.round((currentWeight + hotBoost) * 1000) / 1000]);
    } else if (avgHeat < coldThreshold) {
      updates.push([rel["id"] as number, Math.round(currentWeight * coldDecay * 1000) / 1000]);
    }
    // else: no update — continue source: cortex@ed33435 curation.py:204
  }
  return updates;
}

/**
 * Generate synthetic facts from high-weight relationships.
 *
 * Returns list of fact strings.
 *
 * Port of: mcp_server/core/curation.py::identify_derivable_facts
 * source: cortex@ed33435 mcp_server/core/curation.py:212
 */
export function identifyDerivableFacts(
  relationships: Record<string, unknown>[],
  entityNames: Map<number, string>,
  weightThreshold: number = 10.0, // source: cortex@ed33435 curation.py:215
): string[] {
  const facts: string[] = [];
  for (const rel of relationships) {
    if (Number(rel["weight"] ?? 0) >= weightThreshold) {
      const srcName = entityNames.get(Number(rel["source_entity_id"] ?? 0)) ?? "?";
      const tgtName = entityNames.get(Number(rel["target_entity_id"] ?? 0)) ?? "?";
      const relType = String(rel["relationship_type"] ?? "related_to");
      facts.push(
        `${srcName} and ${tgtName} are strongly linked ` +
          `(${relType}, weight=${Number(rel["weight"]).toFixed(1)})`,
      );
    }
  }
  return facts;
}
