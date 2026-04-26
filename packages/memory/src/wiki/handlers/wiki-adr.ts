/**
 * Handler: wiki-adr — create a numbered ADR from structured fields.
 *
 * Convenience wrapper around wiki-write: finds the next free ADR number,
 * renders the template via buildAdr, and writes the file. Registers the
 * usual protected PG pointer memory.
 *
 * source: mcp_server/handlers/wiki_adr.py
 */

import { adrFilename, pagePath, slugify } from "../layout.js";
import { ADR_STATUSES, buildAdr } from "../pages.js";
import type { AdrStatus } from "../pages.js";
import { WikiExists } from "../types.js";

export interface WikiAdrArgs {
  readonly title: string;
  readonly context: string;
  readonly decision: string;
  readonly consequences: string;
  readonly status?: AdrStatus;
  readonly tags?: readonly string[];
}

export interface WikiAdrResult {
  readonly path: string;
  readonly number: number;
  readonly title: string;
  readonly status: AdrStatus;
  readonly created: boolean;
  readonly bytes_written: number;
  readonly root: string;
}

export type WikiAdrResponse = WikiAdrResult | { readonly error: string };

export interface WikiAdrDeps {
  readonly wikiRoot: string;
  readonly nextAdrNumber: (root: string) => Promise<number>;
  readonly writePage: (root: string, relPath: string, content: string, mode: string) => Promise<{ path: string; mode: string; created: boolean; bytes_written: number }>;
  readonly storePointerMemory?: (relPath: string, content: string, tags: readonly string[]) => Promise<void>;
}

export async function handler(
  args: WikiAdrArgs,
  deps: WikiAdrDeps,
): Promise<WikiAdrResponse> {
  const title = (args.title ?? "").trim();
  const context = (args.context ?? "").trim();
  const decision = (args.decision ?? "").trim();
  const consequences = (args.consequences ?? "").trim();
  const status: AdrStatus = args.status ?? "accepted";
  const tags = [...(args.tags ?? [])];

  if (!title || !context || !decision || !consequences) {
    return { error: "title, context, decision and consequences are required" };
  }
  if (!(ADR_STATUSES as readonly string[]).includes(status)) {
    return { error: `unknown status: ${status}` };
  }

  let number: number;
  try {
    number = await deps.nextAdrNumber(deps.wikiRoot);
  } catch (err) {
    return { error: `cannot determine next ADR number: ${String(err)}` };
  }

  const slug = slugify(title);
  const filename = adrFilename(number, slug);
  const relPath = pagePath("adr", filename);

  const content = buildAdr({ number, title, context, decision, consequences, status, tags });

  try {
    const result = await deps.writePage(deps.wikiRoot, relPath, content, "create");
    if (deps.storePointerMemory) {
      await deps.storePointerMemory(relPath, content, ["wiki", "adr", ...tags]).catch(() => undefined);
    }
    return {
      path: result.path,
      number,
      title,
      status,
      created: result.created,
      bytes_written: result.bytes_written,
      root: deps.wikiRoot,
    };
  } catch (err) {
    if (err instanceof WikiExists) return { error: `ADR already exists: ${relPath}` };
    return { error: `write failed: ${String(err)}` };
  }
}

export const schema = {
  description:
    "Create a numbered ADR (Architecture Decision Record) from structured " +
    "Context/Decision/Consequences fields. Atomically computes the next free " +
    "ADR number, renders the standard template, writes wiki/adr/<NNNN>-<slug>.md, " +
    "and registers a protected pointer memory tagged `wiki`+`adr`.",
  inputSchema: {
    type: "object" as const,
    required: ["title", "context", "decision", "consequences"],
    properties: {
      title: { type: "string" as const, description: "Short imperative title of the decision." },
      context: { type: "string" as const, description: "The forces at play. Markdown allowed." },
      decision: { type: "string" as const, description: "What was decided, in active voice." },
      consequences: { type: "string" as const, description: "Resulting consequences." },
      status: { type: "string" as const, enum: [...ADR_STATUSES] as string[], default: "accepted" },
      tags: { type: "array" as const, items: { type: "string" as const } },
    },
  },
} as const;
