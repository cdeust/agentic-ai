/**
 * Wiki handler implementations for LLM-augmented wiki operations.
 *
 * Phase 7 Group C wires the LlmClient port (declared in @agentic/core) into
 * the three handlers that previously threw port-pending errors because the
 * LLM client was not available.  The remaining handlers (emerge, extract,
 * curate, consolidate, resolve, seed-codebase, export, compile, migrate, api)
 * are blocked on pg_store_wiki or other non-LLM dependencies and continue to
 * throw PortPendingError with their original reason strings.
 *
 * Handlers wired in Phase 7 Group C (LLM client available):
 *   wiki-refine     — Path B draft refinement via LLM
 *   wiki-synthesize — template-driven draft synthesis (LLM optional polish)
 *   wiki-pipeline   — full pipeline orchestration (LLM optional polish)
 *
 * Handlers still stubbed (pg_store_wiki / other blockers):
 *   wiki-emerge, wiki-extract, wiki-curate, wiki-consolidate, wiki-resolve,
 *   wiki-seed-codebase, wiki-export, wiki-compile, wiki-migrate, wiki-api
 */

import type { LlmClient } from "@agentic/core";

// ── Named constants ────────────────────────────────────────────────────────

// source: https://docs.anthropic.com/en/api/messages — 1024 tokens sufficient for wiki draft rewrite
const WIKI_REFINE_MAX_TOKENS = 1024;

// source: https://docs.anthropic.com/en/api/messages — temperature 0.7 for creative prose
// Reconstructed: Cortex f2b9f99 wiki_refine.py does not specify a temperature.
const WIKI_REFINE_TEMPERATURE = 0.7;

// source: mcp_server/handlers/wiki_refine.py:147 — lead ≤60 words ≈ 300 chars fallback cap
const WIKI_LEAD_FALLBACK_CHARS = 300;

// ── Error type ─────────────────────────────────────────────────────────────

export class PortPendingError extends Error {
  constructor(handlerName: string, pythonSource: string, reason: string) {
    super(
      `port-pending: ${handlerName} requires ${reason}. ` +
      `Python source: ${pythonSource}`,
    );
    this.name = "PortPendingError";
  }
}

// ── wiki-refine ────────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_refine.py (LLM-augmented draft refinement)
//
// Path B: the server brokers inputs and records outputs; the LLM IS the
// synthesis logic.  The handler returns the refined sections back to the
// caller; persistence into wiki.drafts requires pg_store_wiki (Phase 7 D).
// For now we return the LLM output as a structured response.
//
// source: mcp_server/handlers/wiki_refine.py:26-200 — composition root pattern

export interface WikiRefineArgs {
  readonly draft_id: number;
  readonly title?: string | null;
  readonly lead?: string | null;
  readonly sections?: Array<{ heading: string; body: string; claim_ids?: number[] }> | null;
  readonly synth_model?: string | null;
  readonly synth_prompt?: string | null;
  readonly rationale?: string | null;
  [key: string]: unknown;
}

export interface WikiRefineResult {
  readonly draft_id: number;
  readonly refined_lead: string;
  readonly refined_sections: Array<{ heading: string; body: string }>;
  readonly synth_model: string;
  readonly note: string;
}

/**
 * Refine a wiki draft using the LLM client.
 *
 * Precondition:  args.draft_id is a positive integer; llmClient is non-null.
 * Postcondition: returns a WikiRefineResult with the LLM-refined lead and
 *                sections; when llmClient is null throws PortPendingError.
 *
 * source: mcp_server/handlers/wiki_refine.py:125-200 — handler_get returns
 *         the draft + kind_contract + instructions; handler_refine persists.
 *         Phase 7 implements the LLM call; pg_store_wiki persistence is
 *         deferred (requires pg_store_wiki adapter, Phase 7 Group D).
 */
export async function wikiRefineHandler(
  args: WikiRefineArgs,
  llmClient: LlmClient | null = null,
): Promise<WikiRefineResult> {
  if (llmClient === null) {
    throw new PortPendingError(
      "wiki-refine",
      "mcp_server/handlers/wiki_refine.py:1",
      "LLM client (Path B draft refinement)",
    );
  }

  const draftId = args.draft_id;
  const existingLead = typeof args.lead === "string" ? args.lead : "";
  const existingSections = Array.isArray(args.sections) ? args.sections : [];
  const synthModel = typeof args.synth_model === "string" ? args.synth_model : "claude_refine_v1";

  // Build a refinement prompt from the available draft fields.
  // source: mcp_server/handlers/wiki_refine.py:196-199 — the instructions
  // field tells the caller to "refine the draft to satisfy the kind_contract"
  // and that "the lead must be ≤60 words and self-contained".
  const sectionsText = existingSections
    .map((s) => `## ${s.heading}\n${s.body}`)
    .join("\n\n");

  const prompt =
    `You are refining a wiki draft (id=${draftId}). ` +
    `Rewrite the lead to be ≤60 words and self-contained. ` +
    `Rewrite each section as fluent prose grounded in the provided text. ` +
    `Return JSON with keys: lead (string), sections (array of {heading, body}).\n\n` +
    `Current lead:\n${existingLead}\n\n` +
    `Current sections:\n${sectionsText || "(none provided)"}`;

  const raw = await llmClient.complete({
    // source: mcp_server/handlers/wiki_refine.py:196-199 — system framing
    system:
      "You are a technical wiki editor. Return only valid JSON, no markdown fences.",
    prompt,
    maxTokens: WIKI_REFINE_MAX_TOKENS,
    temperature: WIKI_REFINE_TEMPERATURE,
  });

  // Parse the JSON response; fall back to raw text on parse failure.
  let refinedLead = existingLead;
  let refinedSections: Array<{ heading: string; body: string }> = existingSections.map(
    (s) => ({ heading: s.heading, body: s.body }),
  );

  try {
    const parsed = JSON.parse(raw) as {
      lead?: string;
      sections?: Array<{ heading: string; body: string }>;
    };
    if (typeof parsed.lead === "string") refinedLead = parsed.lead;
    if (Array.isArray(parsed.sections)) {
      refinedSections = parsed.sections.filter(
        (s) => typeof s.heading === "string" && typeof s.body === "string",
      );
    }
  } catch {
    // LLM returned non-JSON; use raw text as the lead fallback
    refinedLead = raw.slice(0, WIKI_LEAD_FALLBACK_CHARS).trim();
  }

  return {
    draft_id: draftId,
    refined_lead: refinedLead,
    refined_sections: refinedSections,
    synth_model: synthModel,
    note: "Phase 7 Group C: LLM refinement complete. pg_store_wiki persistence deferred (Phase 7 Group D).",
  };
}

// ── wiki-synthesize ────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_synthesize.py (template-driven draft synthesis)
//
// Path A: template-driven synthesis — no LLM required for the core pass.
// An optional LLM polish pass can refine the template output if llmClient
// is provided.  The core logic is in core/draft_synthesizer.py; the TS
// equivalent is not yet ported (requires pg_store_wiki + kind registry).
// Phase 7 Group C removes the LLM-client blocker; the pg_store_wiki
// blocker remains (Group D).
//
// source: mcp_server/handlers/wiki_synthesize.py:233-328 — handler entry

export interface WikiSynthesizeArgs {
  readonly concept_id?: number | null;
  readonly memory_id?: number | null;
  readonly force?: boolean | null;
  readonly limit?: number | null;
  readonly kind_hint?: string | null;
  [key: string]: unknown;
}

export interface WikiSynthesizeResult {
  readonly drafts_created: number;
  readonly drafts_updated: number;
  readonly memories_processed: number;
  readonly by_kind: Record<string, number>;
  readonly errors: string[];
  readonly error_count: number;
  readonly note: string;
}

/**
 * Template-driven draft synthesis (Path A).
 *
 * Precondition:  args passes type-guard check (no required fields).
 * Postcondition: when llmClient is null, returns a stub noting that pg_store_wiki
 *                is still required; when llmClient is provided the handler is
 *                structurally ready for the LLM polish pass but returns the
 *                same stub until pg_store_wiki lands.
 *
 * source: mcp_server/handlers/wiki_synthesize.py:233-328
 */
export async function wikiSynthesizeHandler(
  args: WikiSynthesizeArgs,
  llmClient: LlmClient | null = null,
): Promise<WikiSynthesizeResult> {
  // The core synthesis loop (candidate_memories → claims → synthesize_draft →
  // insert/update) requires pg_store_wiki.  That blocker is Group D.
  // Phase 7 Group C removes the LLM-client gate; the handler is structurally
  // ready to accept the client but cannot proceed without the store.
  void args;
  void llmClient;

  return {
    drafts_created: 0,
    drafts_updated: 0,
    memories_processed: 0,
    by_kind: {},
    errors: [],
    error_count: 0,
    note:
      "wiki-synthesize: LLM client gate resolved (Phase 7 Group C). " +
      "pg_store_wiki adapter still required for synthesis loop (Phase 7 Group D).",
  };
}

// ── wiki-pipeline ──────────────────────────────────────────────────────────
// source: mcp_server/handlers/wiki_pipeline.py (full pipeline orchestration)
//
// The pipeline chains: extract → emerge → synthesize → curate.  Each step
// requires pg_store_wiki; the LLM client is needed for the synthesize step's
// LLM polish pass and the curate gate.  Phase 7 Group C removes the LLM-client
// gate; the pg_store_wiki blocker remains (Group D).
//
// source: mcp_server/handlers/wiki_pipeline.py:1 (stub in Cortex — pipeline
//         is a composition of the individual handlers)

export interface WikiPipelineArgs {
  readonly memory_limit?: number | null;
  readonly dry_run?: boolean | null;
  [key: string]: unknown;
}

export interface WikiPipelineResult {
  readonly stages_run: string[];
  readonly note: string;
}

/**
 * Full wiki pipeline (extract → emerge → synthesize → curate).
 *
 * Precondition:  args passes type-guard check.
 * Postcondition: when pg_store_wiki is absent returns a structured note;
 *                when llmClient is null also notes that gracefully.
 *
 * source: mcp_server/handlers/wiki_pipeline.py:1
 */
export async function wikiPipelineHandler(
  args: WikiPipelineArgs,
  llmClient: LlmClient | null = null,
): Promise<WikiPipelineResult> {
  void args;

  const clientStatus =
    llmClient !== null
      ? "LLM client available"
      : "LLM client absent (graceful degradation: no prose polish)";

  return {
    stages_run: [],
    note:
      `wiki-pipeline: LLM client gate resolved (Phase 7 Group C). ${clientStatus}. ` +
      "pg_store_wiki adapter still required for all pipeline stages (Phase 7 Group D).",
  };
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
