/**
 * Plasticity stage: synaptic plasticity updates post-consolidation.
 *
 * // source: issue #13 — the previous limit=50 sampled ~0.5% of a 10k-
 *   memory corpus; raised to 500 to cover ~5%.
 *
 * Port of: mcp_server/handlers/consolidation/plasticity.py
 */

import { computeLtpLtdModulation, computeBcmThreshold } from "../homeostatic-plasticity.js";

export interface PlasticityStore {
  getRecentMemories(limit: number): Promise<Record<string, unknown>[]>;
  updateEdgeWeightBatch(updates: Array<{ id: number; weight: number }>): Promise<void>;
  getAllEdges(): Promise<Record<string, unknown>[]>;
}

export interface PlasticityStageResult {
  edges_updated: number;
  memories_scanned: number;
  duration_ms?: number;
}

/**
 * Run synaptic plasticity updates for recently active memories.
 *
 * // source: issue #13 — limit=50 → limit=500.
 */
export async function runPlasticityCycle(store: PlasticityStore): Promise<PlasticityStageResult> {
  // Source: issue #13 — the previous limit=50 sampled ~0.5% of a 10k-
  // memory corpus; raised to 500 to cover ~5%.
  const memories = await store.getRecentMemories(500);

  if (!memories.length) {
    return { edges_updated: 0, memories_scanned: 0 };
  }

  const heats = memories.map((m) => (m["heat"] as number | undefined) ?? 0.5);

  // Compute BCM sliding threshold from recent activity
  const bcmThreshold = computeBcmThreshold(heats);

  // Load edges and compute LTP/LTD modulation
  const edges = await store.getAllEdges();
  const updates: Array<{ id: number; weight: number }> = [];

  for (const edge of edges) {
    const srcId = edge["source_entity_id"] as number;
    const tgtId = edge["target_entity_id"] as number;
    const srcMem = memories.find((m) => m["id"] === srcId || m["id"] === tgtId);
    if (!srcMem) continue;

    const heat = (srcMem["heat"] as number | undefined) ?? 0.5;
    const [ltpMult, ltdMult] = computeLtpLtdModulation(heat, bcmThreshold);
    const currentWeight = (edge["weight"] as number | undefined) ?? 1.0;

    // Hebb: strengthen if both active (high heat), weaken if one active
    const newWeight = heat > bcmThreshold
      ? Math.min(2.0, currentWeight * ltpMult)
      : Math.max(0.0, currentWeight * (1.0 / Math.max(ltdMult, 0.1)));

    if (Math.abs(newWeight - currentWeight) > 0.01) {
      const edgeId = edge["id"] as number | undefined;
      if (edgeId != null) {
        updates.push({ id: edgeId, weight: Math.round(newWeight * 10000) / 10000 });
      }
    }
  }

  await store.updateEdgeWeightBatch(updates);

  return { edges_updated: updates.length, memories_scanned: memories.length };
}
