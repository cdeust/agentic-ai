/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Post-WRRF recall pipeline stages — paper-first-class reordering steps.
 * Part 1 of 2 (stages: HOPFIELD, HDC, SPREADING_ACTIVATION, DENDRITIC_CLUSTERS).
 *
 * Port of: cortex@ed33435 mcp_server/core/recall_pipeline.py:1-533
 *
 * Each stage takes a candidates list (the output of the PG WRRF fusion) and
 * returns a possibly-reordered/expanded list. Stages are gated by
 * isMechanismDisabled so an ablation run returns the input unchanged.
 *
 * Blending strategy: Reciprocal Rank Fusion (Cormack, Clarke & Buettcher,
 * SIGIR 2009). Each mechanism contributes a rank vector; we combine the
 * existing WRRF rank with the new mechanism's rank via
 *   score = (1-beta)/(k+rel_rank) + beta/(k+mech_rank)
 * with k=60 (paper default) and beta in [0.0, 0.5].
 *
 * Dendritic clusters use a multiplicative factor instead of a rank because
 * Poirazi, Brannon & Mel (2003) describe soma output as a multiplicative
 * nonlinearity g(x) = scale * x / (1 + offset * exp(-steepness * x)),
 * not a rank fusion. We apply a bounded factor in [0.9, 1.1].
 *
 * Pure business logic — operates on candidate dicts, takes store/embeddings
 * as parameters. No I/O.
 */

import { buildPatternMatrix, retrieve as hopfieldRetrieve } from "./hopfield.js";
import { computeHdcScores } from "./hdc-encoder.js";

// ── Ablation gate ─────────────────────────────────────────────────────────

/**
 * Returns true when CORTEX_ABLATE_<MECH>=1 in the environment.
 * Port of: cortex@ed33435 mcp_server/core/ablation.py::is_mechanism_disabled
 */
function isMechanismDisabled(mech: string): boolean {
  if (typeof process === "undefined") return false;
  return process.env[`CORTEX_ABLATE_${mech}`] === "1";
}

// ── Constants ─────────────────────────────────────────────────────────────

// RRF constant from Cormack et al. (SIGIR 2009). The paper recommends k=60
// as a robust default across heterogeneous rankers.
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py:38
const _RRF_K = 60;

function envFloat(name: string, defaultVal: number): number {
  if (typeof process === "undefined") return defaultVal;
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultVal;
  const n = parseFloat(raw);
  return isNaN(n) ? defaultVal : n;
}

// Per-mechanism blend weights.
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py:81-83
// Calibration outcome: tasks/blend-weight-calibration.md Results §A (2026-05-02)
const _HOPFIELD_BETA = envFloat(
  "CORTEX_HOPFIELD_BETA",
  0.30, // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:82 — confirmed near-optimum
);
const _HDC_BETA = envFloat(
  "CORTEX_HDC_BETA",
  0.20, // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:85 — confirmed near-optimum
);
const _SA_BETA = envFloat(
  "CORTEX_SA_BETA",
  0.25, // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:88 — confirmed near-optimum
);

// Dendritic multiplicative range — bounded perturbation from Poirazi (2003)
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py:95-97
const _DENDRITIC_DELTA = envFloat(
  "CORTEX_DENDRITIC_DELTA",
  0.10, // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:97 — confirmed near-optimum
);

// ── Types ─────────────────────────────────────────────────────────────────

export interface Candidate {
  memory_id: number;
  content?: string;
  score: number;
  heat?: number;
  domain?: string;
  tags?: string[] | string;
  created_at?: string;
  emotional_valence?: number;
  _sa_injected?: boolean;
  [key: string]: unknown;
}

export interface CandidateStore {
  getEmbeddingsForMemories?(
    ids: number[],
  ): Record<number, Uint8Array | number[]> | Promise<Record<number, Uint8Array | number[]>>;
  getMemory?(
    id: number,
  ): Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  spreadActivationMemories?(params: {
    query_terms: string[];
    decay: number;
    threshold: number;
    max_depth: number;
    max_results: number;
    min_heat: number;
  }): Array<[number, number]> | Promise<Array<[number, number]>>;
  getEntityByName?(
    name: string,
  ): { id: number } | null | Promise<{ id: number } | null>;
  getEntityIdsForMemories?(
    ids: number[],
  ): Record<number, Set<number>> | Promise<Record<number, Set<number>>>;
}

// ── RRF blend helper ──────────────────────────────────────────────────────

/**
 * Blend the existing candidate order with a mechanism's rank vector.
 *
 * Port of: cortex@ed33435 mcp_server/core/recall_pipeline.py:136-166
 *
 * mechRanks maps memory_id → rank within the mechanism's output (0 = best).
 * Candidates absent from mechRanks keep their relevance rank only.
 *
 * precondition: beta in [0, 1]; candidates is non-empty
 * postcondition: result is same-length as candidates, sorted descending by new score
 *
 * source: Cormack, Clarke & Buettcher (SIGIR 2009)
 *   k=60, formula: (1-beta)/(k+rel_rank) + beta/(k+mech_rank)
 */
export function rrfBlend(
  candidates: Candidate[],
  mechRanks: Map<number, number>,
  beta: number,
  k = _RRF_K,
): Candidate[] {
  if (candidates.length === 0 || beta <= 0.0) return candidates;

  const n = candidates.length;
  const fallbackRank = n; // absent from mech ranking → demote, don't disqualify

  const scored: Array<[number, Candidate]> = candidates.map((c, relRank) => {
    const mRank = mechRanks.get(c.memory_id) ?? fallbackRank;
    const newScore =
      (1.0 - beta) / (k + relRank) + beta / (k + mRank);
    return [newScore, { ...c, score: newScore }];
  });

  scored.sort(([a], [b]) => b - a);
  return scored.map(([, c]) => c);
}

// ── HOPFIELD stage ────────────────────────────────────────────────────────
// Ramsauer et al. (2021), "Hopfield Networks Is All You Need." ICLR 2021.
// Modern Hopfield retrieval = softmax(beta * X · query) attention.

/**
 * Reorder candidates by Hopfield attention rank, RRF-blended with WRRF.
 *
 * Port of: cortex@ed33435 mcp_server/core/recall_pipeline.py:174-239
 *
 * The Hopfield pattern matrix is built from the candidates' own embeddings
 * (fetched from the store in one bulk PG call). Falls back to per-id
 * get_memory only if the bulk method is absent.
 *
 * precondition: candidates is non-empty; qEmb is valid or null
 * postcondition: result is same or expanded set, sorted by blended score;
 *   returns input unchanged when ablated or qEmb is null or no pairs found
 *
 * Constants — source: cortex@ed33435 mcp_server/core/recall_pipeline.py:174-181
 *   hopfield_beta (Hopfield softmax temp) = 8.0
 *   blend_beta                            = _HOPFIELD_BETA = 0.30
 */
export async function hopfieldComplete(
  candidates: Candidate[],
  qEmb: number[] | null,
  store: CandidateStore | null,
  embeddingDim: number,
  hopfieldBeta = 8.0,          // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:181
  blendBeta = _HOPFIELD_BETA,
): Promise<Candidate[]> {
  if (isMechanismDisabled("HOPFIELD")) return candidates;
  if (candidates.length === 0 || qEmb === null) return candidates;
  if (store === null) return candidates;

  const ids = candidates.map((c) => c.memory_id);
  const pairs: Array<[number, number[]]> = [];

  if (typeof store.getEmbeddingsForMemories === "function") {
    const embById = await store.getEmbeddingsForMemories(ids);
    for (const mid of ids) {
      const emb = embById[mid];
      if (emb) {
        const arr = emb instanceof Uint8Array ? Array.from(emb) : (emb as number[]);
        pairs.push([mid, arr]);
      }
    }
  } else if (typeof store.getMemory === "function") {
    for (const mid of ids) {
      const mem = await store.getMemory(mid);
      if (mem && mem["embedding"]) {
        const emb = mem["embedding"];
        const arr = emb instanceof Uint8Array
          ? Array.from(emb as Uint8Array)
          : (emb as number[]);
        pairs.push([mid, arr]);
      }
    }
  }

  if (pairs.length === 0) return candidates;

  void embeddingDim; // dimension inferred from embeddings by buildPatternMatrix
  const patternMat = buildPatternMatrix(pairs);
  if (patternMat.rows.length === 0) return candidates;

  const hop = hopfieldRetrieve(qEmb, patternMat, hopfieldBeta, patternMat.rows.length);
  if (hop.length === 0) return candidates;

  const mechRanks = new Map<number, number>(
    hop.map(([mid], rank): [number, number] => [mid, rank]),
  );
  return rrfBlend(candidates, mechRanks, blendBeta);
}

// ── HDC stage ─────────────────────────────────────────────────────────────
// Kanerva (2009), "Hyperdimensional Computing." Cognitive Computation 1(2).
// Bipolar (+1/-1) random hypervectors with bind/bundle algebra.

/**
 * Reorder candidates by HDC similarity, RRF-blended with WRRF.
 *
 * Port of: cortex@ed33435 mcp_server/core/recall_pipeline.py:247-276
 *
 * Each candidate's content is encoded as a bipolar hypervector;
 * HDC similarity = dot/dim.
 *
 * precondition: candidates is non-empty
 * postcondition: returns input unchanged when ablated or no HDC scores
 *
 * Constants — source: cortex@ed33435 mcp_server/core/recall_pipeline.py:251
 *   blend_beta = _HDC_BETA = 0.20
 *   threshold  = -1.0 (keep all ranks)
 */
export function hdcRerank(
  candidates: Candidate[],
  query: string,
  blendBeta = _HDC_BETA,
): Candidate[] {
  if (isMechanismDisabled("HDC")) return candidates;
  if (candidates.length === 0) return candidates;

  // HDC_DIM default (1024) — dim, then threshold=-1.0 to keep all ranks
  // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:271
  const contentPairs: Array<[number, string]> = candidates.map((c) => [
    c.memory_id,
    (c.content ?? ""),
  ]);
  // source: cortex@ed33435 mcp_server/core/hdc_encoder.py:27 HDC_DIM=1024
  const hdc = computeHdcScores(query, contentPairs, 1024, -1.0); // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:271 threshold=-1.0
  if (hdc.length === 0) return candidates;

  const mechRanks = new Map<number, number>(
    hdc.map(([mid], rank) => [mid, rank]),
  );
  return rrfBlend(candidates, mechRanks, blendBeta);
}

// ── SPREADING_ACTIVATION stage ────────────────────────────────────────────
// Collins & Loftus (1975), "A Spreading-Activation Theory of Semantic
// Processing." Psychological Review 82(6).

/**
 * Expand the candidate pool with SA-reachable memories, then RRF blend.
 *
 * Port of: cortex@ed33435 mcp_server/core/recall_pipeline.py:285-365
 *
 * Calls spread_activation_memories PL/pgSQL stored procedure (server-side
 * BFS over the entity graph). Memories already in candidates get an SA rank;
 * new ones are appended at the bottom before RRF blending.
 *
 * precondition: store.spreadActivationMemories exists or is silently skipped
 * postcondition: result may be longer than input (new SA-discovered memories
 *   appended); sorted by blended score; returns input unchanged when ablated
 *
 * Constants — source: cortex@ed33435 mcp_server/core/recall_pipeline.py:285-295
 *   decay      = 0.65
 *   threshold  = 0.1
 *   max_depth  = 3
 *   max_results = 50
 *   min_heat   = 0.05
 *   blend_beta = _SA_BETA = 0.25
 */
export async function spreadingActivationExpand(
  candidates: Candidate[],
  query: string,
  store: CandidateStore | null,
  decay = 0.65,      // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:290
  threshold = 0.1,   // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:291
  maxDepth = 3,      // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:292
  maxResults = 50,   // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:293
  minHeat = 0.05,    // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:294
  blendBeta = _SA_BETA,
): Promise<Candidate[]> {
  if (isMechanismDisabled("SPREADING_ACTIVATION")) return candidates;
  if (candidates.length === 0) return candidates;
  if (store === null || typeof store.spreadActivationMemories !== "function") {
    return candidates;
  }

  const terms = extractQueryTerms(query);
  if (terms.length === 0) return candidates;

  let sa: Array<[number, number]>;
  try {
    sa = await store.spreadActivationMemories({
      query_terms: terms,
      decay,
      threshold,
      max_depth: maxDepth,
      max_results: maxResults,
      min_heat: minHeat,
    });
  } catch {
    return candidates;
  }
  if (!sa || sa.length === 0) return candidates;

  const existingIds = new Set<number>(candidates.map((c) => c.memory_id));
  const expanded: Candidate[] = [...candidates];

  // Append SA-discovered memories not already in the candidate pool.
  for (const [mid] of sa) {
    if (existingIds.has(mid)) continue;
    if (typeof store.getMemory !== "function") continue;
    let mem: Record<string, unknown> | null;
    try {
      mem = await store.getMemory(mid);
    } catch {
      continue;
    }
    if (!mem) continue;
    expanded.push({
      memory_id: mid,
      content: (mem["content"] as string | undefined) ?? "",
      score: 0.0, // will be set by RRF blend
      heat: (mem["heat"] as number | undefined) ?? 0.0,
      domain: (mem["domain"] as string | undefined) ?? "",
      tags: (mem["tags"] as string[] | string | undefined) ?? [],
      created_at: (mem["created_at"] as string | undefined) ?? "",
      _sa_injected: true,
    });
    existingIds.add(mid);
  }

  const mechRanks = new Map<number, number>(
    sa.map(([mid], rank) => [mid, rank]),
  );
  return rrfBlend(expanded, mechRanks, blendBeta);
}

// ── DENDRITIC_CLUSTERS stage helpers ─────────────────────────────────────

function candidateEntities(c: Candidate): Set<string> {
  const content = (c.content ?? "").toLowerCase();
  return new Set(
    content.split(/\s+/).map((t) => t.replace(/[.,!?;:()[\]{}"'`]/g, "")).filter((t) => t.length > 2),
  );
}

function candidateTags(c: Candidate): Set<string> {
  const tags = c.tags;
  if (!tags) return new Set();
  if (Array.isArray(tags)) return new Set(tags.map(String));
  return new Set([String(tags)]);
}

async function resolveQueryEntityIds(
  query: string,
  store: CandidateStore,
): Promise<Set<number>> {
  if (typeof store.getEntityByName !== "function") return new Set();
  const ids = new Set<number>();
  const seenNames = new Set<string>();

  // Stage 1: CamelCase / paths / backtick patterns
  const highPrecisionTerms = extractHighPrecisionTerms(query);
  for (const name of highPrecisionTerms) {
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    try {
      const row = await store.getEntityByName(name);
      if (row?.id !== undefined) ids.add(row.id);
    } catch { /* non-load-bearing */ }
  }

  // Stage 2: natural-language token fallback (length >= 4)
  try {
    const tokens = query.split(/\s+/).filter((t) => t.length >= 4);
    for (const token of tokens) {
      if (seenNames.has(token)) continue;
      seenNames.add(token);
      const row = await store.getEntityByName(token);
      if (row?.id !== undefined) ids.add(row.id);
    }
  } catch { /* non-load-bearing */ }

  return ids;
}

/**
 * High-precision entity extraction: CamelCase, slash paths, backtick spans.
 * Mirrors mcp_server/core/query_decomposition.extract_query_entities.
 */
function extractHighPrecisionTerms(query: string): string[] {
  const terms = new Set<string>();
  // CamelCase
  for (const m of query.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g)) {
    terms.add(m[0]);
  }
  // Backtick code spans
  for (const m of query.matchAll(/`([^`]+)`/g)) {
    if (m[1]) terms.add(m[1]);
  }
  // Slash paths
  for (const m of query.matchAll(/\b[\w-]+(?:\/[\w-]+)+\b/g)) {
    terms.add(m[0]);
  }
  return Array.from(terms);
}

function jaccardSim(a: Set<number | string>, b: Set<number | string>): number {
  if (a.size === 0 && b.size === 0) return 0.0;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}

// ── DENDRITIC_CLUSTERS stage ──────────────────────────────────────────────
// Poirazi, Brannon & Mel (2003), "Pyramidal Neuron as a Two-Layer Neural
// Network." Neuron 37:989-999. Branch subunit + soma nonlinearity.

/**
 * Apply branch-affinity multiplicative modulation to candidate scores.
 *
 * Port of: cortex@ed33435 mcp_server/core/recall_pipeline.py:448-532
 *
 * Computes weighted Jaccard affinity (0.7 entity + 0.3 tag — same weights
 * as dendritic_clusters.compute_branch_affinity). The score is multiplied
 * by 1 + delta * (2 * affinity - 1) so:
 *   affinity 0.0 → factor 1 - delta
 *   affinity 0.5 → factor 1.0
 *   affinity 1.0 → factor 1 + delta
 *
 * precondition: candidates is non-empty; delta >= 0
 * postcondition: each score multiplied by factor in [1-delta, 1+delta];
 *   result sorted descending by new score; returns input unchanged when ablated
 *
 * Constants — source: cortex@ed33435 mcp_server/core/recall_pipeline.py:453
 *   entity weight = 0.7
 *   tag weight    = 0.3
 *   delta         = _DENDRITIC_DELTA = 0.10
 */
export async function dendriticModulate(
  candidates: Candidate[],
  query: string,
  store: CandidateStore | null = null,
  delta = _DENDRITIC_DELTA,
): Promise<Candidate[]> {
  if (isMechanismDisabled("DENDRITIC_CLUSTERS")) return candidates;
  if (candidates.length === 0 || delta <= 0.0) return candidates;

  // Try real entity-graph path first
  let qEids = new Set<number>();
  let entIdByMem = new Map<number, Set<number>>();
  if (store !== null && typeof store.getEntityIdsForMemories === "function") {
    qEids = await resolveQueryEntityIds(query, store);
    if (qEids.size > 0) {
      const ids = candidates.map((c) => c.memory_id);
      const raw = await store.getEntityIdsForMemories(ids);
      entIdByMem = new Map(
        Object.entries(raw).map(([k, v]) => [parseInt(k, 10), v]),
      );
    }
  }

  // Token-proxy query set
  const qTokens = new Set<string>(
    query.split(/\s+/)
      .map((t) => t.replace(/[.,!?;:()[\]{}"'`]/g, "").toLowerCase())
      .filter((t) => t.length > 2),
  );

  if (qTokens.size === 0 && qEids.size === 0) return candidates;

  const modulated: Candidate[] = candidates.map((c) => {
    let entSim: number;
    if (qEids.size > 0) {
      const cEids = entIdByMem.get(c.memory_id) ?? new Set<number>();
      entSim = cEids.size > 0 ? jaccardSim(qEids as Set<number | string>, cEids as Set<number | string>) : 0.0;
    } else {
      const cEntities = candidateEntities(c);
      entSim = cEntities.size > 0 ? jaccardSim(qTokens, cEntities) : 0.0;
    }

    const cTags = candidateTags(c);
    const tagSim =
      cTags.size > 0 && qTokens.size > 0
        ? jaccardSim(qTokens, cTags)
        : 0.0;

    // source: cortex@ed33435 mcp_server/core/recall_pipeline.py:525
    const affinity = 0.7 * entSim + 0.3 * tagSim;
    const factor = 1.0 + delta * (2.0 * affinity - 1.0);
    return { ...c, score: (c.score ?? 0.0) * factor };
  });

  modulated.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return modulated;
}

// ── Utilities ─────────────────────────────────────────────────────────────

function extractQueryTerms(query: string): string[] {
  return Array.from(
    new Set(query.split(/\s+/).filter((w) => w.length > 2)),
  );
}

// Re-export constants for testing
export {
  _RRF_K as RRF_K,
  _HOPFIELD_BETA as HOPFIELD_BETA,
  _HDC_BETA as HDC_BETA,
  _SA_BETA as SA_BETA,
  _DENDRITIC_DELTA as DENDRITIC_DELTA,
};
