/**
 * Co-activation Hebbian learning: strengthen entity-pair edges when
 * memories containing related entities are retrieved together.
 *
 * "Dragon Hatchling Hebbian": co-retrieved entities strengthen edges.
 *
 * Port of: mcp_server/handlers/recall.py::_apply_co_activation
 *
 * Entity extraction uses a capitalized-token heuristic that matches
 * the regex-based code pattern extraction in the Python source.
 * The NER path of knowledge_graph.extract_entities (spacy model) is
 * out-of-scope for the TS runtime; the token heuristic is the
 * production strategy for this layer.
 *
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:extract_entities
 */

import type { MemoryStore } from "./port.js";
import type { RecallResult } from "./types.js";

// ── Co-activation constants ────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/recall.py::_apply_co_activation
const ENTITY_EXTRACTION_CAP = 10; // max entities per memory for co-activation
const CO_ACTIVATION_TOP_K = 5; // process top-K high-scoring results for co-activation
const ENTITY_PAIR_CAP = 5; // cap entity set per result before cross-product

// ── Entity extraction ──────────────────────────────────────────────────────

/**
 * Lightweight entity extraction by capitalized-token heuristic.
 *
 * Matches the regex branch of knowledge_graph.extract_entities; the
 * spaCy NER branch is not available in the TS runtime.
 *
 * source: cortex@ed33435 mcp_server/core/knowledge_graph.py:extract_entities
 */
function extractEntitiesSimple(content: string): string[] {
  // Match sequences of Title-Case words (e.g. "pgvector", "FlashRank", "ONNX")
  const entities = content.match(/\b[A-Z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*\b/g) ?? [];
  // Deduplicate and cap
  return [...new Set(entities)].slice(0, ENTITY_EXTRACTION_CAP);
}

// ── Co-activation settings ─────────────────────────────────────────────────

export interface CoActivationSettings {
  CO_ACTIVATION_ENABLED: boolean;
  CO_ACTIVATION_MIN_SCORE: number;
  CO_ACTIVATION_LEARNING_RATE: number;
}

// ── Co-activation update ───────────────────────────────────────────────────

/**
 * Strengthen Hebbian entity-pair edges for co-retrieved memories.
 *
 * Processes the top-5 high-scoring results. For each pair of memories,
 * reinforces relationships between their entity sets.
 *
 * Errors in edge-strengthening are silenced (mirror of Python try/except).
 *
 * Port of: mcp_server/handlers/recall.py::_apply_co_activation
 */
export async function applyCoActivation(
  results: RecallResult[],
  store: MemoryStore,
  settings: CoActivationSettings,
): Promise<void> {
  if (!settings.CO_ACTIVATION_ENABLED || results.length < 2) return;

  const minScore = settings.CO_ACTIVATION_MIN_SCORE;
  const lr = settings.CO_ACTIVATION_LEARNING_RATE;

  const entitySets: string[][] = [];
  for (const result of results.slice(0, CO_ACTIVATION_TOP_K)) {
    if ((result.score ?? 0) < minScore) continue;
    const entities = extractEntitiesSimple(result.content ?? "");
    entitySets.push(entities);
  }

  for (let i = 0; i < entitySets.length; i++) {
    for (let j = i + 1; j < entitySets.length; j++) {
      const entsA = (entitySets[i] ?? []).slice(0, ENTITY_PAIR_CAP);
      const entsB = (entitySets[j] ?? []).slice(0, ENTITY_PAIR_CAP);
      for (const a of entsA) {
        for (const b of entsB) {
          if (a !== b) {
            try {
              await store.reinforceOrCreateRelationship(a, b, lr);
            } catch {
              // Silenced — co-activation is a best-effort side effect
            }
          }
        }
      }
    }
  }
}
