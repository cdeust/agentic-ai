/**
 * Stub implementations for LLM-pass-heavy wiki handlers.
 *
 * These handlers require an LLM client which is not in scope for the
 * foundational first-pass port. Each exports a type-safe handler signature
 * and throws a typed error with a `port-pending` marker pointing at the
 * Python source line.
 *
 * TODO (port-pending): Implement after LLM client is available.
 *
 * Handlers stubbed here:
 *   wiki-refine      — mcp_server/handlers/wiki_refine.py
 *   wiki-synthesize  — mcp_server/handlers/wiki_synthesize.py
 *   wiki-emerge      — mcp_server/handlers/wiki_emerge.py
 *   wiki-extract     — mcp_server/handlers/wiki_extract.py
 *   wiki-pipeline    — mcp_server/handlers/wiki_pipeline.py
 *   wiki-curate      — mcp_server/handlers/wiki_curate.py
 *   wiki-consolidate — mcp_server/handlers/wiki_consolidate.py
 *   wiki-resolve     — mcp_server/handlers/wiki_resolve.py
 *   wiki-seed-codebase — mcp_server/handlers/wiki_seed_codebase.py
 *   wiki-export      — mcp_server/handlers/wiki_export.py
 *   wiki-compile     — mcp_server/handlers/wiki_compile.py
 *   wiki-migrate     — mcp_server/handlers/wiki_migrate.py
 *   wiki-api         — mcp_server/handlers/wiki_api.py
 */

export class PortPendingError extends Error {
  constructor(handlerName: string, pythonSource: string, reason: string) {
    super(
      `port-pending: ${handlerName} requires ${reason}. ` +
      `Python source: ${pythonSource}`,
    );
    this.name = "PortPendingError";
  }
}

// ── wiki-refine ───────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_refine.py (LLM-augmented draft refinement)

export interface WikiRefineArgs { readonly draft_id: number; [key: string]: unknown; }
export async function wikiRefineHandler(_args: WikiRefineArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-refine",
    "mcp_server/handlers/wiki_refine.py:1",
    "LLM client (Path B draft refinement)",
  );
}

// ── wiki-synthesize ───────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_synthesize.py (LLM draft synthesis)

export interface WikiSynthesizeArgs { readonly concept_id?: number | null; [key: string]: unknown; }
export async function wikiSynthesizeHandler(_args: WikiSynthesizeArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-synthesize",
    "mcp_server/handlers/wiki_synthesize.py:1",
    "LLM client (concept → draft synthesis)",
  );
}

// ── wiki-emerge ───────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_emerge.py (concept emergence trigger)

export interface WikiEmergeArgs { readonly memory_limit?: number | null; [key: string]: unknown; }
export async function wikiEmergeHandler(_args: WikiEmergeArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-emerge",
    "mcp_server/handlers/wiki_emerge.py:1",
    "pg_store_wiki (concept emergence DB pass)",
  );
}

// ── wiki-extract ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_extract.py (claim extraction trigger)

export interface WikiExtractArgs { readonly memory_id?: number | null; [key: string]: unknown; }
export async function wikiExtractHandler(_args: WikiExtractArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-extract",
    "mcp_server/handlers/wiki_extract.py:1",
    "pg_store_wiki (claim extraction + persistence)",
  );
}

// ── wiki-pipeline ─────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_pipeline.py (full pipeline orchestration)

export interface WikiPipelineArgs { [key: string]: unknown; }
export async function wikiPipelineHandler(_args: WikiPipelineArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-pipeline",
    "mcp_server/handlers/wiki_pipeline.py:1",
    "LLM client + pg_store_wiki (full pipeline: extract → emerge → synthesize → curate)",
  );
}

// ── wiki-curate ───────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_curate.py (draft curation gate)

export interface WikiCurateArgs { readonly draft_id?: number | null; [key: string]: unknown; }
export async function wikiCurateHandler(_args: WikiCurateArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-curate",
    "mcp_server/handlers/wiki_curate.py:1",
    "pg_store_wiki (draft approval/rejection persistence)",
  );
}

// ── wiki-consolidate ──────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_consolidate.py (heat decay + lifecycle)

export interface WikiConsolidateArgs { readonly dry_run?: boolean; [key: string]: unknown; }
export async function wikiConsolidateHandler(_args: WikiConsolidateArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-consolidate",
    "mcp_server/handlers/wiki_consolidate.py:1",
    "pg_store_wiki (thermodynamic heat decay + staleness flags)",
  );
}

// ── wiki-resolve ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_resolve.py (claim conflict resolution)

export interface WikiResolveArgs { readonly memory_id?: number | null; [key: string]: unknown; }
export async function wikiResolveHandler(_args: WikiResolveArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-resolve",
    "mcp_server/handlers/wiki_resolve.py:1",
    "pg_store_wiki (claim supersedes + conflict persistence)",
  );
}

// ── wiki-seed-codebase ────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_seed_codebase.py (codebase-driven page seeding)

export interface WikiSeedCodebaseArgs { readonly repo_path?: string | null; [key: string]: unknown; }
export async function wikiSeedCodebaseHandler(_args: WikiSeedCodebaseArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-seed-codebase",
    "mcp_server/handlers/wiki_seed_codebase.py:1",
    "cortex-codebase-analysis (#5) + LLM client (file-level page seeding)",
  );
}

// ── wiki-export ───────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_export.py (Pandoc export)

export interface WikiExportArgs { readonly path?: string | null; readonly format?: string | null; [key: string]: unknown; }
export async function wikiExportHandler(_args: WikiExportArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-export",
    "mcp_server/handlers/wiki_export.py:1",
    "Pandoc subprocess integration (PDF/DOCX/HTML export)",
  );
}

// ── wiki-compile ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_compile.py (publish approved drafts)

export interface WikiCompileArgs { readonly draft_id?: number | null; [key: string]: unknown; }
export async function wikiCompileHandler(_args: WikiCompileArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-compile",
    "mcp_server/handlers/wiki_compile.py:1",
    "pg_store_wiki + wiki_store (draft → authored .md page)",
  );
}

// ── wiki-migrate ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_migrate.py (schema migration)

export interface WikiMigrateArgs { readonly target_version?: string | null; [key: string]: unknown; }
export async function wikiMigrateHandler(_args: WikiMigrateArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-migrate",
    "mcp_server/handlers/wiki_migrate.py:1",
    "pg_store_wiki + schema versioning (DB migration)",
  );
}

// ── wiki-api ──────────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_api.py (REST-style API surface)

export interface WikiApiArgs { readonly endpoint?: string | null; [key: string]: unknown; }
export async function wikiApiHandler(_args: WikiApiArgs): Promise<never> {
  throw new PortPendingError(
    "wiki-api",
    "mcp_server/handlers/wiki_api.py:1",
    "HTTP server + pg_store_wiki (REST API bridge)",
  );
}
