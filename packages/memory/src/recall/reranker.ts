/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Cross-encoder reranking.
 * Port of: mcp_server/core/reranker.py | Source SHA: cortex@ed33435
 */
// source: cortex@ed33435 mcp_server/core/reranker.py line 37; benchmark benchmarks/beam/ablation_results.json
const DEFAULT_ALPHA = 0.70;
// source: cortex@ed33435 mcp_server/core/reranker.py line 38 (hand-tuned)
const GATE_THRESHOLD = 0.15;
// source: cortex@ed33435 mcp_server/core/reranker.py line 39 (hand-tuned)
const SUPPRESSION = 0.1;
// source: cortex@ed33435 mcp_server/core/reranker.py line 141 (hand-tuned)
const MAX_ADAPTIVE_BOOST = 0.15;
// source: cortex@ed33435 mcp_server/core/reranker.py line 144 (SPREAD_LOW=0.3)
const SPREAD_LOW = 0.3;
// source: cortex@ed33435 mcp_server/core/reranker.py line 145 (SPREAD_NORM=0.7)
const SPREAD_NORM = 0.7;

export interface RerankPassage { id: number; text: string; }
export interface RerankScore { id: number; score: number; }
export interface FlashRankAdapter { rerank(q: string, p: RerankPassage[]): Promise<RerankScore[]>; }

/**
 * Port of: mcp_server/core/reranker.py::_compute_retrieval_confidence
 * source: cortex@ed33435 mcp_server/core/reranker.py lines 71-99
 */
export function computeRetrievalConfidence(ce: number[], gt = GATE_THRESHOLD, s = SUPPRESSION): number {
  return ce.length && Math.max(...ce) >= gt ? 1.0 : s;
}

/**
 * Port of: mcp_server/core/reranker.py::_compute_adaptive_alpha
 * source: cortex@ed33435 mcp_server/core/reranker.py lines 102-146
 * source: Shtok et al. (TOIS 2012) QPP
 */
export function computeAdaptiveAlpha(ce: number[], base: number): number {
  if (ce.length < 2) return base;
  const sp = Math.max(...ce) - Math.min(...ce);
  if (sp < SPREAD_LOW) return base;
  return Math.min(base + MAX_ADAPTIVE_BOOST * Math.min((sp - SPREAD_LOW) / SPREAD_NORM, 1.0), 1.0);
}

/**
 * Port of: mcp_server/core/reranker.py::_blend_scores
 * source: cortex@ed33435 mcp_server/core/reranker.py lines 149-190
 */
export function blendScores(cands: Array<[number,number]>, ce: Map<number,number>, alpha: number, adaptive = true): Array<[number,number]> {
  const raw = cands.map((_, i) => ce.get(i) ?? 0);
  const conf = computeRetrievalConfidence(raw);
  const ea = adaptive ? computeAdaptiveAlpha(raw, alpha) : alpha;
  const r = cands.map(([id,w],i) => [id, ((1-ea)*w + ea*(ce.get(i)??0))*conf] as [number,number]);
  return r.sort(([,a],[,b]) => b-a);
}

/**
 * Port of: mcp_server/core/reranker.py::rerank_results
 * source: cortex@ed33435 mcp_server/core/reranker.py lines 193-235
 */
export async function rerankResults(
  q: string, cands: Array<[number,number]>, cl: Map<number,string>,
  alpha = DEFAULT_ALPHA,
  // source: cortex@ed33435 mcp_server/core/reranker.py line 209 (max_content_len=1200)
  maxLen = 1200,
  adaptive = false,
  adapter: FlashRankAdapter | null = null,
): Promise<Array<[number,number]>> {
  if (!adapter || !cands.length) return cands;
  try {
    const p = cands.map(([id],i) => ({ id: i, text: (cl.get(id) ?? "").slice(0, maxLen) }));
    const res = await adapter.rerank(q, p);
    return blendScores(cands, new Map(res.map(r => [r.id, r.score])), alpha, adaptive);
  } catch { return cands; }
}

/** Synchronous rerank with pre-computed CE scores. */
export function rerankWithScores(cands: Array<[number,number]>, ce: Map<number,number>, alpha = DEFAULT_ALPHA, adaptive = false): Array<[number,number]> {
  return blendScores(cands, ce, alpha, adaptive);
}
