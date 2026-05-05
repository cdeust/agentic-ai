/**
 * Phase 4 — Staleness brake for wiki pages.
 *
 * A page becomes stale when the file references it cites no longer
 * exist on disk. Stale pages get is_stale=True and lose heat faster.
 *
 * Pure logic: this module is given a page's referenced file paths and
 * a per-path existence map (computed by the handler with filesystem I/O),
 * and returns the decision.
 *
 * Port of: cortex@ed33435 mcp_server/core/wiki_staleness.py
 */

// ── Staleness thresholds ──────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/wiki_staleness.py:26-29

/** A page is stale when this fraction of its file refs are missing. */
export const STALE_THRESHOLD = 0.5;  // source: cortex@ed33435 mcp_server/core/wiki_staleness.py:26

/** A page must reference at least this many files for staleness to apply. */
export const MIN_FILE_REFS = 2;  // source: cortex@ed33435 mcp_server/core/wiki_staleness.py:29

// ── File reference regex ──────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/wiki_staleness.py:21-23

const FILE_REF_RE = /\b([\w./-]+\.(?:py|js|ts|md|json|yaml|yml|sql|go|rs|rb|java|cpp|c|h|hpp|sh|toml))\b/g;

// ── StalenessDecision ─────────────────────────────────────────────────────

/**
 * Per-page staleness verdict.
 * source: cortex@ed33435 mcp_server/core/wiki_staleness.py:32-42
 */
export interface StalenessDecision {
  readonly pageId: number;
  readonly fileRefs: string[];
  readonly missingRefs: string[];
  readonly isStaleNow: boolean;
  readonly isStaleWas: boolean;
  readonly transitioned: boolean;
  readonly rationale: string;
}

// ── Public functions ──────────────────────────────────────────────────────

/**
 * Return distinct file paths mentioned in a body of text.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_staleness.py:45-56
 */
export function extractFileRefs(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(FILE_REF_RE)) {
    const ref = m[1]!;
    if (!seen.has(ref)) { seen.add(ref); out.push(ref); }
  }
  return out;
}

/**
 * Decide whether a page is stale.
 *
 * precondition:  fileRefs is deduplicated; existence maps path → boolean.
 * postcondition: returned StalenessDecision reflects whether missing/total
 *   >= STALE_THRESHOLD AND len(fileRefs) >= MIN_FILE_REFS.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_staleness.py:59-104
 *   STALE_THRESHOLD = 0.5; MIN_FILE_REFS = 2
 */
export function evaluateStaleness(opts: {
  pageId: number;
  isStaleWas: boolean;
  fileRefs: string[];
  existence: Record<string, boolean>;
}): StalenessDecision {
  const { pageId, isStaleWas, fileRefs, existence } = opts;

  if (fileRefs.length < MIN_FILE_REFS) {
    return {
      pageId,
      fileRefs,
      missingRefs: [],
      isStaleNow: false,
      isStaleWas,
      transitioned: isStaleWas, // True if we're un-staling
      rationale: `too few file refs (${fileRefs.length} < ${MIN_FILE_REFS})`,
    };
  }

  const missing = fileRefs.filter((ref) => !existence[ref]);
  const fraction = missing.length / fileRefs.length;
  const isStaleNow = fraction >= STALE_THRESHOLD;

  return {
    pageId,
    fileRefs,
    missingRefs: missing,
    isStaleNow,
    isStaleWas,
    transitioned: isStaleNow !== isStaleWas,
    rationale: `${missing.length}/${fileRefs.length} refs missing (${Math.round(fraction * 100)}% — threshold ${Math.round(STALE_THRESHOLD * 100)}%)`,
  };
}

/**
 * Collect all file refs a page should be checked against.
 *
 * Combines:
 *   - claim-derived file refs (high signal, from extractor)
 *   - inline file patterns in lead + section bodies (best effort)
 *
 * source: cortex@ed33435 mcp_server/core/wiki_staleness.py:107-124
 */
export function harvestPageRefs(
  page: Record<string, unknown>,
  claimEvidenceFiles: string[],
): string[] {
  const refs = new Set<string>(claimEvidenceFiles ?? []);

  for (const ref of extractFileRefs((page["lead"] as string | undefined) ?? "")) {
    refs.add(ref);
  }

  const sections = page["sections"];
  if (sections && typeof sections === "object") {
    if (Array.isArray(sections)) {
      for (const s of sections) {
        const body = typeof s === "object" ? ((s as Record<string, unknown>)["body"] as string | undefined) ?? "" : String(s);
        for (const ref of extractFileRefs(body)) refs.add(ref);
      }
    } else {
      for (const body of Object.values(sections as Record<string, unknown>)) {
        for (const ref of extractFileRefs(String(body))) refs.add(ref);
      }
    }
  }

  return Array.from(refs).sort();
}
