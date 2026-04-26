/**
 * Decay stage — entity heat decay and metabolic observability.
 *
 * A3 lazy-heat: memory heat decay is computed at read time by
 * effective_heat() in recall. What remains here is *entity* decay
 * (the entities.heat column still stores eager state) and metabolic-
 * modulation observability.
 *
 * Source: docs/program/phase-3-a3-migration-design.md §6.
 *
 * Port of: mcp_server/handlers/consolidation/decay.py
 */

import { computeEntityDecay } from "../decay-cycle.js";

export interface DecayStageResult {
  memories_decayed: number;
  entities_decayed: number;
  total_memories: number;
  reason_for_zero: string;
  duration_ms?: number;
}

export interface DecayStageStore {
  getAllEntities(minHeat: number): Promise<Record<string, unknown>[]>;
  updateEntitiesHeatBatch(updates: Array<[number, number]>): Promise<void>;
  getAllMemoriesForDecay(): Promise<Record<string, unknown>[]>;
}

export interface DecayStageSettings {
  COLD_THRESHOLD: number;
  DECAY_FACTOR: number;
}

function groupByDomain(
  memories: readonly Record<string, unknown>[],
): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const mem of memories) {
    const domain = ((mem["domain"] as string | undefined) ?? "default") || "default";
    const list = groups.get(domain) ?? [];
    list.push(mem);
    groups.set(domain, list);
  }
  return groups;
}

async function decayEntities(
  store: DecayStageStore,
  settings: DecayStageSettings,
): Promise<Array<[number, number]>> {
  const entities = await store.getAllEntities(settings.COLD_THRESHOLD);
  const entityUpdates = computeEntityDecay(entities, null, {
    decayFactor: 0.98,
    coldThreshold: settings.COLD_THRESHOLD,
  });
  await store.updateEntitiesHeatBatch(entityUpdates);
  return entityUpdates;
}

/**
 * Run the decay cycle: entity heat decay + metabolic observability.
 *
 * Memory heat decay is lazy — computed by effective_heat() on read.
 * `memories` is kept for caller symmetry and metabolic observability.
 */
export async function runDecayCycle(
  store: DecayStageStore,
  settings: DecayStageSettings,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<DecayStageResult> {
  const mems = memories ?? (await store.getAllMemoriesForDecay());

  // Metabolic observability: log domain groups (no heat writes in A3 path)
  const _domainGroups = groupByDomain(mems);
  void _domainGroups; // observability only — no writes

  const entityUpdates = await decayEntities(store, settings);

  return {
    memories_decayed: 0,
    entities_decayed: entityUpdates.length,
    total_memories: mems.length,
    reason_for_zero: "lazy_decay_via_effective_heat",
  };
}
