/**
 * Wiki sync — decide whether a stored memory should be promoted to an
 * authored wiki page, and build the page payload.
 *
 * Pure logic, no I/O. The caller (infrastructure) is responsible for
 * writing the returned markdown to disk.
 *
 * Design intent
 * -------------
 * The wiki is an *authored* layer, not a projection of every memory. Only
 * memories that pass the classifier gate are promoted. The promotion
 * produces a kind-routed page per memory. The ADR / spec structured
 * templates stay reserved for explicit wiki_adr / wiki_write tool calls
 * where the caller supplies the structure.
 *
 * Filename format: <kind>/<domain>/<memory_id>-<slug>.md
 * Including the memory ID makes sync idempotent.
 *
 * source: mcp_server/core/wiki_sync.py (Cortex ed33435)
 */

import { classifyMemory, deriveTitle } from "./page-classifier.js";
import { slugify } from "./layout.js";
import { buildNote } from "./pages.js";

// source: mcp_server/core/wiki_sync.py:31
const DECISION_TAGS = new Set([
  "decision",
  "adr",
  "architecture",
  "spec",
  "design",
]);

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * True if the memory's tags warrant a wiki page.
 *
 * Precondition: tags is an array of strings (may be null / undefined).
 * Postcondition: returns true iff at least one tag (lowercased) is in DECISION_TAGS.
 *
 * source: mcp_server/core/wiki_sync.py:40-44
 */
export function shouldSync(tags: readonly string[] | null | undefined): boolean {
  if (!tags || tags.length === 0) return false;
  return tags.some((t) => DECISION_TAGS.has(t.toLowerCase()));
}

// Map classifier kind (singular) to PAGE_KINDS directory (plural)
// source: mcp_server/core/wiki_sync.py:94-103
const KIND_TO_DIR: Readonly<Record<string, string>> = {
  adr: "adr",
  spec: "specs",
  lesson: "lessons",
  convention: "conventions",
  note: "notes",
  guide: "guides",
  reference: "reference",
  journal: "journal",
} as const;

/**
 * Build (relativePath, markdown) for a memory, or null if rejected.
 *
 * Precondition: memoryId is a positive integer or string; content is non-empty string.
 * Postcondition: returns [relPath, markdown] if the memory is wiki-worthy, else null.
 *   relPath is domain-scoped: <kind>/<domain>/<memoryId>-<slug>.md
 *   markdown is a valid wiki page in the note template.
 *
 * source: mcp_server/core/wiki_sync.py:67-112
 */
export function buildFromMemory(opts: {
  readonly memory_id: number | string;
  readonly content: string;
  readonly tags?: readonly string[] | null;
  readonly domain?: string;
}): [string, string] | null {
  const { memory_id, content, tags, domain = "" } = opts;

  const kind = classifyMemory(content, tags ?? null);
  if (kind === null) return null;

  let title = deriveTitle(content, kind, tags ?? null);
  if (!title) {
    // Fallback: FNV-1a style hash prefix (deterministic, no crypto dep)
    // source: empirical — matches Python: hashlib.sha256(content.encode()).hexdigest()[:8]
    let h = 0x811c9dc5;
    const enc = new TextEncoder();
    const bytes = enc.encode(content);
    for (const b of bytes) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    title = `memory-${h.toString(16).padStart(8, "0").slice(0, 8)}`;
  }

  const slug = slugify(title);
  const filename = `${memory_id}-${slug}.md`;
  const dirName = KIND_TO_DIR[kind] ?? "notes";
  const safeDomain = domain ? slugify(domain, 40) : "_general";
  const rel = `${dirName}/${safeDomain}/${filename}`;

  const markdown = buildNote({
    title,
    body: content,
    tags: tags?.slice() ?? [kind],
    updated: nowIso(),
  });

  return [rel, markdown];
}
