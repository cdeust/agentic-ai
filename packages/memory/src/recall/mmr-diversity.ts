/**
 * MMR diversity reranking for summarization queries.
 *
 * Maximal Marginal Relevance (Carbonell & Goldstein, SIGIR 1998):
 * iteratively selects documents maximizing relevance to query while
 * minimizing redundancy with already-selected documents.
 *
 * Activated only for SUMMARIZATION intent to improve nugget coverage
 * in BEAM benchmark evaluation.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/mmr_diversity.py
 *
 * Citation:
 *   Carbonell, J. & Goldstein, J. (1998). "The Use of MMR,
 *   Diversity-Based Reranking for Reordering Documents and
 *   Producing Summaries." SIGIR 1998, pp. 335-336.
 */

import { dot, norm } from "../shared/linear-algebra.js";

// ── Cosine helpers ────────────────────────────────────────────────────────

/**
 * Cosine similarity between two float arrays.
 * source: cortex@ed33435 mcp_server/core/mmr_diversity.py:112-117
 */
function cosine(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0.0;
  return dot(a, b) / (na * nb);
}

/**
 * Cosine similarity of each vector in vecs against query.
 * source: cortex@ed33435 mcp_server/core/mmr_diversity.py:119-124
 */
function cosineBatch(vecs: number[][], query: number[]): number[] {
  const qNorm = norm(query);
  if (qNorm === 0) return vecs.map(() => 0.0);
  return vecs.map((v) => {
    const vNorm = norm(v);
    if (vNorm === 0) return 0.0;
    return dot(v, query) / (vNorm * qNorm);
  });
}

/**
 * Convert a Uint8Array of float32 bytes to a number array.
 * Returns null if conversion fails.
 * source: cortex@ed33435 mcp_server/core/mmr_diversity.py:100-109
 */
function toFloatArray(emb: Uint8Array | number[] | null | undefined): number[] | null {
  if (emb === null || emb === undefined) return null;
  if (Array.isArray(emb)) return emb;
  if (emb instanceof Uint8Array) {
    // Interpret as float32 little-endian
    try {
      const view = new DataView(emb.buffer, emb.byteOffset, emb.byteLength);
      const floats: number[] = [];
      for (let i = 0; i + 3 < emb.byteLength; i += 4) {
        floats.push(view.getFloat32(i, true));
      }
      return floats.length > 0 ? floats : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ── MMR rerank ────────────────────────────────────────────────────────────

/**
 * Rerank candidates via MMR for diversity.
 *
 * MMR score = lambda * sim(d_i, q) - (1-lambda) * max_{d_j in S} sim(d_i, d_j)
 *
 * precondition:  lambdaParam ∈ [0, 1]; topK >= 1.
 * postcondition: returned array length <= topK; items are a subset of
 *   candidates, selected greedily by MMR score.
 *
 * source: cortex@ed33435 mcp_server/core/mmr_diversity.py:23-97
 *   lambda_param default = 0.5 — balanced. Carbonell & Goldstein recommend
 *   0.3 for summarization, but 0.5 is safer without ablation.
 *   top_k default = 10
 */
export function mmrRerank(
  candidates: Record<string, unknown>[],
  queryEmbedding: Uint8Array | number[] | null | undefined,
  lambdaParam = 0.5, // source: cortex@ed33435 mcp_server/core/mmr_diversity.py:38 — default 0.5
  topK = 10,         // source: cortex@ed33435 mcp_server/core/mmr_diversity.py:40
): Record<string, unknown>[] {
  if (candidates.length <= 1 || queryEmbedding === null || queryEmbedding === undefined) {
    return candidates.slice(0, topK);
  }

  const qVec = toFloatArray(queryEmbedding);
  if (qVec === null) return candidates.slice(0, topK);

  const candVecs: number[][] = [];
  const validIndices: number[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c) continue;
    const v = toFloatArray(c["embedding"] as Uint8Array | number[] | null | undefined);
    if (v !== null) {
      candVecs.push(v);
      validIndices.push(i);
    }
  }

  if (candVecs.length === 0) return candidates.slice(0, topK);

  // Pre-compute query similarities
  const qSims = cosineBatch(candVecs, qVec);

  // Greedy MMR selection
  const selectedIdx: number[] = [];
  const remaining = new Set<number>(Array.from({ length: candVecs.length }, (_, i) => i));

  // Invariant: selectedIdx.length grows by 1 per iteration
  // Termination: min(topK, candVecs.length) iterations
  for (let _iter = 0; _iter < Math.min(topK, candVecs.length); _iter++) {
    let bestScore = -Infinity;
    let bestI = -1;

    for (const i of remaining) {
      const relevance = qSims[i] ?? 0;
      let maxSim = 0.0;
      if (selectedIdx.length > 0) {
        for (const j of selectedIdx) {
          const sim = cosine(candVecs[i]!, candVecs[j]!);
          if (sim > maxSim) maxSim = sim;
        }
      }
      // source: cortex@ed33435 mcp_server/core/mmr_diversity.py:85
      // MMR score = lambda * relevance - (1-lambda) * max_sim
      const score = lambdaParam * relevance - (1 - lambdaParam) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestI = i;
      }
    }

    if (bestI < 0) break;
    selectedIdx.push(bestI);
    remaining.delete(bestI);
  }

  return selectedIdx.map((i) => {
    const candidateIdx = validIndices[i];
    return candidates[candidateIdx!]!;
  });
}
