/**
 * SWR replay execution — sequence building and STDP pair extraction.
 *
 * Builds temporal and causal replay sequences from memory traces, then
 * extracts entity pairs for spike-timing-dependent plasticity updates.
 *
 * Biological replay compresses temporal sequences by 15-20x during SWR events
 * (Davidson et al. 2009, Neuron 63:497-507). This module uses entity-overlap-
 * based sequence building and applies the compression ratio (20x, upper end)
 * to STDP timing.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/replay_execution.py
 *
 * References:
 *   Foster DJ, Wilson MA (2006) Nature 440:680-683
 *   Diba K, Buzsaki G (2007) Nature Neurosci 10:1241-1242
 *   Davidson TJ, Kloosterman F, Wilson MA (2009) Neuron 63:497-507
 */

import { type ReplayEvent, ReplayDirection, makeReplayEvent } from "./replay-types.js";

// Re-export for callers that import ReplayDirection from this module
export { ReplayDirection };
export type { ReplayEvent };

// ── Constants ─────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/replay_execution.py:33-38

const MAX_SEQUENCE_LENGTH = 8;
const MIN_SEQUENCE_LENGTH = 2;
const STDP_REPLAY_SCALE = 0.5;

/**
 * Davidson et al. (2009) report 15-20x compression during SWR replay.
 * Using 20x (upper bound) since our sequences are shorter than biological ones.
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:38
 */
const COMPRESSION_RATIO = 20.0;

// ── Helpers ───────────────────────────────────────────────────────────────

function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags as string[];
  if (typeof tags === "string") {
    try { return JSON.parse(tags) as string[]; }
    catch { return []; }
  }
  return [];
}

function getEntitySet(mem: Record<string, unknown>): Set<string> {
  const tags = parseTags(mem["tags"] ?? []);
  return new Set(tags);
}

function hasRelationship(
  idA: number, idB: number,
  relationships: Record<string, unknown>[],
): boolean {
  for (const rel of relationships) {
    const src = rel["source_entity_id"];
    const tgt = rel["target_entity_id"];
    if ((src === idA && tgt === idB) || (src === idB && tgt === idA)) return true;
  }
  return false;
}

function memToEvent(mem: Record<string, unknown>): ReplayEvent {
  return makeReplayEvent(
    mem["id"] as number,
    (mem["content"] as string | undefined) ?? "",
    {
      heat: (mem["heat"] as number | undefined) ?? 0.0,
      createdAt: (mem["created_at"] as string | undefined) ?? "",
      entities: parseTags(mem["tags"] ?? []),
    },
  );
}

// ── Temporal sequence ─────────────────────────────────────────────────────

/**
 * Build a temporal sequence from memories ordered by creation time.
 *
 * precondition:  memories is an array of memory records.
 * postcondition: returned array length <= maxLength; sorted by created_at.
 *
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:86-96
 */
export function buildTemporalSequence(
  memories: Record<string, unknown>[],
  maxLength = MAX_SEQUENCE_LENGTH,
): ReplayEvent[] {
  const sorted = [...memories].sort((a, b) =>
    String(a["created_at"] ?? "").localeCompare(String(b["created_at"] ?? "")),
  );
  return sorted.slice(0, maxLength).map(memToEvent);
}

// ── Causal sequence ───────────────────────────────────────────────────────

function sortCandidates(
  memories: Record<string, unknown>[],
  direction: ReplayDirection,
): Record<string, unknown>[] {
  const sorted = [...memories].sort((a, b) =>
    String(a["created_at"] ?? "").localeCompare(String(b["created_at"] ?? "")),
  );
  return direction === ReplayDirection.REVERSE ? sorted.reverse() : sorted;
}

function isValidCandidate(
  mem: Record<string, unknown>,
  seedTime: string,
  seedEntities: Set<string>,
  seedId: number,
  relationships: Record<string, unknown>[],
  direction: ReplayDirection,
): boolean {
  const memTime = String(mem["created_at"] ?? "");
  if (direction === ReplayDirection.FORWARD && memTime < seedTime) return false;
  if (direction === ReplayDirection.REVERSE && memTime > seedTime) return false;

  const memEntities = getEntitySet(mem);
  let hasOverlap = false;
  for (const e of seedEntities) { if (memEntities.has(e)) { hasOverlap = true; break; } }

  return hasOverlap || hasRelationship(seedId, mem["id"] as number, relationships);
}

function buildChainIds(
  seedMemory: Record<string, unknown>,
  relatedMemories: Record<string, unknown>[],
  relationships: Record<string, unknown>[],
  direction: ReplayDirection,
  maxLength: number,
): number[] {
  const chain: number[] = [seedMemory["id"] as number];
  const visited = new Set<number>([seedMemory["id"] as number]);
  let seedEntities = getEntitySet(seedMemory);
  const seedTime = String(seedMemory["created_at"] ?? "");

  const candidates = sortCandidates(relatedMemories, direction);

  for (const mem of candidates) {
    if (chain.length >= maxLength) break;
    const memId = mem["id"] as number;
    if (visited.has(memId)) continue;
    if (!isValidCandidate(mem, seedTime, seedEntities, seedMemory["id"] as number, relationships, direction)) continue;

    chain.push(memId);
    visited.add(memId);
    const memEntities = getEntitySet(mem);
    for (const e of memEntities) seedEntities.add(e);
  }

  return chain;
}

/**
 * Build a causal chain by following entity relationships from a seed.
 *
 * precondition:  seedMemory is a non-empty memory record.
 * postcondition: returned array length <= maxLength; first element is seedMemory.
 *   For forward replay, events are in chronological order; reverse is reversed.
 *
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:102-126
 */
export function buildCausalSequence(
  seedMemory: Record<string, unknown>,
  relatedMemories: Record<string, unknown>[],
  relationships: Record<string, unknown>[],
  direction = ReplayDirection.FORWARD,
  maxLength = MAX_SEQUENCE_LENGTH,
): ReplayEvent[] {
  if (!seedMemory || Object.keys(seedMemory).length === 0) return [];

  const chainIds = buildChainIds(seedMemory, relatedMemories, relationships, direction, maxLength);
  const memById = new Map<number, Record<string, unknown>>(
    [seedMemory, ...relatedMemories].map((m) => [m["id"] as number, m]),
  );

  return chainIds
    .filter((id) => memById.has(id))
    .map((id) => memToEvent(memById.get(id)!));
}

// ── STDP pairs ────────────────────────────────────────────────────────────

function entityPairsForStep(
  curr: ReplayEvent,
  nextEv: ReplayEvent,
  direction: ReplayDirection,
  baseDt: number,
): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = [];
  for (const srcEnt of curr.entities) {
    for (const tgtEnt of nextEv.entities) {
      if (srcEnt === tgtEnt) continue;
      // Simple deterministic hash to integer
      const srcHash = Math.abs(hashStr(srcEnt)) & 0x7FFFFFFF;
      const tgtHash = Math.abs(hashStr(tgtEnt)) & 0x7FFFFFFF;
      if (direction === ReplayDirection.FORWARD) {
        pairs.push([srcHash, tgtHash, baseDt]);
      } else {
        pairs.push([tgtHash, srcHash, baseDt]);
      }
    }
  }
  return pairs;
}

/** Simple djb2 hash for string → integer. */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h = h & h; // force 32-bit integer
  }
  return h;
}

/**
 * Extract entity pairs for STDP updates from a replay sequence.
 *
 * During replay, sequential memories activate entities in order.
 * Replay is compressed ~20x (Davidson et al. 2009); timing is scaled
 * accordingly to model compressed STDP windows.
 *
 * precondition:  events has at least 2 elements.
 * postcondition: returned array of [src_id, tgt_id, delta_t] tuples;
 *   delta_t is scaled by compression_ratio.
 *
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:198-218
 *   STDP_REPLAY_SCALE = 0.5; COMPRESSION_RATIO = 20.0 (Davidson et al. 2009 upper bound)
 */
export function computeReplayStdpPairs(
  events: ReplayEvent[],
  direction: ReplayDirection,
  scale = STDP_REPLAY_SCALE,
  compressionRatio = COMPRESSION_RATIO,
): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i < events.length - 1; i++) {
    const baseDt = (i + 1) * scale / compressionRatio;
    pairs.push(...entityPairsForStep(events[i]!, events[i + 1]!, direction, baseDt));
  }
  return pairs;
}

// Re-export constants for testing
export { MAX_SEQUENCE_LENGTH, MIN_SEQUENCE_LENGTH, STDP_REPLAY_SCALE, COMPRESSION_RATIO };
