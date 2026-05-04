/**
 * Wiki handlers blocked on pg_store_wiki or other Phase 7 Group D+ deps.
 *
 * Every handler here throws PortPendingError with a specific reason naming
 * the exact missing dependency.  None returns a success-shaped response.
 *
 * Handlers move out of this file when their dependency lands.
 *
 * source: mcp_server/handlers/wiki_emerge.py     (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_extract.py    (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_curate.py     (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_consolidate.py (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_resolve.py    (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_seed_codebase.py (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_export.py     (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_compile.py    (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_migrate.py    (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_api.py        (Cortex bc0ae4f)
 */

import { PortPendingError } from "./wiki-errors.js";

// ── wiki-emerge ───────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_emerge.py

export interface WikiEmergeArgs { readonly memory_limit?: number | null; [key: string]: unknown; }
export async function wikiEmergeHandler(_args: WikiEmergeArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-emerge",
    "mcp_server/handlers/wiki_emerge.py:1",
    "pg_store_wiki (concept emergence DB pass)",
  );
}

// ── wiki-extract ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_extract.py

export interface WikiExtractArgs { readonly memory_id?: number | null; [key: string]: unknown; }
export async function wikiExtractHandler(_args: WikiExtractArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-extract",
    "mcp_server/handlers/wiki_extract.py:1",
    "pg_store_wiki (claim extraction + persistence)",
  );
}

// ── wiki-curate ───────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_curate.py

export interface WikiCurateArgs { readonly draft_id?: number | null; [key: string]: unknown; }
export async function wikiCurateHandler(_args: WikiCurateArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-curate",
    "mcp_server/handlers/wiki_curate.py:1",
    "pg_store_wiki (draft approval/rejection persistence)",
  );
}

// ── wiki-consolidate ──────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_consolidate.py

export interface WikiConsolidateArgs { readonly dry_run?: boolean; [key: string]: unknown; }
export async function wikiConsolidateHandler(_args: WikiConsolidateArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-consolidate",
    "mcp_server/handlers/wiki_consolidate.py:1",
    "pg_store_wiki (thermodynamic heat decay + staleness flags)",
  );
}

// ── wiki-resolve ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_resolve.py

export interface WikiResolveArgs { readonly memory_id?: number | null; [key: string]: unknown; }
export async function wikiResolveHandler(_args: WikiResolveArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-resolve",
    "mcp_server/handlers/wiki_resolve.py:1",
    "pg_store_wiki (claim supersedes + conflict persistence)",
  );
}

// ── wiki-seed-codebase ────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_seed_codebase.py

export interface WikiSeedCodebaseArgs { readonly repo_path?: string | null; [key: string]: unknown; }
export async function wikiSeedCodebaseHandler(_args: WikiSeedCodebaseArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-seed-codebase",
    "mcp_server/handlers/wiki_seed_codebase.py:1",
    "cortex-codebase-analysis (#5) + LLM client (file-level page seeding)",
  );
}

// ── wiki-export ───────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_export.py

export interface WikiExportArgs { readonly path?: string | null; readonly format?: string | null; [key: string]: unknown; }
export async function wikiExportHandler(_args: WikiExportArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-export",
    "mcp_server/handlers/wiki_export.py:1",
    "Pandoc subprocess integration (PDF/DOCX/HTML export)",
  );
}

// ── wiki-compile ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_compile.py

export interface WikiCompileArgs { readonly draft_id?: number | null; [key: string]: unknown; }
export async function wikiCompileHandler(_args: WikiCompileArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-compile",
    "mcp_server/handlers/wiki_compile.py:1",
    "pg_store_wiki + wiki_store (draft → authored .md page)",
  );
}

// ── wiki-migrate ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_migrate.py

export interface WikiMigrateArgs { readonly target_version?: string | null; [key: string]: unknown; }
export async function wikiMigrateHandler(_args: WikiMigrateArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-migrate",
    "mcp_server/handlers/wiki_migrate.py:1",
    "pg_store_wiki + schema versioning (DB migration)",
  );
}

// ── wiki-api ──────────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_api.py

export interface WikiApiArgs { readonly endpoint?: string | null; [key: string]: unknown; }
export async function wikiApiHandler(_args: WikiApiArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-api",
    "mcp_server/handlers/wiki_api.py:1",
    "HTTP server + pg_store_wiki (REST API bridge)",
  );
}
