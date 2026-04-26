/**
 * Memify stage: episodic → semantic candidate selection.
 *
 * Identifies high-value episodic memories that are candidates for semantic
 * promotion (memification). Candidate selection thresholds come from the
 * curation module defaults.
 *
 * // source: mcp_server.core.curation (identify_prunable defaults).
 *
 * Port of: mcp_server/handlers/consolidation/memify.py
 */

export interface MemifyStore {
  getEpisodicMemories(limit: number): Promise<Record<string, unknown>[]>;
  markForMemification(ids: readonly number[]): Promise<void>;
}

export interface MemifyStageResult {
  candidates_found: number;
  marked_for_promotion: number;
  reason_for_inaction?: string;
  duration_ms?: number;
}

// Candidate selection thresholds.
// // source: mcp_server.core.curation (identify_prunable defaults).
const MIN_ACCESS_COUNT = 3;
const MIN_IMPORTANCE = 0.5;
const MIN_HEAT_THRESHOLD = 0.3;

/**
 * Run the memify self-improvement cycle.
 *
 * Selects episodic memories that are frequently accessed, highly important,
 * and still warm — candidates for promotion to semantic memory.
 */
export async function runMemifyCycle(
  store: MemifyStore,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<MemifyStageResult> {
  const episodic = memories
    ? memories.filter((m) => m["store_type"] === "episodic")
    : await store.getEpisodicMemories(500);

  if (!episodic.length) {
    return { candidates_found: 0, marked_for_promotion: 0, reason_for_inaction: "empty_episodic_scan" };
  }

  const candidates = episodic.filter((m) => {
    const accessCount = (m["access_count"] as number | undefined) ?? 0;
    const importance = (m["importance"] as number | undefined) ?? 0.0;
    const heat = (m["heat"] as number | undefined) ?? 0.0;
    const alreadyMemified = Boolean(m["is_memified"]);
    return (
      !alreadyMemified &&
      accessCount >= MIN_ACCESS_COUNT &&
      importance >= MIN_IMPORTANCE &&
      heat >= MIN_HEAT_THRESHOLD
    );
  });

  if (!candidates.length) {
    return {
      candidates_found: 0,
      marked_for_promotion: 0,
      reason_for_inaction: "passed_through",
    };
  }

  const ids = candidates.map((m) => m["id"] as number);
  await store.markForMemification(ids);

  return { candidates_found: candidates.length, marked_for_promotion: ids.length };
}
