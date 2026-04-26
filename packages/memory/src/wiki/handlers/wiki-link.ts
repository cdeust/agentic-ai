/**
 * Handler: wiki-link — add a bidirectional link between two wiki pages.
 *
 * Updates the ## Related section of both files, writing the forward
 * relation on the source and the inverse on the target. Idempotent.
 *
 * source: mcp_server/handlers/wiki_link.py
 */

import { RELATIONS, applyLink, inverseOf } from "../links.js";
import type { LinkEntry } from "../links.js";
import { WikiMissing } from "../types.js";

export interface WikiLinkArgs {
  readonly from_path: string;
  readonly to_path: string;
  readonly relation: string;
}

export interface WikiLinkResult {
  readonly from_path: string;
  readonly to_path: string;
  readonly relation: string;
  readonly inverse: string;
}

export type WikiLinkResponse = WikiLinkResult | { readonly error: string };

export interface WikiLinkDeps {
  readonly wikiRoot: string;
  readonly readPage: (root: string, relPath: string) => Promise<string | null>;
  readonly writePage: (root: string, relPath: string, content: string, mode: string) => Promise<{ path: string; mode: string; created: boolean; bytes_written: number }>;
}

async function updatePage(
  relPath: string,
  entry: LinkEntry,
  deps: WikiLinkDeps,
): Promise<void> {
  const current = await deps.readPage(deps.wikiRoot, relPath);
  if (current === null) throw new WikiMissing(relPath);
  const updated = applyLink(current, entry);
  await deps.writePage(deps.wikiRoot, relPath, updated, "replace");
}

export async function handler(
  args: WikiLinkArgs,
  deps: WikiLinkDeps,
): Promise<WikiLinkResponse> {
  const fromPath = (args.from_path ?? "").trim();
  const toPath = (args.to_path ?? "").trim();
  const relation = (args.relation ?? "").trim();

  if (!fromPath || !toPath || !relation) {
    return { error: "from_path, to_path, and relation are required" };
  }
  if (!RELATIONS[relation]) {
    return { error: `unknown relation: ${relation}` };
  }

  try {
    await updatePage(fromPath, { relation, target: toPath }, deps);
    await updatePage(toPath, { relation: inverseOf(relation), target: fromPath }, deps);
  } catch (err) {
    if (err instanceof WikiMissing) return { error: `page not found: ${String(err.message)}` };
    return { error: `link failed: ${String(err)}` };
  }

  return { from_path: fromPath, to_path: toPath, relation, inverse: inverseOf(relation) };
}

export const schema = {
  title: "Wiki — link pages",
  description:
    "Add a bidirectional link between two wiki pages: write the forward " +
    "relation into the ## Related section of the source page and the " +
    "inverse relation into the target page, in one idempotent operation.",
  inputSchema: {
    type: "object" as const,
    required: ["from_path", "to_path", "relation"],
    properties: {
      from_path: { type: "string" as const },
      to_path: { type: "string" as const },
      relation: { type: "string" as const, enum: Object.keys(RELATIONS) },
    },
  },
} as const;
