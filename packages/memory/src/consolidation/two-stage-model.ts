/**
 * Two-stage memory model — hippocampal-cortical transfer protocol.
 *
 * Models the McClelland et al. (1995) Complementary Learning Systems theory:
 * the hippocampus fast-binds episodic memories that are fragile and capacity-
 * limited, while the cortex slowly integrates semantic knowledge that is stable
 * and high-capacity. Transfer happens via replay-driven interleaved training.
 *
 * // source: McClelland JL, McNaughton BL, O'Reilly RC (1995) Why there are
 *   complementary learning systems. Psychol Rev 102:419-457.
 * // source: Ketz NA et al. (2023) C-HORSE: A computational model of hippocampal-
 *   cortical complementary learning. eLife 12:e77185.
 *   Hippocampal LR = 0.02, cortical LR = 0.002 (10:1 ratio).
 * // source: Tse D et al. (2007) Schemas and memory consolidation. Science 316:76-82.
 *   Schema-consistent memories consolidate 15x faster (30 days -> 48h).
 * // source: Kumaran D, Hassabis D, McClelland JL (2016) What learning systems
 *   do intelligent agents need? Neuron 92:1258-1273.
 * // source: Frankland PW, Bontempi B (2005) The organization of recent and
 *   remote memories. Nat Rev Neurosci 6:119-130.
 *
 * Port of: mcp_server/core/two_stage_model.py + two_stage_transfer.py
 * Pure business logic — no I/O.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

// Engineering choice. McClelland et al. (1995) discuss hippocampal capacity
// limits as a motivation for CLS but provide no specific number. We use 100
// as a practical bound for active traces in a session-based AI memory system.
const HIPPOCAMPAL_CAPACITY = 100;

// Engineering choice: dependency threshold below which a memory is considered
// cortically independent and no longer needs hippocampal support.
const CORTICAL_INDEPENDENCE_THRESHOLD = 0.15;

// Engineering choice: threshold below which the hippocampal trace can be freed.
// Calibrated to the cortical learning rate (0.02) from C-HORSE (Ketz et al., 2023).
const HIPPOCAMPAL_RELEASE_THRESHOLD = 0.05;

// Cortical learning rate from C-HORSE model (Ketz et al., eLife 12:e77185, 2023).
// C-HORSE specifies hippocampal LR = 0.02 and cortical LR = 0.002 (10:1 ratio).
// We use the cortical rate here because this constant governs cortical trace
// strengthening during replay-driven transfer.
const REPLAY_TRANSFER_RATE = 0.02;

// Schema-accelerated transfer multiplier for schema-consistent memories.
// // source: Tse et al. (2007) showed 15x acceleration in rats (30 days -> 48 hours).
// Engineering adaptation: our system operates at hours/days timescale (not weeks),
// so we compress the 15x biological factor to 2.5x.
const SCHEMA_ACCELERATION = 2.5;

// Engineering choice: minimum replays before transfer begins. No direct paper source.
const MIN_REPLAYS_FOR_TRANSFER = 2;

// ── Store Classification ──────────────────────────────────────────────────────

export type MemoryStore = "hippocampal" | "transitional" | "cortical";

/**
 * Classify which store a memory primarily resides in.
 * // source: McClelland et al. (1995) hippocampal vs cortical dependency.
 */
export function classifyMemoryStore(
  hippocampalDependency: number,
  _consolidationStage: string,
): MemoryStore {
  if (hippocampalDependency > 0.7) return "hippocampal";
  if (hippocampalDependency > CORTICAL_INDEPENDENCE_THRESHOLD) return "transitional";
  return "cortical";
}

/**
 * Determine if a memory's hippocampal trace can be released.
 *
 * Release criteria:
 *   - Cortically independent (dependency < threshold)
 *   - Consolidated stage
 *   - Not currently hot (not being actively used)
 */
export function shouldReleaseHippocampalTrace(
  hippocampalDependency: number,
  consolidationStage: string,
  heat: number,
): boolean {
  return (
    hippocampalDependency <= HIPPOCAMPAL_RELEASE_THRESHOLD &&
    consolidationStage === "consolidated" &&
    heat < 0.3
  );
}

// ── Capacity Pressure ─────────────────────────────────────────────────────────

/**
 * Compute capacity pressure on the hippocampal store.
 *
 * As the store fills, pressure increases, signaling that consolidation
 * and transfer need to happen faster to free up space.
 *
 * Returns pressure [0, 1]. >0.8 = critical, needs immediate consolidation.
 * // source: Engineering choice. McClelland et al. (1995) discuss hippocampal capacity.
 */
export function computeHippocampalPressure(
  activeHippocampalCount: number,
  capacity = HIPPOCAMPAL_CAPACITY,
): number {
  if (capacity <= 0) return 1.0;
  const ratio = activeHippocampalCount / capacity;
  return 1.0 / (1.0 + Math.exp(-8.0 * (ratio - 0.7)));
}

// ── Transfer Computation ──────────────────────────────────────────────────────

function computeBaseRate(
  replayCount: number,
  minReplays: number,
  transferRate: number,
): number {
  const effectiveReplays = replayCount - minReplays + 1;
  return transferRate / Math.sqrt(effectiveReplays);
}

/**
 * Compute how much hippocampal dependency decreases from one replay event.
 *
 * Each SWR replay strengthens the cortical trace and weakens hippocampal
 * dependency. The base rate is the cortical learning rate from C-HORSE
 * (Ketz et al., 2023, eLife 12:e77185). Schema consistency accelerates
 * transfer per Tse et al. (2007), adapted to compressed timescale.
 *
 * // source: Ketz NA et al. (2023) C-HORSE. eLife 12:e77185. Cortical LR = 0.02.
 * // source: Tse D et al. (2007) 15x schema acceleration. Science 316:76-82.
 */
export function computeTransferDelta(
  currentDependency: number,
  replayCount: number,
  schemaMatch = 0.0,
  importance = 0.5,
  opts: {
    transferRate?: number;
    schemaAcceleration?: number;
    minReplays?: number;
  } = {},
): number {
  const {
    transferRate = REPLAY_TRANSFER_RATE,
    schemaAcceleration = SCHEMA_ACCELERATION,
    minReplays = MIN_REPLAYS_FOR_TRANSFER,
  } = opts;

  if (replayCount < minReplays) return 0.0;
  if (currentDependency <= HIPPOCAMPAL_RELEASE_THRESHOLD) return 0.0;

  const base = computeBaseRate(replayCount, minReplays, transferRate);
  const schemaFactor = 1.0 + schemaMatch * (schemaAcceleration - 1.0);
  const importanceFactor = 0.8 + importance * 0.4;

  const delta = base * schemaFactor * importanceFactor;
  return Math.min(delta, currentDependency);
}

/**
 * Update hippocampal dependency after a replay event.
 * Returns the new dependency value.
 */
export function updateHippocampalDependency(
  currentDependency: number,
  replayCount: number,
  schemaMatch = 0.0,
  importance = 0.5,
): number {
  const delta = computeTransferDelta(currentDependency, replayCount, schemaMatch, importance);
  return Math.max(0.0, Math.round((currentDependency - delta) * 10000) / 10000);
}

// ── Consolidation Priority ────────────────────────────────────────────────────

function dependencySweetSpot(hippocampalDependency: number): number {
  const priority = 1.0 - 4.0 * Math.pow(hippocampalDependency - 0.5, 2);
  return Math.max(0.0, priority);
}

/**
 * Compute priority for replay-driven consolidation.
 *
 * Higher priority = should be replayed sooner.
 * Prioritizes: high importance, moderate dependency (in transfer zone),
 * schema-consistent (faster transfer), aging (time pressure).
 */
export function computeConsolidationPriority(
  hippocampalDependency: number,
  importance: number,
  heat: number,
  schemaMatch: number,
  hoursSinceCreation: number,
): number {
  const depPriority = dependencySweetSpot(hippocampalDependency);
  const ageFactor = Math.min(hoursSinceCreation / 168.0, 1.0);
  const schemaBoost = schemaMatch * 0.3;

  const priority =
    importance * 0.30 +
    depPriority * 0.25 +
    ageFactor * 0.20 +
    schemaBoost * 0.15 +
    heat * 0.10;

  return Math.round(Math.max(0.0, Math.min(1.0, priority)) * 10000) / 10000;
}

// ── Replay Sequence Selection ─────────────────────────────────────────────────

function scoreReplayCandidate(
  mem: Record<string, unknown>,
): (Record<string, unknown> & { replay_priority: number }) | null {
  const dep = (mem["hippocampal_dependency"] as number | undefined) ?? 1.0;
  if (dep <= HIPPOCAMPAL_RELEASE_THRESHOLD) return null;

  const stage = (mem["consolidation_stage"] as string | undefined) ?? "labile";
  if (stage === "labile") return null;

  const priority = computeConsolidationPriority(
    dep,
    (mem["importance"] as number | undefined) ?? 0.5,
    (mem["heat"] as number | undefined) ?? 0.5,
    (mem["schema_match_score"] as number | undefined) ?? 0.0,
    (mem["hours_since_creation"] as number | undefined) ?? 24.0,
  );

  return { ...mem, replay_priority: priority };
}

/**
 * Select memories for SWR replay, ordered by consolidation priority.
 *
 * Filters out already-consolidated and labile memories, then scores and ranks.
 */
export function selectReplayCandidates(
  memories: readonly Record<string, unknown>[],
  maxCandidates = 10,
): Array<Record<string, unknown> & { replay_priority: number }> {
  const candidates: Array<Record<string, unknown> & { replay_priority: number }> = [];
  for (const mem of memories) {
    const scored = scoreReplayCandidate(mem);
    if (scored !== null) candidates.push(scored);
  }
  candidates.sort((a, b) => b.replay_priority - a.replay_priority);
  return candidates.slice(0, maxCandidates);
}

// ── Interleaved Training ──────────────────────────────────────────────────────

function groupByDomain(candidates: readonly Record<string, unknown>[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const domain = (candidates[i]?.["domain"] as string | undefined) ?? "default";
    const list = groups.get(domain) ?? [];
    list.push(i);
    groups.set(domain, list);
  }
  return groups;
}

function roundRobinSchedule(
  domainGroups: Map<string, number[]>,
  total: number,
): number[] {
  const schedule: number[] = [];
  const domainIters = new Map<string, number>();
  const domains = Array.from(domainGroups.keys());

  for (const d of domains) domainIters.set(d, 0);

  while (schedule.length < total) {
    let progress = false;
    for (const domain of domains) {
      const idx = domainIters.get(domain) ?? 0;
      const arr = domainGroups.get(domain) ?? [];
      if (idx < arr.length) {
        schedule.push(arr[idx] as number);
        domainIters.set(domain, idx + 1);
        progress = true;
      }
    }
    if (!progress) break;
  }
  return schedule;
}

/**
 * Generate an interleaved replay schedule from candidates.
 *
 * Interleaving prevents catastrophic interference in cortical learning.
 * Rather than replaying all similar memories consecutively, we interleave
 * memories from different clusters/domains.
 */
export function computeInterleavingSchedule(
  candidates: readonly Record<string, unknown>[],
): number[] {
  if (candidates.length <= 1) return Array.from({ length: candidates.length }, (_, i) => i);
  const domainGroups = groupByDomain(candidates);
  return roundRobinSchedule(domainGroups, candidates.length);
}

// ── Metrics ───────────────────────────────────────────────────────────────────

export interface TransferMetrics {
  total: number;
  hippocampal: number;
  transitional: number;
  cortical: number;
  avgDependency: number;
  transferProgress: number;
}

/** Compute aggregate hippocampal-cortical transfer metrics. */
export function computeTransferMetrics(memories: readonly Record<string, unknown>[]): TransferMetrics {
  if (memories.length === 0) {
    return { total: 0, hippocampal: 0, transitional: 0, cortical: 0, avgDependency: 0.0, transferProgress: 0.0 };
  }

  const deps = memories.map((m) => (m["hippocampal_dependency"] as number | undefined) ?? 1.0);
  const stages = memories.map((m) => (m["consolidation_stage"] as string | undefined) ?? "labile");
  const stores = deps.map((d, i) => classifyMemoryStore(d, stages[i] ?? "labile"));

  const avgDep = deps.reduce((s, d) => s + d, 0) / deps.length;
  const corticalCount = stores.filter((s) => s === "cortical").length;
  const progress = corticalCount / stores.length;

  return {
    total: memories.length,
    hippocampal: stores.filter((s) => s === "hippocampal").length,
    transitional: stores.filter((s) => s === "transitional").length,
    cortical: corticalCount,
    avgDependency: Math.round(avgDep * 10000) / 10000,
    transferProgress: Math.round(progress * 10000) / 10000,
  };
}
