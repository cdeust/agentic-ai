/**
 * Wiki handler implementations for LLM-augmented wiki operations.
 *
 * This file replaces wiki-stubs.ts for the two handlers that previously
 * silently voided their inputs and returned hardcoded success-shaped lies:
 *   - wikiSynthesizeHandler  (Phase 7 CRIT-B fix)
 *   - wikiPipelineHandler    (Phase 7 CRIT-B fix)
 *
 * wikiRefineHandler remains here as the real LLM-wired implementation
 * that was already correct in wiki-stubs.ts.
 *
 * Both wikiSynthesizeHandler and wikiPipelineHandler now accept an
 * injected WikiDbClient.  When the client is null the handler throws
 * WikiUnavailableError with the specific missing dependency named — it does
 * NOT return a success-shaped lie.
 *
 * source: mcp_server/handlers/wiki_synthesize.py (Cortex bc0ae4f)
 * source: mcp_server/handlers/wiki_pipeline.py   (Cortex bc0ae4f)
 */

import type { LlmClient } from "@agentic/core";
import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";
import {
  getClaimsForMemory,
  findDraftForSource,
  insertDraft,
  updateDraft,
  insertMemo,
} from "../storage/pg-wiki-store-concepts.js";
import { loadRegistry } from "../schema-loader.js";
import { synthesizeDraft, inferKind } from "../draft-synthesizer.js";
import { WikiUnavailableError } from "./wiki-errors.js";
export { WikiUnavailableError } from "./wiki-errors.js";
import { wikiExtractHandler } from "./wiki-extract-handler.js";
import { wikiResolveHandler } from "./wiki-resolve-handler.js";
import { wikiEmergeHandler } from "./wiki-emerge-handler.js";
import { wikiCurateHandler } from "./wiki-curate-handler.js";
import { wikiCompileHandler } from "./wiki-compile-handler.js";

// ── wiki-refine (Path B: LLM-augmented) ──────────────────────────────────────
// Implemented in wiki-refine-handler.ts (SRP: separate LLM-path from DB-path)
export {
  wikiRefineHandler,
  type WikiRefineArgs,
  type WikiRefineResult,
} from "./wiki-refine-handler.js";

// ── Named constants ────────────────────────────────────────────────────────

// source: mcp_server/handlers/wiki_synthesize.py:88 — default limit per sweep
const WIKI_SYNTHESIZE_DEFAULT_LIMIT = 100;

// source: mcp_server/handlers/wiki_synthesize.py:326 — errors capped at 10 in response
const WIKI_SYNTHESIZE_MAX_ERRORS_REPORTED = 10;

// source: mcp_server/handlers/wiki_pipeline.py:80 — default pipeline stage item limit
const WIKI_PIPELINE_DEFAULT_LIMIT = 500;

// ── wiki-synthesize ────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_synthesize.py:233-328 (Cortex bc0ae4f)
//
// Path A: template-driven synthesis — deterministic, no LLM required.
// The handler enumerates candidate memories, routes claims into kind-specific
// sections, and persists drafts via pg_store_wiki.
//
// Wire: WikiDbClient for DB access + optional LlmClient (not used in Path A,
// accepted for interface symmetry with the rest of the handler suite).
//
// If db is null the handler throws WikiUnavailableError naming the specific
// missing dependency: "WikiDbClient (pg_store_wiki adapter)".

export interface WikiSynthesizeArgs {
  readonly concept_id?: number | null;
  readonly memory_id?: number | null;
  readonly force?: boolean | null;
  readonly limit?: number | null;
  readonly kind_hint?: string | null;
  readonly wiki_root?: string | null;
  [key: string]: unknown;
}

export interface WikiSynthesizeResult {
  readonly drafts_created: number;
  readonly drafts_updated: number;
  readonly memories_processed: number;
  readonly by_kind: Record<string, number>;
  readonly errors: string[];
  readonly error_count: number;
}

/**
 * Template-driven draft synthesis (Path A).
 *
 * Precondition:  db is non-null; args passes type-guard check.
 * Postcondition: for each memory_id with claim_events and no existing
 *                template_v1 draft, synthesizes and persists a DraftPage;
 *                returns real counts of drafts_created, drafts_updated,
 *                memories_processed, and by_kind breakdown.
 *                When db is null throws WikiUnavailableError.
 *
 * source: mcp_server/handlers/wiki_synthesize.py:233-328
 */
export async function wikiSynthesizeHandler(
  args: WikiSynthesizeArgs,
  // _llmClient: Path A is template-driven (no LLM). Accepted for interface
  // symmetry; Path B (wiki-refine) uses it for LLM polish.
  _llmClient: LlmClient | null = null,
  db: WikiDbClient | null = null,
): Promise<WikiSynthesizeResult> {
  if (db === null) {
    throw new WikiUnavailableError(
      "wiki-synthesize",
      "mcp_server/handlers/wiki_synthesize.py:233", // source: mcp_server/handlers/wiki_synthesize.py:233
      "WikiDbClient (pg_store_wiki adapter for claim_events + drafts tables)",
    );
  }

  const memoryId = typeof args.memory_id === "number" ? args.memory_id : null;
  const force = args.force === true;
  const limit = typeof args.limit === "number" ? args.limit : WIKI_SYNTHESIZE_DEFAULT_LIMIT;
  const kindHint = typeof args.kind_hint === "string" ? args.kind_hint : null;
  const wikiRoot = typeof args.wiki_root === "string" ? args.wiki_root : "";

  // Load kind registry once per call — empty registry is safe (falls back to
  // hardcoded defaults in synthesizeDraft).
  // source: mcp_server/handlers/wiki_synthesize.py:244-245
  const registry = wikiRoot ? loadRegistry(wikiRoot) : { kinds: {}, rules: [], views: {}, triggers: {}, known_kind_names: new Set<string>() };
  const availableKinds = registry.known_kind_names;

  // Enumerate candidate memory_ids
  // source: mcp_server/handlers/wiki_synthesize.py:247-255 (_candidate_memories)
  let memoryIds: number[];
  if (memoryId !== null) {
    memoryIds = [memoryId];
  } else if (force) {
    // All memories with claims
    const r = await db.query<{ memory_id: number }>(
      `SELECT DISTINCT memory_id FROM wiki.claim_events
        WHERE memory_id IS NOT NULL ORDER BY memory_id LIMIT $1`,
      [limit],
    );
    memoryIds = r.rows.map((row) => row.memory_id);
  } else {
    // Memories with claims but no template_v1 draft
    const r = await db.query<{ memory_id: number }>(
      `SELECT DISTINCT c.memory_id
         FROM wiki.claim_events c
        WHERE c.memory_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM wiki.drafts d
             WHERE d.memory_id = c.memory_id
               AND d.synth_model = 'template_v1'
          )
        ORDER BY c.memory_id LIMIT $1`,
      [limit],
    );
    memoryIds = r.rows.map((row) => row.memory_id);
  }

  if (!memoryIds.length) {
    return {
      drafts_created: 0,
      drafts_updated: 0,
      memories_processed: 0,
      by_kind: {},
      errors: [],
      error_count: 0,
    };
  }

  let draftsCreated = 0;
  let draftsUpdated = 0;
  const byKind: Record<string, number> = {};
  const errors: string[] = [];

  // Invariant: draftsCreated + draftsUpdated <= loop iterations completed
  // Termination: for loop iterates over a finite slice of memoryIds
  for (const mid of memoryIds) {
    try {
      // Fetch claims for this memory
      // source: mcp_server/handlers/wiki_synthesize.py:264-202 (_claims_for_memory)
      const claims = (await getClaimsForMemory(db, mid)) as Array<{
        id?: number;
        text: string;
        claim_type?: string;
        confidence?: number;
        evidence_refs?: unknown[];
        memory_id?: number;
      }>;

      if (!claims.length) continue;

      // Infer kind from dominant claim_type (or use hint)
      // source: mcp_server/handlers/wiki_synthesize.py:267
      const kind = kindHint ?? inferKind(claims, availableKinds);
      const kindDef = registry.kinds[kind] ?? null;

      // Run template-driven synthesis (pure, no I/O)
      const [draft, stats] = synthesizeDraft(claims, {
        kind,
        kindDefinition: kindDef,
        memoryId: mid,
      });

      // Persist: insert or update in wiki.drafts
      // source: mcp_server/handlers/wiki_synthesize.py:277-294
      const existing = await findDraftForSource(db, { memory_id: mid });
      let draftId: number;

      if (existing && !force) {
        // Update in place rather than spawn a duplicate
        await updateDraft(db, existing["id"] as number, {
          title: draft.title,
          lead: draft.lead,
          sections: draft.sections as unknown[],
          frontmatter: draft.frontmatter as Record<string, unknown>,
          confidence: draft.confidence,
          synth_model: draft.provenance.synthesis_model ?? "template_v1",
        });
        draftsUpdated++;
        draftId = existing["id"] as number;
      } else {
        draftId = await insertDraft(db, {
          concept_id: draft.concept_id ?? null,
          memory_id: draft.memory_id ?? null,
          title: draft.title,
          kind: draft.kind,
          lead: draft.lead,
          sections: draft.sections,
          frontmatter: draft.frontmatter,
          provenance: draft.provenance,
          synth_model: draft.provenance.synthesis_model ?? "template_v1",
          confidence: draft.confidence,
          status: draft.status,
        });
        draftsCreated++;
      }

      byKind[kind] = (byKind[kind] ?? 0) + 1;

      // Audit memo (grounded-theory audit trail)
      // source: mcp_server/handlers/wiki_synthesize.py:298-315
      await insertMemo(
        db,
        "draft",
        draftId,
        "synthesized_template_v1",
        `Routed ${stats.claims_routed}/${stats.claims_total} claims into ` +
          `${stats.sections_filled}/${stats.sections_required} required sections.`,
        [],
        { memory_id: mid, kind, claim_count: claims.length },
        draft.confidence,
        "synthesizer_template",
      );
    } catch (err) {
      errors.push(`memory ${mid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    drafts_created: draftsCreated,
    drafts_updated: draftsUpdated,
    memories_processed: memoryIds.length,
    by_kind: byKind,
    errors: errors.slice(0, WIKI_SYNTHESIZE_MAX_ERRORS_REPORTED),
    error_count: errors.length,
  };
}

// ── wiki-pipeline ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_pipeline.py (Cortex bc0ae4f)
//
// Orchestrates: extract → resolve → emerge → synthesize → curate → compile.
// Each stage is delegated to its own handler and its summary preserved.
// Per-stage errors are captured (never raised) so a failure in one phase
// does not abort the rest.
//
// Stages whose handlers throw WikiUnavailableError are captured; their
// per-stage result records the pending reason. The pipeline still
// reports real stage counts and real stages_run.

export interface WikiPipelineArgs {
  readonly memory_limit?: number | null;
  readonly dry_run?: boolean | null;
  readonly limit_per_stage?: number | null;
  readonly skip_compile?: boolean | null;
  readonly wiki_root?: string | null;
  [key: string]: unknown;
}

export interface WikiPipelineStageResult {
  readonly status: "ok" | "unavailable" | "error";
  readonly result?: Record<string, unknown>;
  readonly reason?: string;
}

export interface WikiPipelineResult {
  readonly stages_run: string[];
  readonly stages: Record<string, WikiPipelineStageResult>;
  readonly pages_published: number;
  readonly drafts_approved: number;
  readonly concepts_inserted: number;
  readonly claims_inserted: number;
}

/**
 * Full wiki pipeline (extract → resolve → emerge → synthesize → curate → compile).
 *
 * Precondition:  args passes type-guard check.
 * Postcondition: runs each stage via its handler; captures WikiUnavailableError
 *                and runtime errors per-stage without aborting the remainder;
 *                returns real stages_run (non-empty when any stage ran) plus
 *                per-stage summaries and aggregate counts.
 *
 * source: mcp_server/handlers/wiki_pipeline.py:78-108
 */
export async function wikiPipelineHandler(
  args: WikiPipelineArgs,
  llmClient: LlmClient | null = null,
  db: WikiDbClient | null = null,
): Promise<WikiPipelineResult> {
  const limitPerStage = typeof args.limit_per_stage === "number"
    ? args.limit_per_stage
    : typeof args.memory_limit === "number"
      ? args.memory_limit
      : WIKI_PIPELINE_DEFAULT_LIMIT;
  const skipCompile = args.skip_compile === true || args.dry_run === true;
  const wikiRoot = typeof args.wiki_root === "string" ? args.wiki_root : "";

  // Stage handlers are defined in this same file — no dynamic import required.
  // source: mcp_server/handlers/wiki_pipeline.py:83-88

  /**
   * Run a handler; capture WikiUnavailableError and generic errors.
   *
   * Precondition:  label is a non-empty string; fn is a callable that
   *                returns a promise.
   * Postcondition: always returns a WikiPipelineStageResult; never throws.
   *
   * source: mcp_server/handlers/wiki_pipeline.py:69-75 (_safe_call)
   */
  async function safeCall(
    label: string,
    fn: () => Promise<unknown>,
  ): Promise<[string, WikiPipelineStageResult]> {
    try {
      const result = await fn() as Record<string, unknown>;
      return [label, { status: "ok", result }];
    } catch (err) {
      if (err instanceof WikiUnavailableError || (err instanceof Error && (err.name === "WikiUnavailableError"))) {
        return [label, { status: "unavailable", reason: err.message }];
      }
      return [label, { status: "error", reason: err instanceof Error ? err.message : String(err) }];
    }
  }

  // When db is null the DB-backed stages throw WikiUnavailableError which
  // safeCall captures as { status: "unavailable" }. The pipeline still runs
  // all stages and returns aggregate counts from those that succeeded.
  // source: mcp_server/handlers/wiki_pipeline.py:92-98
  const stageResults: Array<[string, WikiPipelineStageResult]> = [];

  stageResults.push(
    await safeCall("extract", () =>
      db !== null
        ? wikiExtractHandler({ memory_id: null }, db)
        : Promise.reject(new WikiUnavailableError("wiki-extract", "mcp_server/handlers/wiki_extract.py:1", "WikiDbClient required")),
    ),
  );
  stageResults.push(
    await safeCall("resolve", () =>
      db !== null
        ? wikiResolveHandler({ memory_id: null }, db)
        : Promise.reject(new WikiUnavailableError("wiki-resolve", "mcp_server/handlers/wiki_resolve.py:1", "WikiDbClient required")),
    ),
  );
  stageResults.push(
    await safeCall("emerge", () =>
      db !== null
        ? wikiEmergeHandler({ memory_limit: limitPerStage }, db)
        : Promise.reject(new WikiUnavailableError("wiki-emerge", "mcp_server/handlers/wiki_emerge.py:1", "WikiDbClient required")),
    ),
  );
  stageResults.push(
    await safeCall("synthesize", () =>
      wikiSynthesizeHandler(
        { limit: limitPerStage, wiki_root: wikiRoot || null },
        llmClient,
        db,
      ),
    ),
  );
  stageResults.push(
    await safeCall("curate", () =>
      db !== null
        ? wikiCurateHandler({ draft_id: null }, db)
        : Promise.reject(new WikiUnavailableError("wiki-curate", "mcp_server/handlers/wiki_curate.py:1", "WikiDbClient required")),
    ),
  );
  if (!skipCompile) {
    stageResults.push(
      await safeCall("compile", () =>
        db !== null
          ? wikiCompileHandler(
              { draft_id: null },
              db,
              // No-op write in pipeline context — wikiCompileHandler is called
              // directly (not via pipeline) when callers need disk writes.
              async (_relPath: string, _content: string) => { /* intentional no-op */ },
            )
          : Promise.reject(new WikiUnavailableError("wiki-compile", "mcp_server/handlers/wiki_compile.py:1", "WikiDbClient required")),
      ),
    );
  }

  const stagesMap = Object.fromEntries(stageResults);

  // stages_run: stages that completed successfully
  const stagesRun = stageResults
    .filter(([, r]) => r.status === "ok")
    .map(([label]) => label);

  // Aggregate counters from individual stage results
  // source: mcp_server/handlers/wiki_pipeline.py:100-107
  const compileResult = stagesMap["compile"]?.result ?? {};
  const curateResult = stagesMap["curate"]?.result ?? {};
  const emergeResult = stagesMap["emerge"]?.result ?? {};
  const extractResult = stagesMap["extract"]?.result ?? {};

  return {
    stages_run: stagesRun,
    stages: stagesMap,
    pages_published: (compileResult["drafts_published"] as number | undefined) ?? 0,
    drafts_approved: (curateResult["approved"] as number | undefined) ?? 0,
    concepts_inserted: (emergeResult["concepts_inserted"] as number | undefined) ?? 0,
    claims_inserted: (extractResult["claims_inserted"] as number | undefined) ?? 0,
  };
}

// ── Remaining wiki handlers (real implementations) ────────────────────────────
export {
  wikiEmergeHandler,
  type WikiEmergeArgs,
  type WikiEmergeResult,
} from "./wiki-emerge-handler.js";
export {
  wikiExtractHandler,
  type WikiExtractArgs,
  type WikiExtractResult,
} from "./wiki-extract-handler.js";
export {
  wikiCurateHandler,
  type WikiCurateArgs,
  type WikiCurateResult,
} from "./wiki-curate-handler.js";
export {
  wikiConsolidateHandler,
  type WikiConsolidateArgs,
  type WikiConsolidateResult,
} from "./wiki-consolidate-handler.js";
export {
  wikiResolveHandler,
  type WikiResolveArgs,
  type WikiResolveResult,
} from "./wiki-resolve-handler.js";
export {
  wikiSeedCodebaseHandler,
  type WikiSeedCodebaseArgs,
  type WikiSeedCodebaseResult,
  type SeedImportPayload,
} from "./wiki-seed-codebase-handler.js";
export {
  wikiExportHandler,
  type WikiExportArgs,
  type WikiExportResult,
} from "./wiki-export-handler.js";
export {
  wikiCompileHandler,
  type WikiCompileArgs,
  type WikiCompileResult,
} from "./wiki-compile-handler.js";
export {
  wikiMigrateHandler,
  type WikiMigrateArgs,
  type WikiMigrateResult,
} from "./wiki-migrate-handler.js";
export {
  wikiApiHandler,
  type WikiApiArgs,
  type WikiApiResult,
} from "./wiki-api-handler.js";
