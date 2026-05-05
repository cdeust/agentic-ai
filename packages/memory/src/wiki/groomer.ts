/**
 * Wiki grooming — drift detection against templates + naming conventions.
 *
 * The grooming system has two parts:
 *
 *   1. Auditor (this module, deterministic): scans every wiki page,
 *      reports drift against the page's kind template. Fast, runs every
 *      consolidate cycle. Produces a structured list of issues (missing
 *      front-matter, wrong status value, non-canonical slug, missing
 *      required section).
 *
 *   2. Rewriter (agents/cortex-wiki-groomer.md, LLM): handed the
 *      audit output + the raw page, rewrites to the template while
 *      preserving content semantics. Runs on-demand when the auditor
 *      reports issues, or when the user invokes /cortex:groom-wiki.
 *
 * This module is pure-functional — no I/O, no LLM calls. The auditor's
 * output is structured so tests can assert on it and the LLM rewriter
 * has an unambiguous work list.
 *
 * source: mcp_server/core/wiki_groomer.py (Cortex ed33435)
 */

import { PAGE_KINDS } from "./layout.js";
import { requiredFields, validStatusValues, namingConvention } from "./templates.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type GroomIssueKind =
  | "missing_frontmatter"
  | "invalid_status"
  | "non_canonical_slug"
  | "missing_section"
  | "manual_override"
  | "unknown_kind";

export interface GroomIssue {
  readonly kind: GroomIssueKind;
  readonly detail: string;
  readonly suggestion: string;
}

export interface PageAudit {
  readonly page_path: string;
  readonly page_kind: string | null;
  readonly issues: readonly GroomIssue[];
  readonly has_issues: boolean;
}

// ── Front-matter parser ───────────────────────────────────────────────────────

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;

/**
 * Split a Markdown file into (frontmatter_dict, body).
 *
 * Precondition: content is a string (may be empty).
 * Postcondition: returns empty dict + full content when no frontmatter present.
 * Does NOT require a YAML library — parses limited key: value subset.
 *
 * source: mcp_server/core/wiki_groomer.py:68-96
 */
export function parseFrontmatter(content: string): [Record<string, string>, string] {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return [{}, content];

  const raw = match[1]!;
  const body = content.slice(match[0]!.length);
  const frontmatter: Record<string, string> = {};

  for (const line of raw.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!trimmed.includes(":")) continue;

    const colonIdx = trimmed.indexOf(":");
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();

    // Strip surrounding quotes
    if (
      value.length >= 2 &&
      value[0] === value[value.length - 1] &&
      (value[0] === "'" || value[0] === '"')
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return [frontmatter, body];
}

// ── Auditor ──────────────────────────────────────────────────────────────────

/**
 * Infer page kind from the wiki-relative path.
 *
 * Precondition: pagePath is a forward-slash-separated wiki-relative path.
 * Postcondition: returns kind string if first segment is a PAGE_KIND, else null.
 *
 * source: mcp_server/core/wiki_groomer.py:102-113
 */
export function inferKindFromPath(pagePath: string): string | null {
  const parts = pagePath.split("/");
  if (!parts.length) return null;
  const first = parts[0]!;
  return (PAGE_KINDS as readonly string[]).includes(first) ? first : null;
}

/**
 * Audit a single page against its kind's template + naming rule.
 *
 * Precondition: pagePath is wiki-relative; content is the full file text.
 * Postcondition: returns PageAudit with issues=[]; means the page is clean.
 *   When frontmatter declares grooming: manual, emits a single manual_override.
 *
 * source: mcp_server/core/wiki_groomer.py:116-190
 */
export function auditPage(pagePath: string, content: string): PageAudit {
  const issues: GroomIssue[] = [];
  const kind = inferKindFromPath(pagePath);

  if (kind === null) {
    return {
      page_path: pagePath,
      page_kind: null,
      issues: [
        {
          kind: "unknown_kind",
          detail: `path ${JSON.stringify(pagePath)} does not start with a known kind prefix`,
          suggestion: `move into one of: ${PAGE_KINDS.join(", ")}`,
        },
      ],
      has_issues: true,
    };
  }

  const [frontmatter] = parseFrontmatter(content);

  if (frontmatter["grooming"] === "manual") {
    return {
      page_path: pagePath,
      page_kind: kind,
      issues: [
        {
          kind: "manual_override",
          detail: "page opts out of grooming",
          suggestion: "skip (author-managed)",
        },
      ],
      has_issues: true,
    };
  }

  // 1. Required front-matter fields
  for (const fieldName of requiredFields(kind)) {
    if (!(fieldName in frontmatter) || frontmatter[fieldName] === "") {
      issues.push({
        kind: "missing_frontmatter",
        detail: `required field '${fieldName}' is missing or empty`,
        suggestion: `add '${fieldName}: <value>' to front-matter`,
      });
    }
  }

  // 2. Valid status value (when the kind has a status field)
  const validStatuses = validStatusValues(kind);
  if (validStatuses.length > 0 && "status" in frontmatter) {
    if (!validStatuses.includes(frontmatter["status"]!)) {
      issues.push({
        kind: "invalid_status",
        detail: `status=${JSON.stringify(frontmatter["status"])} is not one of ${JSON.stringify(validStatuses)}`,
        suggestion: `use one of: ${validStatuses.join(", ")}`,
      });
    }
  }

  // 3. Naming convention on the slug
  const slug = pagePath.split("/").pop()!.replace(/\.md$/, "");
  const convention = namingConvention(kind);
  if (!new RegExp(convention.pattern).test(slug)) {
    issues.push({
      kind: "non_canonical_slug",
      detail: `slug ${JSON.stringify(slug)} does not match pattern ${convention.pattern}`,
      suggestion: convention.description,
    });
  }

  return {
    page_path: pagePath,
    page_kind: kind,
    issues,
    has_issues: issues.length > 0,
  };
}

/**
 * Audit a batch of pages.
 *
 * Precondition: pages is an array of [path, content] tuples.
 * Postcondition: returns only audits with issues (groomed pages filtered out).
 *
 * source: mcp_server/core/wiki_groomer.py:193-205
 */
export function auditWiki(pages: ReadonlyArray<[string, string]>): PageAudit[] {
  const audits: PageAudit[] = [];
  for (const [pagePath, content] of pages) {
    const audit = auditPage(pagePath, content);
    if (audit.has_issues) audits.push(audit);
  }
  return audits;
}
