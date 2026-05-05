/**
 * Core: sleep_compute — deep consolidation (dream replay).
 *
 * Biologically inspired offline consolidation pass:
 *   1. Dream replay:  re-process hot memories through enrichment pipeline
 *   2. Cluster summarization: synthesize text summaries for fractal L1/L2 clusters
 *   3. Re-embedding:  re-encode stale/compressed memories with current encoder
 *   4. Auto-narration: generate a brief project narrative and store as semantic memory
 *
 * Port of: mcp_server/core/sleep_compute.py
 * Pure business logic — no I/O.  All storage is done by the caller (consolidate handler).
 */

import { buildEnrichedContent } from "../wiki/enrichment.js";

// ── Dream Replay ──────────────────────────────────────────────────────────────

/**
 * Re-process the hottest memories through query-enrichment.
 *
 * Returns a list of update objects: {memory_id, enriched_content}.
 * Caller is responsible for persisting these.
 *
 * Precondition: memories is an array of memory objects.
 * Postcondition: each result object refers to an id from memories;
 *   enriched_content !== original content (only changed memories returned).
 */
export function dreamReplay(
  memories: Record<string, unknown>[],
  maxMemories: number = 50,
): Array<{ memory_id: unknown; enriched_content: string }> {
  const hot = [...memories]
    .sort((a, b) => ((b["heat"] as number) ?? 0) - ((a["heat"] as number) ?? 0))
    .slice(0, maxMemories);

  const updates: Array<{ memory_id: unknown; enriched_content: string }> = [];
  for (const mem of hot) {
    const content = (mem["content"] ?? "") as string;
    if (!content || content.length < 30) continue;
    // Skip already-enriched content to avoid double-appending
    if (content.includes("<!-- doc2query -->")) continue;

    const enriched = buildEnrichedContent(content);
    if (enriched !== content) {
      updates.push({ memory_id: mem["id"], enriched_content: enriched });
    }
  }
  return updates;
}

// ── Cluster Summarization ─────────────────────────────────────────────────────

function centroidSentence(texts: string[]): string {
  if (texts.length === 0) return "";
  if (texts.length === 1) return (texts[0] ?? "").slice(0, 200);

  function tokens(t: string): Set<string> {
    return new Set(Array.from(t.toLowerCase().matchAll(/[a-zA-Z]{3,}/g)).map((m) => m[0]));
  }

  const allWords = new Set<string>();
  for (const t of texts) {
    for (const w of tokens(t)) allWords.add(w);
  }

  let bestText = texts[0] ?? "";
  let bestScore = -1;
  for (const t of texts) {
    const toks = tokens(t);
    const overlap = Array.from(toks).filter((w) => allWords.has(w)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestText = t;
    }
  }
  return bestText.slice(0, 200);
}

/**
 * Generate text summaries for a list of cluster objects.
 *
 * Each cluster object must have: {cluster_id, level, memories: [...]}.
 * Returns list of {cluster_id, level, summary, memory_count}.
 *
 * Precondition: clusters is an array.
 * Postcondition: each result has cluster_id, level, summary (non-empty string), memory_count.
 */
export function summarizeClusters(
  clusters: Record<string, unknown>[],
): Array<{ cluster_id: unknown; level: unknown; summary: string; memory_count: number }> {
  const results = [];
  for (const cluster of clusters) {
    const mems = (cluster["memories"] ?? []) as Record<string, unknown>[];
    const texts = mems
      .map((m) => (m["content"] ?? "") as string)
      .filter((t) => t.length > 0);
    if (texts.length === 0) continue;

    const summary = `[${texts.length} memories] ${centroidSentence(texts)}`;
    results.push({
      cluster_id: cluster["cluster_id"],
      level: cluster["level"] ?? 1,
      summary,
      memory_count: texts.length,
    });
  }
  return results;
}

// ── Re-embedding ──────────────────────────────────────────────────────────────

/**
 * Return memories that should be re-embedded.
 *
 * Criteria:
 *   - embedding is null / missing
 *   - compression_level > 0 (content changed after compression)
 *   - content hash doesn't match stored hash (if available)
 *
 * Precondition: memories is an array of memory objects.
 * Postcondition: each returned memory lacks a valid embedding or needs re-embedding.
 */
export function selectStaleEmbeddings(
  memories: Record<string, unknown>[],
  maxMemories: number = 100,
): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  for (const mem of memories) {
    if (!mem["embedding"]) {
      candidates.push(mem);
      continue;
    }
    if (
      (mem["compression_level"] as number | undefined ?? 0) > 0 &&
      !mem["reembedded_after_compression"]
    ) {
      candidates.push(mem);
      continue;
    }
  }
  return candidates.slice(0, maxMemories);
}

// ── Auto-narration ────────────────────────────────────────────────────────────

const FILLER_RE = /\b(the|a|an|is|are|was|were|this|that|it|be|been|being)\b/gi;

function keywordFrequency(texts: string[], topN: number = 10): Array<[string, number]> {
  const freq = new Map<string, number>();
  for (const text of texts) {
    const words = Array.from(text.toLowerCase().matchAll(/[a-zA-Z]{4,}/g)).map((m) => m[0]);
    for (const w of words) {
      FILLER_RE.lastIndex = 0;
      if (!FILLER_RE.test(w)) {
        freq.set(w, (freq.get(w) ?? 0) + 1);
      }
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
}

function memoryTimestamp(m: Record<string, unknown>): number {
  const raw = (m["created_at"] ?? "") as string;
  if (!raw) return 0.0;
  try {
    const dt = new Date(raw);
    return isNaN(dt.getTime()) ? 0.0 : dt.getTime();
  } catch {
    return 0.0;
  }
}

function buildNarrationProse(
  memories: Record<string, unknown>[],
  keywords: Array<[string, number]>,
  directory: string,
  periodLabel: string,
): string {
  const kwPhrase =
    keywords.length > 0 ? keywords.slice(0, 5).map(([kw]) => kw).join(", ") : "various topics";
  const label = directory || "this project";

  const lines: string[] = [
    `During ${periodLabel}, ${memories.length} memories were stored for ${label}.`,
    `Key themes: ${kwPhrase}.`,
  ];

  const byImportance = [...memories].sort(
    (a, b) => ((b["importance"] as number) ?? 0) - ((a["importance"] as number) ?? 0),
  );
  if (byImportance.length > 0) {
    const top = (((byImportance[0] ?? {})["content"] ?? "") as string).slice(0, 120);
    lines.push(`Most important: "${top}"`);
  }

  return lines.join(" ");
}

export interface NarrationResult {
  narrative_text: string;
  keyword_summary: Array<{ keyword: string; count: number }>;
  memory_count: number;
  period: string;
}

/**
 * Generate a brief narrative from memory contents.
 *
 * Returns {narrative_text, keyword_summary, memory_count, period}.
 *
 * Precondition: memories is an array (may be empty).
 * Postcondition: memory_count === memories.length.
 */
export function autoNarrate(
  memories: Record<string, unknown>[],
  directory: string = "",
  periodLabel: string = "recent",
): NarrationResult {
  if (memories.length === 0) {
    return {
      narrative_text: "No memories found for narration.",
      keyword_summary: [],
      memory_count: 0,
      period: periodLabel,
    };
  }

  const sortedMems = [...memories].sort((a, b) => memoryTimestamp(b) - memoryTimestamp(a));
  const texts = sortedMems.map((m) => (m["content"] ?? "") as string).filter((t) => t.length > 0);
  const keywords = keywordFrequency(texts, 8);
  const narrativeText = buildNarrationProse(memories, keywords, directory, periodLabel);

  return {
    narrative_text: narrativeText,
    keyword_summary: keywords.map(([keyword, count]) => ({ keyword, count })),
    memory_count: memories.length,
    period: periodLabel,
  };
}

// ── Sleep Compute Orchestrator ────────────────────────────────────────────────

export interface SleepComputeResult {
  replay_updates: Array<{ memory_id: unknown; enriched_content: string }>;
  cluster_summaries: Array<{ cluster_id: unknown; level: unknown; summary: string; memory_count: number }>;
  stale_embeddings: Array<{ memory_id: unknown; content: string }>;
  narration: NarrationResult;
}

/**
 * Run the full sleep compute pass.
 *
 * Returns a plan object with all updates — the caller (consolidate handler)
 * is responsible for persisting these to the store.
 *
 * Precondition: memories is an array; clusters may be null/undefined.
 * Postcondition: all arrays in result contain only valid update objects.
 */
export function runSleepCompute(
  memories: Record<string, unknown>[],
  clusters: Record<string, unknown>[] | null = null,
  directory: string = "",
  periodLabel: string = "recent",
  maxReplay: number = 50,
  maxReembed: number = 100,
): SleepComputeResult {
  const replayUpdates = dreamReplay(memories, maxReplay);
  const clusterSummaries = summarizeClusters(clusters ?? []);
  const stale = selectStaleEmbeddings(memories, maxReembed);
  const staleEmbeddings = stale.map((m) => ({
    memory_id: m["id"],
    content: (m["content"] ?? "") as string,
  }));
  const narration = autoNarrate(memories, directory, periodLabel);

  return {
    replay_updates: replayUpdates,
    cluster_summaries: clusterSummaries,
    stale_embeddings: staleEmbeddings,
    narration,
  };
}
