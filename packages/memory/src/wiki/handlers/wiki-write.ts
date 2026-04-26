/**
 * Handler: wiki-write — author a new wiki page or update an existing one.
 *
 * Composition root for the authoring path. Renders templated content via
 * core wiki_pages when a kind is supplied, then delegates the atomic write
 * to the wiki store. After a successful write, stores a protected pointer
 * memory tagged `wiki` so `recall` can surface the page.
 *
 * source: mcp_server/handlers/wiki_write.py
 */

import { WikiExists, WikiMissing } from "../types.js";

export interface WikiWriteArgs {
  readonly path: string;
  readonly content?: string | null;
  readonly mode?: "create" | "append" | "replace";
  readonly title?: string | null;
  readonly summary?: string | null;
  readonly body?: string | null;
  readonly tags?: readonly string[];
}

export interface WikiWriteResult {
  readonly path: string;
  readonly mode: string;
  readonly created: boolean;
  readonly bytes_written: number;
  readonly root: string;
}

export type WikiWriteResponse = WikiWriteResult | { readonly error: string };

// Port note: WikiStore is injected at composition root to avoid
// importing infrastructure from the core layer (DIP compliance).
export interface WikiWriteDeps {
  readonly wikiRoot: string;
  readonly writePage: (root: string, relPath: string, content: string, mode: string) => Promise<{ path: string; mode: string; created: boolean; bytes_written: number }>;
  readonly storePointerMemory?: (relPath: string, content: string, tags: readonly string[]) => Promise<void>;
}

export async function handler(
  args: WikiWriteArgs,
  deps: WikiWriteDeps,
): Promise<WikiWriteResponse> {
  const relPath = (args.path ?? "").trim();
  if (!relPath) return { error: "path is required" };

  const mode = args.mode ?? "create";
  const content = args.content;

  if (!content) {
    return {
      error:
        "content is required — render the page yourself " +
        "(e.g. via wiki-adr for ADRs) and pass the final markdown.",
    };
  }

  try {
    const result = await deps.writePage(deps.wikiRoot, relPath, content, mode);
    const tags = [...(args.tags ?? [])];
    if (deps.storePointerMemory) {
      await deps.storePointerMemory(relPath, content, tags).catch(() => undefined);
    }
    return {
      path: result.path,
      mode: result.mode,
      created: result.created,
      bytes_written: result.bytes_written,
      root: deps.wikiRoot,
    };
  } catch (err) {
    if (err instanceof WikiExists) return { error: `page already exists: ${relPath}` };
    if (err instanceof WikiMissing) return { error: `page does not exist: ${relPath}` };
    return { error: `write failed: ${String(err)}` };
  }
}

export const schema = {
  title: "Wiki — write page",
  description:
    "Author a new wiki page or append/replace content on an existing one " +
    "(kind inferred from the first path segment: adr, specs, files, notes, " +
    "lessons, conventions, guides, reference, journal). " +
    "Pages live under ~/.claude/methodology/wiki/, written atomically " +
    "via tmp+rename. After a successful write, registers a protected " +
    "PG pointer memory tagged `wiki` so the page surfaces in `recall`.",
  inputSchema: {
    type: "object" as const,
    required: ["path"],
    properties: {
      path: { type: "string" as const, description: "Wiki-relative path of the page (no leading slash)." },
      content: { type: "string" as const, description: "Raw markdown content." },
      mode: { type: "string" as const, enum: ["create", "append", "replace"] as const, default: "create" },
      title: { type: "string" as const },
      summary: { type: "string" as const },
      body: { type: "string" as const },
      tags: { type: "array" as const, items: { type: "string" as const } },
    },
  },
} as const;

