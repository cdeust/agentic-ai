/**
 * Phase 4 — Staleness brake for wiki pages.
 *
 * A page becomes stale when the file references it cites no longer
 * exist on disk. Stale pages get is_stale=true and lose heat faster
 * (half-life multiplier).
 *
 * Pure logic: this module is given a page's referenced file paths and
 * a per-path existence map (computed by the handler with filesystem
 * I/O), and returns the decision.
 *
 * source: mcp_server/core/wiki_staleness.py
 */

const FILE_REF_RE =
  /\b([\w./-]+\.(?:py|js|ts|md|json|yaml|yml|sql|go|rs|rb|java|cpp|c|h|hpp|sh|toml))\b/g;

// A page is stale when this fraction of its file refs are missing.
// source: empirical threshold chosen to match wiki_staleness.STALE_THRESHOLD
export const STALE_THRESHOLD = 0.5;

// A page must reference at least this many files for staleness to apply
// (avoid false positives from pages with one stray file mention).
export const MIN_FILE_REFS = 2;

export interface StalenessDecision {
  readonly page_id: number;
  readonly file_refs: readonly string[];
  readonly missing_refs: readonly string[];
  readonly is_stale_now: boolean;
  readonly is_stale_was: boolean;
  readonly transitioned: boolean;
  readonly rationale: string;
}

/**
 * Return distinct file paths mentioned in a body of text.
 */
export function extractFileRefs(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(FILE_REF_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ref = m[1]!;
    if (!seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  }
  return out;
}

export interface EvaluateStalenessArgs {
  readonly page_id: number;
  readonly is_stale_was: boolean;
  readonly file_refs: readonly string[];
  readonly existence: Readonly<Record<string, boolean>>;
}

/**
 * Decide whether a page is stale.
 *
 * A page is stale iff:
 *   - len(file_refs) >= MIN_FILE_REFS
 *   - missing / total >= STALE_THRESHOLD
 */
export function evaluateStaleness(args: EvaluateStalenessArgs): StalenessDecision {
  const { page_id, is_stale_was, file_refs, existence } = args;

  if (file_refs.length < MIN_FILE_REFS) {
    return {
      page_id,
      file_refs,
      missing_refs: [],
      is_stale_now: false,
      is_stale_was,
      transitioned: is_stale_was,
      rationale: `too few file refs (${file_refs.length} < ${MIN_FILE_REFS})`,
    };
  }

  const missing = file_refs.filter((ref) => !existence[ref]);
  const fraction = missing.length / file_refs.length;
  const isStaleNow = fraction >= STALE_THRESHOLD;

  return {
    page_id,
    file_refs,
    missing_refs: missing,
    is_stale_now: isStaleNow,
    is_stale_was,
    transitioned: isStaleNow !== is_stale_was,
    rationale: `${missing.length}/${file_refs.length} refs missing (${Math.round(fraction * 100)}% — threshold ${Math.round(STALE_THRESHOLD * 100)}%)`,
  };
}

export interface PageLike {
  readonly lead?: string | null;
  readonly sections?: Record<string, string> | Array<{ heading: string; body: string }> | null;
}

/**
 * Collect all file refs a page should be checked against.
 *
 * Combines:
 *   - claim-derived file refs (high signal, from extractor)
 *   - inline file patterns in lead + section bodies (best effort)
 */
export function harvestPageRefs(
  page: PageLike,
  claimEvidenceFiles: readonly string[],
): string[] {
  const refs = new Set<string>(claimEvidenceFiles ?? []);

  for (const ref of extractFileRefs(page.lead ?? "")) {
    refs.add(ref);
  }

  const sections = page.sections;
  if (sections) {
    if (Array.isArray(sections)) {
      for (const s of sections) {
        for (const ref of extractFileRefs(s.body)) {
          refs.add(ref);
        }
      }
    } else {
      for (const body of Object.values(sections)) {
        for (const ref of extractFileRefs(String(body))) {
          refs.add(ref);
        }
      }
    }
  }

  return [...refs].sort();
}
