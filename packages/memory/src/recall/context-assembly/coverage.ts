/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Submodular coverage selection for Phase 1 own-stage retrieval.
 *
 * Replaces "top-k by score" with greedy submodular coverage: each new
 * chunk is picked to maximize marginal information gain given what has
 * already been selected. Directly addresses the "near-duplicate top-k"
 * failure mode observed at BEAM-10M scale, where the 5 highest-scored
 * chunks are often substrings of each other.
 *
 * Paper backing:
 *   Krause & Guestrin, "Near-Optimal Sensor Placements in Gaussian
 *   Processes", JMLR 9:235-284 (2008). Proves that for a monotone
 *   submodular set function f, the greedy algorithm returns S_k with
 *   f(S_k) >= (1 - 1/e) * f(S*_k) ≈ 0.63 * optimal. Also introduces
 *   the lazy greedy acceleration (Minoux 1978) that makes selection
 *   nearly O(n log n) instead of O(n^2).
 *
 * Applied here: marginal relevance = score - λ * max_similarity(c, S)
 * where similarity is cosine over embeddings. This is the Carbonell &
 * Goldstein MMR (1998) objective, which is submodular when λ < 1.
 *
 * source: Cortex mcp_server/core/context_assembly/coverage.py
 */

import { estimateTokens } from "./budget.js";

/** Candidate record shape expected by submodularSelect. */
export interface Candidate extends Record<string, unknown> {
  score?: number;
  content?: string;
  embedding?: number[] | Float32Array | null;
}

/**
 * Greedy submodular selection, optionally within a token budget.
 *
 * Selection is driven by maxChunks first. tokenBudget is an
 * OPTIONAL soft upper bound — when undefined, the function always picks
 * maxChunks items regardless of total tokens.
 *
 * When both maxChunks and tokenBudget are set, the function stops
 * at whichever is reached first. When tokenBudget is undefined, only
 * maxChunks applies.
 *
 * @param candidates - list of candidate dicts, pre-scored by the retriever.
 * @param tokenBudget - soft upper bound on total tokens. undefined = ignore.
 * @param diversityLambda - MMR diversity weight in [0, 1]. 0 = pure
 *   relevance (top-k), 1 = pure diversity.
 * @param maxChunks - hard cap on number of selected chunks.
 * @param scoreKey / contentKey / embeddingKey - field names.
 */
export function submodularSelect<T extends Candidate>(
  candidates: T[],
  {
    tokenBudget,
    diversityLambda = 0.5,
    maxChunks = 5,
    scoreKey = "score",
    contentKey = "content",
    embeddingKey = "embedding",
  }: {
    tokenBudget?: number;
    diversityLambda?: number;
    maxChunks?: number;
    scoreKey?: string;
    contentKey?: string;
    embeddingKey?: string;
  } = {},
): T[] {
  if (candidates.length === 0) return [];

  // Normalize candidates to embeddings (null for candidates without one)
  const embeddings: Array<Float32Array | null> = candidates.map((c) => {
    const raw = c[embeddingKey];
    if (raw == null) return null;
    if (raw instanceof Float32Array) return raw;
    if (Array.isArray(raw)) return new Float32Array(raw as number[]);
    return null;
  });

  const scores = candidates.map((c) => Number(c[scoreKey] ?? 0));
  const tokenCounts = candidates.map((c) =>
    estimateTokens(String(c[contentKey] ?? "")),
  );

  const selected: number[] = [];
  const selectedEmbs: Float32Array[] = [];
  let usedTokens = 0;

  while (selected.length < maxChunks) {
    let bestI = -1;
    let bestGain = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      if (selected.includes(i)) continue;
      const tokI = tokenCounts[i] ?? 0;
      if (tokenBudget !== undefined && usedTokens + tokI > tokenBudget) {
        continue;
      }

      // Marginal relevance = score - λ * max sim to already-selected
      let penalty = 0;
      const embI = embeddings[i] ?? null;
      if (selectedEmbs.length > 0 && embI !== null) {
        const sims = selectedEmbs.map((s) => cosineSim(embI, s));
        penalty = sims.length > 0 ? Math.max(...sims) : 0;
      }
      const gain = (scores[i] ?? 0) - diversityLambda * penalty;

      if (gain > bestGain) {
        bestGain = gain;
        bestI = i;
      }
    }

    if (bestI < 0) break; // No candidate fits budget
    selected.push(bestI);
    const selectedEmb = embeddings[bestI] ?? null;
    if (selectedEmb !== null) {
      selectedEmbs.push(selectedEmb);
    }
    usedTokens += tokenCounts[bestI] ?? 0;
  }

  // Return in original ranking order for readability
  const selectedSorted = [...selected].sort((a, b) => a - b);
  const result: T[] = [];
  for (const i of selectedSorted) {
    const c = candidates[i];
    if (c !== undefined) result.push(c);
  }
  return result;
}

// ── Helper ───────────────────────────────────────────────────────────────

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8); // source: standard cosine-similarity numerical stability epsilon, Cortex coverage.py::cosineSim
}
