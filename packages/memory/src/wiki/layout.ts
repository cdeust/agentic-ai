/**
 * Wiki path contract — pure functions, no I/O.
 *
 * The wiki is an authored long-form Markdown layer. Pages live under a
 * supplied wiki root; this module only computes paths so the core layer
 * stays filesystem-agnostic.
 *
 * Layout:
 *   <root>/adr/NNNN-<slug>.md         architecture decision records
 *   <root>/specs/<slug>.md            feature specs / PRDs / design docs
 *   <root>/files/<path-slug>.md       per-file documentation
 *   <root>/notes/<slug>.md            free-form notes / investigations
 *   <root>/.generated/INDEX.md        auto-regenerated table of contents
 *
 * source: mcp_server/core/wiki_layout.py
 */

import type { WikiKind } from "./types.js";

export const PAGE_KINDS: readonly WikiKind[] = [
  "adr",
  "specs",
  "guides",
  "reference",
  "conventions",
  "lessons",
  "notes",
  "journal",
  "files",
] as const;

const _SAFE = /[^a-zA-Z0-9_.\\-]+/g;
const _MAX_SLUG_LEN = 80;

/**
 * Stable filesystem-safe slug. Deterministic, lowercased, length-capped.
 */
export function slugify(value: string, maxLen: number = _MAX_SLUG_LEN): string {
  if (!value) return "unknown";
  const cleaned = value.trim().toLowerCase().replace(_SAFE, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) return "unknown";
  const trimmed = cleaned.slice(0, maxLen).replace(/-+$/, "");
  return trimmed || "unknown";
}

/**
 * Slugify a source-file path into a single token suitable for files/.
 *
 * ``src/auth/login.py`` → ``src-auth-login-py``.
 */
export function filePathSlug(filePath: string): string {
  return slugify(filePath.replace(/[/\\]/g, "-"));
}

/**
 * Canonical ADR filename: NNNN-slug.md (4-digit zero-padded).
 */
export function adrFilename(number: number, slug: string): string {
  return `${String(number).padStart(4, "0")}-${slug}.md`;
}

/**
 * Generate a domain-scoped page path: <kind>/<domain>/<slug>.md.
 */
export function domainPagePath(kind: WikiKind, domain: string, slug: string): string {
  const safeDomain = domain ? slugify(domain, 40) : "_general";
  return `${kind}/${safeDomain}/${slug}.md`;
}

/**
 * Path relative to the wiki root for a page of a given kind.
 */
export function pagePath(kind: WikiKind, filename: string): string {
  if (!(PAGE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`unknown wiki page kind: ${kind}`);
  }
  return `${kind}/${filename}`;
}

/**
 * Path of the single auto-generated table of contents.
 */
export function indexPath(): string {
  return ".generated/INDEX.md";
}

/**
 * Given a path like ``adr/0001-foo.md`` return ``[kind, filename]``.
 *
 * Returns null for unrecognised paths (including the generated INDEX).
 */
export function parsePagePath(path: string): [WikiKind, string] | null {
  const parts = path.split("/");
  if (parts.length < 2) return null;
  const kind = parts[0] as WikiKind;
  if (!(PAGE_KINDS as readonly string[]).includes(kind)) return null;
  const filename = parts[parts.length - 1];
  if (!filename) return null;
  return [kind, filename];
}
