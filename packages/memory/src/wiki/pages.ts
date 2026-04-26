/**
 * Wiki page templates + frontmatter parser — pure, deterministic.
 *
 * Builds the markdown body for each page kind (ADR, spec, file doc, note).
 * Also parses YAML-style frontmatter (---…---) into a plain dict so
 * handlers can round-trip metadata without depending on a YAML library.
 *
 * Design intent: pages are *authored* content, not derived views. Templates
 * provide sensible sections; the body is whatever the caller passes in.
 *
 * source: mcp_server/core/wiki_pages.py
 */

import { PAGE_KINDS } from "./layout.js";

export const ADR_STATUSES = [
  "proposed",
  "accepted",
  "rejected",
  "superseded",
  "deprecated",
] as const;

export type AdrStatus = typeof ADR_STATUSES[number];

export interface PageDocument {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatFrontmatter(fm: Record<string, unknown>): string {
  if (!fm || Object.keys(fm).length === 0) return "";
  const lines = ["---"];
  for (const key of Object.keys(fm).sort()) {
    const value = fm[key];
    let rendered: string;
    if (Array.isArray(value)) {
      rendered = "[" + value.map(String).join(", ") + "]";
    } else if (value == null) {
      rendered = "";
    } else {
      rendered = String(value);
    }
    lines.push(`${key}: ${rendered}`);
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

function stripInlineList(value: string): string[] {
  let inner = value.trim();
  if (inner.startsWith("[") && inner.endsWith("]")) {
    inner = inner.slice(1, -1);
  }
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse a page's frontmatter + body. Tolerant of missing frontmatter.
 */
export function parsePage(text: string): PageDocument {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { frontmatter: {}, body: text };
  }
  const lines = text.split("\n");
  if (!lines[0] || lines[0].trim() !== "---") {
    return { frontmatter: {}, body: text };
  }

  const fm: Record<string, unknown> = {};
  let bodyStart = lines.length;

  for (let idx = 1; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line) continue;
    if (line.trim() === "---") {
      bodyStart = idx + 1;
      break;
    }
    if (!line.includes(":")) continue;
    const colonIdx = line.indexOf(":");
    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      fm[key] = stripInlineList(raw);
    } else {
      fm[key] = raw;
    }
  }

  let bodyLines = lines.slice(bodyStart);
  while (bodyLines.length > 0 && bodyLines[0] === "") {
    bodyLines = bodyLines.slice(1);
  }

  return { frontmatter: fm, body: bodyLines.join("\n") };
}

/**
 * Render a PageDocument back to markdown text.
 */
export function renderPage(doc: PageDocument): string {
  const header = formatFrontmatter(doc.frontmatter as Record<string, unknown>);
  if (header && doc.body) {
    return header + doc.body + (doc.body.endsWith("\n") ? "" : "\n");
  }
  if (header) return header;
  return doc.body ? doc.body + (doc.body.endsWith("\n") ? "" : "\n") : "";
}

export interface BuildAdrArgs {
  readonly number: number;
  readonly title: string;
  readonly context: string;
  readonly decision: string;
  readonly consequences: string;
  readonly status?: AdrStatus;
  readonly tags?: readonly string[];
}

/**
 * Render an ADR page body + frontmatter.
 */
export function buildAdr(args: BuildAdrArgs): string {
  const status = args.status ?? "accepted";
  if (!(ADR_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`unknown ADR status: ${status}`);
  }
  const fm: Record<string, unknown> = {
    kind: "adr",
    number: String(args.number).padStart(4, "0"),
    title: args.title,
    status,
    created: nowIso(),
    tags: args.tags ?? ["adr"],
  };
  const body =
    `# ADR-${String(args.number).padStart(4, "0")}: ${args.title}\n\n` +
    `## Status\n\n${status}\n\n` +
    `## Context\n\n${args.context}\n\n` +
    `## Decision\n\n${args.decision}\n\n` +
    `## Consequences\n\n${args.consequences}\n`;
  return renderPage({ frontmatter: fm, body });
}

export interface BuildSpecArgs {
  readonly title: string;
  readonly summary: string;
  readonly body?: string;
  readonly tags?: readonly string[];
}

/**
 * Render a spec / PRD / design doc page.
 */
export function buildSpec(args: BuildSpecArgs): string {
  const fm: Record<string, unknown> = {
    kind: "spec",
    title: args.title,
    created: nowIso(),
    tags: args.tags ?? ["spec"],
  };
  let pageBody = `# ${args.title}\n\n## Summary\n\n${args.summary}\n`;
  if (args.body) {
    pageBody += `\n## Detail\n\n${args.body}\n`;
  }
  return renderPage({ frontmatter: fm, body: pageBody });
}

export interface BuildFileDocArgs {
  readonly file_path: string;
  readonly purpose: string;
  readonly body?: string;
  readonly tags?: readonly string[];
}

/**
 * Render a per-source-file documentation page.
 */
export function buildFileDoc(args: BuildFileDocArgs): string {
  const fm: Record<string, unknown> = {
    kind: "file",
    file: args.file_path,
    created: nowIso(),
    tags: args.tags ?? ["file"],
  };
  let pageBody = `# \`${args.file_path}\`\n\n## Purpose\n\n${args.purpose}\n`;
  if (args.body) {
    pageBody += `\n## Notes\n\n${args.body}\n`;
  }
  return renderPage({ frontmatter: fm, body: pageBody });
}

export interface BuildNoteArgs {
  readonly title: string;
  readonly body: string;
  readonly tags?: readonly string[];
  readonly updated?: string;
}

/**
 * Render a free-form note / investigation.
 */
export function buildNote(args: BuildNoteArgs): string {
  const fm: Record<string, unknown> = {
    kind: "note",
    title: args.title,
    created: nowIso(),
    tags: args.tags ?? ["note"],
  };
  if (args.updated) {
    (fm as Record<string, unknown>)["updated"] = args.updated;
  }
  return renderPage({ frontmatter: fm, body: `# ${args.title}\n\n${args.body}\n` });
}

export function maturityLabel(sourceCount: number): string {
  if (sourceCount >= 8) return "stable";
  if (sourceCount >= 4) return "reviewed";
  if (sourceCount >= 2) return "draft";
  return "stub";
}

function sourcesSection(sourceIds: readonly (number | string)[] | null | undefined): string {
  if (!sourceIds || sourceIds.length === 0) {
    return "\n## Sources\n\n*Auto-generated from memory system.*\n";
  }
  const items = sourceIds.map((sid) => `- Memory #${sid}`).join("\n");
  return `\n## Sources\n\n${items}\n`;
}

function relatedSection(): string {
  return "\n## Related\n\n*No cross-links yet.*\n";
}

export interface BuildLessonArgs {
  readonly title: string;
  readonly situation: string;
  readonly mistake: string;
  readonly fix: string;
  readonly rule: string;
  readonly domain?: string;
  readonly tags?: readonly string[];
  readonly created?: string;
  readonly updated?: string;
  readonly source_ids?: readonly (number | string)[];
}

/**
 * Render a lesson-learned page.
 */
export function buildLesson(args: BuildLessonArgs): string {
  const sc = args.source_ids ? args.source_ids.length : 1;
  const fm: Record<string, unknown> = {
    kind: "lesson",
    title: args.title,
    domain: args.domain ?? "",
    created: args.created ?? nowIso(),
    maturity: maturityLabel(sc),
    source_count: sc,
    tags: args.tags ?? ["lesson"],
  };
  if (args.updated) fm["updated"] = args.updated;
  const body =
    `# ${args.title}\n\n` +
    `## Situation\n\n${args.situation}\n\n` +
    `## What Went Wrong\n\n${args.mistake}\n\n` +
    `## Fix Applied\n\n${args.fix}\n\n` +
    `## Rule for the Future\n\n${args.rule}\n` +
    sourcesSection(args.source_ids) +
    relatedSection();
  return renderPage({ frontmatter: fm, body });
}

export interface BuildConventionArgs {
  readonly title: string;
  readonly rule: string;
  readonly rationale: string;
  readonly scope?: string;
  readonly domain?: string;
  readonly tags?: readonly string[];
  readonly created?: string;
  readonly updated?: string;
  readonly source_ids?: readonly (number | string)[];
}

/**
 * Render a convention/standard page.
 */
export function buildConvention(args: BuildConventionArgs): string {
  const sc = args.source_ids ? args.source_ids.length : 1;
  const fm: Record<string, unknown> = {
    kind: "convention",
    title: args.title,
    domain: args.domain ?? "",
    created: args.created ?? nowIso(),
    maturity: maturityLabel(sc),
    source_count: sc,
    tags: args.tags ?? ["convention"],
  };
  if (args.updated) fm["updated"] = args.updated;
  let body = `# ${args.title}\n\n## Rule\n\n${args.rule}\n\n## Rationale\n\n${args.rationale}\n`;
  if (args.scope) {
    body += `\n## Scope\n\n${args.scope}\n`;
  }
  body += sourcesSection(args.source_ids) + relatedSection();
  return renderPage({ frontmatter: fm, body });
}

export interface BuildReferenceArgs {
  readonly title: string;
  readonly overview: string;
  readonly architecture?: string;
  readonly api?: string;
  readonly domain?: string;
  readonly tags?: readonly string[];
  readonly created?: string;
  readonly updated?: string;
  readonly source_ids?: readonly (number | string)[];
}

/**
 * Render a reference page — current truth about a component.
 */
export function buildReference(args: BuildReferenceArgs): string {
  const sc = args.source_ids ? args.source_ids.length : 1;
  const fm: Record<string, unknown> = {
    kind: "reference",
    title: args.title,
    domain: args.domain ?? "",
    created: args.created ?? nowIso(),
    maturity: maturityLabel(sc),
    source_count: sc,
    tags: args.tags ?? ["reference"],
  };
  if (args.updated) fm["updated"] = args.updated;
  let body = `# ${args.title}\n\n## Overview\n\n${args.overview}\n`;
  if (args.architecture) {
    body += `\n## Architecture\n\n${args.architecture}\n`;
  }
  if (args.api) {
    body += `\n## API / Interface\n\n${args.api}\n`;
  }
  body += sourcesSection(args.source_ids) + relatedSection();
  return renderPage({ frontmatter: fm, body });
}

/**
 * Build a structured INDEX.md grouped by domain then kind.
 *
 * Each path is relative to the wiki root. Supports both flat
 * (``notes/foo.md``) and domain-scoped (``notes/cortex/foo.md``) paths.
 * Pure function — no I/O.
 */
export function buildIndex(pagePaths: readonly string[]): string {
  const KIND_LABELS: Record<string, string> = {
    adr: "Architecture Decisions",
    specs: "Specifications",
    guides: "Guides & How-To",
    reference: "Reference",
    conventions: "Conventions",
    lessons: "Lessons Learned",
    notes: "Notes",
    journal: "Journal",
    files: "File Documentation",
  };

  type Entry = { kind: string; domain: string; filename: string; path: string };
  const entries: Entry[] = [];

  for (const p of pagePaths) {
    const parts = p.split("/");
    const kind = parts[0];
    if (!kind || !(PAGE_KINDS as readonly string[]).includes(kind)) continue;
    if (parts.length >= 3) {
      entries.push({ kind, domain: parts[1] ?? "_general", filename: parts[parts.length - 1]?.replace(/\.md$/, "") ?? "", path: p });
    } else {
      entries.push({ kind, domain: "_general", filename: parts[parts.length - 1]?.replace(/\.md$/, "") ?? "", path: p });
    }
  }

  const total = entries.length;
  const domains = [...new Set(entries.map((e) => e.domain))];
  const domainCount = domains.filter((d) => d !== "_general").length;

  const tree: Record<string, Record<string, Array<[string, string]>>> = {};
  for (const { kind, domain, filename, path } of entries) {
    if (!tree[domain]) tree[domain] = {};
    if (!tree[domain]![kind]) tree[domain]![kind] = [];
    tree[domain]![kind]!.push([filename, path]);
  }

  const lines = [
    "# Cortex Knowledge Base",
    "",
    `**${total} pages** across ${domainCount} domains`,
    "",
  ];

  const sortedDomains = Object.keys(tree).sort((a, b) => {
    if (a === "_general") return 1;
    if (b === "_general") return -1;
    return a.localeCompare(b);
  });

  for (const domain of sortedDomains) {
    const kinds = tree[domain]!;
    const pageCount = Object.values(kinds).reduce((s, ps) => s + ps.length, 0);
    const label = domain === "_general" ? "Global" : domain.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`## ${label} (${pageCount} pages)`);
    lines.push("");

    for (const kind of PAGE_KINDS) {
      const pages = kinds[kind];
      if (!pages || pages.length === 0) continue;
      const kindLabel = KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
      lines.push(`### ${kindLabel}`);
      lines.push("");
      for (const [filename, path] of [...pages].sort()) {
        lines.push(`- [${filename}](${path})`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
