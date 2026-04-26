/**
 * Handler: wiki-verify — check whether a wiki page's cited symbols still
 * exist in the AP code graph (ADR-0046 Phase 2).
 *
 * Composition root: filesystem wiki → symbol extractor (core) → AP bridge
 * verification (infrastructure) → verdict (core). Returns a structured
 * report per page.
 *
 * When AP is disabled, the handler returns status: 'skipped' — never a
 * staleness claim. Graceful degradation is the invariant.
 *
 * Dependency: cortex-codebase-analysis (#5) provides the symbol graph.
 * The deps.verifySymbols function is the port boundary to that package.
 *
 * source: mcp_server/handlers/wiki_verify.py
 */

import { harvestPageSymbols } from "../symbol-extract.js";
import { evaluateSymbolStaleness, MIN_SYMBOL_REFS, STALE_THRESHOLD } from "../symbol-verify.js";

interface PageStruct {
  lead: string;
  sections: Record<string, string>;
}

function parseLeadAndSections(md: string): PageStruct {
  const lines = md.split("\n");
  const leadLines: string[] = [];
  const sections: Record<string, string> = {};
  let current: string | null = null;
  const buf: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current !== null) {
        sections[current] = buf.join("\n").trim();
      } else {
        leadLines.push(...buf);
      }
      current = line.slice(3).trim();
      buf.length = 0;
    } else {
      buf.push(line);
    }
  }

  if (current !== null) {
    sections[current] = buf.join("\n").trim();
  } else {
    leadLines.push(...buf);
  }

  return { lead: leadLines.join("\n").trim(), sections };
}

export interface WikiVerifyArgs {
  readonly path?: string | null;
}

export interface VerifyPageResult {
  readonly page: string;
  readonly symbol_refs: readonly string[];
  readonly missing_refs: readonly string[];
  readonly is_symbol_stale: boolean;
  readonly rationale: string;
  readonly error?: string;
}

export interface WikiVerifyResult {
  readonly status: "ok" | "skipped";
  readonly results?: readonly VerifyPageResult[];
  readonly summary?: {
    readonly total: number;
    readonly stale: number;
    readonly threshold: number;
    readonly min_refs: number;
  };
  readonly reason?: string;
  readonly detail?: string;
  readonly threshold?: number;
  readonly min_refs?: number;
}

export interface WikiVerifyDeps {
  readonly wikiRoot: string;
  readonly isApEnabled: () => boolean;
  readonly readPage: (root: string, relPath: string) => Promise<string | null>;
  readonly listPages: (root: string) => Promise<string[]>;
  readonly verifySymbols: (symbols: readonly string[]) => Promise<Record<string, boolean>>;
}

async function verifyOne(path: string, deps: WikiVerifyDeps): Promise<VerifyPageResult> {
  const content = await deps.readPage(deps.wikiRoot, path);
  if (content === null) {
    return { page: path, symbol_refs: [], missing_refs: [], is_symbol_stale: false, rationale: "page not found", error: "page not found" };
  }
  const pageStruct = parseLeadAndSections(content);
  const symbolRefs = harvestPageSymbols(pageStruct).slice(0, 200);
  const existence = symbolRefs.length > 0 ? await deps.verifySymbols(symbolRefs) : {};
  const verdict = evaluateSymbolStaleness({
    page_id: path,
    is_symbol_stale_was: false,
    symbol_refs: symbolRefs,
    existence,
  });
  return {
    page: path,
    symbol_refs: verdict.symbol_refs,
    missing_refs: verdict.missing_refs,
    is_symbol_stale: verdict.is_symbol_stale_now,
    rationale: verdict.rationale,
  };
}

export async function handler(
  args: WikiVerifyArgs,
  deps: WikiVerifyDeps,
): Promise<WikiVerifyResult> {
  if (!deps.isApEnabled()) {
    return {
      status: "skipped",
      reason: "ap_disabled",
      detail:
        "AP is disabled. Set CORTEX_MEMORY_AP_ENABLED=1 in your MCP config " +
        "(default) and install automatised-pipeline to run symbol verification.",
    };
  }

  const target = (args.path ?? "").trim();
  if (target) {
    const result = await verifyOne(target, deps);
    return {
      status: "ok",
      results: [result],
      threshold: STALE_THRESHOLD,
      min_refs: MIN_SYMBOL_REFS,
    };
  }

  const pages = await deps.listPages(deps.wikiRoot);
  const results = await Promise.all(pages.map((p) => verifyOne(p, deps)));
  const stale = results.filter((r) => r.is_symbol_stale);
  return {
    status: "ok",
    results,
    summary: {
      total: results.length,
      stale: stale.length,
      threshold: STALE_THRESHOLD,
      min_refs: MIN_SYMBOL_REFS,
    },
  };
}

export const schema = {
  title: "Wiki — verify symbols",
  description:
    "Verify that code symbols cited by wiki pages still resolve in the AST " +
    "(via the automatised-pipeline MCP server, ADR-0046 Phase 2). " +
    "Read-only — never mutates wiki or memory state.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Optional wiki-relative path of a single page to verify." },
    },
  },
} as const;
