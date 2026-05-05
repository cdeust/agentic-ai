/**
 * Replay data types — shared across replay submodules.
 *
 * Pure data types with no logic beyond defaults.
 *
 * Port of: cortex@ed33435 mcp_server/core/replay_types.py
 */

// ── Replay direction ──────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/replay_types.py:12-16

export enum ReplayDirection {
  FORWARD = "forward",
  REVERSE = "reverse",
}

// ── ReplayEvent ───────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/replay_types.py:19-28

/**
 * A single memory in a replay sequence.
 */
export interface ReplayEvent {
  memoryId: number;
  content: string;
  heat: number;
  createdAt: string;
  entities: string[];
  causalEdges: Array<[number, number]>;
}

export function makeReplayEvent(
  memoryId: number,
  content: string,
  opts: {
    heat?: number;
    createdAt?: string;
    entities?: string[];
    causalEdges?: Array<[number, number]>;
  } = {},
): ReplayEvent {
  return {
    memoryId,
    content,
    heat: opts.heat ?? 0.0,
    createdAt: opts.createdAt ?? "",
    entities: opts.entities ?? [],
    causalEdges: opts.causalEdges ?? [],
  };
}

// ── ReplaySequence ────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/replay_types.py:31-47

/**
 * An ordered sequence of memories replayed during an SWR burst.
 *
 * events:               Ordered memories in the sequence.
 * direction:            Forward or reverse replay.
 * priorityScore:        Heat/variance heuristic — higher = higher priority.
 * stdpPairs:            Entity pairs for STDP updates (source, target, delta_t).
 * schemaUpdateSignal:   How much this replay should update schemas.
 */
export interface ReplaySequence {
  events: ReplayEvent[];
  direction: ReplayDirection;
  priorityScore: number;
  stdpPairs: Array<[number, number, number]>;
  schemaUpdateSignal: number;
}

export function makeReplaySequence(
  opts: Partial<ReplaySequence> = {},
): ReplaySequence {
  return {
    events: opts.events ?? [],
    direction: opts.direction ?? ReplayDirection.FORWARD,
    priorityScore: opts.priorityScore ?? 0.0,
    stdpPairs: opts.stdpPairs ?? [],
    schemaUpdateSignal: opts.schemaUpdateSignal ?? 0.0,
  };
}

// ── ReplayResult ──────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/replay_types.py:50-60

/** Result of a full SWR replay cycle. */
export interface ReplayResult {
  sequencesGenerated: number;
  memoriesReplayed: number;
  stdpUpdates: Array<[number, number, number]>;
  schemaSignals: Record<string, unknown>[];
  forwardCount: number;
  reverseCount: number;
}

export function makeReplayResult(
  opts: Partial<ReplayResult> = {},
): ReplayResult {
  return {
    sequencesGenerated: opts.sequencesGenerated ?? 0,
    memoriesReplayed: opts.memoriesReplayed ?? 0,
    stdpUpdates: opts.stdpUpdates ?? [],
    schemaSignals: opts.schemaSignals ?? [],
    forwardCount: opts.forwardCount ?? 0,
    reverseCount: opts.reverseCount ?? 0,
  };
}
