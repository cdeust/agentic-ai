/**
 * SWR replay execution — sequence building and STDP pair extraction.
 *
 * Builds temporal and causal replay sequences from memory traces, then
 * extracts entity pairs for spike-timing-dependent plasticity updates.
 *
 * Biological replay compresses temporal sequences by 15-20x during SWR events
 * (Davidson et al. 2009, Neuron 63:497-507). This module uses entity-overlap-
 * based sequence building rather than population burst dynamics, and applies
 * the compression ratio (20x, upper end of published range) to STDP timing.
 *
 * References:
 *   Foster DJ, Wilson MA (2006) Reverse replay of behavioural sequences
 *     in hippocampal place cells during the awake state. Nature 440:680-683
 *   Diba K, Buzsaki G (2007) Forward and reverse hippocampal place-cell
 *     sequences during ripples. Nature Neurosci 10:1241-1242
 *   Davidson TJ, Kloosterman F, Wilson MA (2009) Hippocampal replay of
 *     extended experience. Neuron 63:497-507
 *
 * Pure business logic — no I/O.
 *
 * Port of: mcp_server/core/replay_execution.py
 * source: cortex@ed33435 mcp_server/core/replay_execution.py
 */

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/core/replay_execution.py:33
const MAX_SEQUENCE_LENGTH = 8;
// source: cortex@ed33435 mcp_server/core/replay_execution.py:34
const MIN_SEQUENCE_LENGTH = 2;
// source: cortex@ed33435 mcp_server/core/replay_execution.py:35
const STDP_REPLAY_SCALE = 0.5;
// Davidson et al. (2009) report 15-20x compression during SWR replay.
// Using 20x (upper bound) since our sequences are shorter than biological ones.
// source: cortex@ed33435 mcp_server/core/replay_execution.py:38
const COMPRESSION_RATIO = 20.0;

// ── Types ──────────────────────────────────────────────────────────────────

export const ReplayDirection = {
  FORWARD: "forward",
  REVERSE: "reverse",
} as const;

export type ReplayDirectionValue = (typeof ReplayDirection)[keyof typeof ReplayDirection];

export interface ReplayEvent {
  memory_id: number;
  content: string;
  heat: number;
  created_at: string;
  entities: string[];
}

export { MIN_SEQUENCE_LENGTH };

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely parse tags that might be string or array.
 * Port of: mcp_server/core/replay_execution.py::_parse_tags
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:44
 */
function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags as string[];
  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Extract entity set from a memory dict's tags field.
 * Port of: mcp_server/core/replay_execution.py::_get_entity_set
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:56
 */
function getEntitySet(mem: Record<string, unknown>): Set<string> {
  const tags = parseTags(mem["tags"]);
  return new Set(tags);
}

/**
 * Check if two memory IDs are connected via entity relationships.
 * Port of: mcp_server/core/replay_execution.py::_has_relationship
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:62
 */
function hasRelationship(
  idA: number,
  idB: number,
  relationships: Record<string, unknown>[],
): boolean {
  for (const rel of relationships) {
    const src = rel["source_entity_id"];
    const tgt = rel["target_entity_id"];
    if ((src === idA && tgt === idB) || (src === idB && tgt === idA)) return true;
  }
  return false;
}

/**
 * Convert a memory dict to a ReplayEvent.
 * Port of: mcp_server/core/replay_execution.py::_mem_to_event
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:72
 */
function memToEvent(mem: Record<string, unknown>): ReplayEvent {
  return {
    memory_id: mem["id"] as number,
    content: String(mem["content"] ?? ""),
    heat: Number(mem["heat"] ?? 0),
    created_at: String(mem["created_at"] ?? ""),
    entities: parseTags(mem["tags"]),
  };
}

// ── Temporal Sequence ──────────────────────────────────────────────────────

/**
 * Build a temporal sequence from memories ordered by creation time.
 *
 * Memories are sorted chronologically and converted to ReplayEvents.
 * This is the basic building block for both forward and reverse replay.
 *
 * Port of: mcp_server/core/replay_execution.py::build_temporal_sequence
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:86
 */
export function buildTemporalSequence(
  memories: Record<string, unknown>[],
  maxLength: number = MAX_SEQUENCE_LENGTH, // source: cortex@ed33435 replay_execution.py:89
): ReplayEvent[] {
  const sorted = [...memories].sort((a, b) =>
    String(a["created_at"] ?? "").localeCompare(String(b["created_at"] ?? "")),
  );
  return sorted.slice(0, maxLength).map(memToEvent);
}

// ── Causal Sequence ────────────────────────────────────────────────────────

/**
 * Sort candidate memories by time, reversed for reverse replay.
 * Port of: mcp_server/core/replay_execution.py::_sort_candidates
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:162
 */
function sortCandidates(
  memories: Record<string, unknown>[],
  direction: ReplayDirectionValue,
): Record<string, unknown>[] {
  const sorted = [...memories].sort((a, b) =>
    String(a["created_at"] ?? "").localeCompare(String(b["created_at"] ?? "")),
  );
  return direction === ReplayDirection.REVERSE ? sorted.reverse() : sorted;
}

/**
 * Check whether a candidate memory belongs in the causal chain.
 * Port of: mcp_server/core/replay_execution.py::_is_valid_candidate
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:172
 */
function isValidCandidate(
  mem: Record<string, unknown>,
  seedTime: string,
  seedEntities: Set<string>,
  seedId: number,
  relationships: Record<string, unknown>[],
  direction: ReplayDirectionValue,
): boolean {
  const memTime = String(mem["created_at"] ?? "");

  if (direction === ReplayDirection.FORWARD && memTime < seedTime) return false;
  if (direction === ReplayDirection.REVERSE && memTime > seedTime) return false;

  const memEntities = getEntitySet(mem);
  const hasOverlap = [...seedEntities].some((e) => memEntities.has(e));
  const hasRel = hasRelationship(seedId, mem["id"] as number, relationships);

  return hasOverlap || hasRel;
}

/**
 * Walk candidates to build an ordered chain of memory IDs.
 * Port of: mcp_server/core/replay_execution.py::_build_chain_ids
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:129
 */
function buildChainIds(
  seedMemory: Record<string, unknown>,
  relatedMemories: Record<string, unknown>[],
  relationships: Record<string, unknown>[],
  direction: ReplayDirectionValue,
  maxLength: number,
): number[] {
  const chain: number[] = [seedMemory["id"] as number];
  const visited = new Set<number>([seedMemory["id"] as number]);
  let seedEntities = getEntitySet(seedMemory);
  const seedTime = String(seedMemory["created_at"] ?? "");

  const candidates = sortCandidates(relatedMemories, direction);

  for (const mem of candidates) {
    if (chain.length >= maxLength) break;
    const mid = mem["id"] as number;
    if (visited.has(mid)) continue;
    if (!isValidCandidate(mem, seedTime, seedEntities, seedMemory["id"] as number, relationships, direction)) {
      continue;
    }

    chain.push(mid);
    visited.add(mid);
    seedEntities = new Set([...seedEntities, ...getEntitySet(mem)]);
  }

  return chain;
}

/**
 * Build a causal chain by following entity relationships from a seed.
 *
 * For forward replay, follow edges forward in time.
 * For reverse replay, follow edges backward.
 *
 * Port of: mcp_server/core/replay_execution.py::build_causal_sequence
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:102
 */
export function buildCausalSequence(
  seedMemory: Record<string, unknown> | null | undefined,
  relatedMemories: Record<string, unknown>[],
  relationships: Record<string, unknown>[],
  direction: ReplayDirectionValue = ReplayDirection.FORWARD,
  maxLength: number = MAX_SEQUENCE_LENGTH, // source: cortex@ed33435 replay_execution.py:109
): ReplayEvent[] {
  if (!seedMemory) return [];

  const chainIds = buildChainIds(
    seedMemory,
    relatedMemories,
    relationships,
    direction,
    maxLength,
  );

  const memById: Record<number, Record<string, unknown>> = {};
  for (const m of [seedMemory, ...relatedMemories]) {
    memById[m["id"] as number] = m;
  }

  return chainIds
    .filter((mid) => mid in memById)
    .map((mid) => memToEvent(memById[mid] as Record<string, unknown>));
}

// ── STDP Pairs ─────────────────────────────────────────────────────────────

/**
 * Generate STDP pairs between two consecutive replay events.
 * Port of: mcp_server/core/replay_execution.py::_entity_pairs_for_step
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:221
 */
function entityPairsForStep(
  curr: ReplayEvent,
  nextEv: ReplayEvent,
  direction: ReplayDirectionValue,
  baseDt: number,
): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = [];

  for (const srcEnt of curr.entities) {
    for (const tgtEnt of nextEv.entities) {
      if (srcEnt === tgtEnt) continue;

      // Use 31-bit hash via string hash
      const srcHash = stringHash(srcEnt);
      const tgtHash = stringHash(tgtEnt);

      if (direction === ReplayDirection.FORWARD) {
        pairs.push([srcHash, tgtHash, baseDt]);
      } else {
        pairs.push([tgtHash, srcHash, baseDt]);
      }
    }
  }

  return pairs;
}

/** Simple non-negative 31-bit string hash. */
function stringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h & 0x7fffffff; // source: cortex@ed33435 replay_execution.py:234
}

/**
 * Extract entity pairs for STDP updates from a replay sequence.
 *
 * During replay, sequential memories activate entities in order.
 * Replay is compressed ~20x (Davidson et al. 2009); timing is scaled
 * accordingly to model compressed STDP windows.
 *
 * precondition: events is a non-empty sequence of ReplayEvents.
 * postcondition: returns list of (src_hash, tgt_hash, dt) triples;
 *   dt is scaled by COMPRESSION_RATIO (20.0) and STDP_REPLAY_SCALE (0.5).
 *
 * Port of: mcp_server/core/replay_execution.py::compute_replay_stdp_pairs
 * source: cortex@ed33435 mcp_server/core/replay_execution.py:198
 */
export function computeReplayStdpPairs(
  events: ReplayEvent[],
  direction: ReplayDirectionValue,
  scale: number = STDP_REPLAY_SCALE, // source: cortex@ed33435 replay_execution.py:201
  compressionRatio: number = COMPRESSION_RATIO, // source: cortex@ed33435 replay_execution.py:202
): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = [];

  for (let i = 0; i < events.length - 1; i++) {
    const curr = events[i];
    const next = events[i + 1];
    if (!curr || !next) continue;
    const baseDt = ((i + 1) * scale) / compressionRatio;
    pairs.push(
      ...entityPairsForStep(curr, next, direction, baseDt),
    );
  }

  return pairs;
}
