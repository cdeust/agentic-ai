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

  const lines = [
    "---",
    `title: Process — ${entry}`,
    "kind: reference",
    `tags: [code-reference, process, ${kind}]`,
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
   */
  const written: string[] = [];
  for (const proc of processes) {
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
  return written;
}
