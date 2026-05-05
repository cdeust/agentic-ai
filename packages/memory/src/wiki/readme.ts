/**
 * Wiki README generation — plain-language top-level entry point.
 *
 * Generates a top-level README.md that is readable by non-technical
 * stakeholders:
 *   * What the wiki IS (one paragraph, plain language).
 *   * What lives WHERE (kind-labelled sections with a 1-line "what it's for").
 *   * How to NAVIGATE (auto-generated ToC + link to INDEX.md).
 *   * When it was last GROOMED (builds trust: "this is current").
 *
 * Pure function — takes page paths, returns Markdown string. Caller writes.
 *
 * source: mcp_server/core/wiki_readme.py (Cortex ed33435)
 */

import { PAGE_KINDS } from "./layout.js";

// source: mcp_server/core/wiki_readme.py:35-82
const KIND_PLAIN: Readonly<Record<string, [string, string]>> = {
  adr: [
    "Architecture Decisions",
    "Why we chose X over Y — the reasoning behind major design " +
      "choices. Read these to understand WHY the system looks the way it does.",
  ],
  specs: [
    "Specifications & Designs",
    "What we plan to build before we build it — feature specs, " +
      "design docs, PRDs. Read these to understand WHAT is coming.",
  ],
  guides: [
    "Guides & How-To",
    "Step-by-step instructions for common tasks. Read these when " +
      "you want to DO something.",
  ],
  reference: [
    "Reference",
    "API signatures, configuration keys, protocol formats. Read " +
      "these to LOOK UP an exact detail.",
  ],
  conventions: [
    "Conventions",
    "The rules the team follows (naming, style, contribution " +
      "process). Read these before proposing changes.",
  ],
  lessons: [
    "Lessons Learned",
    "Mistakes, root causes, and rules we now follow to avoid " +
      "repeating them. Read these to learn from past incidents.",
  ],
  notes: [
    "Notes & Investigations",
    "Work-in-progress thinking, exploratory analyses. Read these " +
      "for context on ongoing work.",
  ],
  journal: [
    "Journal",
    "Time-stamped entries of events, experiments, and sessions. " +
      "Read these for what happened and when.",
  ],
  files: [
    "File Documentation",
    "Per-source-file documentation (auto-generated from code " +
      "analysis). Read these for a map of the codebase.",
  ],
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Count pages per kind. Only kinds with >0 pages are returned.
 *
 * source: mcp_server/core/wiki_readme.py:85-92
 */
function countPages(pagePaths: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of pagePaths) {
    const first = p.split("/")[0] ?? "";
    if ((PAGE_KINDS as readonly string[]).includes(first)) {
      counts[first] = (counts[first] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Count pages per domain, excluding the catch-all _general.
 *
 * source: mcp_server/core/wiki_readme.py:95-105
 */
function countByDomain(pagePaths: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of pagePaths) {
    const parts = p.split("/");
    if (parts.length < 3) continue;
    if (!(PAGE_KINDS as readonly string[]).includes(parts[0]!)) continue;
    const domain = parts[1]!;
    counts[domain] = (counts[domain] ?? 0) + 1;
  }
  return counts;
}

// ── Main generator ────────────────────────────────────────────────────────

/**
 * Generate the top-level plain-language README.md for the wiki.
 *
 * Precondition: pagePaths is an array of wiki-relative page paths (forward slash).
 * Postcondition: returns a stable Markdown string. Same input produces same output
 *   modulo the generatedAt timestamp. Safe to write on every reindex.
 *
 * source: mcp_server/core/wiki_readme.py:108-211
 */
export function buildPlainReadme(
  pagePaths: readonly string[],
  opts: {
    readonly project_name?: string;
    readonly generated_at?: Date | null;
  } = {},
): string {
  const projectName = opts.project_name ?? "Cortex";
  const generatedAt = opts.generated_at ?? new Date();

  const total = pagePaths.filter(
    (p) => p && !p.startsWith(".generated/"),
  ).length;
  const kindCounts = countPages(pagePaths);
  const domainCounts = countByDomain(pagePaths);

  const lines: string[] = [];
  lines.push(`# ${projectName} Wiki`);
  lines.push("");
  lines.push(
    "This is your project's **living knowledge base** — " +
      "decisions, plans, how-tos, and lessons, kept tidy automatically " +
      "as the work happens.",
  );
  lines.push("");

  const kindCountKeys = Object.keys(kindCounts);
  const domainCountKeys = Object.keys(domainCounts);
  lines.push(
    `There are currently **${total} page${total !== 1 ? "s" : ""}** ` +
      `across **${kindCountKeys.length} categories**` +
      (domainCountKeys.length > 0
        ? ` and **${domainCountKeys.length} domains**.`
        : "."),
  );
  lines.push("");

  const groomedAt = generatedAt.toISOString().slice(0, 16).replace("T", " ");
  lines.push(`_Last groomed: ${groomedAt} UTC._`);
  lines.push("");

  lines.push("## What's here");
  lines.push("");
  for (const kind of PAGE_KINDS) {
    const count = kindCounts[kind] ?? 0;
    if (count === 0) continue;
    const entry = KIND_PLAIN[kind];
    const label = entry ? entry[0] : kind;
    const description = entry ? entry[1] : "";
    lines.push(`### ${label} (${count} page${count !== 1 ? "s" : ""})`);
    lines.push("");
    lines.push(description);
    lines.push("");
    lines.push(`-> Folder: [\`${kind}/\`](./${kind}/)`);
    lines.push("");
  }

  if (domainCountKeys.length > 0) {
    lines.push("## Covered domains");
    lines.push("");
    lines.push(
      "Each domain is a distinct area of the project. Pages are " +
        "filed under `<category>/<domain>/<page>.md`.",
    );
    lines.push("");
    const sorted = Object.entries(domainCounts).sort(([, a], [, b]) => b - a);
    for (const [domain, count] of sorted) {
      lines.push(`- **${domain}** — ${count} page${count !== 1 ? "s" : ""}`);
    }
    lines.push("");
  }

  lines.push("## Go deeper");
  lines.push("");
  lines.push(
    "The full table of contents (grouped by domain and category) " +
      "lives at [`.generated/INDEX.md`](./.generated/INDEX.md). " +
      "It's rebuilt automatically on every wiki write.",
  );
  lines.push("");
  lines.push(
    "Every page follows a consistent template per category — see " +
      "the [conventions folder](./conventions/) (if present) for the rules.",
  );
  lines.push("");

  lines.push("## For contributors");
  lines.push("");
  lines.push(
    "Pages are groomed by `cortex-wiki-groomer` (runs asynchronously " +
      "during `cortex:consolidate`). The groomer:",
  );
  lines.push("");
  lines.push("- Preserves every paragraph you wrote (no information loss).");
  lines.push("- Fills missing front-matter from context (or marks `unknown`).");
  lines.push("- Enforces naming conventions (kebab-slugs, 4-digit ADR IDs).");
  lines.push("- Skips any page whose front-matter declares `grooming: manual`.");
  lines.push("");
  lines.push(
    "To opt a page out of grooming, add `grooming: manual` to its " +
      "front-matter. Nothing you write by hand will ever be rewritten " +
      "without your consent.",
  );
  lines.push("");

  return lines.join("\n") + "\n";
}
