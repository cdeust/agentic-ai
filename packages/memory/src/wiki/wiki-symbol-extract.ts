/**
 * Phase 2 (ADR-0046) — extract symbol references from wiki page text.
 *
 * A wiki page may cite code symbols in three forms:
 *   1. Backtick-wrapped function or method call: `foo()` / `Bar.baz()`
 *   2. Dotted qualified name (no parens): module.Class.method
 *   3. Explicit {path}::{qualname} annotation
 *
 * Returns the normalized candidate set — a deduplicated list of qualified
 * names that Cortex will ask AP to verify.
 *
 * Pure logic — no AP calls, no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/wiki_symbol_extract.py
 */

// ── Regex patterns ────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/wiki_symbol_extract.py:30-39

const IDENT = "[A-Za-z_][A-Za-z_0-9]{1,}";
const BACKTICK_CALL = /`([A-Za-z_][\w.]*(?:\(\)|\([^`]{0,60}\)))`/g;
const DOTTED = new RegExp(`\\b(${IDENT}(?:\\.${IDENT}){1,})\\b`, "g");

// ── File extension blacklist ──────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/wiki_symbol_extract.py:43-71

const FILE_SUFFIXES = new Set([
  "py", "js", "ts", "tsx", "jsx", "md", "json", "yaml", "yml",
  "toml", "sql", "go", "rs", "rb", "java", "cpp", "c", "h",
  "hpp", "sh", "txt", "csv", "ini", "cfg", "lock", "log",
]);

// ── Helpers ───────────────────────────────────────────────────────────────

/** `foo(x, y)` → `foo`; leave bare `foo` untouched.
 * source: cortex@ed33435 mcp_server/core/wiki_symbol_extract.py:75-78
 */
function stripCallArgs(s: string): string {
  const idx = s.indexOf("(");
  return idx >= 0 ? s.slice(0, idx) : s;
}

/** Reject dotted chains whose last segment is a file extension.
 * source: cortex@ed33435 mcp_server/core/wiki_symbol_extract.py:81-84
 */
function looksLikeFile(qname: string): boolean {
  const tail = qname.split(".").pop()!.toLowerCase();
  return FILE_SUFFIXES.has(tail);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Return distinct qualified-name candidates mentioned in text.
 *
 * Candidates are deduplicated preserving first-occurrence order.
 * Single-identifier names and file-path-like dots are filtered out.
 *
 * precondition:  text is a string.
 * postcondition: returned array has no duplicates; each entry is either
 *   a dotted multi-segment qualname or a single function name from backticks.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_symbol_extract.py:87-126
 */
export function extractSymbolRefs(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const m of text.matchAll(BACKTICK_CALL)) {
    const q = stripCallArgs(m[1]!);
    if (!q.includes(".")) {
      if (!seen.has(q)) { seen.add(q); out.push(q); }
      continue;
    }
    if (looksLikeFile(q)) continue;
    if (!seen.has(q)) { seen.add(q); out.push(q); }
  }

  for (const m of text.matchAll(DOTTED)) {
    const q = m[1]!;
    if (looksLikeFile(q)) continue;
    if (!seen.has(q)) { seen.add(q); out.push(q); }
  }

  return out;
}

/**
 * Merge best-effort extraction with claim-evidence symbol refs.
 *
 * precondition:  page has optional lead and sections fields.
 * postcondition: returned list is a stable, deduplicated union of
 *   claim-evidence symbol refs and pattern matches in the page text.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_symbol_extract.py:129-165
 */
export function harvestPageSymbols(
  page: Record<string, unknown>,
  claimEvidenceSymbols: string[] | null = null,
): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  for (const q of claimEvidenceSymbols ?? []) {
    if (q && !seen.has(q)) { seen.add(q); refs.push(q); }
  }

  function add(chunk: string): void {
    for (const q of extractSymbolRefs(chunk)) {
      if (!seen.has(q)) { seen.add(q); refs.push(q); }
    }
  }

  add((page["lead"] as string | undefined) ?? "");

  const sections = page["sections"];
  if (sections && typeof sections === "object") {
    if (Array.isArray(sections)) {
      for (const s of sections) {
        const body = typeof s === "object"
          ? ((s as Record<string, unknown>)["body"] as string | undefined) ?? ""
          : String(s);
        add(body);
      }
    } else {
      for (const body of Object.values(sections as Record<string, unknown>)) {
        add(String(body));
      }
    }
  }

  return refs;
}
