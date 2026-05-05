/**
 * Core post-storage operations — entity persistence, synaptic tagging, engrams.
 *
 * Extracted from the remember handler to keep each function under 40 lines.
 *
 * Port of: mcp_server/core/write_post_store.py
 */

import { applySynapticTags } from "../consolidation/synaptic-tagging.js";
import { extractProspectiveIntents } from "../automation/trigger-matcher.js";

export interface Store {
  insertProspectiveMemory(data: Record<string, unknown>): number;
  getEntityByName(name: string): Record<string, unknown> | null;
  insertEntity(data: Record<string, unknown>): number;
  insertMemoryEntity(memoryId: number, entityId: number): void;
  insertRelationship(data: Record<string, unknown>): void;
  getHotMemories(opts: { minHeat: number; limit: number }): Record<string, unknown>[];
  updateMemoryImportance(id: number, importance: number): void;
  updateMemoryHeat(id: number, heat: number): void;
  getAllEntities(opts: { minHeat: number }): Record<string, unknown>[];
  findSharedEntities(memId: number, entityIds: number[]): number[];
  getMemoriesMentioningEntity(name: string, limit: number): Record<string, unknown>[];
  initEngramSlots(numSlots: number): void;
  getAllEngramSlots(): Record<string, unknown>[];
  assignMemorySlot(memId: number, slotIndex: number): void;
  updateEngramSlot(slotIndex: number, excitability: number, activatedAt: string): void;
  countMemoriesInSlot(slotIndex: number, excludeId: number): number;
  nowIso(): string;
}

export interface Settings {
  HOPFIELD_MAX_PATTERNS: number;
  EXCITABILITY_HALF_LIFE_HOURS: number;
  EXCITABILITY_BOOST: number;
}

/**
 * Auto-extract prospective triggers and persist them.
 *
 * Precondition: content is a non-empty string; store supports insertProspectiveMemory.
 * Postcondition: returns list of inserted trigger IDs (may be empty).
 */
export function extractTriggers(
  content: string,
  directory: string,
  store: Store,
): number[] {
  const intents = extractProspectiveIntents(content);
  const triggerIds: number[] = [];
  for (const intent of intents) {
    const tid = store.insertProspectiveMemory({ ...intent, target_directory: directory });
    triggerIds.push(tid);
  }
  return triggerIds;
}

/**
 * Insert new entities, co-occurrence relationships, and memory-entity links.
 *
 * Precondition: extractedEntities is an array of {name, type} objects.
 * Postcondition: returns array of entity IDs (existing or newly created).
 */
export function persistEntities(
  extractedEntities: Array<{ name: string; type: string }>,
  domain: string,
  content: string,
  store: Store,
  memoryId?: number,
): number[] {
  const entityIds: number[] = [];
  for (const ent of extractedEntities) {
    const existing = store.getEntityByName(ent.name);
    if (existing) {
      entityIds.push(existing["id"] as number);
    } else {
      const eid = store.insertEntity({ name: ent.name, type: ent.type, domain });
      entityIds.push(eid);
    }
  }
  createCoOccurrences(extractedEntities, content, store, entityIds);
  if (memoryId !== undefined) {
    for (const eid of entityIds) {
      store.insertMemoryEntity(memoryId, eid);
    }
  }
  return entityIds;
}

function createCoOccurrences(
  entities: Array<{ name: string }>,
  content: string,
  store: Store,
  entityIds: number[],
): void {
  // Detect co-occurrences via simple proximity heuristic:
  // entities mentioned within the same sentence are co-occurring.
  if (entityIds.length < 2) return;
  const sentences = content.split(/[.!?\n]+/);
  for (const sentence of sentences) {
    const sLower = sentence.toLowerCase();
    const present = entities.filter((e) => sLower.includes(e.name.toLowerCase()));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i];
        const b = present[j];
        if (!a || !b) continue;
        const ea = store.getEntityByName(a.name);
        const eb = store.getEntityByName(b.name);
        if (ea && eb) {
          store.insertRelationship({
            source_entity_id: ea["id"],
            target_entity_id: eb["id"],
            relationship_type: "co_occurrence",
            weight: 0.5,
          });
        }
      }
    }
  }
}

/**
 * Retroactively boost weak memories sharing entities (Frey & Morris 1997).
 *
 * Precondition: importance in [0,1]; newEntityNames is an array of strings.
 * Postcondition: returns array of tagging result dicts (may be empty).
 */
export function runSynapticTagging(
  memId: number,
  importance: number,
  newEntityNames: string[],
  store: Store,
): Record<string, unknown>[] {
  const tagged: Record<string, unknown>[] = [];
  try {
    if (importance < 0.7 || newEntityNames.length === 0) return tagged;
    const recent = store.getHotMemories({ minHeat: 0.0, limit: 50 });
    const candidates = buildTaggingCandidates(recent, memId, newEntityNames, store);
    const newEntSet = new Set(newEntityNames.map((n) => n.toLowerCase()));
    const tagResults = applySynapticTags(newEntSet, importance, candidates as never);
    for (const tag of tagResults) {
      store.updateMemoryImportance(tag.memory_id, tag.new_importance);
      store.updateMemoryHeat(tag.memory_id, tag.new_heat);
      tagged.push(tag as unknown as Record<string, unknown>);
    }
  } catch {
    // fail silently — tagging is a best-effort enrichment
  }
  return tagged;
}

function buildTaggingCandidates(
  recent: Record<string, unknown>[],
  excludeId: number,
  entityNames: string[],
  store: Store,
): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  for (const mem of recent) {
    if (mem["id"] === excludeId) continue;
    const memEnts = findSharedEntities(mem["id"] as number, entityNames, store);
    const hoursAgo = hoursSinceCreation(
      (mem["ingested_at"] ?? mem["created_at"] ?? "") as string,
    );
    candidates.push({
      id: mem["id"] as number,
      importance: (mem["importance"] as number | undefined) ?? 0.5,
      heat: (mem["heat"] as number | undefined) ?? 0.1,
      entities: memEnts,
      age_hours: hoursAgo,
    });
  }
  return candidates;
}

/**
 * Find which entities a memory mentions.
 *
 * Phase 2 B2: replaces the pre-Phase-2 O(N_candidates × 50) substring
 * scan with a single JOIN query on memory_entities. Falls back to legacy
 * scan on any error.
 *
 * Source: docs/program/phase-5-pool-admission-design.md (Phase 2 B2);
 *         docs/invariants/cortex-invariants.md §I4.
 *
 * Postcondition: returns a Set<string> of lowercased entity names.
 */
function findSharedEntities(
  memId: number,
  entityNames: string[],
  store: Store,
): Set<string> {
  if (!memId) return new Set();

  const idToName = new Map<number, string>();
  try {
    for (const ename of entityNames ?? []) {
      const ent = store.getEntityByName(ename);
      if (ent && ent["id"] != null) {
        idToName.set(Number(ent["id"]), ename);
      }
    }
    const allEnts = store.getAllEntities({ minHeat: 0.0 }) ?? [];
    for (const ent of allEnts) {
      if (ent["id"] != null && ent["name"]) {
        idToName.set(Number(ent["id"]), ent["name"] as string);
      }
    }
  } catch {
    return new Set();
  }

  if (idToName.size === 0) return new Set();

  try {
    const sharedIds = store.findSharedEntities(memId, Array.from(idToName.keys()));
    return new Set(sharedIds.map((eid) => (idToName.get(eid) ?? "").toLowerCase()));
  } catch (err) {
    if (err instanceof TypeError && (err.message.includes("findSharedEntities") || err.message.includes("not a function"))) {
      // Legacy fallback: O(N) scan
      const shared: number[] = [];
      for (const [eid, ename] of idToName) {
        const mentioning = store.getMemoriesMentioningEntity(ename, 50);
        if (mentioning.some((m) => m["id"] === memId)) {
          shared.push(eid);
        }
      }
      return new Set(shared.map((eid) => (idToName.get(eid) ?? "").toLowerCase()));
    }
    return new Set();
  }
}

function hoursSinceCreation(isoStr: string): number {
  if (!isoStr) return 0.0;
  try {
    const dt = new Date(isoStr);
    if (isNaN(dt.getTime())) return 0.0;
    return (Date.now() - dt.getTime()) / 3_600_000;
  } catch {
    return 0.0;
  }
}

// ── Engram slot helpers (inlined from engram.py) ──────────────────────────────

/**
 * Find the slot with lowest excitability, adjusting for time decay.
 * Source: mcp_server/core/engram.py find_best_slot
 */
function findBestEngramSlot(
  slots: Record<string, unknown>[],
  halfLifeHours: number,
): [number, number] {
  let bestSlot = 0;
  let bestExc = Infinity;
  for (const slot of slots) {
    const slotIndex = slot["slot_index"] as number;
    const excitability = (slot["excitability"] as number | undefined) ?? 0;
    const lastActivated = (slot["last_activated"] as string | undefined) ?? "";
    const hoursAgo = lastActivated
      ? (Date.now() - new Date(lastActivated).getTime()) / 3_600_000
      : Infinity;
    const decayed = excitability * Math.pow(0.5, hoursAgo / Math.max(halfLifeHours, 1));
    if (decayed < bestExc) {
      bestExc = decayed;
      bestSlot = slotIndex;
    }
  }
  return [bestSlot, bestExc];
}

/**
 * Apply excitability boost after allocation.
 * Source: mcp_server/core/engram.py compute_boost
 */
function computeExcitabilityBoost(currentExc: number, boost: number): number {
  return Math.min(1.0, currentExc + boost);
}

// ── Module-level slot cache ───────────────────────────────────────────────────
// Avoids re-fetching all 5 000 engram_slots rows on every remember() call —
// a pure performance optimisation with no change in behaviour. The cache is
// invalidated whenever the store instance changes and kept in sync by applying
// the same excitability update to both the DB and the cached list.
//
// Precedent: sensory_buffer._global_buffer, reranker._flashrank_instance,
// pg_recall._titans all use the same module-level cache pattern.

let slotCache: Record<string, unknown>[] | null = null;
let slotCacheStoreId: object | null = null;
let slotsInitialised = false;

function getSlotCache(store: Store, numSlots: number): Record<string, unknown>[] {
  if (slotCache !== null && slotCacheStoreId === store) {
    return slotCache;
  }
  if (!slotsInitialised || slotCacheStoreId !== store) {
    store.initEngramSlots(numSlots);
    slotsInitialised = true;
  }
  slotCache = store.getAllEngramSlots();
  slotCacheStoreId = store;
  return slotCache;
}

function updateSlotCache(slotIndex: number, newExc: number, activatedAt: string): void {
  if (slotCache === null) return;
  for (const slot of slotCache) {
    if (slot["slot_index"] === slotIndex) {
      slot["excitability"] = newExc;
      slot["last_activated"] = activatedAt;
      break;
    }
  }
}

/** Force-clear the slot cache (for testing or after bulk operations). */
export function invalidateSlotCache(): void {
  slotCache = null;
  slotCacheStoreId = null;
  slotsInitialised = false;
}

/**
 * Allocate an engram slot for competitive memory allocation.
 *
 * Precondition: store supports engram slot operations; settings has required fields.
 * Postcondition: returns {slot_index, temporally_linked} or null on failure.
 */
export function allocateEngramSlot(
  memId: number,
  settings: Settings,
  store: Store,
): Record<string, unknown> | null {
  try {
    const allSlots = getSlotCache(store, settings.HOPFIELD_MAX_PATTERNS);
    if (allSlots.length === 0) return null;
    const [bestSlot, bestExc] = findBestEngramSlot(allSlots, settings.EXCITABILITY_HALF_LIFE_HOURS);
    store.assignMemorySlot(memId, bestSlot);
    const newExc = computeExcitabilityBoost(bestExc, settings.EXCITABILITY_BOOST);
    const nowIso = store.nowIso();
    store.updateEngramSlot(bestSlot, newExc, nowIso);
    updateSlotCache(bestSlot, newExc, nowIso);
    const linkedCount = store.countMemoriesInSlot(bestSlot, memId);
    return {
      slot_index: bestSlot,
      temporally_linked: linkedCount,
    };
  } catch {
    return null;
  }
}
