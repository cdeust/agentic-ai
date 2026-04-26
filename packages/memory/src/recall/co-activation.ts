/**
 * Co-activation Hebbian learning: strengthen entity-pair edges when
 * memories containing related entities are retrieved together.
 *
 * "Dragon Hatchling Hebbian": co-retrieved entities strengthen edges.
 *
 * Port of: mcp_server/handlers/recall.py::_apply_co_activation
 *
 * The entity extraction is simplified here — the full implementation
 * uses knowledge_graph.extract_entities which does regex-based code
 * pattern extraction + NER.
 *
 * TODO(port-pending): Full entity extraction requires porting
 * mcp_server/core/knowledge_graph.py::extract_entities — assign to
 * port/cortex-graph-navigation worktree. This stub extracts
 * capitalized tokens as a lightweight approximation.
 */

import type { MemoryStore } from "./port.js";
import type { RecallResult } from "./types.js";

// ── Entity extraction stub ─────────────────────────────────────────────────

/**
 * Lightweight entity extraction by capitalized-token heuristic.
 *
 * TODO(port-pending): Replace with knowledge_graph.extract_entities port
 * once port/cortex-graph-navigation worktree is merged.
 */
function extractEntitiesSimple(content: string): string[] {
  // Match sequences of Title-Case words (e.g. "pgvector", "FlashRank", "ONNX")
  const entities = content.match(/\b[A-Z][A-Za-z0-9]*(?:[_-][A-Za-z0-9]+)*\b/g) ?? [];
  // Deduplicate and take up to 10
  return [...new Set(entities)].slice(0, 10);
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
  for (const result of results.slice(0, 5)) {
    if ((result.score ?? 0) < minScore) continue;
    const entities = extractEntitiesSimple(result.content ?? "");
    entitySets.push(entities);
  }

  for (let i = 0; i < entitySets.length; i++) {
    for (let j = i + 1; j < entitySets.length; j++) {
      const entsA = (entitySets[i] ?? []).slice(0, 5);
      const entsB = (entitySets[j] ?? []).slice(0, 5);
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
