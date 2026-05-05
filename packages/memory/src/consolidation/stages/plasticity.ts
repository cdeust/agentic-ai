/**
 * Plasticity cycle: Hebbian LTP/LTD on knowledge graph edges.
 *
 * Strengthens co-accessed entity relationships and weakens unused ones
 * using BCM sliding threshold dynamics.
 *
 * // source: issue #13 — the previous limit=50 sampled ~0.5% of a 10k-
 *   entity store which collapsed the co-access set. 2000 gives an order-
 *   of-magnitude better sample while keeping the subsequent O(N_mem × N_ent)
 *   substring loop under ~25M ops on darval's store size.
 *
 * Port of: mcp_server/handlers/consolidation/plasticity.py
 */

import { applyHebbianUpdate, type Edge } from "../synaptic-plasticity-hebbian.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// Source: issue #13 — the previous limit=50 sampled ~0.5% of a 10k-entity store
// which collapsed the co-access set. 2000 gives an order-of-magnitude better
// sample while keeping the subsequent O(N_mem × N_ent) substring loop under
// ~25M ops on darval's store size.
const CO_ACCESS_SAMPLE_CAP = 2000;

// ── Store interface ───────────────────────────────────────────────────────────

export interface PlasticityStore {
  getAllEntities(opts: { minHeat: number }): Promise<Record<string, unknown>[]>;
  getAllRelationships(): Promise<Record<string, unknown>[]>;
  getHotMemories(opts: { minHeat: number; limit: number }): Promise<Record<string, unknown>[]>;
  findCoAccessedPairs(memoryIds: number[]): Promise<Array<[number, number]>>;
  updateRelationshipsWeightBatch(updates: Array<[number, number]>): Promise<void>;
}

export interface PlasticityStageResult {
  ltp: number;
  ltd: number;
  edges_updated: number;
  co_access_pairs: number;
  memories_sampled: number;
  error?: string;
  duration_ms?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Select the memory sample used to infer entity co-access.
 *
 * Prefers the consolidation-scoped list (filtered to hot memories)
 * when available; otherwise falls back to store.getHotMemories with
 * a larger cap than the pre-#13 value.
 *
 * Precondition: store.getHotMemories is available.
 * Postcondition: returns up to CO_ACCESS_SAMPLE_CAP memories sorted by heat desc.
 */
async function selectCoAccessSample(
  store: PlasticityStore,
  memories: readonly Record<string, unknown>[] | null,
): Promise<Record<string, unknown>[]> {
  if (memories === null) {
    return store.getHotMemories({ minHeat: 0.1, limit: CO_ACCESS_SAMPLE_CAP });
  }
  const hot = memories.filter(
    (m) => ((m["heat"] as number | undefined) ?? 0.0) >= 0.1,
  );
  if (hot.length <= CO_ACCESS_SAMPLE_CAP) return hot as Record<string, unknown>[];
  const sorted = [...hot].sort(
    (a, b) =>
      ((b["heat"] as number | undefined) ?? 0.0) - ((a["heat"] as number | undefined) ?? 0.0),
  );
  return sorted.slice(0, CO_ACCESS_SAMPLE_CAP) as Record<string, unknown>[];
}

/**
 * Build activity and BCM threshold maps from entity data.
 *
 * Precondition: entities is non-empty.
 * Postcondition: activities[eid] = min(1.0, heat + access_count * 0.01);
 *   thresholds[eid] = 0.3 + heat * 0.4.
 */
function buildEntityMaps(
  entities: readonly Record<string, unknown>[],
): [Map<number, number>, Map<number, number>] {
  const activities = new Map<number, number>();
  const thresholds = new Map<number, number>();
  for (const ent of entities) {
    const eid = ent["id"] as number;
    const heat = (ent["heat"] as number | undefined) ?? 0.5;
    const access = (ent["access_count"] as number | undefined) ?? 0;
    activities.set(eid, Math.min(1.0, heat + access * 0.01));
    thresholds.set(eid, 0.3 + heat * 0.4);
  }
  return [activities, thresholds];
}

/**
 * Format relationship rows into edge dicts for Hebbian update.
 *
 * Precondition: relationships is a list of raw relationship rows.
 * Postcondition: returns Edge objects with id, source_entity_id, target_entity_id, weight.
 */
function formatEdges(relationships: readonly Record<string, unknown>[]): Edge[] {
  return relationships.map((r) => ({
    id: r["id"] as number,
    source_entity_id: r["source_entity_id"] as number,
    target_entity_id: r["target_entity_id"] as number,
    weight: (r["weight"] as number | undefined) ?? 1.0,
  }));
}

/**
 * Apply Hebbian weight updates via a single batched UPDATE.
 *
 * Source: issue #13 — plasticity previously ran one UPDATE per edge inside
 * a loop. Batched path collapses 30k+ round-trips into one.
 *
 * Precondition: store.updateRelationshipsWeightBatch is available.
 * Postcondition: returns (ltpCount, ltdCount) of applied updates.
 */
async function applyUpdates(
  store: PlasticityStore,
  results: ReturnType<typeof applyHebbianUpdate>,
): Promise<[number, number]> {
  const batch: Array<[number, number]> = [];
  let ltpCount = 0;
  let ltdCount = 0;
  for (const r of results) {
    if (r["action"] === "none") continue;
    batch.push([r["id"] as number, r.weight]);
    if (r["action"] === "ltp") ltpCount++;
    else ltdCount++;
  }
  await store.updateRelationshipsWeightBatch(batch);
  return [ltpCount, ltdCount];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply Hebbian LTP/LTD to knowledge graph edges.
 *
 * `memories` may be pre-loaded by the consolidate handler (Phase B of
 * issue #13). When not provided, falls back to a broader hot-memory window
 * to avoid the co-access starvation documented in the Feinstein/Feynman audit
 * of darval's 66K run (previous limit=50 across 10,770 entities → 99.95%
 * LTD was distribution collapse, not plasticity).
 *
 * Phase 2 B1: JOIN replacement. Pre-Phase 2 did an O(N_mem × N_ent)
 * Python substring scan; post-0.4.5 backfill we query memory_entities
 * directly via JOIN (O(pairs)).
 *
 * Precondition: store is a valid PlasticityStore.
 * Postcondition: returned object contains ltp, ltd, edges_updated,
 *   co_access_pairs, memories_sampled. All non-negative.
 */
export async function runPlasticityCycle(
  store: PlasticityStore,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<PlasticityStageResult> {
  try {
    const entities = await store.getAllEntities({ minHeat: 0.0 });
    const relationships = await store.getAllRelationships();

    if (!entities.length || !relationships.length) {
      return {
        ltp: 0,
        ltd: 0,
        edges_updated: 0,
        co_access_pairs: 0,
        memories_sampled: 0,
      };
    }

    const [activities, thresholds] = buildEntityMaps(entities);
    const sample = await selectCoAccessSample(store, memories);

    // Phase 2 B1: JOIN replacement. Pre-Phase 2 did an O(N_mem × N_ent)
    // Python substring scan; post-0.4.5 backfill we query memory_entities
    // directly via JOIN (O(pairs)).
    const sampleIds = sample
      .map((m) => m["id"] as number | undefined)
      .filter((id): id is number => id != null);
    const coAccessedList = await store.findCoAccessedPairs(sampleIds);
    // Encode as "a:b" strings (a < b) for set membership.
    const coAccessed = new Set<string>(
      coAccessedList.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)),
    );

    const edgeDicts = formatEdges(relationships);

    const results = applyHebbianUpdate(
      edgeDicts,
      coAccessed,
      activities,
      thresholds,
      1.0, // hours_since_last_update
    );

    const [ltpCount, ltdCount] = await applyUpdates(store, results);
    return {
      ltp: ltpCount,
      ltd: ltdCount,
      edges_updated: ltpCount + ltdCount,
      co_access_pairs: coAccessed.size,
      memories_sampled: sample.length,
    };
  } catch (exc) {
    return {
      ltp: 0,
      ltd: 0,
      edges_updated: 0,
      co_access_pairs: 0,
      memories_sampled: 0,
      error: `${(exc as Error).name}: ${(exc as Error).message}`,
    };
  }
}
