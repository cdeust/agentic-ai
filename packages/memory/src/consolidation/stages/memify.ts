/**
 * Memify cycle: self-improvement via pruning, strengthening, and reweighting.
 *
 * Prunes low-quality memories, boosts important ones, and adjusts relationship
 * weights based on entity heat.
 *
 * Returns include diagnostic `reason_for_zero` / `reason_for_inaction`
 * fields when the cycle produces no mutation counters, distinguishing
 * early-return from a genuine "nothing to do" pass (issue #14 P2, darval).
 *
 * Port of: mcp_server/handlers/consolidation/memify.py
 */

// ── Thresholds ────────────────────────────────────────────────────────────────

// Thresholds mirror the defaults applied inside identify_prunable /
// identify_strengtheneable. Pulled to module scope so the diagnostic
// reclassification can reproduce the same gates without calling back
// into the curation helpers.
// Source: mcp_server.core.curation (identify_prunable defaults).
const PRUNE_HEAT_THRESHOLD = 0.01;
const PRUNE_CONFIDENCE_THRESHOLD = 0.3;
const STRENGTHEN_MIN_ACCESS = 5;
const STRENGTHEN_MIN_CONFIDENCE = 0.8;

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface MemifyStore {
  getAllMemoriesForDecay(): Promise<Record<string, unknown>[]>;
  deleteMemory(id: number): Promise<void>;
  updateMemoryImportance(id: number, importance: number): Promise<void>;
  getAllEntities(opts: { minHeat: number }): Promise<Record<string, unknown>[]>;
  insertRelationship(rel: Record<string, unknown>): Promise<void>;
  acquireBatch(): {
    execute(sql: string, params?: unknown[]): Promise<{ rows?: Record<string, unknown>[] }>;
  };
}

export interface MemifyStageResult {
  pruned: number;
  strengthened: number;
  reweighted: number;
  reason_for_zero?: string;
  reason_for_inaction?: string;
  duration_ms?: number;
}

// ── Prune ─────────────────────────────────────────────────────────────────────

/**
 * Identify prunable memory IDs from the list.
 *
 * Precondition: memories is the full decay snapshot.
 * Postcondition: returns IDs of memories with heat < PRUNE_HEAT_THRESHOLD
 *   AND confidence < PRUNE_CONFIDENCE_THRESHOLD.
 */
function identifyPrunable(memories: readonly Record<string, unknown>[]): number[] {
  const ids: number[] = [];
  for (const m of memories) {
    const heat = (m["heat"] as number | undefined) ?? 1.0;
    const confidence = (m["confidence"] as number | undefined) ?? 1.0;
    if (heat < PRUNE_HEAT_THRESHOLD && confidence < PRUNE_CONFIDENCE_THRESHOLD) {
      const id = m["id"] as number | undefined;
      if (id != null) ids.push(id);
    }
  }
  return ids;
}

/**
 * Delete prunable low-quality memories.
 *
 * Precondition: store.deleteMemory is available.
 * Postcondition: returns count of successfully deleted memories.
 *   Individual failures are swallowed (non-fatal).
 */
async function pruneMemories(
  store: MemifyStore,
  memories: readonly Record<string, unknown>[],
): Promise<number> {
  const prunableIds = identifyPrunable(memories);
  let count = 0;
  for (const mid of prunableIds) {
    try {
      await store.deleteMemory(mid);
      count++;
    } catch {
      // non-fatal
    }
  }
  return count;
}

// ── Strengthen ────────────────────────────────────────────────────────────────

/**
 * Identify strengtheneable memories: (id, newImportance) pairs.
 *
 * Precondition: memories is the full decay snapshot.
 * Postcondition: returns list of (id, new_importance) for memories with
 *   access_count >= STRENGTHEN_MIN_ACCESS AND confidence >= STRENGTHEN_MIN_CONFIDENCE.
 *   new_importance = min(1.0, current + 0.1).
 */
function identifyStrengthenable(
  memories: readonly Record<string, unknown>[],
): Array<[number, number]> {
  const results: Array<[number, number]> = [];
  for (const m of memories) {
    const accessCount = (m["access_count"] as number | undefined) ?? 0;
    const confidence = (m["confidence"] as number | undefined) ?? 0.0;
    if (accessCount >= STRENGTHEN_MIN_ACCESS && confidence >= STRENGTHEN_MIN_CONFIDENCE) {
      const id = m["id"] as number | undefined;
      const importance = (m["importance"] as number | undefined) ?? 0.5;
      if (id != null) {
        results.push([id, Math.min(1.0, importance + 0.1)]);
      }
    }
  }
  return results;
}

/**
 * Boost importance of memories that deserve strengthening.
 *
 * Precondition: store.updateMemoryImportance is available.
 * Postcondition: returns count of successfully updated memories.
 */
async function strengthenMemories(
  store: MemifyStore,
  memories: readonly Record<string, unknown>[],
): Promise<number> {
  const strengthenList = identifyStrengthenable(memories);
  let count = 0;
  for (const [mid, newImportance] of strengthenList) {
    try {
      await store.updateMemoryImportance(mid, newImportance);
      count++;
    } catch {
      // non-fatal
    }
  }
  return count;
}

// ── Reweight relationships ────────────────────────────────────────────────────

/**
 * Compute relationship reweights based on entity heat.
 *
 * Precondition: rels is a list of relationship rows; entityHeats maps entity id → heat.
 * Postcondition: returns (id, new_weight) pairs where weight adjusted by avg-entity-heat.
 */
function computeRelationshipReweights(
  rels: readonly Record<string, unknown>[],
  entityHeats: Map<number, number>,
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const rel of rels) {
    const srcId = rel["source_entity_id"] as number | undefined;
    const tgtId = rel["target_entity_id"] as number | undefined;
    const rid = rel["id"] as number | undefined;
    if (srcId == null || tgtId == null || rid == null) continue;
    const srcHeat = entityHeats.get(srcId) ?? 0.5;
    const tgtHeat = entityHeats.get(tgtId) ?? 0.5;
    const avgHeat = (srcHeat + tgtHeat) / 2.0;
    const currentWeight = (rel["weight"] as number | undefined) ?? 1.0;
    // Weight converges toward avg entity heat (normalized to [0, 2]).
    const newWeight = Math.max(0.0, Math.min(2.0, currentWeight * (avgHeat / 0.5)));
    result.push([rid, Math.round(newWeight * 10000) / 10000]);
  }
  return result;
}

/**
 * Adjust relationship weights based on entity heat.
 *
 * Phase 5: runs on the batch pool (long-running consolidation stage).
 *
 * Precondition: store.acquireBatch() returns a connection with execute().
 * Postcondition: returns count of reweighted relationships; 0 on error.
 */
async function reweightRelationships(store: MemifyStore): Promise<number> {
  try {
    const entities = await store.getAllEntities({ minHeat: 0.0 });
    const entityHeats = new Map<number, number>(
      entities.map((e) => [e["id"] as number, (e["heat"] as number | undefined) ?? 0.5]),
    );

    const conn = store.acquireBatch();
    const result = await conn.execute(
      "SELECT id, source_entity_id, target_entity_id, weight FROM relationships",
    );
    const rels = result.rows ?? [];
    const reweights = computeRelationshipReweights(rels, entityHeats);

    let count = 0;
    for (const [rid, newWeight] of reweights) {
      await conn.execute("UPDATE relationships SET weight = $1 WHERE id = $2", [
        newWeight,
        rid,
      ]);
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// ── Zero-reason classifier ────────────────────────────────────────────────────

/**
 * Classify the early-return path for memify.
 *
 * Precondition: counters reflect the actual cycle outcome.
 * Postcondition: returns null unless (a) all three counters are zero, or
 *   (b) pruned == 0 AND strengthened == 0 AND reweighted > 0.
 *   Otherwise returns one of:
 *
 *   - below_stale_threshold — candidate memories exist but none are cold /
 *     low-confidence / zero-access enough to prune.
 *   - below_access_threshold — candidates exist but none crossed the
 *     strengthen access-count gate.
 *   - reweight_only_gate — intentional gating: nothing crossed either the
 *     prune or the strengthen thresholds, yet the relationship reweight step
 *     did fire. Used only when reweighted > 0 (the "inaction" shape).
 *   - passed_through — candidates exist that would cross at least one gate
 *     if the thresholds matched them, AND the candidates did not materialise.
 *     True quiet-store no-op.
 *
 * Priority: when all counters are zero and memories is empty → passed_through.
 * Else: prefer the tightest gate that rejected candidates.
 */
function classifyMemifyReason(
  pruned: number,
  strengthened: number,
  reweighted: number,
  memories: readonly Record<string, unknown>[],
): string | null {
  const actionNonzero = pruned !== 0 || strengthened !== 0;
  if (actionNonzero) return null;

  const allZero = pruned === 0 && strengthened === 0 && reweighted === 0;
  const inaction = pruned === 0 && strengthened === 0 && reweighted > 0;
  if (!allZero && !inaction) return null;

  if (!memories.length) return "passed_through";

  // Inspect which gate rejected candidates that were present.
  const hasPruneCandidates = memories.some(
    (m) =>
      ((m["heat"] as number | undefined) ?? 1.0) < PRUNE_HEAT_THRESHOLD &&
      ((m["confidence"] as number | undefined) ?? 1.0) < PRUNE_CONFIDENCE_THRESHOLD,
  );
  const hasStrengthenCandidates = memories.some(
    (m) =>
      ((m["access_count"] as number | undefined) ?? 0) >= STRENGTHEN_MIN_ACCESS &&
      ((m["confidence"] as number | undefined) ?? 0) >= STRENGTHEN_MIN_CONFIDENCE,
  );

  // Reweight happened but no prune/strengthen → intentional gating.
  if (inaction && !hasPruneCandidates && !hasStrengthenCandidates) {
    return "reweight_only_gate";
  }

  // All three zero: identify which threshold is missing signal.
  if (hasPruneCandidates || hasStrengthenCandidates) {
    return "passed_through";
  }
  if (
    !hasStrengthenCandidates &&
    memories.some((m) => ((m["access_count"] as number | undefined) ?? 0) > 0)
  ) {
    return "below_access_threshold";
  }
  if (
    !hasPruneCandidates &&
    memories.some((m) => ((m["heat"] as number | undefined) ?? 1.0) < 0.5)
  ) {
    return "below_stale_threshold";
  }

  return "passed_through";
}

// ── Passed-through log ────────────────────────────────────────────────────────

/**
 * Emit an INFO log when the stage finished as a genuine no-op.
 *
 * Issue #14 P2 (darval): operators grep `stage=<name> reason=passed_through`
 * to distinguish "quiet store" runs from early-return runs. Only fires when
 * the classified reason is `passed_through` on either field.
 *
 * Precondition: stats carries reason_for_zero or reason_for_inaction.
 * Postcondition: logs iff reason === "passed_through".
 */
function logIfPassedThrough(
  stageName: string,
  stats: Partial<MemifyStageResult>,
  scanned: number,
): void {
  const reason = stats.reason_for_zero ?? stats.reason_for_inaction;
  if (reason !== "passed_through") return;
  console.info(`stage=${stageName} reason=passed_through scanned=${scanned} duration_ms=0`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run memify self-improvement: prune, strengthen, reweight.
 *
 * `memories` may be pre-loaded by the consolidate handler (issue #13).
 *
 * Postcondition (issue #14 P2):
 *   - Always returns `pruned`, `strengthened`, `reweighted`.
 *   - When all three counters are zero → additive `reason_for_zero` key with
 *     one of `passed_through`, `below_access_threshold`, `below_stale_threshold`,
 *     `reweight_only_gate`.
 *   - When `pruned == 0 AND strengthened == 0 AND reweighted > 0` → additive
 *     `reason_for_inaction` key with one of the same values.
 *   - When any of `pruned` / `strengthened` is non-zero → both diagnostic keys
 *     are absent.
 *
 * Precondition: store is a valid MemifyStore.
 * Postcondition: pruned, strengthened, reweighted are non-negative integers.
 */
export async function runMemifyCycle(
  store: MemifyStore,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<MemifyStageResult> {
  const mems = memories !== null ? memories : await store.getAllMemoriesForDecay();

  const pruned = await pruneMemories(store, mems);
  const strengthened = await strengthenMemories(store, mems);
  const reweighted = await reweightRelationships(store);

  const stats: MemifyStageResult = { pruned, strengthened, reweighted };

  const reason = classifyMemifyReason(pruned, strengthened, reweighted, mems);
  if (reason !== null) {
    if (pruned === 0 && strengthened === 0 && reweighted === 0) {
      stats.reason_for_zero = reason;
    } else if (pruned === 0 && strengthened === 0 && reweighted > 0) {
      stats.reason_for_inaction = reason;
    }
    logIfPassedThrough("memify", stats, mems.length);
  }

  return stats;
}
