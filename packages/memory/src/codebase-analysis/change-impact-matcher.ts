/**
 * Phase 4 (ADR-0046) — match code-change impact sets to memories.
 *
 * Given:
 *   - a set of impacted qualified names (from ap.detect_changes / ap.get_impact)
 *   - a set of file paths touched by the commit
 *   - an iterable of memory rows ({memory_id, content, tags, ...})
 *
 * Returns a deterministic list of ImpactMatch objects identifying memories
 * whose content mentions any impacted symbol or file.
 *
 * Pure logic — no I/O. Case-insensitive substring match on the content
 * field plus tag intersection. The handler is responsible for deciding
 * what to do with the matches (heat bump, tag annotation, user report).
 *
 * Port of: cortex@ed33435 mcp_server/core/change_impact_matcher.py
 */

// ── ImpactMatch type ──────────────────────────────────────────────────────

/**
 * A single memory touched by a change-impact set.
 * source: cortex@ed33435 mcp_server/core/change_impact_matcher.py:23-29
 */
export interface ImpactMatch {
  memoryId: number | string;
  matchedSymbols: string[];
  matchedFiles: string[];
  matchCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Return the last identifier of a dotted qualname.
 * e.g. "foo.Bar.baz" → "baz"
 * Used to widen the match — memories often mention "baz()" without its
 * module prefix.
 *
 * source: cortex@ed33435 mcp_server/core/change_impact_matcher.py:32-36
 */
function tailOfQualname(q: string): string {
  const dot = q.lastIndexOf(".");
  return dot >= 0 ? q.slice(dot + 1) : q;
}

/**
 * Return the basename of a file path (last component after / or \).
 * source: cortex@ed33435 mcp_server/core/change_impact_matcher.py:39-42
 */
function basename(path: string): string {
  if (!path) return "";
  const slashIdx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slashIdx >= 0 ? path.slice(slashIdx + 1) : path;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Return a deterministic list of memories touched by the impact set.
 *
 * A memory matches if:
 *   - its content mentions any impacted symbol (or its tail name)
 *   - OR any impacted file path (or its basename)
 *   - OR its tags list intersects the impacted-file basenames
 *
 * precondition:  memories is an array of record objects; impactedSymbols
 *   and impactedFiles are string arrays (may be empty).
 * postcondition: returned array is sorted by (−matchCount, id) for
 *   determinism; every returned ImpactMatch has matchCount >= 1.
 *
 * source: cortex@ed33435 mcp_server/core/change_impact_matcher.py:45-98
 */
export function matchMemories(opts: {
  impactedSymbols: string[];
  impactedFiles: string[];
  memories: Record<string, unknown>[];
  idKey?: string;
}): ImpactMatch[] {
  const { impactedSymbols, impactedFiles, memories, idKey = "memory_id" } = opts;

  const symTerms = impactedSymbols
    .filter((q) => q)
    .map((q) => [q, tailOfQualname(q)] as [string, string]);

  const fileTerms = impactedFiles
    .filter((p) => p)
    .map((p) => [p, basename(p)] as [string, string]);

  const out: ImpactMatch[] = [];

  for (const m of memories ?? []) {
    const mid = idKey in m ? m[idKey] : m["id"];
    if (mid === null || mid === undefined) continue;

    const content = ((m["content"] as string | undefined) ?? "").toLowerCase();
    const tags = new Set(
      ((m["tags"] as unknown[] | undefined) ?? []).map((t) => String(t).toLowerCase()),
    );

    const matchedSymbols: string[] = [];
    for (const [full, tail] of symTerms) {
      if (content.includes(full.toLowerCase()) || (tail && content.includes(tail.toLowerCase()))) {
        matchedSymbols.push(full);
      }
    }

    const matchedFiles: string[] = [];
    for (const [full, base] of fileTerms) {
      if (content.includes(full.toLowerCase()) || (base && content.includes(base.toLowerCase()))) {
        matchedFiles.push(full);
      } else if (base && tags.has(base.toLowerCase())) {
        matchedFiles.push(full);
      }
    }

    const total = matchedSymbols.length + matchedFiles.length;
    if (total === 0) continue;

    out.push({
      memoryId: mid as number | string,
      matchedSymbols,
      matchedFiles,
      matchCount: total,
    });
  }

  // source: cortex@ed33435 mcp_server/core/change_impact_matcher.py:97
  out.sort((a, b) => {
    const diff = b.matchCount - a.matchCount;
    if (diff !== 0) return diff;
    return String(a.memoryId).localeCompare(String(b.memoryId));
  });

  return out;
}
