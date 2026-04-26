/**
 * Self-hosting wiki schema loader.
 *
 * The wiki describes its own schema. Kinds, classifier rules, views, and
 * triggers all live as markdown pages under reserved folders:
 *
 *   wiki/_kinds/    — kind definitions
 *   wiki/_rules/    — classifier rules (markdown tables: pattern → kind)
 *   wiki/_views/    — saved queries (fenced cortex-query blocks)
 *   wiki/_triggers/ — trigger declarations
 *
 * This module is the READER — parses these files at boot and returns
 * typed in-memory registries. No writes. Never raises; missing folders
 * produce empty registries.
 *
 * The TS port uses sync fs reads to match the Python original which
 * is called at boot time (not in an async context).
 *
 * source: mcp_server/core/wiki_schema_loader.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parsePage } from "./pages.js";

// ── Registry types ────────────────────────────────────────────────────────

export interface KindDefinition {
  readonly name: string;
  readonly display_name: string;
  readonly dir_name: string;
  readonly required_sections: readonly string[];
  readonly optional_sections: readonly string[];
  readonly parent_kind: string | null;
  readonly autofill_prompt: string;
}

export interface ClassifierRule {
  readonly pattern: string;
  readonly pattern_kind: string;
  readonly target_kind: string | null;
  readonly weight: number;
  readonly note: string;
}

export interface ViewDefinition {
  readonly name: string;
  readonly rel_path: string;
  readonly query: string;
  readonly description: string;
}

export interface TriggerDefinition {
  readonly name: string;
  readonly event: string;
  readonly condition: string;
  readonly action: string;
}

export interface WikiRegistry {
  readonly kinds: Readonly<Record<string, KindDefinition>>;
  readonly rules: readonly ClassifierRule[];
  readonly views: Readonly<Record<string, ViewDefinition>>;
  readonly triggers: Readonly<Record<string, TriggerDefinition>>;
  readonly known_kind_names: ReadonlySet<string>;
}

// ── Parsers ───────────────────────────────────────────────────────────────

function parseKind(relPath: string, content: string): KindDefinition | null {
  const doc = parsePage(content);
  const fm = doc.frontmatter;
  const name = (fm["name"] as string | undefined) ?? path.basename(relPath, ".md");
  if (!name) return null;

  const toStringArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string" && v) return [v];
    return [];
  };

  return {
    name,
    display_name: String(fm["display_name"] ?? name),
    dir_name: String(fm["dir_name"] ?? name + "s"),
    required_sections: toStringArray(fm["required_sections"]),
    optional_sections: toStringArray(fm["optional_sections"]),
    parent_kind: (fm["parent_kind"] as string | null | undefined) ?? null,
    autofill_prompt: String(fm["autofill_prompt"] ?? ""),
  };
}

const TABLE_ROW_RE = /^\|(.+)\|$/gm;

function parseRulesTable(body: string): ClassifierRule[] {
  const rows: string[] = [];
  let m: RegExpExecArray | null;
  const re = /^\|(.+)\|$/gm;
  while ((m = re.exec(body)) !== null) {
    rows.push(m[1]!);
  }
  if (rows.length < 2) return [];

  const headerCells = rows[0]!.split("|").map((c) => c.trim().toLowerCase());
  const rules: ClassifierRule[] = [];

  for (const row of rows.slice(2)) {
    const cells = row.split("|").map((c) => c.trim());
    if (cells.length !== headerCells.length) continue;

    const r: Record<string, string> = {};
    headerCells.forEach((h, i) => { r[h] = cells[i] ?? ""; });

    if (!r["pattern"] || !r["kind"]) continue;

    let target: string | null = r["target"] ?? null;
    if (target === "reject" || target === "-" || target === "") {
      target = null;
    }

    let weight = 1.0;
    const rawWeight = r["weight"];
    if (rawWeight) {
      const parsed = parseFloat(rawWeight);
      if (!isNaN(parsed)) weight = parsed;
    }

    rules.push({
      pattern: r["pattern"]!,
      pattern_kind: r["kind"]!,
      target_kind: target,
      weight,
      note: r["note"] ?? "",
    });
  }

  return rules;
}

const QUERY_BLOCK_RE = /```cortex-query\n([\s\S]*?)\n```/;

function parseView(relPath: string, content: string): ViewDefinition | null {
  const doc = parsePage(content);
  const m = QUERY_BLOCK_RE.exec(doc.body);
  if (!m) return null;
  const fm = doc.frontmatter;
  return {
    name: String(fm["name"] ?? path.basename(relPath, ".md")),
    rel_path: relPath,
    query: m[1]!.trim(),
    description: String(fm["description"] ?? ""),
  };
}

function parseTrigger(relPath: string, content: string): TriggerDefinition | null {
  const doc = parsePage(content);
  const fm = doc.frontmatter;
  const event = fm["event"];
  if (!event) return null;
  return {
    name: String(fm["name"] ?? path.basename(relPath, ".md")),
    event: String(event),
    condition: String(fm["condition"] ?? ""),
    action: String(fm["action"] ?? ""),
  };
}

// ── Loader ────────────────────────────────────────────────────────────────

function loadFolderDirect<T extends { name?: string }>(
  wikiRoot: string,
  folder: string,
  parser: (relPath: string, content: string) => T | null,
): Record<string, T> {
  const results: Record<string, T> = {};
  const full = path.join(wikiRoot, folder);
  if (!fs.existsSync(full)) return results;

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const relPath = path.relative(wikiRoot, entryPath).replace(/\\/g, "/");
        try {
          const content = fs.readFileSync(entryPath, "utf-8");
          const parsed = parser(relPath, content);
          if (parsed !== null) {
            const key = (parsed as { name?: string }).name ?? relPath;
            results[key] = parsed;
          }
        } catch {
          // skip unparseable files — never raises
        }
      }
    }
  }

  walk(full);
  return results;
}

/**
 * Read the self-hosting schema files and return the registry.
 *
 * Safe to call at boot, after wiki_migrate, or on-demand. Missing
 * folders yield empty sub-registries — no raises.
 */
export function loadRegistry(wikiRoot: string): WikiRegistry {
  const kinds = loadFolderDirect(wikiRoot, "_kinds", parseKind);

  const rules: ClassifierRule[] = [];
  const rulesDir = path.join(wikiRoot, "_rules");
  if (fs.existsSync(rulesDir)) {
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          try {
            const content = fs.readFileSync(entryPath, "utf-8");
            const body = parsePage(content).body;
            rules.push(...parseRulesTable(body));
          } catch {
            // skip
          }
        }
      }
    };
    walk(rulesDir);
  }

  const views = loadFolderDirect(wikiRoot, "_views", parseView);
  const triggers = loadFolderDirect(wikiRoot, "_triggers", parseTrigger);

  return {
    kinds,
    rules,
    views,
    triggers,
    known_kind_names: new Set(Object.keys(kinds)),
  };
}

