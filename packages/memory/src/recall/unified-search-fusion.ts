/**
 * Phase 3 (ADR-0046) — Reciprocal Rank Fusion for unified search.
 *
 * Merges two (or more) ranked result lists from independent retrievers —
 * Cortex memory recall and AP code-symbol search — into a single list
 * ordered by aggregated relevance.
 *
 * RRF formula: score(d) = sum_{r in retrievers} 1 / (K + rank_r(d))
 *
 * Pure logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/unified_search_fusion.py
 *
 * Source: Cormack, Clarke, Büttcher (2009) "Reciprocal Rank Fusion
 * Outperforms Condorcet and Individual Rank Learning Methods", SIGIR.
 */

// Matches pg_recall default; see Cormack (2009) for the empirical basis.
// K=60 is used for WRRF inside pg_recall (settings.WRRF_K), so
// Phase 3 is consistent with the rest of the retrieval stack.
// source: cortex@ed33435 mcp_server/core/unified_search_fusion.py:30
export const DEFAULT_K = 60;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Return the string id of an item, or null if missing.
 * source: cortex@ed33435 mcp_server/core/unified_search_fusion.py:33-35
 */
function idOf(item: Record<string, unknown>, idKey: string): string | null {
  const v = item[idKey];
  return v !== null && v !== undefined ? String(v) : null;
}

// ── RRF fusion ────────────────────────────────────────────────────────────

/**
 * RRF-merge two or more ranked lists into one.
 *
 * rankedLists is [[sourceName, results], ...]. Each result must expose
 * an idKey field used as the identity for fusion — duplicates across
 * lists are collapsed.
 *
 * When a result appears in more than one list, the merged record keeps
 * the first-seen body but records per-source ranks so the UI can explain
 * why it ranked where it did.
 *
 * Items lacking idKey are skipped silently.
 *
 * precondition:  k >= 1; each result list is ordered from most to least relevant.
 * postcondition: returned array is sorted by (−rrf_score, −source_count, id);
 *   deterministic across runs.
 *   Length <= topN if topN is specified.
 *
 * source: cortex@ed33435 mcp_server/core/unified_search_fusion.py:38-97
 *   K default = 60 (Cormack et al. 2009 experimental finding)
 *   RRF formula: delta = 1 / (k + rank), rank is 1-indexed
 */
export function fuse(
  rankedLists: Array<[string, Record<string, unknown>[]]>,
  k = DEFAULT_K,
  idKey = "id",
  topN: number | null = null,
): Record<string, unknown>[] {
  const scores = new Map<string, number>();
  const bodies = new Map<string, Record<string, unknown>>();
  const sourceRanks = new Map<string, Record<string, number>>();

  for (const [sourceName, results] of rankedLists) {
    results.forEach((item, zeroIdx) => {
      const rank = zeroIdx + 1; // 1-indexed per RRF formula
      const ident = idOf(item, idKey);
      if (ident === null) return;

      const delta = 1.0 / (k + rank);
      scores.set(ident, (scores.get(ident) ?? 0.0) + delta);

      if (!bodies.has(ident)) {
        bodies.set(ident, { ...item });
      }

      const sr = sourceRanks.get(ident) ?? {};
      sr[sourceName] = rank;
      sourceRanks.set(ident, sr);
    });
  }

  const merged: Record<string, unknown>[] = [];
  for (const [ident, score] of scores) {
    const body = bodies.get(ident) ?? {};
    merged.push({
      ...body,
      [idKey]: ident,
      rrf_score: Math.round(score * 1e6) / 1e6,
      source_ranks: sourceRanks.get(ident) ?? {},
    });
  }

  // source: cortex@ed33435 mcp_server/core/unified_search_fusion.py:91-93
  // Sort by (-rrf_score, -source_count, id) for determinism
  merged.sort((a, b) => {
    const scoreDiff = (b["rrf_score"] as number) - (a["rrf_score"] as number);
    if (scoreDiff !== 0) return scoreDiff;
    const aRanks = Object.keys(a["source_ranks"] as object).length;
    const bRanks = Object.keys(b["source_ranks"] as object).length;
    const rankDiff = bRanks - aRanks;
    if (rankDiff !== 0) return rankDiff;
    return String(a[idKey]).localeCompare(String(b[idKey]));
  });

  if (topN !== null && topN >= 0) {
    return merged.slice(0, topN);
  }
  return merged;
}
