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
  // ── Shared / decay ───────────────────────────────────────────────────────
  getAllMemoriesForDecay(): Promise<Record<string, unknown>[]>;
  getAllEntities(opts: { minHeat: number }): Promise<Record<string, unknown>[]>;
  updateEntitiesHeatBatch(updates: Array<[number, number]>): Promise<void>;
  // ── Plasticity ────────────────────────────────────────────────────────────
  getAllRelationships(): Promise<Record<string, unknown>[]>;
  getHotMemories(opts: { minHeat: number; limit: number }): Promise<Record<string, unknown>[]>;
  findCoAccessedPairs(memoryIds: number[]): Promise<Array<[number, number]>>;
  updateRelationshipsWeightBatch(updates: Array<[number, number]>): Promise<void>;
  // ── Pruning ───────────────────────────────────────────────────────────────
  deleteRelationshipsBatch(ids: readonly number[]): Promise<number>;
  archiveEntitiesBatch(ids: readonly number[]): Promise<number>;
  // ── Compression + Sleep ───────────────────────────────────────────────────
  insertArchive(row: Record<string, unknown>): Promise<void>;
  updateMemoryCompression(
    id: number,
    content: string,
    embedding: number[],
    compressionLevel: number,
    opts?: { originalContent?: string },
  ): Promise<void>;
  // ── CLS ───────────────────────────────────────────────────────────────────
  getEpisodicMemories(limit: number): Promise<Record<string, unknown>[]>;
  getSemanticMemories(limit: number): Promise<Record<string, unknown>[]>;
  // ── Memify ────────────────────────────────────────────────────────────────
  deleteMemory(id: number): Promise<void>;
  updateMemoryImportance(id: number, importance: number): Promise<void>;
  insertRelationship(rel: Record<string, unknown>): Promise<void>;
  // ── Sleep ─────────────────────────────────────────────────────────────────
  insertMemory(mem: Record<string, unknown>): Promise<number>;
  // ── Cascade ───────────────────────────────────────────────────────────────
  getMemoriesByStage(stage: string, limit: number): Promise<Record<string, unknown>[]>;
  updateMemoryConsolidation(id: number, stage: string, hours: number, replayCount: number, hippocampalDependency: number): Promise<void>;
  insertStageTransitionsBatch(transitions: Record<string, unknown>[]): Promise<void>;
  updateStageEnteredAt(memoryId: number, enteredAt: Date): Promise<void>;
  // ── Homeostatic ───────────────────────────────────────────────────────────
  getHomeostaticFactor(domain: string): Promise<number>;
  setHomeostaticFactor(domain: string, factor: number): Promise<void>;
  bumpHeatRaw(memoryId: number, newHeat: number): Promise<void>;
  // ── Batch connection (memify + homeostatic + sleep) ───────────────────────
  acquireBatch(): {
    execute(sql: string, params?: unknown[]): Promise<{ rows?: Record<string, unknown>[]; rowcount?: number }>;
  };
  // ── Transfer ──────────────────────────────────────────────────────────────
  getTransferCandidates(limit: number): Promise<Record<string, unknown>[]>;
  updateHippocampalDependency(id: number, dependency: number): Promise<void>;
  // ── Logging ───────────────────────────────────────────────────────────────
  logConsolidation(entry: Record<string, unknown>): Promise<void>;
}

export interface ConsolidationEmbeddingEngine {
  encode(text: string): Promise<number[]>;
  similarity(a: number[], b: number[]): number;
}

export interface ConsolidationSettings {
  COLD_THRESHOLD: number;
  DECAY_FACTOR: number;
  // source: compression.ts CompressionSettings — passed to runCompressionCycle
  COMPRESSION_GIST_AGE_HOURS: number;
  COMPRESSION_TAG_AGE_HOURS: number;
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
        getAllEntities: (opts) => store.getAllEntities(opts),
        getAllRelationships: () => store.getAllRelationships(),
        getHotMemories: (opts) => store.getHotMemories(opts),
        findCoAccessedPairs: (ids) => store.findCoAccessedPairs(ids),
        updateRelationshipsWeightBatch: (u) => store.updateRelationshipsWeightBatch(u),
      }),
    );
    stats["pruning"] = await timed(() =>
      runPruningCycle({
        getAllEntities: (opts) => store.getAllEntities(opts),
        getAllRelationships: () => store.getAllRelationships(),
        getHotMemories: (opts) => store.getHotMemories(opts),
        deleteRelationshipsBatch: (ids) => store.deleteRelationshipsBatch(ids),
        archiveEntitiesBatch: (ids) => store.archiveEntitiesBatch(ids),
      }),
    );
  }

  if (args.compress !== false) {
    stats["compression"] = await timed(() =>
      runCompressionCycle(
        {
          getAllMemoriesForDecay: () => store.getAllMemoriesForDecay(),
          insertArchive: (row) => store.insertArchive(row),
          updateMemoryCompression: (id, content, embedding, compressionLevel, opts) =>
            store.updateMemoryCompression(id, content, embedding, compressionLevel, opts),
        },
        settings,
        embeddings,
        memories,
      ),
    );
  }

  if (args.cls !== false) {
    stats["cls"] = await timed(() =>
      runClsCycle(
        {
          getEpisodicMemories: (l) => store.getEpisodicMemories(l),
          getSemanticMemories: (l) => store.getSemanticMemories(l),
          getAllEntities: (o) => store.getAllEntities(o),
          insertMemory: (mem) => store.insertMemory(mem),
          insertRelationship: (rel) => store.insertRelationship(rel),
        },
        {},
        embeddings,
      ),
    );
  }

  if (args.memify !== false) {
    stats["memify"] = await timed(() =>
      runMemifyCycle(
        {
          getAllMemoriesForDecay: () => store.getAllMemoriesForDecay(),
          deleteMemory: (id) => store.deleteMemory(id),
          updateMemoryImportance: (id, importance) => store.updateMemoryImportance(id, importance),
          getAllEntities: (opts) => store.getAllEntities(opts),
          insertRelationship: (rel) => store.insertRelationship(rel),
          acquireBatch: () => store.acquireBatch(),
        },
        memories,
      ),
    );
  }

  if (args.deep) {
    stats["deep_sleep"] = await timed(() =>
      runDeepSleep(
        {
          getAllMemoriesForDecay: () => store.getAllMemoriesForDecay(),
          updateMemoryCompression: (id, content, embedding, compressionLevel) =>
            store.updateMemoryCompression(id, content, embedding, compressionLevel),
          acquireBatch: () => {
            const conn = store.acquireBatch();
            return { execute: (sql: string, params: unknown[]) => conn.execute(sql, params).then(() => undefined) };
          },
          insertMemory: (mem) => store.insertMemory(mem),
        },
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
      updateStageEnteredAt: (memoryId, enteredAt) => store.updateStageEnteredAt(memoryId, enteredAt),
    }),
  );

  stats["homeostatic"] = await timed(() =>
    runHomeostaticCycle(
      {
        getAllMemoriesForDecay: () => store.getAllMemoriesForDecay(),
        getHomeostaticFactor: (d) => store.getHomeostaticFactor(d),
        setHomeostaticFactor: (d, f) => store.setHomeostaticFactor(d, f),
        bumpHeatRaw: (id, heat) => store.bumpHeatRaw(id, heat),
        acquireBatch: () => store.acquireBatch(),
      },
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
    "CLS transfer (McClelland 1995), synaptic plasticity LTP/LTD " + // source: McClelland et al. (1995) Science 268:1692 — CLS; Hebb (1949) Org. of Behavior — LTP
    "(Hebb 1949, Bi & Poo 1998), microglial pruning of orphan edges " + // source: Bi & Poo (1998) J Neurosci 18:10464 — STDP; cited years are publication years
    "(Wang 2020), homeostatic scaling (Turrigiano 2008), cascade " + // source: Wang (2020) Nature 579:589 — microglial pruning; Turrigiano (2008) Neuron 60:477
    "stage advancement (Kandel 2001), and optional deep-sleep replay.", // source: Kandel (2001) Science 294:1030 — systems consolidation cascade
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
