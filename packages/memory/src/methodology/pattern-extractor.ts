/**
 * Extract entry points, recurring patterns, tool preferences, and session shape.
 *
 * Agglomerative clustering for entry points (O(n^3), fine for 10-100 sessions).
 * N-gram mining for recurring patterns (bigrams + trigrams, >=3-session threshold).
 * Tool stats and session shape are delegated to session-shape module.
 *
 * Port of: mcp_server/core/pattern_extractor.py
 * Pure business logic — no I/O.
 */

import { jaccardSimilarity } from "../shared/similarity.js";
import { STOPWORDS, extractKeywords } from "../shared/text.js";

// Session shape and tool preference extraction — delegates to the profile assembler.
// These are stub implementations that return the pre-computed fields from conversation
// objects (following the Python source: core/session_shape.py delegates to stored data).

function extractToolPreferences(conversations: Record<string, unknown>[]): Record<string, unknown> {
  // Aggregate tool use counts from stored tool_uses fields
  const toolCounts: Record<string, number> = {};
  for (const conv of conversations) {
    const tools = (conv["tool_uses"] ?? conv["toolUses"] ?? []) as string[];
    for (const t of tools) {
      toolCounts[t] = (toolCounts[t] ?? 0) + 1;
    }
  }
  const total = conversations.length || 1;
  return Object.fromEntries(
    Object.entries(toolCounts).map(([t, c]) => [t, { count: c, ratio: c / total }]),
  );
}

function extractSessionShape(conversations: Record<string, unknown>[]): Record<string, unknown> {
  if (conversations.length === 0) {
    return { avgTurns: 0, avgDurationMs: 0, avgToolsUsed: 0 };
  }
  const turns = conversations.map((c) => (c["turnCount"] as number | undefined) ?? 0);
  const duration = conversations.map((c) => (c["duration"] as number | undefined) ?? 0);
  const toolCount = conversations.map((c) => {
    const t = (c["toolsUsed"] ?? c["tool_uses"] ?? []) as unknown[];
    return t.length;
  });
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    avgTurns: avg(turns),
    avgDurationMs: avg(duration),
    avgToolsUsed: avg(toolCount),
  };
}

const SPLIT_RE = /\W+/;

// ── Entry Points — Agglomerative clustering ───────────────────────────────────

interface ClusterItem {
  keywords: Set<string>;
  message: string;
}

/**
 * Merge items by average-linkage Jaccard similarity until below threshold.
 *
 * Precondition: items is an array; threshold in (0, 1].
 * Postcondition: every item appears in exactly one cluster.
 * Termination: each iteration reduces cluster count by 1; terminates when
 *   max similarity < threshold or only one cluster remains.
 */
function agglomerativeClusters(
  items: ClusterItem[],
  threshold: number,
): ClusterItem[][] {
  let clusters: ClusterItem[][] = items.map((item) => [item]);

  // Invariant: sum of cluster sizes = items.length (no items lost)
  while (true) {
    let bestSim = -1.0;
    let bestI = -1;
    let bestJ = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let simSum = 0.0;
        let simCount = 0;
        const ci = clusters[i] ?? [];
        const cj = clusters[j] ?? [];
        for (const a of ci) {
          for (const b of cj) {
            simSum += jaccardSimilarity(a.keywords, b.keywords);
            simCount++;
          }
        }
        const sim = simCount > 0 ? simSum / simCount : 0.0;
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestSim < threshold || bestI === -1) break;

    const merged = [...(clusters[bestI] ?? []), ...(clusters[bestJ] ?? [])];
    clusters = [
      ...clusters.filter((_, k) => k !== bestI && k !== bestJ),
      merged,
    ];
  }

  return clusters;
}

function labelCluster(cluster: ClusterItem[]): string {
  const freq = new Map<string, number>();
  for (const item of cluster) {
    for (const kw of item.keywords) {
      freq.set(kw, (freq.get(kw) ?? 0) + 1);
    }
  }
  const top = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kw]) => kw);
  return top.join(" / ") || "general";
}

function extractFirstUserMessage(conv: Record<string, unknown>): string | null {
  if (conv["firstMessage"]) return conv["firstMessage"] as string;
  const messages = conv["messages"] as Array<unknown> | undefined;
  if (messages) {
    for (const m of messages) {
      if (typeof m === "string") return m;
      const msg = m as Record<string, unknown>;
      const role = ((msg["role"] ?? msg["speaker"] ?? "") as string);
      if (role === "user") {
        return (msg["content"] ?? msg["text"] ?? "") as string;
      }
    }
  }
  return null;
}

/**
 * Cluster first-messages into entry point patterns.
 *
 * Precondition: conversations is an array.
 * Postcondition: result.length <= 5; each entry has pattern, frequency, confidence, exampleMessages.
 */
export function extractEntryPoints(
  conversations: Record<string, unknown>[],
): Record<string, unknown>[] {
  const items: ClusterItem[] = [];
  for (const conv of conversations) {
    const text = extractFirstUserMessage(conv);
    if (!text || !text.trim()) continue;
    items.push({ keywords: new Set(extractKeywords(text)), message: text.trim() });
  }

  if (items.length === 0) return [];

  const clusters = agglomerativeClusters(items, 0.3);
  clusters.sort((a, b) => b.length - a.length);
  const total = items.length;

  return clusters.slice(0, 5).map((cluster) => ({
    pattern: labelCluster(cluster),
    frequency: cluster.length,
    confidence: total > 0 ? cluster.length / total : 0,
    exampleMessages: cluster.slice(0, 3).map((item) => item.message),
  }));
}

// ── Recurring Patterns (n-gram mining) ───────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().split(SPLIT_RE).filter(
    (w: string) => w.length >= 2 && !STOPWORDS.has(w),
  );
}

function extractNgrams(tokens: string[]): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    ngrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    if (i < tokens.length - 2) {
      ngrams.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }
  return ngrams;
}

function sharedKeywordCount(a: string, b: string): number {
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));
  let count = 0;
  for (const w of setA) {
    if (setB.has(w)) count++;
  }
  return count;
}

function collectNgramSessions(
  conversations: Record<string, unknown>[],
): Map<string, Set<number>> {
  const ngramSessions = new Map<string, Set<number>>();
  conversations.forEach((conv, sessionIdx) => {
    const allText = ((conv["allText"] ?? conv["fullText"] ?? "") as string).trim();
    if (!allText) return;
    const tokens = tokenize(allText);
    for (const ng of new Set(extractNgrams(tokens))) {
      if (!ngramSessions.has(ng)) ngramSessions.set(ng, new Set());
      ngramSessions.get(ng)!.add(sessionIdx);
    }
  });
  return ngramSessions;
}

interface NgramGroup {
  ngrams: string[];
  session_union: Set<number>;
}

function groupQualifiedNgrams(
  qualified: Array<{ ngram: string; sessions: Set<number> }>,
): NgramGroup[] {
  const groups: NgramGroup[] = [];
  for (const item of qualified) {
    let merged = false;
    for (const group of groups) {
      const overlaps = group.ngrams.some(
        (existing) => sharedKeywordCount(item.ngram, existing) >= 2,
      );
      if (overlaps) {
        group.ngrams.push(item.ngram);
        for (const s of item.sessions) group.session_union.add(s);
        merged = true;
        break;
      }
    }
    if (!merged) {
      groups.push({
        ngrams: [item.ngram],
        session_union: new Set(item.sessions),
      });
    }
  }
  return groups;
}

function groupsToResults(
  groups: NgramGroup[],
  ngramSessions: Map<string, Set<number>>,
  totalSessions: number,
): Record<string, unknown>[] {
  return groups.map((group) => {
    const topNgram = group.ngrams.reduce((best, ng) => {
      const bestCount = ngramSessions.get(best)?.size ?? 0;
      const ngCount = ngramSessions.get(ng)?.size ?? 0;
      return ngCount > bestCount ? ng : best;
    });
    const sessionsObserved = group.session_union.size;
    const frequency = ngramSessions.get(topNgram)?.size ?? sessionsObserved;
    return {
      pattern: topNgram,
      ngramSignature: group.ngrams.slice(0, 10),
      frequency,
      sessionsObserved,
      confidence: totalSessions > 0 ? sessionsObserved / totalSessions : 0,
    };
  });
}

/**
 * Mine bigram/trigram patterns appearing in 3+ sessions.
 *
 * Precondition: conversations is an array.
 * Postcondition: each result has pattern, ngramSignature, frequency, sessionsObserved, confidence.
 */
export function extractRecurringPatterns(
  conversations: Record<string, unknown>[],
): Record<string, unknown>[] {
  const totalSessions = conversations.length;
  if (totalSessions === 0) return [];

  const ngramSessions = collectNgramSessions(conversations);

  const minSessions = 3;
  const qualified = Array.from(ngramSessions.entries())
    .filter(([, sessions]) => sessions.size >= minSessions)
    .map(([ngram, sessions]) => ({ ngram, sessions }))
    .sort((a, b) => b.sessions.size - a.sessions.size);

  if (qualified.length === 0) return [];

  const groups = groupQualifiedNgrams(qualified);
  return groupsToResults(groups, ngramSessions, totalSessions);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Extract all pattern types from conversations for a single domain.
 *
 * Precondition: conversations is an array.
 * Postcondition: result contains entryPoints, recurringPatterns, toolPreferences, sessionShape.
 */
export function extractPatterns(
  conversations: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    entryPoints: extractEntryPoints(conversations),
    recurringPatterns: extractRecurringPatterns(conversations),
    toolPreferences: extractToolPreferences(conversations),
    sessionShape: extractSessionShape(conversations),
  };
}
