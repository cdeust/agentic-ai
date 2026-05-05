/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Retrieval signal computation for HDC, Hopfield, SR, and Spreading Activation.
 *
 * Port of: cortex@ed33435 mcp_server/core/retrieval_signals.py
 *
 * Spreading activation and SR co-access use PL/pgSQL stored procedures
 * for server-side computation. Hopfield and HDC stay client-side.
 *
 * Pure business logic (takes store/embeddings as parameters -- no globals).
 */

import { computeHdcScores } from "./hdc-encoder.js";
import { buildPatternMatrix, retrieve as hopfieldRetrieve } from "./hopfield.js";
import {
  spreadActivation,
  buildEntityGraph,
  mapEntityActivationToMemories,
} from "./spreading-activation.js";
import type { EmbeddingEngine, MemoryStore } from "./port.js";

// ── Settings interface (mirrors Python settings object) ───────────────────
// source: cortex@ed33435 mcp_server/core/retrieval_signals.py:31-48

export interface RetrievalSignalSettings {
  HOPFIELD_BETA: number;
  SA_DECAY: number;
  SA_THRESHOLD: number;
  SA_MAX_DEPTH: number;
  SA_MAX_NODES: number;
}

// ── Store interface extensions (optional PG-path methods) ─────────────────
// source: cortex@ed33435 mcp_server/core/retrieval_signals.py:31-83

export interface ExtendedMemoryStore extends MemoryStore {
  getHotEmbeddings?(
    minHeat: number,
    limit: number,
  ): Promise<Array<[number, Uint8Array | number[], number]>>;
  getTemporalCoAccess?(
    windowHours: number,
    minAccess: number,
    limit: number,
  ): Promise<Array<[number, number, number]>>;
  spreadActivationMemories?(params: {
    queryTerms: string[];
    decay: number;
    threshold: number;
    maxDepth: number;
    maxResults: number;
    minHeat: number;
  }): Promise<Array<[number, number]>>;
}

// ── Hopfield + HDC ────────────────────────────────────────────────────────

/**
 * Hopfield network + HDC signals.
 *
 * Port of: cortex@ed33435 mcp_server/core/retrieval_signals.py:30-62
 *
 * precondition: store implements getHotEmbeddings; embeddings implements encode
 * postcondition: hop and hdc are ranked (id, score) lists, possibly empty on
 *   any error or missing dependency (exceptions are caught internally)
 *
 * Hopfield: uses get_hot_embeddings() PL/pgSQL for efficient fetch,
 * then client-side softmax attention.
 * HDC: fully client-side bipolar vector encoding.
 */
export async function computeHopfieldHdc(
  query: string,
  qEmb: number[] | null,
  store: ExtendedMemoryStore,
  embeddings: EmbeddingEngine,
  hotMems: Array<{ id: number; content?: string }>,
  settings: RetrievalSignalSettings,
  pool: number,
  minHeat: number,
): Promise<[Array<[number, number]>, Array<[number, number]>]> {
  let hop: Array<[number, number]> = [];
  let hdc: Array<[number, number]> = [];

  if (qEmb !== null) {
    try {
      if (typeof store.getHotEmbeddings === "function") {
        // Use PG-side batch embedding fetch (single round trip)
        // source: cortex@ed33435 mcp_server/core/retrieval_signals.py:40-50
        const pairs = await store.getHotEmbeddings(minHeat, pool * 2);
        const embPairs: Array<[number, number[]]> = [];
        for (const [mid, emb] of pairs) {
          if (emb) {
            const arr = emb instanceof Uint8Array
              ? Array.from(emb as Uint8Array)
              : (emb as number[]);
            embPairs.push([mid, arr]);
          }
        }
        if (embPairs.length > 0) {
          const patMat = buildPatternMatrix(embPairs);
          if (patMat.rows.length > 0) {
            hop = hopfieldRetrieve(qEmb, patMat, settings.HOPFIELD_BETA, pool);
          }
        }
      }
    } catch {
      // Non-load-bearing; absence is fine
    }
  }

  try {
    if (hotMems.length > 0) {
      // source: cortex@ed33435 mcp_server/core/retrieval_signals.py:53-59
      // computeHdcScores(query, pairs, dim=1024, threshold)
      // source: cortex@ed33435 mcp_server/core/retrieval_signals.py:54-59
      const raw = computeHdcScores(
        query,
        hotMems.map((m): [number, string] => [m.id, m.content ?? ""]),
        1024, // source: cortex@ed33435 mcp_server/core/hdc_encoder.py:27 — HDC_DIM default
        0.05, // source: cortex@ed33435 mcp_server/core/retrieval_signals.py:56 — HDC threshold
      );
      // Normalize from [-1, 1] to [0, 1]
      hdc = raw.map(([mid, s]): [number, number] => [mid, (s + 1.0) / 2.0]);
    }
  } catch {
    // Non-load-bearing; absence is fine
  }

  return [hop, hdc];
}

// ── Graph signals ─────────────────────────────────────────────────────────

/**
 * Successor Representation + Spreading Activation signals.
 *
 * Port of: cortex@ed33435 mcp_server/core/retrieval_signals.py:65-83
 *
 * SA: single PL/pgSQL call (spread_activation_memories).
 * SR: PG-side co-access fetch + client-side scoring.
 */
export async function computeGraphSignals(
  query: string,
  store: ExtendedMemoryStore,
  vecResults: Array<[number, number]>,
  minHeat: number,
  settings: RetrievalSignalSettings,
  pool: number,
): Promise<[Array<[number, number]>, Array<[number, number]>]> {
  const sr = await computeSr(store, vecResults, pool);
  const sa = await computeSa(query, store, minHeat, settings);
  return [sr, sa];
}

// ── SR helper ─────────────────────────────────────────────────────────────

/**
 * Successor Representation from PG-side temporal co-access.
 * Port of: cortex@ed33435 mcp_server/core/retrieval_signals.py:86-106
 *
 * precondition: vecResults is possibly empty; store may lack getTemporalCoAccess
 * postcondition: returns empty list on any error or missing method
 */
async function computeSr(
  store: ExtendedMemoryStore,
  vecResults: Array<[number, number]>,
  pool: number,
): Promise<Array<[number, number]>> {
  try {
    if (vecResults.length === 0) return [];
    if (typeof store.getTemporalCoAccess !== "function") return [];

    // Use PG-side co-access query (single round trip)
    // source: cortex@ed33435 mcp_server/core/retrieval_signals.py:92-98
    const pairs = await store.getTemporalCoAccess(2.0, 1, 100);
    if (pairs.length === 0) return [];

    // Build SR graph from PG co-access pairs
    const g = new Map<number, Map<number, number>>();
    for (const [memA, memB, proximity] of pairs) {
      if (!g.has(memA)) g.set(memA, new Map());
      if (!g.has(memB)) g.set(memB, new Map());
      g.get(memA)?.set(memB, proximity);
      // source: cortex@ed33435 mcp_server/core/retrieval_signals.py:100
      g.get(memB)?.set(memA, proximity * 0.45); // back-link weaker; source: cortex@ed33435 mcp_server/core/retrieval_signals.py:100
    }

    const seeds = vecResults.slice(0, 3).map(([m]) => m);
    return computeSrScores(seeds, g, pool);
  } catch {
    return [];
  }
}

/**
 * Compute SR scores from a co-access graph and seed memories.
 * Port of: cortex@ed33435 mcp_server/core/cognitive_map.py::compute_sr_scores
 *
 * precondition: seeds is non-empty; graph maps id→{id→weight}
 * postcondition: returns ranked (id, score) list of length <= topK
 */
function computeSrScores(
  seeds: number[],
  graph: Map<number, Map<number, number>>,
  topK: number,
): Array<[number, number]> {
  const scores = new Map<number, number>();
  for (const seed of seeds) {
    const neighbors = graph.get(seed);
    if (!neighbors) continue;
    for (const [neighborId, weight] of neighbors) {
      scores.set(neighborId, (scores.get(neighborId) ?? 0) + weight);
    }
  }
  return Array.from(scores.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, topK)
    .map(([id, score]): [number, number] => [id, score]);
}

// ── SA helper ─────────────────────────────────────────────────────────────

/**
 * Spreading Activation via PL/pgSQL spread_activation_memories.
 *
 * Port of: cortex@ed33435 mcp_server/core/retrieval_signals.py:109-130
 *
 * Single server-side call replacing:
 *   1. get_all_entities
 *   2. get_all_relationships
 *   3. build_entity_graph + resolve_seed_entities + spread_activation
 *   4. N × get_memories_mentioning_entity
 */
async function computeSa(
  query: string,
  store: ExtendedMemoryStore,
  minHeat: number,
  settings: RetrievalSignalSettings,
): Promise<Array<[number, number]>> {
  try {
    const terms = extractQueryTerms(query);
    if (terms.length === 0) return [];

    if (typeof store.spreadActivationMemories !== "function") {
      // Fallback: client-side spreading activation via entity graph
      return await computeClientSideSa(query, store, minHeat, settings);
    }

    return await store.spreadActivationMemories({
      queryTerms: terms,
      decay: settings.SA_DECAY,
      threshold: settings.SA_THRESHOLD,
      maxDepth: settings.SA_MAX_DEPTH,
      maxResults: settings.SA_MAX_NODES,
      minHeat,
    });
  } catch {
    return [];
  }
}

/**
 * Client-side SA fallback using the spreading-activation module.
 * Used when the store does not expose spreadActivationMemories.
 */
async function computeClientSideSa(
  query: string,
  store: ExtendedMemoryStore,
  _minHeat: number,
  settings: RetrievalSignalSettings,
): Promise<Array<[number, number]>> {
  try {
    const entities = typeof store.getEntities === "function"
      ? await store.getEntities()
      : [];
    const relationships = typeof store.getRelationships === "function"
      ? await store.getRelationships()
      : [];
    if (entities.length === 0) return [];

    const { graph, nameIndex } = buildEntityGraph(entities, relationships);
    const terms = extractQueryTerms(query);
    // Resolve seed entity IDs using the name index
    const seedIds: number[] = [];
    for (const term of terms) {
      const id = nameIndex.get(term.toLowerCase());
      if (id !== undefined) seedIds.push(id);
    }
    // Fallback: name-match from entities array
    if (seedIds.length === 0) {
      for (const e of entities) {
        if (terms.some((t) => e.name.toLowerCase().includes(t.toLowerCase()))) {
          seedIds.push(e.id);
        }
      }
    }
    if (seedIds.length === 0) return [];

    const activation = spreadActivation(graph, seedIds, {
      decay: settings.SA_DECAY,
      threshold: settings.SA_THRESHOLD,
      maxDepth: settings.SA_MAX_DEPTH,
      maxNodes: settings.SA_MAX_NODES,
    });

    // Build entity→memoryIds map (stub: each entity maps to itself as memory proxy)
    const entityToMemoryIds = new Map<number, number[]>(
      Array.from(activation.keys()).map((eid) => [eid, [eid]]),
    );
    return mapEntityActivationToMemories(activation, entityToMemoryIds);
  } catch {
    return [];
  }
}

/**
 * Extract query terms for SA seed resolution.
 * Mirrors Python's extract_query_entities + token fallback.
 * source: cortex@ed33435 mcp_server/core/retrieval_signals.py:120-127
 */
function extractQueryTerms(query: string): string[] {
  const words = query.split(/\s+/).filter((w) => w.length > 2);
  const terms = new Set<string>(words);
  return Array.from(terms);
}
