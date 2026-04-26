/**
 * Hippocampal replay — SWR-driven memory consolidation and context reconstruction.
 *
 * Two modes of operation:
 *
 * 1. Context restoration (original): Format checkpoint + hot memories for
 *    post-compaction injection. This is the "macro-replay" after Claude Code
 *    context compaction.
 *
 * 2. SWR replay (new): During consolidation, generate replay sequences from
 *    memory traces ordered by temporal/causal chains. Forward replay projects
 *    sequences forward; reverse replay traces backward from outcomes to causes.
 *    Replay-dependent plasticity updates edge weights via STDP.
 *
 * SWR replay is gated by the oscillatory clock — replay only fires during
 * sharp-wave ripple events, not on every consolidation call.
 *
 * Biological adaptation note:
 *   Biological SWR replay uses population burst dynamics where place cell
 *   sequences are reactivated in compressed time (Ecker et al. 2022, eLife).
 *   This code approximates replay by building sequences from entity-overlap
 *   and temporal ordering, not from population-level burst detection. The
 *   compression ratio (~20x, Davidson et al. 2009) is applied to STDP timing.
 *
 * // source: Foster DJ, Wilson MA (2006) Reverse replay of behavioural sequences
 *   in hippocampal place cells during the awake state. Nature 440:680-683.
 * // source: Diba K, Buzsaki G (2007) Forward and reverse hippocampal place-cell
 *   sequences during ripples. Nature Neurosci 10:1241-1242.
 * // source: Davidson TJ, Kloosterman F, Wilson MA (2009) Hippocampal replay of
 *   extended experience. Neuron 63:497-507.
 *   Compression ratio 15-20x; we use 20x (upper bound).
 *
 * Port of: mcp_server/core/replay*.py
 * Pure business logic — no I/O.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReplayDirectionName = "forward" | "reverse";

export interface ReplayEvent {
  memoryId: number;
  content: string;
  heat: number;
  createdAt: string;
  entities: string[];
  causalEdges: Array<[number, number]>;
}

export interface ReplaySequence {
  events: ReplayEvent[];
  direction: ReplayDirectionName;
  priorityScore: number;
  /** Entity pairs for STDP updates: (srcHash, tgtHash, delta_t) */
  stdpPairs: Array<[number, number, number]>;
  schemaUpdateSignal: number;
}

export interface ReplayResult {
  sequencesGenerated: number;
  memoriesReplayed: number;
  stdpUpdates: Array<[number, number, number]>;
  schemaSignals: Array<Record<string, unknown>>;
  forwardCount: number;
  reverseCount: number;
}

function emptyReplayResult(): ReplayResult {
  return {
    sequencesGenerated: 0,
    memoriesReplayed: 0,
    stdpUpdates: [],
    schemaSignals: [],
    forwardCount: 0,
    reverseCount: 0,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_SEQUENCE_LENGTH = 2;
const MAX_SEQUENCES_PER_SWR = 5;
const MAX_SEQUENCE_LENGTH = 8;
const STDP_REPLAY_SCALE = 0.5;
// Davidson et al. (2009) report 15-20x compression during SWR replay.
// Using 20x (upper bound) since our sequences are shorter than biological ones.
const COMPRESSION_RATIO = 20.0;
const PRIORITY_THRESHOLD = 0.3;

// ── Helper utilities ──────────────────────────────────────────────────────────

function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags as string[];
  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getEntitySet(mem: Record<string, unknown>): Set<string> {
  const tags = parseTags(mem["tags"]);
  return new Set(tags);
}

function hasRelationship(
  idA: number,
  idB: number,
  relationships: readonly Record<string, unknown>[],
): boolean {
  for (const rel of relationships) {
    const src = rel["source_entity_id"] as number | undefined;
    const tgt = rel["target_entity_id"] as number | undefined;
    if ((src === idA && tgt === idB) || (src === idB && tgt === idA)) return true;
  }
  return false;
}

function memToEvent(mem: Record<string, unknown>): ReplayEvent {
  return {
    memoryId: mem["id"] as number,
    content: (mem["content"] as string | undefined) ?? "",
    heat: (mem["heat"] as number | undefined) ?? 0.0,
    createdAt: (mem["created_at"] as string | undefined) ?? "",
    entities: parseTags(mem["tags"]),
    causalEdges: [],
  };
}

// ── Temporal Sequence ─────────────────────────────────────────────────────────

/** Build a temporal sequence from memories ordered by creation time. */
export function buildTemporalSequence(
  memories: readonly Record<string, unknown>[],
  maxLength = MAX_SEQUENCE_LENGTH,
): ReplayEvent[] {
  const sorted = [...memories].sort((a, b) =>
    ((a["created_at"] as string | undefined) ?? "").localeCompare(
      (b["created_at"] as string | undefined) ?? "",
    ),
  );
  return sorted.slice(0, maxLength).map(memToEvent);
}

// ── Causal Sequence ───────────────────────────────────────────────────────────

function sortCandidates(
  memories: readonly Record<string, unknown>[],
  direction: ReplayDirectionName,
): Record<string, unknown>[] {
  const sorted = [...memories].sort((a, b) =>
    ((a["created_at"] as string | undefined) ?? "").localeCompare(
      (b["created_at"] as string | undefined) ?? "",
    ),
  );
  return direction === "reverse" ? sorted.reverse() : sorted;
}

function isValidCandidate(
  mem: Record<string, unknown>,
  seedTime: string,
  seedEntities: Set<string>,
  seedId: number,
  relationships: readonly Record<string, unknown>[],
  direction: ReplayDirectionName,
): boolean {
  const memTime = (mem["created_at"] as string | undefined) ?? "";
  if (direction === "forward" && memTime < seedTime) return false;
  if (direction === "reverse" && memTime > seedTime) return false;

  const memEntities = getEntitySet(mem);
  const hasOverlap = [...seedEntities].some((e) => memEntities.has(e));
  const hasRel = hasRelationship(seedId, mem["id"] as number, relationships);
  return hasOverlap || hasRel;
}

function buildChainIds(
  seedMemory: Record<string, unknown>,
  relatedMemories: readonly Record<string, unknown>[],
  relationships: readonly Record<string, unknown>[],
  direction: ReplayDirectionName,
  maxLength: number,
): number[] {
  const chain: number[] = [seedMemory["id"] as number];
  const visited = new Set<number>([seedMemory["id"] as number]);
  let seedEntities = getEntitySet(seedMemory);
  const seedTime = (seedMemory["created_at"] as string | undefined) ?? "";

  const candidates = sortCandidates(relatedMemories, direction);

  for (const mem of candidates) {
    if (chain.length >= maxLength) break;
    const memId = mem["id"] as number;
    if (visited.has(memId)) continue;
    if (!isValidCandidate(mem, seedTime, seedEntities, seedMemory["id"] as number, relationships, direction)) continue;
    chain.push(memId);
    visited.add(memId);
    seedEntities = new Set([...seedEntities, ...getEntitySet(mem)]);
  }
  return chain;
}

/**
 * Build a causal chain by following entity relationships from a seed.
 *
 * For forward replay, follow edges forward in time.
 * For reverse replay, follow edges backward.
 */
export function buildCausalSequence(
  seedMemory: Record<string, unknown>,
  relatedMemories: readonly Record<string, unknown>[],
  relationships: readonly Record<string, unknown>[],
  direction: ReplayDirectionName = "forward",
  maxLength = MAX_SEQUENCE_LENGTH,
): ReplayEvent[] {
  if (!seedMemory) return [];

  const chainIds = buildChainIds(seedMemory, relatedMemories, relationships, direction, maxLength);
  const memById = new Map<number, Record<string, unknown>>();
  memById.set(seedMemory["id"] as number, seedMemory);
  for (const m of relatedMemories) memById.set(m["id"] as number, m);

  return chainIds
    .filter((id) => memById.has(id))
    .map((id) => memToEvent(memById.get(id)!));
}

// ── STDP Pairs ────────────────────────────────────────────────────────────────

function entityPairsForStep(
  curr: ReplayEvent,
  nextEv: ReplayEvent,
  direction: ReplayDirectionName,
  baseDt: number,
): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = [];

  for (const srcEnt of curr.entities) {
    for (const tgtEnt of nextEv.entities) {
      if (srcEnt === tgtEnt) continue;
      // Hash entity strings to integers. We use a simple djb2-style hash
      // and mask to positive 31-bit integer (mirrors Python hash(s) & 0x7FFFFFFF).
      const srcHash = hashStr(srcEnt) & 0x7fffffff;
      const tgtHash = hashStr(tgtEnt) & 0x7fffffff;

      if (direction === "forward") {
        pairs.push([srcHash, tgtHash, baseDt]);
      } else {
        pairs.push([tgtHash, srcHash, baseDt]);
      }
    }
  }
  return pairs;
}

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // djb2: h = ((h << 5) + h) + charCode
    h = Math.imul(h, 33) ^ s.charCodeAt(i);
  }
  return h;
}

/**
 * Extract entity pairs for STDP updates from a replay sequence.
 *
 * During replay, sequential memories activate entities in order.
 * Replay is compressed ~20x (Davidson et al. 2009); timing is scaled
 * accordingly to model compressed STDP windows.
 * // source: Davidson TJ et al. (2009) Neuron 63:497-507. Compression ratio 15-20x.
 */
export function computeReplayStdpPairs(
  events: readonly ReplayEvent[],
  direction: ReplayDirectionName,
  scale = STDP_REPLAY_SCALE,
  compressionRatio = COMPRESSION_RATIO,
): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = [];

  for (let i = 0; i < events.length - 1; i++) {
    const baseDt = ((i + 1) * scale) / compressionRatio;
    pairs.push(
      ...entityPairsForStep(events[i]!, events[i + 1]!, direction, baseDt),
    );
  }
  return pairs;
}

// ── Priority Scoring ──────────────────────────────────────────────────────────

/**
 * Compute priority score for a replay sequence.
 *
 * Formula: (avg_heat * 0.4 + sqrt(heat_variance) * 0.6) * DA_level.
 * Heuristic combining importance (heat) and surprise (variance),
 * amplified by dopamine. Weights are hand-tuned — no paper.
 */
export function computeSequencePriority(
  events: readonly ReplayEvent[],
  dopamineLevel = 1.0,
): number {
  if (events.length < 2) return 0.0;
  const heats = events.map((e) => e.heat);
  const avgHeat = heats.reduce((s, h) => s + h, 0) / heats.length;
  const variance = heats.reduce((s, h) => s + Math.pow(h - avgHeat, 2), 0) / heats.length;
  const rawPriority = (avgHeat * 0.4 + Math.sqrt(variance) * 0.6) * dopamineLevel;
  return Math.max(0.0, Math.min(1.0, rawPriority));
}

// ── Sequence Selection ────────────────────────────────────────────────────────

function fallbackSelection(
  candidates: ReplaySequence[],
  maxSequences: number,
): ReplaySequence[] {
  return [...candidates]
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, maxSequences);
}

function balancedSelection(
  viable: ReplaySequence[],
  maxSequences: number,
): ReplaySequence[] {
  const forward = viable
    .filter((s) => s.direction === "forward")
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const reverse = viable
    .filter((s) => s.direction === "reverse")
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const selected: ReplaySequence[] = [];
  if (forward.length > 0) selected.push(forward[0]!);
  if (reverse.length > 0) selected.push(reverse[0]!);

  const allSorted = [...viable].sort((a, b) => b.priorityScore - a.priorityScore);
  for (const seq of allSorted) {
    if (selected.length >= maxSequences) break;
    if (!selected.includes(seq)) selected.push(seq);
  }
  return selected.slice(0, maxSequences);
}

/** Select top replay sequences for an SWR burst. */
export function selectReplaySequences(
  candidateSequences: ReplaySequence[],
  maxSequences = MAX_SEQUENCES_PER_SWR,
  priorityThreshold = PRIORITY_THRESHOLD,
): ReplaySequence[] {
  const viable = candidateSequences.filter((s) => s.priorityScore >= priorityThreshold);
  if (viable.length === 0) return fallbackSelection(candidateSequences, maxSequences);
  return balancedSelection(viable, maxSequences);
}

// ── Full SWR Replay Cycle ─────────────────────────────────────────────────────

function buildSingleSequence(
  seed: Record<string, unknown>,
  relatedMemories: readonly Record<string, unknown>[],
  relationships: readonly Record<string, unknown>[],
  direction: ReplayDirectionName,
  dopamineLevel: number,
): ReplaySequence | null {
  const events = buildCausalSequence(seed, relatedMemories, relationships, direction);
  if (events.length < MIN_SEQUENCE_LENGTH) return null;

  const rpe = computeSequencePriority(events, dopamineLevel);
  const stdp = computeReplayStdpPairs(events, direction);

  return { events, direction, priorityScore: rpe, stdpPairs: stdp, schemaUpdateSignal: 0.0 };
}

function buildCandidateSequences(
  seeds: readonly Record<string, unknown>[],
  relatedMemories: readonly Record<string, unknown>[],
  relationships: readonly Record<string, unknown>[],
  dopamineLevel: number,
): ReplaySequence[] {
  const candidates: ReplaySequence[] = [];
  for (const seed of seeds) {
    for (const direction of ["forward", "reverse"] as ReplayDirectionName[]) {
      const seq = buildSingleSequence(seed, relatedMemories, relationships, direction, dopamineLevel);
      if (seq !== null) candidates.push(seq);
    }
  }
  return candidates;
}

function aggregateResults(selected: ReplaySequence[]): ReplayResult {
  const result = emptyReplayResult();
  const memoryIds = new Set<number>();
  const allStdp: Array<[number, number, number]> = [];
  const schemaSignals: Array<Record<string, unknown>> = [];

  for (const seq of selected) {
    allStdp.push(...seq.stdpPairs);
    for (const ev of seq.events) memoryIds.add(ev.memoryId);

    if (seq.direction === "forward") result.forwardCount++;
    else result.reverseCount++;

    if (seq.priorityScore > 0.5) {
      schemaSignals.push({
        entities: seq.events.flatMap((ev) => ev.entities),
        priority: seq.priorityScore,
        direction: seq.direction,
        update_strength: seq.priorityScore * 0.3,
      });
    }
  }

  result.sequencesGenerated = selected.length;
  result.memoriesReplayed = memoryIds.size;
  result.stdpUpdates = allStdp;
  result.schemaSignals = schemaSignals;
  return result;
}

/**
 * Execute a full SWR replay cycle.
 *
 * This is the main entry point for replay during consolidation.
 * Only runs if SWR is active (from oscillatory clock).
 */
export function runSwrReplay(
  hotMemories: readonly Record<string, unknown>[],
  relatedMemories: readonly Record<string, unknown>[],
  relationships: readonly Record<string, unknown>[],
  opts: {
    dopamineLevel?: number;
    swrActive?: boolean;
    maxSequences?: number;
  } = {},
): ReplayResult {
  const { dopamineLevel = 1.0, swrActive = true, maxSequences = MAX_SEQUENCES_PER_SWR } = opts;

  if (!swrActive || hotMemories.length === 0) return emptyReplayResult();

  const seeds = [...hotMemories]
    .sort((a, b) => ((b["heat"] as number | undefined) ?? 0) - ((a["heat"] as number | undefined) ?? 0))
    .slice(0, maxSequences * 2);

  const candidates = buildCandidateSequences(seeds, relatedMemories, relationships, dopamineLevel);

  // Also add temporal candidate
  const temporalEvents = buildTemporalSequence(hotMemories);
  if (temporalEvents.length >= MIN_SEQUENCE_LENGTH) {
    const rpe = computeSequencePriority(temporalEvents, dopamineLevel);
    const stdp = computeReplayStdpPairs(temporalEvents, "forward");
    candidates.push({ events: temporalEvents, direction: "forward", priorityScore: rpe, stdpPairs: stdp, schemaUpdateSignal: 0.0 });
  }

  const selected = selectReplaySequences(candidates, maxSequences);
  return aggregateResults(selected);
}

// ── Restoration Formatting ────────────────────────────────────────────────────

/** Check if content warrants a micro-checkpoint. Returns (shouldCheckpoint, reason). */
export function shouldMicroCheckpoint(
  content: string,
  tags: readonly string[],
  surprise = 0.0,
  toolCallCount = 0,
  cooldown = 5,
): [boolean, string] {
  if (toolCallCount < cooldown) return [false, ""];

  if (/\b(error|exception|traceback|failed|crash|bug)\b/i.test(content)) {
    return [true, "error_detected"];
  }
  if (/\b(decided|chose|switched|migrated|will use|going with|opted)\b/i.test(content)) {
    return [true, "decision_made"];
  }
  if (surprise > 0.8) return [true, "high_surprise_event"];

  const criticalTags = new Set(["critical", "important", "architecture", "breaking"]);
  if (tags.some((t) => criticalTags.has(t.toLowerCase()))) return [true, "critical_tag"];

  return [false, ""];
}

/** Human-readable summary of replay cycle. */
export function describeReplayResult(result: ReplayResult): Record<string, unknown> {
  return {
    sequences_generated: result.sequencesGenerated,
    memories_replayed: result.memoriesReplayed,
    forward_sequences: result.forwardCount,
    reverse_sequences: result.reverseCount,
    stdp_updates_count: result.stdpUpdates.length,
    schema_signals_count: result.schemaSignals.length,
  };
}
