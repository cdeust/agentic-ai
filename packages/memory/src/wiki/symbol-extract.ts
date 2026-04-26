/**
 * Phase 2 (ADR-0046) — extract symbol references from wiki page text.
 *
 * A wiki page may cite code symbols in three forms:
 *
 *   1. Backtick-wrapped function or method call:  `foo()` / `Bar.baz()`
 *   2. Dotted qualified name (no parens):         `module.Class.method`
 *   3. Explicit `{path}::{qualname}` annotation inserted by extractors.
 *
 * Returns the *normalized candidate set* — a deduplicated list
 * of qualified names that the system will ask AP to verify.
 *
 * Pure logic — no AP calls, no I/O.
 *
 * source: mcp_server/core/wiki_symbol_extract.py
 */

// A qualified name segment: Python/TS/Rust-style identifier. We reject
// leading digits and single-letter fragments to cut false positives.
const IDENT = String.raw`[A-Za-z_][A-Za-z_0-9]{1,}`;

// `foo()` or `Class.method()` inside backticks.
const BACKTICK_CALL = /`([A-Za-z_][\w.]*(?:\(\)|\([^`]{0,60}\)))`/g;

// Dotted chain of at least two identifier segments.
const DOTTED_RE = new RegExp(String.raw`\b(${IDENT}(?:\.${IDENT}){1,})\b`, "g");

const FILE_SUFFIXES = new Set([
  "py", "js", "ts", "tsx", "jsx", "md", "json", "yaml", "yml", "toml",
  "sql", "go", "rs", "rb", "java", "cpp", "c", "h", "hpp", "sh", "txt",
  "csv", "ini", "cfg", "lock", "log",
]);

function stripCallArgs(s: string): string {
  const idx = s.indexOf("(");
  return idx >= 0 ? s.slice(0, idx) : s;
}

function looksLikeFile(qname: string): boolean {
  const tail = qname.split(".").pop()?.toLowerCase() ?? "";
  return FILE_SUFFIXES.has(tail);
}

/**
 * Return distinct qualified-name candidates mentioned in ``text``.
 *
 * Candidates are deduplicated preserving first-occurrence order.
 * Single-identifier names and file-path-like dots are filtered out.
 */
export function extractSymbolRefs(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  const backtickRe = new RegExp(BACKTICK_CALL.source, "g");
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(text)) !== null) {
    const q = stripCallArgs(m[1]!);
    if (q.includes(".")) {
      if (looksLikeFile(q)) continue;
    }
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }

  const dottedRe = new RegExp(DOTTED_RE.source, "g");
  while ((m = dottedRe.exec(text)) !== null) {
    const q = m[1]!;
    if (looksLikeFile(q)) continue;
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }

  return out;
}

export interface PageLikeForSymbols {
  readonly lead?: string | null;
  readonly sections?:
    | Record<string, string>
    | Array<{ heading: string; body: string }>
    | null;
}

/**
 * Merge best-effort extraction with claim-evidence symbol refs.
 *
 * Returns a stable, deduplicated union of:
 *   * high-signal claim-evidence symbol refs (if provided);
 *   * pattern matches in the page lead and every section body.
 */
export function harvestPageSymbols(
  page: PageLikeForSymbols,
  claimEvidenceSymbols?: readonly string[] | null,
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  for (const q of claimEvidenceSymbols ?? []) {
    if (q && !seen.has(q)) {
      seen.add(q);
      refs.push(q);
    }
  }

  function add(chunk: string): void {
    for (const q of extractSymbolRefs(chunk)) {
      if (!seen.has(q)) {
        seen.add(q);
        refs.push(q);
      }
    }
  }

  add(page.lead ?? "");

  const sections = page.sections;
  if (sections) {
    if (Array.isArray(sections)) {
      for (const s of sections) add(s.body);
    } else {
      for (const body of Object.values(sections)) add(String(body));
    }
  }

  return refs;
}
