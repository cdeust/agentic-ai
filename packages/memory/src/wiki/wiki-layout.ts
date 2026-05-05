/**
 * Wiki path contract — pure functions, no I/O.
 *
 * The wiki is an authored long-form Markdown layer. Pages live under a
 * supplied wiki root; this module only computes paths so the core layer
 * stays filesystem-agnostic.
 *
 * Layout:
 *   <root>/adr/NNNN-<slug>.md        architecture decision records
 *   <root>/specs/<slug>.md           feature specs / PRDs / design docs
 *   <root>/files/<path-slug>.md      per-file documentation
 *   <root>/notes/<slug>.md           free-form notes / investigations
 *   <root>/.generated/INDEX.md       auto-regenerated table of contents
 *
 * Port of: cortex@ed33435 mcp_server/core/wiki_layout.py
 */

// ── Page kinds ────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/wiki_layout.py:21-31

export const PAGE_KINDS = [
  "adr", "specs", "guides", "reference", "conventions",
  "lessons", "notes", "journal", "files",
] as const;

export type PageKind = typeof PAGE_KINDS[number];

// ── Slug generation ───────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/wiki_layout.py:33-34

const SAFE = /[^a-zA-Z0-9_.-]+/g;
const MAX_SLUG_LEN = 80;

/**
 * Stable filesystem-safe slug. Deterministic, lowercased, length-capped.
 *
 * precondition:  value is a string.
 * postcondition: returned string is in [a-z0-9_.-], lowercased, <= maxLen
 *   characters; returns "unknown" for empty/whitespace input.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_layout.py:37-44
 */
export function slugify(value: string, maxLen = MAX_SLUG_LEN): string {
  if (!value) return "unknown";
  const cleaned = value.trim().toLowerCase().replace(SAFE, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) return "unknown";
  return cleaned.slice(0, maxLen).replace(/-+$/, "") || "unknown";
}

/**
 * Slugify a source-file path into a single token suitable for files/.
 *
 * `src/auth/login.py` → `src-auth-login-py`
 *
 * source: cortex@ed33435 mcp_server/core/wiki_layout.py:47-52
 */
export function filePathSlug(filePath: string): string {
  return slugify(filePath.replace(/\//g, "-").replace(/\\/g, "-"));
}

/**
 * Canonical ADR filename: NNNN-slug.md (4-digit zero-padded).
 * source: cortex@ed33435 mcp_server/core/wiki_layout.py:55-57
 */
export function adrFilename(number: number, slug: string): string {
  return `${String(number).padStart(4, "0")}-${slug}.md`;
}

/**
 * Generate a domain-scoped page path: <kind>/<domain>/<slug>.md.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_layout.py:60-65
 */
export function domainPagePath(kind: string, domain: string, slug: string): string {
  if (!(PAGE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`unknown wiki page kind: ${kind}`);
  }
  const safeDomain = domain ? slugify(domain, 40) : "_general";
  return `${kind}/${safeDomain}/${slug}.md`;
}

/**
 * Path relative to the wiki root for a page of a given kind.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_layout.py:68-72
 */
export function pagePath(kind: string, filename: string): string {
  if (!(PAGE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`unknown wiki page kind: ${kind}`);
  }
  return `${kind}/${filename}`;
}

/**
 * Path of the single auto-generated table of contents.
 * source: cortex@ed33435 mcp_server/core/wiki_layout.py:75-77
 */
export function indexPath(): string {
  return ".generated/INDEX.md";
}

/**
 * Given a path like `adr/0001-foo.md` return `[kind, filename]`.
 *
 * Returns null for unrecognised paths (including the generated INDEX).
 *
 * source: cortex@ed33435 mcp_server/core/wiki_layout.py:80-88
 */
export function parsePagePath(path: string): [string, string] | null {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const kind = parts[0]!;
  if (!(PAGE_KINDS as readonly string[]).includes(kind)) return null;
  return [kind, parts[parts.length - 1]!];
}
