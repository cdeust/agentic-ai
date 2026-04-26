/**
 * Handler: wiki-read — fetch the raw markdown of a wiki page.
 *
 * source: mcp_server/handlers/wiki_read.py
 */

export interface WikiReadArgs {
  readonly path: string;
}

export interface WikiReadResult {
  readonly path: string;
  readonly content: string;
  readonly root: string;
}

export type WikiReadResponse = WikiReadResult | { readonly error: string };

export interface WikiReadDeps {
  readonly wikiRoot: string;
  readonly readPage: (root: string, relPath: string) => Promise<string | null>;
}

export async function handler(
  args: WikiReadArgs,
  deps: WikiReadDeps,
): Promise<WikiReadResponse> {
  const relPath = (args.path ?? "").trim();
  if (!relPath) return { error: "path is required" };

  try {
    const content = await deps.readPage(deps.wikiRoot, relPath);
    if (content === null) return { error: `page not found: ${relPath}` };
    return { path: relPath, content, root: deps.wikiRoot };
  } catch (err) {
    return { error: `read failed: ${String(err)}` };
  }
}

export const schema = {
  title: "Wiki — read page",
  description:
    "Fetch the raw markdown source of one wiki page by its wiki-relative path. " +
    "Path resolution is sandboxed under the wiki root. Read-only; never mutates state.",
  inputSchema: {
    type: "object" as const,
    required: ["path"],
    properties: {
      path: {
        type: "string" as const,
        description: "Wiki-relative path of the page to read (no leading slash, no ..).",
        examples: ["adr/0042-pgvector.md", "specs/cortex/recall-pipeline.md"],
      },
    },
  },
} as const;
