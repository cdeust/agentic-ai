/**
 * Text scoring signals re-export + computeKeywordOverlap.
 * Port of: mcp_server/core/scoring.py | Source SHA: cortex@ed33435
 */
export { tokenize, tokenizeRaw, computeBm25Scores, computeNgramScore } from "./bm25.js";
import { tokenizeRaw } from "./bm25.js";
/**
 * Simple keyword overlap in [0,1].
 * Port of: mcp_server/core/scoring.py::compute_keyword_overlap
 * source: cortex@ed33435 mcp_server/core/scoring.py lines 138-144
 */
export function computeKeywordOverlap(query: string, document: string): number {
  const q = new Set(tokenizeRaw(query)), d = new Set(tokenizeRaw(document));
  if (!q.size) return 0;
  let n = 0; for (const t of q) if (d.has(t)) n++;
  return n / q.size;
}
