/**
 * Handler: wiki-purge — remove wiki pages that fail the current classifier.
 *
 * Re-evaluates every authored wiki page against the current classifier rules
 * and deletes the ones that would no longer be admitted. Memories in the
 * PostgreSQL/SQLite store are left untouched — only the markdown files are
 * removed.
 *
 * source: mcp_server/handlers/wiki_purge.py
 */

import { classifyMemory } from "../page-classifier.js";
import { parsePage } from "../pages.js";
import type { WikiKind } from "../types.js";

const PAGE_DIRS = new Set(["adr", "conventions", "guides", "journal", "lessons", "notes", "reference", "specs"]);

export interface WikiPurgeArgs {
  readonly apply?: boolean;
  readonly kind?: WikiKind | null;
}

export interface WikiPurgeResult {
  readonly applied: boolean;
  readonly scanned: number;
  readonly kept: number;
  readonly purged: number;
  readonly purged_paths: readonly string[];
  readonly errors: readonly string[];
  readonly root: string;
}

export type WikiPurgeResponse = WikiPurgeResult | { readonly error: string };

export interface PageEntry {
  readonly relPath: string;
  readonly content: string;
}

export interface WikiPurgeDeps {
  readonly wikiRoot: string;
  readonly listAllMarkdownFiles: (root: string, kindFilter?: WikiKind | null) => Promise<PageEntry[]>;
  readonly deleteFile: (absPath: string) => Promise<void>;
  readonly removeEmptyDirs?: (root: string) => Promise<void>;
  readonly wikiRoot_string: string;
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string") return [];
  const stripped = raw.trim().replace(/^\[|\]$/g, "");
  return stripped.split(",").map((t) => t.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

function evaluatePage(content: string): [string | null, string[]] {
  const doc = parsePage(content);
  const tags = parseTags(doc.frontmatter["tags"]);
  let body = doc.body;
  const lines = body.trim().split("\n");
  const bodyLines = lines[0]?.startsWith("# ") ? lines.slice(1) : lines;
  const bodyText = bodyLines.join("\n").trim() || String(doc.frontmatter["title"] ?? "");
  return [classifyMemory(bodyText, tags), tags];
}

export async function handler(
  args: WikiPurgeArgs,
  deps: WikiPurgeDeps,
): Promise<WikiPurgeResponse> {
  const apply = args.apply ?? false;
  const kindFilter = args.kind ?? null;

  if (!deps.wikiRoot) return { error: "wiki root not configured" };

  let entries: PageEntry[];
  try {
    entries = await deps.listAllMarkdownFiles(deps.wikiRoot, kindFilter);
  } catch (err) {
    return { error: `wiki root does not exist or cannot be listed: ${String(err)}` };
  }

  const kept: string[] = [];
  const purged: string[] = [];
  const errors: string[] = [];

  for (const { relPath, content } of entries) {
    const firstSegment = relPath.split("/")[0] ?? "";
    if (!PAGE_DIRS.has(firstSegment)) continue;

    try {
      const [decision] = evaluatePage(content);
      if (decision === null) {
        purged.push(relPath);
        if (apply) {
          await deps.deleteFile(`${deps.wikiRoot}/${relPath}`).catch((err: unknown) => {
            errors.push(`${relPath}: ${String(err)}`);
          });
        }
      } else {
        kept.push(relPath);
      }
    } catch (err) {
      errors.push(`${relPath}: ${String(err)}`);
    }
  }

  if (apply && purged.length && deps.removeEmptyDirs) {
    await deps.removeEmptyDirs(deps.wikiRoot).catch(() => undefined);
  }

  return {
    applied: apply,
    scanned: kept.length + purged.length,
    kept: kept.length,
    purged: purged.length,
    purged_paths: purged,
    errors,
    root: deps.wikiRoot,
  };
}

export const schema = {
  title: "Wiki — purge stale",
  description:
    "Re-evaluate every authored wiki page against the current classifier " +
    "and delete the ones that no longer pass the admission gate. " +
    "Defaults to dry-run; pass apply=true to actually delete.",
  inputSchema: {
    type: "object" as const,
    required: [] as const,
    properties: {
      apply: { type: "boolean" as const, default: false },
      kind: { type: "string" as const, enum: [...PAGE_DIRS] as string[] },
    },
  },
} as const;
