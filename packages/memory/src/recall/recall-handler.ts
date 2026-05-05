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
  buildPatternMatrix,
  retrieve as hopfieldRetrieve,
} from "./hopfield.js";
import { computeHdcScores } from "./hdc-encoder.js";
import {
  buildEntityGraph,
  mapEntityActivationToMemories,
  resolveSeedEntities,
  spreadActivation,
} from "./spreading-activation.js";
import { extractKeywords } from "./knowledge-graph.js";
import { findBestBranch } from "./dendritic-clusters.js";
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

// ── CORTEX_ABLATE env-var ablation contract ───────────────────────────────
//
// Each CORTEX_ABLATE_<MECH>=1 env var disables the corresponding mechanism
// at handler entry. Mirrors cortex@bc0ae4f mcp_server/handlers/recall.py
// ablation guard block.
//
// WIRED (5 mechanisms — their implementations are present in this port):
//   CORTEX_ABLATE_HOPFIELD=1           → skip Hopfield signal
//   CORTEX_ABLATE_HDC=1                → skip HDC signal
//   CORTEX_ABLATE_SPREADING_ACTIVATION=1 → skip spreading-activation signal
//   CORTEX_ABLATE_DENDRITIC_CLUSTERS=1 → skip dendritic branch scoring
//   CORTEX_ABLATE_CO_ACTIVATION=1      → skip co-activation Hebbian update
//
// DEFERRED (18 mechanisms — their handlers are not yet ported to TS):
//   OSCILLATORY_CLOCK, CASCADE, PREDICTIVE_CODING, NEUROMODULATION,
//   PATTERN_SEPARATION, SCHEMA_ENGINE, TRIPARTITE_SYNAPSE, INTERFERENCE,
//   HOMEOSTATIC_PLASTICITY, SYNAPTIC_PLASTICITY, SYNAPTIC_TAGGING,
//   EMOTIONAL_TAGGING, MICROGLIAL_PRUNING, ENGRAM_ALLOCATION,
//   RECONSOLIDATION, TWO_STAGE_MODEL, SURPRISE_MOMENTUM, ADAPTIVE_DECAY
//   — ablation guards for these will be wired when each handler lands.

const ABLATE_HOPFIELD = process.env["CORTEX_ABLATE_HOPFIELD"] === "1";
const ABLATE_HDC = process.env["CORTEX_ABLATE_HDC"] === "1";
const ABLATE_SPREADING_ACTIVATION =
  process.env["CORTEX_ABLATE_SPREADING_ACTIVATION"] === "1";
const ABLATE_DENDRITIC_CLUSTERS =
  process.env["CORTEX_ABLATE_DENDRITIC_CLUSTERS"] === "1";
const ABLATE_CO_ACTIVATION = process.env["CORTEX_ABLATE_CO_ACTIVATION"] === "1";

// ── Handler-internal constants ────────────────────────────────────────────

/** Minimum word length for keyword-trigger matching.
 *  source: cortex@bc0ae4f mcp_server/handlers/recall.py (check_trigger heuristic) */
const TRIGGER_MIN_WORD_LEN = 3; // source: cortex@bc0ae4f mcp_server/handlers/recall.py (len(w) > 3 keyword heuristic)

/** Number of FTS candidates to fetch per prospective trigger.
 *  source: cortex@bc0ae4f mcp_server/handlers/recall.py (ftsCandidates limit = 3) */
const TRIGGER_FTS_LIMIT = 3; // source: cortex@bc0ae4f mcp_server/handlers/recall.py (trigger FTS limit)

/** Default importance score for injected trigger memories.
 *  source: cortex@bc0ae4f mcp_server/handlers/recall.py (default importance = 0.5) */
const DEFAULT_IMPORTANCE = 0.5; // source: cortex@bc0ae4f mcp_server/handlers/recall.py (default importance=0.5)

/** Default max_results when not specified by the caller.
 *  source: cortex@bc0ae4f mcp_server/handlers/recall.py (max_results=10 default) */
const DEFAULT_MAX_RESULTS = 10; // source: cortex@bc0ae4f mcp_server/handlers/recall.py (top_k default=10)

/** Default min_heat threshold when not specified by the caller.
 *  source: cortex@bc0ae4f mcp_server/handlers/recall.py (min_heat=0.05 default) */
const DEFAULT_MIN_HEAT = 0.05; // source: cortex@bc0ae4f mcp_server/handlers/recall.py (min_heat default=0.05)

/** Candidate pool multiplier: pool = max_results * POOL_MULTIPLIER (min POOL_FLOOR).
 *  source: cortex@bc0ae4f mcp_server/handlers/recall.py (pool = max(top_k * 3, 30)) */
const POOL_MULTIPLIER = 3; // source: cortex@bc0ae4f mcp_server/handlers/recall.py (pool multiplier = 3)

/** Minimum candidate pool size.
 *  source: cortex@bc0ae4f mcp_server/handlers/recall.py (max(top_k * 3, 30)) */
const POOL_FLOOR = 30; // source: cortex@bc0ae4f mcp_server/handlers/recall.py (pool floor = 30)

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
  CO_ACTIVATION_LEARNING_RATE: 0.01, // source: cortex@bc0ae4f mcp_server/handlers/recall.py (default Hebbian learning rate, empirical)
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
      (w) => w.length > TRIGGER_MIN_WORD_LEN && queryLower.includes(w),
    );
    if (!matches) continue;

    const ftsCandidates = await store.searchByFts(triggerContent, TRIGGER_FTS_LIMIT);
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
        importance: mem.importance ?? DEFAULT_IMPORTANCE,
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

  // source: cortex@bc0ae4f mcp_server/handlers/recall.py (max_results=10, min_heat=0.05 — empirical defaults)
  const { query, max_results = DEFAULT_MAX_RESULTS, min_heat = DEFAULT_MIN_HEAT } = args;

  // 1. Intent classification
  const intentInfo = classifyQueryIntent(query);
  const intent = intentInfo.intent;

  // 2. Fetch candidates
  const pool = Math.max(max_results * POOL_MULTIPLIER, POOL_FLOOR);
  const { vectorPairs, ftsPairs, hotMems, queryEmbedding } =
    await fetchCandidates(args, store, embeddings, pool);

  // 3. Compute text signals (BM25 + n-gram + heat) from hot pool
  const { bm25, ngram } = computeTextSignals(query, hotMems);
  const heatSignal = extractHeatSignal(hotMems);

  // 4. Compute Hopfield signal (energy-based associative retrieval).
  //    CORTEX_ABLATE_HOPFIELD=1 → skip.
  //    source: Ramsauer et al. (2021); cortex@bc0ae4f mcp_server/core/hopfield.py
  let hopfieldPairs: Array<[number, number]> = [];
  if (!ABLATE_HOPFIELD && queryEmbedding !== null && queryEmbedding.length > 0 && hotMems.length > 0) {
    const embPairs: Array<[number, number[]]> = hotMems
      .filter((m) => m.embedding !== null && m.embedding.length > 0)
      .map((m) => [m.id, m.embedding as number[]]);
    if (embPairs.length > 0) {
      const matrix = buildPatternMatrix(embPairs);
      hopfieldPairs = hopfieldRetrieve(queryEmbedding, matrix);
    }
  }

  // 5. Compute HDC signal (hyperdimensional text encoding).
  //    CORTEX_ABLATE_HDC=1 → skip.
  //    source: Kanerva (2009); cortex@bc0ae4f mcp_server/core/hdc_encoder.py
  let hdcPairs: Array<[number, number]> = [];
  if (!ABLATE_HDC && hotMems.length > 0) {
    const memContents: Array<[number, string]> = hotMems.map((m) => [m.id, m.content]);
    hdcPairs = computeHdcScores(query, memContents);
  }

  // 6. Compute spreading-activation signal (entity-graph BFS).
  //    CORTEX_ABLATE_SPREADING_ACTIVATION=1 → no propagation (seeds only).
  //    source: Collins & Loftus (1975); cortex@bc0ae4f mcp_server/core/spreading_activation.py
  let saPairs: Array<[number, number]> = [];
  if (store.getEntities && store.getRelationships) {
    try {
      const [rawEntities, rawRels] = await Promise.all([
        store.getEntities(args.domain),
        store.getRelationships(args.domain),
      ]);
      if (rawEntities.length > 0) {
        const { graph, nameIndex } = buildEntityGraph(rawEntities, rawRels);
        const queryTerms = extractKeywords(query);
        const seedIds = resolveSeedEntities(queryTerms, nameIndex);
        if (seedIds.length > 0) {
          // entityToMemoryIds: entity → list of memories that mention it
          const entityToMemoryIds = new Map<number, number[]>();
          for (const mem of hotMems) {
            for (const ent of rawEntities) {
              if (mem.content.toLowerCase().includes(ent.name?.toLowerCase() ?? "")) {
                if (!entityToMemoryIds.has(ent.id)) entityToMemoryIds.set(ent.id, []);
                const bucket = entityToMemoryIds.get(ent.id);
                if (bucket !== undefined) bucket.push(mem.id);
              }
            }
          }
          const entityActivations = spreadActivation(graph, seedIds, {
            disabled: ABLATE_SPREADING_ACTIVATION,
          });
          saPairs = mapEntityActivationToMemories(entityActivations, entityToMemoryIds);
        }
      }
    } catch {
      // Spreading activation is best-effort; failures must not block recall.
    }
  }

  // 7. Compute dendritic branch signal (semantic clustering).
  //    CORTEX_ABLATE_DENDRITIC_CLUSTERS=1 → findBestBranch returns null.
  //    source: Kastellakis et al. (2015); cortex@bc0ae4f mcp_server/core/dendritic_clusters.py
  //    Note: the dendritic signal boosts memories that belong to the same
  //    branch as the top-scoring results. We derive a simple score from
  //    branch affinity of the query's entity set against existing hot-mem
  //    entity signatures. When ablated or no hot mems, srPairs stays [].
  let srPairs: Array<[number, number]> = [];
  if (!ABLATE_DENDRITIC_CLUSTERS && hotMems.length > 0) {
    // Build query entity set from keywords for affinity comparison.
    const queryKeywords = extractKeywords(query);
    const queryTagSet = new Set<string>(queryKeywords);
    // D-05 fix: entitySignature is now Set<string> (entity names), not Set<number>.
    // At this call site entity names are not available from the query, so the
    // entity set remains empty — identical to Python's behaviour when the query
    // has no extractable entity names. Jaccard over empty sets = 0, so the
    // affinity score is driven entirely by the tag Jaccard (0.3 weight), which
    // matches the Python code path for name-free queries.
    // source: cortex@ed33435 mcp_server/core/dendritic_clusters.py:44-67
    const queryEntitySet = new Set<string>(); // entity names not extractable from raw query text
    // Score each hot memory by how well its tags align with query keywords.
    const tagScored: Array<[number, number]> = hotMems.map((m) => {
      const memTags = new Set<string>(
        Array.isArray(m.tags) ? m.tags : [],
      );
      const result = findBestBranch(queryEntitySet, queryTagSet, [
        {
          branchId: `m${m.id}`,
          domain: m.domain,
          memoryIds: [m.id],
          entitySignature: new Set<string>(), // entity names (not IDs) — empty at query time
          tagSignature: memTags,
          avgHeat: m.heat,
          plasticity: 1.0,
          spikeCount: 0,
        },
      ], { disabled: ABLATE_DENDRITIC_CLUSTERS });
      return [m.id, result.score] as [number, number];
    });
    srPairs = tagScored.filter(([, s]) => s > 0);
  }

  // 8. Assemble signals
  const signals: MultiSignalSignals = {
    vector: vectorPairs,
    fts: ftsPairs,
    heat: heatSignal,
    bm25,
    ngram,
    hopfield: hopfieldPairs,
    hdc: hdcPairs,
    sr: srPairs,
    sa: saPairs,
  };

  // 9. RRF fusion
  const fused = fuseSignals(signals, settings.WRRF_K);
  if (fused.length === 0) {
    return { ...empty, query_intent: intent };
  }

  // 10. Resolve memory objects + build results
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

  // 11. Prospective trigger injection
  const withTriggers = await injectTriggeredMemories(scored, query, store);

  // 12. Apply neuro-symbolic rules
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

  // 13. Cap to max_results
  const capped = afterRules.slice(0, max_results);

  // 14. Strategic ordering (Lost-in-the-Middle mitigation)
  // source: Liu et al. (2023) "Lost in the Middle: How Language Models Use Long Contexts."
  const ordered = settings.STRATEGIC_ORDERING_ENABLED
    ? applyStrategicOrdering(
        capped,
        settings.STRATEGIC_TOP_FRACTION,
        settings.STRATEGIC_BOTTOM_FRACTION,
      )
    : capped;

  // 11. Co-activation Hebbian learning (side effect).
  //     CORTEX_ABLATE_CO_ACTIVATION=1 → skip.
  if (!ABLATE_CO_ACTIVATION) {
    await applyCoActivation(ordered, store, settings);
  }

  // 16. Track replay for consolidation cascade
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
