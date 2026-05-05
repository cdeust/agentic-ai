/**
 * Phase 2.5 — Compile approved DraftPages to markdown files.
 *
 * Pure function: given an approved draft + kind metadata + domain,
 * produce [rel_path, markdown_text, frontmatter]. The handler atomically
 * writes the file via wiki_store and persists the wiki.pages mirror row.
 *
 * Port of: cortex@ed33435 mcp_server/core/draft_compiler.py
 */

import { slugify } from "./wiki-layout.js";

// ── Constants ─────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/draft_compiler.py:32-51

const FRONTMATTER_KEYS_ORDER = [
  "title", "kind", "domain", "domains", "tags", "audience", "requires",
  "status", "lifecycle_state", "supersedes", "superseded_by", "verified",
  "concept_id", "memory_id", "draft_id", "synth_model", "created", "updated",
] as const;

const KIND_TO_DIR: Record<string, string> = {
  adr: "adr", spec: "specs", lesson: "lessons",
  convention: "conventions", note: "notes", guide: "guides", reference: "reference",
};

// ── Helpers ───────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Render a value as a YAML inline value our parser supports.
 * source: cortex@ed33435 mcp_server/core/draft_compiler.py:58-71
 */
function yamlValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) {
    return "[" + v.map((x) => yamlValue(x).replace(/^"|"$/g, "")).join(", ") + "]";
  }
  const s = String(v);
  if (s.includes(":") || s.includes("#") || s.includes("\n")
    || s.startsWith("[") || s.startsWith("{") || s.startsWith("-") || s.startsWith("?")) {
    return `"${s}"`;
  }
  return s;
}

/**
 * Build YAML frontmatter block.
 * source: cortex@ed33435 mcp_server/core/draft_compiler.py:74-86
 */
function buildFrontmatter(meta: Record<string, unknown>): string {
  const lines = ["---"];
  const seen = new Set<string>();
  for (const key of FRONTMATTER_KEYS_ORDER) {
    if (key in meta && meta[key] !== null && meta[key] !== undefined && meta[key] !== "") {
      lines.push(`${key}: ${yamlValue(meta[key])}`);
      seen.add(key);
    }
  }
  for (const [key, val] of Object.entries(meta)) {
    if (seen.has(key) || val === null || val === undefined || val === "") continue;
    lines.push(`${key}: ${yamlValue(val)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function sectionMd(heading: string, body: string): string {
  return `## ${heading}\n\n${(body ?? "").trim()}\n`;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Compute the canonical filesystem path for a compiled page.
 *
 * source: cortex@ed33435 mcp_server/core/draft_compiler.py:94-127
 */
export function deriveRelPath(opts: {
  kind: string;
  domain: string;
  title: string;
  memoryId?: number | null;
  conceptId?: number | null;
  kindDir?: string | null;
}): string {
  const { kind, domain, title, memoryId, conceptId, kindDir } = opts;
  const titleSlug = slugify(title || "untitled");
  const domainSlug = slugify(domain || "_general", 40);
  const folder = kindDir ?? KIND_TO_DIR[kind] ?? "notes";
  const idPrefix = memoryId !== null && memoryId !== undefined
    ? String(memoryId)
    : (conceptId !== null && conceptId !== undefined ? `c${conceptId}` : "x");
  return `${folder}/${domainSlug}/${idPrefix}-${titleSlug}.md`;
}

/**
 * Compile an approved DraftPage to [rel_path, markdown, frontmatter].
 *
 * precondition:  draft has title, kind, lead, sections, id, memory_id,
 *   concept_id, synth_model, frontmatter fields (all optional).
 * postcondition: returned rel_path is canonical; markdown has YAML frontmatter
 *   header; trailing whitespace is normalized.
 *
 * source: cortex@ed33435 mcp_server/core/draft_compiler.py:130-210
 */
export function compileDraft(
  draft: Record<string, unknown>,
  opts: {
    domain?: string;
    kindDir?: string | null;
    backlinks?: Array<{ slug: string; title: string; link_kind?: string }>;
  } = {},
): [string, string, Record<string, unknown>] {
  const { domain = "_general", kindDir = null, backlinks } = opts;

  const title = (draft["title"] as string | undefined) ?? "Untitled";
  const kind = (draft["kind"] as string | undefined) ?? "note";
  const lead = ((draft["lead"] as string | undefined) ?? "").trim();
  const sections = (draft["sections"] as Array<Record<string, unknown>> | undefined) ?? [];
  const fmExisting = (draft["frontmatter"] as Record<string, unknown> | undefined) ?? {};

  const relPath = deriveRelPath({
    kind, domain, title,
    memoryId: draft["memory_id"] as number | null | undefined,
    conceptId: draft["concept_id"] as number | null | undefined,
    kindDir,
  });

  const now = nowIso();
  const frontmatter: Record<string, unknown> = {
    title, kind, domain,
    status: fmExisting["status"] ?? "seedling",
    lifecycle_state: fmExisting["lifecycle_state"] ?? "active",
    memory_id: draft["memory_id"] ?? null,
    concept_id: draft["concept_id"] ?? null,
    draft_id: draft["id"] ?? null,
    synth_model: draft["synth_model"] ?? null,
    created: fmExisting["created"] ?? now,
    updated: now,
  };
  for (const [k, v] of Object.entries(fmExisting)) {
    if (!(k in frontmatter)) frontmatter[k] = v;
  }

  const bodyParts: string[] = [];
  bodyParts.push(`# ${title}\n`);
  if (lead) bodyParts.push(`${lead}\n`);

  for (const s of sections) {
    const heading = typeof s === "object"
      ? (s["heading"] as string | undefined) ?? ""
      : "";
    const body = typeof s === "object"
      ? (s["body"] as string | undefined) ?? ""
      : "";
    if (!heading) continue;
    bodyParts.push(sectionMd(heading, body));
  }

  if (backlinks && backlinks.length > 0) {
    bodyParts.push("## See also\n");
    for (const b of backlinks) {
      const slug = b.slug ?? "";
      const label = b.title ?? slug;
      const kindHint = b.link_kind ?? "";
      const suffix = (kindHint && kindHint !== "see-also") ? ` _(${kindHint})_` : "";
      bodyParts.push(`- [[${slug}|${label}]]${suffix}\n`);
    }
  }

  let md = buildFrontmatter(frontmatter) + "\n\n" + bodyParts.join("\n");
  // Normalize trailing whitespace (mirror Python: re.sub(r"\n{3,}", "\n\n", md))
  md = md.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

  return [relPath, md, frontmatter];
}
