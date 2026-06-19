/* eslint-disable @typescript-eslint/no-magic-numbers -- source: process-page rendering constants (50-symbol cap, 80-char slug) copied from mcp_server/handlers/ingest_codebase_pages.py. */
/**
 * Wiki-page rendering for ingest-codebase processes.
 *
 * Ported from mcp_server/handlers/ingest_codebase_pages.py
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function _slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function renderProcessPage(
  process: Record<string, unknown>,
): [string, string] {
  /**
   * Return [relative_wiki_path, markdown] for a process page.
   */
  const entry =
    (process["entry_point"] as string) ?? (process["name"] as string) ?? "unknown";
  const kind = (process["entry_kind"] as string) ?? "entry";
  const depth =
    (process["bfs_depth"] as number) ?? (process["depth"] as number) ?? 0;
  const symbols = (process["symbols"] as unknown[]) ?? [];
  const symbolCount =
    (process["symbol_count"] as number) ?? symbols.length;
  const slug = _slug(entry) || "process";
  const relPath = `reference/codebase/${slug}.md`;

  // ADR-2244 Phase 6: codebase_analyze output is auto-generated reference
  // content. Setting ``provenance: auto-generated`` lets wiki_list / the
  // INDEX hide these pages from default views (Phase 5).
  const lines = [
    "---",
    `title: Process — ${entry}`,
    "kind: reference",
    "lifecycle: active",
    "audience: [developer]",
    "provenance: auto-generated",
    "generator:",
    "  model: codebase_analyze",
    "  version: ''",
    "  prompt_template: ''",
    `  generated_at: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    `tags: [code-reference, codebase, process, ${kind}]`,
    "---",
    "",
    `# Process — \`${entry}\``,
    "",
    `- **Entry kind:** ${kind}`,
    `- **BFS depth:** ${depth}`,
    `- **Symbols in flow:** ${symbolCount}`,
    "",
  ];

  if (symbols.length > 0) {
    lines.push("## Symbols reached");
    for (const sym of symbols.slice(0, 50)) {
      const qn = typeof sym === "string" ? sym : ((sym as Record<string, unknown>)["qualified_name"] as string) ?? "";
      if (qn) lines.push(`- \`${qn}\``);
    }
    if (symbols.length > 50) lines.push(`- … and ${symbols.length - 50} more.`);
    lines.push("");
  }

  return [relPath, lines.join("\n")];
}

export function writeProcessPages(
  processes: Record<string, unknown>[],
  wikiRoot: string,
): string[] {
  /**
   * Create wiki reference pages for each process. Returns paths written.
   *
   * 2026-05-17 (user feedback "the wiki is still far from being curated
   * documentation"): processes with zero symbols-in-flow produce a
   * 268-byte stub that carries no information. When the AST graph is
   * empty (the common case until ``analyze_codebase`` has been run for
   * a project) EVERY process page is empty — 1215 stubs in one audit,
   * 100% of reference/codebase/. Filter them out: a Process page
   * without symbols has nothing to document.
   *
   * source: cortex@83a6834 mcp_server/handlers/ingest_codebase_pages.py:54-85
   */
  const written: string[] = [];
  let skippedEmpty = 0;
  for (const proc of processes) {
    const symbols = (proc["symbols"] as unknown[]) ?? [];
    const symbolCount = (proc["symbol_count"] as number) ?? symbols.length;
    if (symbolCount === 0) {
      skippedEmpty += 1;
      continue;
    }
    try {
      const [relPath, markdown] = renderProcessPage(proc);
      const fullPath = join(wikiRoot, relPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, markdown, "utf8");
      written.push(relPath);
    } catch {
      // best-effort
    }
  }
  if (skippedEmpty > 0) {
    // Structured operator-facing audit line — to STDERR, never stdout: stdout is
    // the MCP JSON-RPC channel and a stray line there corrupts the framing.
    // source: cortex@83a6834 logger.info("skipped %d empty process pages")
    // source: packages/mcp-servers/memory/src/index.ts header (stderr-only rule)
    console.error(
      `[ingest-codebase-pages] skipped ${skippedEmpty} empty process pages (symbol_count=0)`,
    );
  }
  return written;
}
