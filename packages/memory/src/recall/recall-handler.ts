/**
 * Recall handler — multi-signal fusion recall with production enrichments.
 *
 * Composition root: wires MemoryStore port into retrieval logic.
 *
 * Pipeline:
 *   1. Classify query intent
 *   2. Fetch vector + FTS candidates from MemoryStore
 *   3. Fetch hot-memory pool for BM25 + heat + n-gram signals
 *   4. Fuse all signals via RRF
 *   5. Build typed results with recency boost + session coherence
 *   6. Inject prospective-memory triggers
 *   7. Apply neuro-symbolic rules
 *   8. Apply strategic ordering (Lost-in-the-Middle mitigation)
 *   9. Track replay for consolidation cascade
 *
 * Port of: mcp_server/handlers/recall.py::handler
 *          mcp_server/core/pg_recall.py::recall (client-side path)
 *          mcp_server/handlers/recall_helpers.py
 *
 * Read-only: no DB writes except access_count and replay_count tracking
 * (idiomatic side effects on read in the Python source — preserved here).
 */

import { applyCoActivation } from "./co-activation.js";
import {
  applyStrategicOrdering,
  buildRecallResult,
  computeTextSignals,
  extractHeatSignal,
  fuseSignals,
} from "./multi-signal-fusion.js";
import type { EmbeddingEngine, MemoryStore } from "./port.js";
import { classifyQueryIntent } from "./query-intent.js";
import { applyRules } from "./rules.js";
import type {
  MemoryItem,
  MultiSignalSignals,
  RecallRequest,
  RecallResponse,
} from "./types.js";
import { QueryIntent } from "./types.js";

// ── Settings ──────────────────────────────────────────────────────────────

export interface RecallSettings {
  WRRF_K: number;
  CO_ACTIVATION_ENABLED: boolean;
  CO_ACTIVATION_MIN_SCORE: number;
  CO_ACTIVATION_LEARNING_RATE: number;
  STRATEGIC_ORDERING_ENABLED: boolean;
  STRATEGIC_TOP_FRACTION: number;
  STRATEGIC_BOTTOM_FRACTION: number;
  SESSION_COHERENCE_BONUS: number;
  SESSION_COHERENCE_WINDOW_HOURS: number;
  RECENCY_BOOST_MAX: number;
  RECENCY_BOOST_HALFLIFE_DAYS: number;
  RECENCY_BOOST_CUTOFF_DAYS: number;
}

export const DEFAULT_RECALL_SETTINGS: RecallSettings = {
  WRRF_K: 60,
  CO_ACTIVATION_ENABLED: true,
  CO_ACTIVATION_MIN_SCORE: 0.3,
  CO_ACTIVATION_LEARNING_RATE: 0.01,
  STRATEGIC_ORDERING_ENABLED: true,
  STRATEGIC_TOP_FRACTION: 0.3,
  STRATEGIC_BOTTOM_FRACTION: 0.2,
  SESSION_COHERENCE_BONUS: 0.1,
  SESSION_COHERENCE_WINDOW_HOURS: 4,
  RECENCY_BOOST_MAX: 0.3,
  RECENCY_BOOST_HALFLIFE_DAYS: 7,
  RECENCY_BOOST_CUTOFF_DAYS: 30,
};

// ── Candidate retrieval ───────────────────────────────────────────────────

async function fetchCandidates(
  args: RecallRequest,
  store: MemoryStore,
  embeddings: EmbeddingEngine | null,
  pool: number,
): Promise<{
  vectorPairs: Array<[number, number]>;
  ftsPairs: Array<[number, number]>;
  hotMems: MemoryItem[];
  queryEmbedding: number[] | null;
}> {
  const minHeat = args.min_heat;

  // Vector signal
  let vectorPairs: Array<[number, number]> = [];
  let queryEmbedding: number[] | null = null;
  if (embeddings) {
    queryEmbedding = await embeddings.encode(args.query);
    if (queryEmbedding) {
      const vecResults = await store.searchByVector(queryEmbedding, pool, minHeat);
      vectorPairs = vecResults.map((r) => [r.memory_id, 1 / (1 + r.distance)]);
    }
  }

  // FTS signal
  const ftsResults = await store.searchByFts(args.query, pool);
  const ftsPairs: Array<[number, number]> = ftsResults.map((r) => [r.memory_id, r.score]);

  // Hot memory pool for text signals
  let hotMems: MemoryItem[];
  if (args.domain) {
    hotMems = await store.getMemoriesForDomain(args.domain, minHeat, pool);
  } else if (args.directory) {
    hotMems = await store.getMemoriesForDirectory(args.directory, minHeat);
  } else {
    hotMems = await store.getHotMemories(minHeat, pool);
  }

  return { vectorPairs, ftsPairs, hotMems, queryEmbedding };
}

// ── Prospective trigger injection ─────────────────────────────────────────

async function injectTriggeredMemories(
  results: ReturnType<typeof buildRecallResult>[],
  query: string,
  store: MemoryStore,
): Promise<ReturnType<typeof buildRecallResult>[]> {
  let triggers: unknown[];
  try {
    triggers = await store.getActiveProspectiveMemories();
  } catch {
    return results;
  }
  if (!triggers || triggers.length === 0) return results;

  const existingIds = new Set(results.map((r) => r.memory_id));
  const injected: ReturnType<typeof buildRecallResult>[] = [];

  for (const trigger of triggers) {
    const t = trigger as Record<string, unknown>;
    const triggerContent = (t["content"] as string) ?? "";
    if (!triggerContent) continue;
    // Simple containment check (port of check_trigger for keyword matching)
    const triggerWords = triggerContent.toLowerCase().split(/\s+/);
    const queryLower = query.toLowerCase();
    const matches = triggerWords.some(
      (w) => w.length > 3 && queryLower.includes(w),
    );
    if (!matches) continue;

    const ftsCandidates = await store.searchByFts(triggerContent, 3);
    for (const { memory_id } of ftsCandidates) {
      if (existingIds.has(memory_id)) continue;
      const mem = await store.getMemory(memory_id);
      if (!mem) continue;
      injected.push({
        memory_id,
        content: mem.content,
        score: 0.9,
        heat: mem.heat ?? 1.0,
        domain: mem.domain ?? "",
        tags: Array.isArray(mem.tags) ? mem.tags : [],
        store_type: mem.store_type ?? "episodic",
        created_at: mem.created_at ?? "",
        importance: mem.importance ?? 0.5,
        surprise: mem.surprise_score ?? 0,
        recency_boost: 0.0,
      });
      existingIds.add(memory_id);
    }
  }

  return injected.length > 0 ? [...injected, ...results] : results;
}

// ── Replay tracking ───────────────────────────────────────────────────────

async function trackRecallReplay(
  results: Array<{ memory_id: number }>,
  store: MemoryStore,
): Promise<void> {
  // Biological basis: retrieval = hippocampal replay (McClelland 1995)
  // Each recall increments replay_count, driving consolidation stage advancement
  for (const mem of results) {
    const id = mem.memory_id;
    if (id == null) continue;
    try {
      await store.updateMemoryAccess(id);
      await store.incrementReplayCount(id);
    } catch {
      // Side-effect failures are silenced — recall must not fail due to tracking errors
    }
  }
}

// ── Handler ───────────────────────────────────────────────────────────────

/**
 * Recall handler: multi-signal fusion + production enrichments.
 *
 * Pre:  args.query is a non-empty string.
 * Post: returned RecallResponse.results is bounded by max_results.
 *
 * Port of: mcp_server/handlers/recall.py::handler
 */
export async function recallHandler(
  args: RecallRequest | null | undefined,
  store: MemoryStore,
  embeddings: EmbeddingEngine | null = null,
  settings: RecallSettings = DEFAULT_RECALL_SETTINGS,
): Promise<RecallResponse> {
  const empty: RecallResponse = {
    results: [],
    total: 0,
    query_intent: QueryIntent.GENERAL,
    dispatch_tier: "ts",
    signals: {},
    enhancements: undefined,
  };

  if (!args || !args.query) return empty;

  const { query, max_results = 10, min_heat = 0.05 } = args;

  // 1. Intent classification
  const intentInfo = classifyQueryIntent(query);
  const intent = intentInfo.intent;

  // 2. Fetch candidates
  const pool = Math.max(max_results * 3, 30);
  const { vectorPairs, ftsPairs, hotMems, queryEmbedding } =
    await fetchCandidates(args, store, embeddings, pool);

  // 3. Compute text signals (BM25 + n-gram + heat) from hot pool
  const { bm25, ngram } = computeTextSignals(query, hotMems);
  const heatSignal = extractHeatSignal(hotMems);

  // 4. Assemble signals (no Hopfield/HDC/SR/SA — those are port-pending)
  const signals: MultiSignalSignals = {
    vector: vectorPairs,
    fts: ftsPairs,
    heat: heatSignal,
    bm25,
    ngram,
    hopfield: [],
    hdc: [],
    sr: [],
    sa: [],
  };

  // 5. RRF fusion
  const fused = fuseSignals(signals, settings.WRRF_K);
  if (fused.length === 0) {
    return { ...empty, query_intent: intent };
  }

  // 6. Resolve memory objects + build results
  const topIds = fused.slice(0, max_results * 2).map(([id]) => id);
  const mems = await store.getByIds(topIds);
  const memMap = new Map(mems.map((m) => [m.id, m]));

  const scored = fused
    .flatMap(([id, score]): ReturnType<typeof buildRecallResult>[] => {
      const mem = memMap.get(id);
      if (!mem) return [];
      if (mem.heat < min_heat) return [];
      // Apply domain filter post-fusion: the FTS and vector signals may
      // surface cross-domain memories when no server-side filter is in place.
      // Python path enforces this inside the PG stored procedure; TS path
      // must apply it explicitly here.
      if (args.domain && mem.domain !== args.domain) return [];
      if (args.directory) {
        const tags = Array.isArray(mem.tags) ? mem.tags : [];
        const matchesDir = tags.some((t) => t.includes(args.directory as string));
        if (!matchesDir) return [];
      }
      return [buildRecallResult(mem, score, intent, settings)];
    })
    .slice(0, max_results * 2);

  // 7. Prospective trigger injection
  const withTriggers = await injectTriggeredMemories(scored, query, store);

  // 8. Apply neuro-symbolic rules
  let rules: unknown[] = [];
  try {
    rules = await store.getAllActiveRules();
  } catch {
    // rules unavailable — continue without
  }
  const afterRules =
    rules.length > 0
      ? (applyRules(
          withTriggers as Array<Record<string, unknown>>,
          rules as Parameters<typeof applyRules>[1],
          "score",
        ) as ReturnType<typeof buildRecallResult>[])
      : withTriggers;

  // 9. Cap to max_results
  const capped = afterRules.slice(0, max_results);

  // 10. Strategic ordering (Lost-in-the-Middle mitigation)
  // source: Liu et al. (2023) "Lost in the Middle: How Language Models Use Long Contexts."
  const ordered = settings.STRATEGIC_ORDERING_ENABLED
    ? applyStrategicOrdering(
        capped,
        settings.STRATEGIC_TOP_FRACTION,
        settings.STRATEGIC_BOTTOM_FRACTION,
      )
    : capped;

  // 11. Co-activation Hebbian learning (side effect)
  await applyCoActivation(ordered, store, settings);

  // 12. Track replay for consolidation cascade
  // Biological basis: retrieval = hippocampal replay (McClelland 1995)
  await trackRecallReplay(ordered, store);

  return {
    results: ordered,
    total: ordered.length,
    query_intent: intent,
    dispatch_tier: "ts",
    signals: {},
    enhancements: {
      query_expanded: false,
      multihop_applied: false,
      reranked: false,
      knowledge_update_boost: intent === QueryIntent.KNOWLEDGE_UPDATE,
      strategic_ordering: settings.STRATEGIC_ORDERING_ENABLED,
    },
  };
}

// ── Unused queryEmbedding — exported for future reranker integration ───────
export type { RecallSettings as RecallHandlerSettings };
