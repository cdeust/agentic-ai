/**
 * Handler: wiki-list — enumerate authored wiki pages.
 *
 * source: mcp_server/handlers/wiki_list.py
 */

import { PAGE_KINDS } from "../layout.js";
import type { WikiKind } from "../types.js";

export interface WikiListArgs {
  readonly kind?: WikiKind | null;
}

export interface WikiListResult {
  readonly root: string;
  readonly count: number;
  readonly pages: readonly string[];
}

export type WikiListResponse = WikiListResult | { readonly error: string };

export interface WikiListDeps {
  readonly wikiRoot: string;
  readonly listPages: (root: string, kind?: WikiKind | null) => Promise<string[]>;
}

export async function handler(
  args: WikiListArgs,
  deps: WikiListDeps,
): Promise<WikiListResponse> {
  const kind = args.kind ?? null;
  if (kind && !(PAGE_KINDS as readonly string[]).includes(kind)) {
    return { error: `unknown kind: ${kind}` };
  }
  try {
    const pages = await deps.listPages(deps.wikiRoot, kind);
    return { root: deps.wikiRoot, count: pages.length, pages };
  } catch (err) {
    return { error: `list failed: ${String(err)}` };
  }
}

export const schema = {
  title: "Wiki — list pages",
  description:
    "Enumerate every authored wiki page under ~/.claude/methodology/wiki/, " +
    "filesystem-walked from the wiki root. Optionally restrict by kind.",
  inputSchema: {
    type: "object" as const,
    required: [] as const,
    properties: {
      kind: {
        type: "string" as const,
        enum: [...PAGE_KINDS] as string[],
        description: "Restrict the listing to a single page kind.",
      },
    },
  },
} as const;
