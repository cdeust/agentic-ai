/**
 * Schema abstraction, clustering, and consistency checking for CLS.
 *
 * Extracted from dual_store_cls.py: greedy embedding clustering,
 * recurring pattern filtering, contradiction detection, and
 * keyword-frequency schema abstraction.
 *
 * Port of: mcp_server/core/dual_store_cls_abstraction.py
 * Pure business logic -- no I/O.
 */

// ── Clustering ────────────────────────────────────────────────────────────────

type SimilarityFn = (a: unknown, b: unknown) => number;

function findClusterMembers(
  seedIdx: number,
  seedEmb: unknown,
  memories: Record<string, unknown>[],
  assigned: Set<number>,
  similarityFn: SimilarityFn,
  threshold: number,
): Record<string, unknown>[] {
  const members: Record<string, unknown>[] = [];
  for (let j = seedIdx + 1; j < memories.length; j++) {
    if (assigned.has(j)) continue;
    const mem = memories[j];
    if (!mem) continue;
    const embB = mem["embedding"];
    if (embB == null) continue;
    if (similarityFn(seedEmb, embB) >= threshold) {
      members.push(mem);
      assigned.add(j);
    }
  }
  return members;
}

/**
 * Greedy clustering of memories by embedding similarity.
 *
 * @param memories - Each object must have an "embedding" field.
 * @param similarityFn - Callable(emb_a, emb_b) -> number in [0, 1].
 * @param threshold - Minimum similarity to join a cluster.
 * @returns List of clusters (each a list of memories).
 *
 * Precondition: memories is an array.
 * Postcondition: every memory appears in exactly one cluster.
 * Invariant: assigned.size grows monotonically with each iteration.
 */
export function clusterBySimilarity(
  memories: Record<string, unknown>[],
  similarityFn: SimilarityFn,
  threshold: number = 0.6,
): Record<string, unknown>[][] {
  if (memories.length === 0) return [];

  const clusters: Record<string, unknown>[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < memories.length; i++) {
    if (assigned.has(i)) continue;
    assigned.add(i);
    const mem = memories[i];
    if (!mem) continue;
    const embA = mem["embedding"];
    const members =
      embA != null
        ? findClusterMembers(i, embA, memories, assigned, similarityFn, threshold)
        : [];
    clusters.push([mem, ...members]);
  }

  return clusters;
}

/**
 * Filter clusters to only those that represent recurring patterns.
 *
 * A recurring pattern must appear in at least minOccurrences memories
 * across at least minSessions distinct sessions.
 *
 * Precondition: clusters is an array of arrays.
 * Postcondition: each returned pattern has count >= minOccurrences and session_count >= minSessions.
 */
export function filterRecurringPatterns(
  clusters: Record<string, unknown>[][],
  minOccurrences: number = 3,
  minSessions: number = 2,
): Record<string, unknown>[] {
  const patterns: Record<string, unknown>[] = [];

  for (const cluster of clusters) {
    if (cluster.length < minOccurrences) continue;

    const sessions = new Set<string>();
    for (const mem of cluster) {
      const sid = (mem["session_id"] ?? mem["source"] ?? "") as string;
      if (sid) sessions.add(sid);
    }

    if (sessions.size < minSessions) continue;

    patterns.push({
      memories: cluster,
      count: cluster.length,
      session_count: sessions.size,
      memory_ids: cluster
        .filter((m) => m["id"] != null)
        .map((m) => m["id"]),
    });
  }

  return patterns;
}

// ── Consistency checking ──────────────────────────────────────────────────────

const NEGATION_RE =
  /\b(not|don't|doesn't|no longer|replaced|switched from|deprecated|never)\b/i;

/**
 * Check a cluster of memories for contradictions.
 *
 * Simple heuristic: if one memory has negation words and another doesn't,
 * flag as potential contradiction.
 *
 * Precondition: memories is an array of memory objects.
 * Postcondition: consistent === (contradictions.length === 0).
 */
export function checkConsistency(
  memories: Record<string, unknown>[],
): { consistent: boolean; contradictions: string[] } {
  if (memories.length < 2) {
    return { consistent: true, contradictions: [] };
  }

  const contradictions: string[] = [];
  const negated: Record<string, unknown>[] = [];
  const positive: Record<string, unknown>[] = [];

  for (const mem of memories) {
    const content = (mem["content"] ?? "") as string;
    if (NEGATION_RE.test(content)) {
      negated.push(mem);
    } else {
      positive.push(mem);
    }
  }

  if (negated.length > 0 && positive.length > 0) {
    for (const neg of negated.slice(0, 3)) {
      const preview = ((neg["content"] ?? "") as string).slice(0, 100);
      contradictions.push(`Potential contradiction: '${preview}...'`);
    }
  }

  return { consistent: contradictions.length === 0, contradictions };
}

// ── Schema abstraction ────────────────────────────────────────────────────────

const STOP_WORDS = new Set<string>([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "is", "it", "this", "that", "are", "was", "be", "has", "have", "had", "do",
  "does", "did", "will", "would", "could", "should", "may", "might", "can", "from",
  "as", "if", "then", "than", "so", "just", "also", "its", "their", "them", "they",
  "we", "our", "i", "you", "he", "she", "my", "your", "his", "her",
]);

function extractKeyWords(
  memories: Record<string, unknown>[],
): [string[], number] {
  const n = memories.length;
  const wordCounts = new Map<string, number>();

  for (const mem of memories) {
    const content = (mem["content"] ?? "") as string;
    const words = new Set(Array.from(content.toLowerCase().matchAll(/\b\w+\b/g)).map((m) => m[0]));
    for (const w of words) {
      wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    }
  }

  const firstContent = ((memories[0] ?? {})["content"] ?? "") as string;
  const firstWords = Array.from(firstContent.toLowerCase().matchAll(/\b\w+\b/g)).map((m) => m[0]);
  const firstOrder = new Map(firstWords.map((w, i) => [w, i]));

  const threshold = Math.max(1, n * 0.5);
  const keyWords = Array.from(wordCounts.entries())
    .filter(([w, cnt]) => cnt >= threshold && !STOP_WORDS.has(w.toLowerCase()) && w.length > 1)
    .map(([w]) => w);

  keyWords.sort((a, b) => {
    const oa = firstOrder.get(a) ?? 9999;
    const ob = firstOrder.get(b) ?? 9999;
    return oa !== ob ? oa - ob : a.localeCompare(b);
  });

  return [keyWords.slice(0, 15), n];
}

function extractCommonTags(
  memories: Record<string, unknown>[],
  n: number,
): string[] {
  const allTags = new Map<string, number>();
  for (const mem of memories) {
    const tags = (mem["tags"] ?? []) as string[];
    for (const tag of tags) {
      if (typeof tag === "string") {
        allTags.set(tag, (allTags.get(tag) ?? 0) + 1);
      }
    }
  }
  return Array.from(allTags.entries())
    .filter(([, c]) => c >= Math.max(1, n * 0.5))
    .map(([t]) => t);
}

/**
 * Extract a generalized schema statement from a cluster.
 *
 * Precondition: memories is an array (may be empty).
 * Postcondition: returns a non-empty string (empty string only when memories is empty).
 */
export function abstractToSchema(memories: Record<string, unknown>[]): string {
  if (memories.length === 0) return "";

  const [keyWords, n] = extractKeyWords(memories);

  if (keyWords.length === 0) {
    return `Recurring pattern across ${n} observations`;
  }

  const keyPhrase = keyWords.join(" ");
  const commonTags = extractCommonTags(memories, n);

  let schema = `Recurring pattern across ${n} observations: ${keyPhrase}`;
  if (commonTags.length > 0) {
    schema += ` [${commonTags.slice(0, 5).join(", ")}]`;
  }

  return schema;
}
