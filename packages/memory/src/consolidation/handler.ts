/**
 * Handler: consolidate — run decay, compression, and CLS maintenance cycles.
 *
 * Thin orchestrator that delegates each cycle to a focused sub-module in
 * consolidation/stages/. Per-stage telemetry (duration_ms) surfaces
 * where time goes on real stores (issue #13 darval).
 *
 * Port of: mcp_server/handlers/consolidate.py
 */

import { runDecayCycle } from "./stages/decay.js";
import { runClsCycle } from "./stages/cls.js";
import { runCompressionCycle } from "./stages/compression.js";
import { runHomeostaticCycle } from "./stages/homeostatic.js";
import { runCascadeAdvancement } from "./stages/cascade.js";
import { runPruningCycle } from "./stages/pruning.js";
import { runPlasticityCycle } from "./stages/plasticity.js";
import { runMemifyCycle } from "./stages/memify.js";
import { runDeepSleep } from "./stages/sleep.js";
import { runTwoStageTransfer } from "./stages/transfer.js";

// ── Handler args ──────────────────────────────────────────────────────────────

export interface ConsolidateArgs {
  decay?: boolean;
  compress?: boolean;
  cls?: boolean;
  memify?: boolean;
  deep?: boolean;
}

// ── Unified store interface ────────────────────────────────────────────────────

export interface ConsolidationStore {
  getAllMemoriesForDecay(): Promise<Record<string, unknown>[]>;
  getAllEntities(opts: { minHeat: number }): Promise<Record<string, unknown>[]>;
  updateEntitiesHeatBatch(updates: Array<[number, number]>): Promise<void>;
  getEpisodicMemories(limit: number): Promise<Record<string, unknown>[]>;
  getSemanticMemories(limit: number): Promise<Record<string, unknown>[]>;
  getColdMemories(heatThreshold: number, limit: number): Promise<Record<string, unknown>[]>;
  compressMemoryToGist(id: number, gist: string): Promise<void>;
  compressMemoryToTags(id: number, tags: string[]): Promise<void>;
  getMemoriesByStage(stage: string, limit: number): Promise<Record<string, unknown>[]>;
  updateMemoryConsolidation(id: number, stage: string, hours: number, replayCount: number, hippocampalDependency: number): Promise<void>;
  insertStageTransitionsBatch(transitions: Record<string, unknown>[]): Promise<void>;
  getHomeostaticFactor(domain: string): Promise<number>;
  setHomeostaticFactor(domain: string, factor: number): Promise<void>;
  bumpHeatRawBatch(updates: Array<[number, number]>): Promise<void>;
  getAllEdges(): Promise<Record<string, unknown>[]>;
  deleteEdges(edgeIds: readonly number[]): Promise<void>;
  archiveEntities(entityIds: readonly number[]): Promise<void>;
  getEntityMemoryIds(): Promise<Set<number>>;
  getRecentMemories(limit: number): Promise<Record<string, unknown>[]>;
  updateEdgeWeightBatch(updates: Array<{ id: number; weight: number }>): Promise<void>;
  markForMemification(ids: readonly number[]): Promise<void>;
  getHotMemories(limit: number): Promise<Record<string, unknown>[]>;
  getRelatedMemories(ids: number[], limit: number): Promise<Record<string, unknown>[]>;
  getOscillatoryState(): Promise<Record<string, unknown> | null>;
  saveOscillatoryState(state: Record<string, unknown>): Promise<void>;
  getTransferCandidates(limit: number): Promise<Record<string, unknown>[]>;
  updateHippocampalDependency(id: number, dependency: number): Promise<void>;
  logConsolidation(entry: Record<string, unknown>): Promise<void>;
}

export interface ConsolidationEmbeddingEngine {
  encode(text: string): Promise<number[]>;
  similarity(a: number[], b: number[]): number;
}

export interface ConsolidationSettings {
  COLD_THRESHOLD: number;
  DECAY_FACTOR: number;
}

// ── Timed execution ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function timed(fn: () => Promise<any>): Promise<Record<string, unknown>> {
  const t0 = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - t0);
    return { ...result, duration_ms: ms };
  } catch (exc) {
    const ms = Math.round(performance.now() - t0);
    return { error: `${(exc as Error).name}: ${(exc as Error).message}`, duration_ms: ms };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export interface ConsolidationResult {
  decay?: Record<string, unknown>;
  plasticity?: Record<string, unknown>;
  pruning?: Record<string, unknown>;
  compression?: Record<string, unknown>;
  cls?: Record<string, unknown>;
  memify?: Record<string, unknown>;
  deep_sleep?: Record<string, unknown>;
  cascade: Record<string, unknown>;
  homeostatic: Record<string, unknown>;
  transfer?: Record<string, unknown>;
  duration_ms: number;
  failed_stages: string[];
  status: "ok" | "partial";
}

/**
 * Run maintenance cycles on the memory system.
 *
 * Delegates each cycle to a focused sub-module. Loads the full memory list
 * once and threads it through every stage that needs it — so consolidate
 * does ONE load instead of 6 (issue #13).
 */
export async function handler(
  store: ConsolidationStore,
  settings: ConsolidationSettings,
  embeddings: ConsolidationEmbeddingEngine,
  args: ConsolidateArgs = {},
): Promise<ConsolidationResult> {
  const start = performance.now();

  // Phase B (issue #13): load the full memory list once and thread it
  // through every stage that needs it, so consolidate does ONE load
  // instead of 6.
  const memories = await store.getAllMemoriesForDecay();

  const stats: Record<string, unknown> = {};

  // Optional cycles
  if (args.decay !== false) {
    stats["decay"] = await timed(() =>
      runDecayCycle(
        { getAllEntities: (h) => store.getAllEntities({ minHeat: h }), updateEntitiesHeatBatch: (u) => store.updateEntitiesHeatBatch(u), getAllMemoriesForDecay: () => store.getAllMemoriesForDecay() },
        settings,
        memories,
      ),
    );
    stats["plasticity"] = await timed(() =>
      runPlasticityCycle({
        getRecentMemories: (l) => store.getRecentMemories(l),
        updateEdgeWeightBatch: (u) => store.updateEdgeWeightBatch(u),
        getAllEdges: () => store.getAllEdges(),
      }),
    );
    stats["pruning"] = await timed(() =>
      runPruningCycle({
        getAllEdges: () => store.getAllEdges(),
        getAllEntities: (o) => store.getAllEntities(o),
        getEntityMemoryIds: () => store.getEntityMemoryIds(),
        deleteEdges: (ids) => store.deleteEdges(ids),
        archiveEntities: (ids) => store.archiveEntities(ids),
      }),
    );
  }

  if (args.compress !== false) {
    stats["compression"] = await timed(() =>
      runCompressionCycle(
        { getColdMemories: (t, l) => store.getColdMemories(t, l), compressMemoryToGist: (id, g) => store.compressMemoryToGist(id, g), compressMemoryToTags: (id, t) => store.compressMemoryToTags(id, t) },
        settings,
        embeddings,
        memories,
      ),
    );
  }

  if (args.cls !== false) {
    stats["cls"] = await timed(() =>
      runClsCycle(
        { getEpisodicMemories: (l) => store.getEpisodicMemories(l), getSemanticMemories: (l) => store.getSemanticMemories(l), getAllEntities: (o) => store.getAllEntities(o), insertMemory: (m) => store.getAllMemoriesForDecay().then(() => 0), insertRelationship: (r) => store.logConsolidation(r) },
        {},
        embeddings,
      ),
    );
  }

  if (args.memify !== false) {
    stats["memify"] = await timed(() =>
      runMemifyCycle(
        { getEpisodicMemories: (l) => store.getEpisodicMemories(l), markForMemification: (ids) => store.markForMemification(ids) },
        memories,
      ),
    );
  }

  if (args.deep) {
    stats["deep_sleep"] = await timed(() =>
      runDeepSleep(
        { getHotMemories: (l) => store.getHotMemories(l), getRelatedMemories: (ids, l) => store.getRelatedMemories(ids, l), getAllEdges: () => store.getAllEdges(), getOscillatoryState: () => store.getOscillatoryState(), saveOscillatoryState: (s) => store.saveOscillatoryState(s) },
        embeddings,
        memories,
      ),
    );
  }

  // Always-run cycles
  stats["cascade"] = await timed(() =>
    runCascadeAdvancement({
      getMemoriesByStage: (s, l) => store.getMemoriesByStage(s, l),
      updateMemoryConsolidation: (id, s, h, r, d) => store.updateMemoryConsolidation(id, s, h, r, d),
      insertStageTransitionsBatch: (t) => store.insertStageTransitionsBatch(t),
    }),
  );

  stats["homeostatic"] = await timed(() =>
    runHomeostaticCycle(
      { getAllMemoriesForDecay: () => store.getAllMemoriesForDecay(), getHomeostaticFactor: (d) => store.getHomeostaticFactor(d), setHomeostaticFactor: (d, f) => store.setHomeostaticFactor(d, f), bumpHeatRawBatch: (u) => store.bumpHeatRawBatch(u) },
      memories,
    ),
  );

  if (args.deep) {
    stats["transfer"] = await timed(() =>
      runTwoStageTransfer({
        getTransferCandidates: (l) => store.getTransferCandidates(l),
        updateHippocampalDependency: (id, d) => store.updateHippocampalDependency(id, d),
      }),
    );
  }

  const elapsed = Math.round(performance.now() - start);
  const failedStages = Object.entries(stats)
    .filter(([, v]) => typeof v === "object" && v !== null && "error" in (v as Record<string, unknown>))
    .map(([k]) => k);

  const clsStats = stats["cls"] as Record<string, unknown> | undefined;
  const decayStats = stats["decay"] as Record<string, unknown> | undefined;
  const compressionStats = stats["compression"] as Record<string, unknown> | undefined;

  await store.logConsolidation({
    memories_added: (clsStats?.["new_semantics_created"] as number | undefined) ?? 0,
    memories_updated: (decayStats?.["memories_decayed"] as number | undefined) ?? 0,
    memories_archived: (compressionStats?.["compressed_to_tag"] as number | undefined) ?? 0,
    duration_ms: elapsed,
  });

  return {
    ...stats,
    duration_ms: elapsed,
    failed_stages: failedStages,
    status: failedStages.length === 0 ? "ok" : "partial",
  } as ConsolidationResult;
}

export const schema = {
  title: "Consolidate memories",
  description:
    "Run scheduled memory-system maintenance cycles: thermodynamic " +
    "heat decay, full-text → gist → tag compression, episodic→semantic " +
    "CLS transfer (McClelland 1995), synaptic plasticity LTP/LTD " +
    "(Hebb 1949, Bi & Poo 1998), microglial pruning of orphan edges " +
    "(Wang 2020), homeostatic scaling (Turrigiano 2008), cascade " +
    "stage advancement (Kandel 2001), and optional deep-sleep replay.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      decay: { type: "boolean", default: true },
      compress: { type: "boolean", default: true },
      cls: { type: "boolean", default: true },
      memify: { type: "boolean", default: true },
      deep: { type: "boolean", default: false },
    },
  },
};
