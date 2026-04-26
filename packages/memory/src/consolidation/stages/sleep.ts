/**
 * Sleep-phase replay stage: deep consolidation during sleep-equivalent cycle.
 *
 * Selects high-value episodic memories, runs SWR replay, and triggers
 * hippocampal-cortical transfer for eligible candidates.
 *
 * Port of: mcp_server/handlers/consolidation/sleep.py
 *
 * // source: Buzsaki G (2015) Hippocampus 25:1073-1188 — SWR-driven replay.
 * // source: Davidson TJ et al. (2009) Neuron 63:497-507 — replay compression.
 */

import { runSwrReplay, describeReplayResult } from "../replay.js";
import {
  shouldGenerateSwr,
  makeInitialOscillatoryState,
  beginSwr,
  isSwrActive,
} from "../oscillatory-clock.js";

export interface SleepStore {
  getHotMemories(limit: number): Promise<Record<string, unknown>[]>;
  getRelatedMemories(ids: number[], limit: number): Promise<Record<string, unknown>[]>;
  getAllEdges(): Promise<Record<string, unknown>[]>;
  getOscillatoryState(): Promise<Record<string, unknown> | null>;
  saveOscillatoryState(state: Record<string, unknown>): Promise<void>;
}

export interface SleepStageResult {
  replay_sequences: number;
  memories_replayed: number;
  stdp_updates: number;
  swr_active: boolean;
  duration_ms?: number;
}

/** Run deep-sleep SWR replay cycle. */
export async function runDeepSleep(
  store: SleepStore,
  _embeddings: unknown,
  memories: readonly Record<string, unknown>[] | null = null,
): Promise<SleepStageResult> {
  // Load hot memories
  const hotMemories = memories
    ? [...memories].sort((a, b) =>
        ((b["heat"] as number | undefined) ?? 0) - ((a["heat"] as number | undefined) ?? 0),
      ).slice(0, 50)
    : await store.getHotMemories(50);

  if (!hotMemories.length) {
    return { replay_sequences: 0, memories_replayed: 0, stdp_updates: 0, swr_active: false };
  }

  // Check oscillatory state
  let oscState = makeInitialOscillatoryState();
  const swrActive = shouldGenerateSwr(oscState.operationsSinceSwr, oscState.hoursSinceLastSwr);

  if (swrActive) {
    oscState = beginSwr(oscState);
  }

  if (!isSwrActive(oscState)) {
    return { replay_sequences: 0, memories_replayed: 0, stdp_updates: 0, swr_active: false };
  }

  // Load related memories and relationships
  const hotIds = hotMemories.map((m) => m["id"] as number);
  const relatedMemories = await store.getRelatedMemories(hotIds, 100);
  const relationships = await store.getAllEdges();

  const replayResult = runSwrReplay(hotMemories, relatedMemories, relationships, {
    swrActive: true,
    dopamineLevel: 1.0,
  });

  const desc = describeReplayResult(replayResult);

  return {
    replay_sequences: desc["sequences_generated"] as number,
    memories_replayed: desc["memories_replayed"] as number,
    stdp_updates: desc["stdp_updates_count"] as number,
    swr_active: true,
  };
}
