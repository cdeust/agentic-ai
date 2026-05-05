/**
 * Wiki pipeline runner — stitches Phase 2-2.5 handlers into one call.
 *
 *   extract → resolve → emerge → synthesize → curate → compile
 *
 * Used at setup / backfill time so fresh installs go from raw memories
 * to published pages without manual tool chaining. Each stage's summary
 * is retained so the caller can see what happened.
 *
 * Never raises: per-stage errors are captured in the summary. A later
 * stage that has nothing to process simply returns zero counts and the
 * pipeline moves on.
 *
 * Port of: mcp_server/handlers/wiki_pipeline.py
 * source: cortex@ed33435 mcp_server/handlers/wiki_pipeline.py
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface WikiPipelineArgs {
  /** Cap on items each stage processes. */
  limit_per_stage?: number;
  /** Stop after curate — skip compile. */
  skip_compile?: boolean;
}

export interface WikiPipelineResult {
  stages: Record<string, Record<string, unknown>>;
  pages_published: number;
  drafts_approved: number;
  concepts_inserted: number;
  claims_inserted: number;
}

/** Minimal interface for a single-stage handler. */
export type StageHandler = (
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export interface WikiPipelineHandlers {
  extract: StageHandler;
  resolve: StageHandler;
  emerge: StageHandler;
  synthesize: StageHandler;
  curate: StageHandler;
  compile: StageHandler;
}

// ── Schema ─────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/wiki_pipeline.py:19

export const schema = {
  description:
    "Drive the wiki redesign pipeline end-to-end in one call: " +
    "extract → resolve → emerge → synthesize → curate → compile. Each " +
    "stage is delegated to its own handler (wiki_extract, " +
    "wiki_resolve, wiki_emerge, wiki_synthesize, wiki_curate, " +
    "wiki_compile) and its summary is preserved in the response. Use " +
    "this on fresh installs, after backfilling memories, or as a " +
    "scheduled job; for surgical control over a single phase, call the " +
    "individual handlers instead. Per-stage errors are captured (never " +
    "raised), so a failure in one phase does not abort the rest. Distinct " +
    "from each individual wiki_extract / wiki_resolve / wiki_emerge " +
    "/ wiki_synthesize / wiki_curate / wiki_compile (this " +
    "orchestrates them in order with one summary). Mutates " +
    "wiki.* tables and (unless skip_compile) the wiki/ filesystem tree. " +
    "Latency varies (~10s-5min depending on memory corpus). Returns " +
    "{stages: per-handler summary, pages_published, drafts_approved, " +
    "concepts_inserted, claims_inserted}.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      limit_per_stage: {
        type: "integer",
        description:
          "Cap on the number of items each stage processes. Acts as " +
          "a back-pressure knob — start low for safety, raise once " +
          "the pipeline is known-good.",
        default: 500, // source: cortex@ed33435 mcp_server/handlers/wiki_pipeline.py:48
        minimum: 1,
        maximum: 50000,
        examples: [200, 500, 5000],
      },
      skip_compile: {
        type: "boolean",
        description:
          "Stop after the curate stage — approved drafts stay in " +
          "wiki.drafts unpublished. Useful when you want to review " +
          "verdicts before any .md files are written.",
        default: false,
        examples: [false, true],
      },
    },
  },
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Run a handler; return its summary or an error dict.
 * Port of: mcp_server/handlers/wiki_pipeline.py::_safe_call
 * source: cortex@ed33435 mcp_server/handlers/wiki_pipeline.py:69
 */
async function safeCall(
  label: string,
  coro: Promise<Record<string, unknown>>,
): Promise<[string, Record<string, unknown>]> {
  try {
    const result = await coro;
    return [label, result ?? {}];
  } catch (e) {
    return [label, { error: String(e) }];
  }
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Drive the wiki pipeline end-to-end.
 *
 * precondition: handlers provides all six stage implementations.
 * postcondition: returns per-stage summary + aggregated counts;
 *   never throws — all stage errors are captured.
 *
 * Port of: mcp_server/handlers/wiki_pipeline.py::handler
 * source: cortex@ed33435 mcp_server/handlers/wiki_pipeline.py:78
 */
export async function handler(
  args: WikiPipelineArgs | null | undefined,
  handlers: WikiPipelineHandlers,
): Promise<WikiPipelineResult> {
  const limit = Number(args?.limit_per_stage ?? 500); // source: cortex@ed33435 wiki_pipeline.py:80
  const skipCompile = Boolean(args?.skip_compile ?? false);

  const stages: Array<[string, Record<string, unknown>]> = [];

  stages.push(await safeCall("extract", handlers.extract({ limit })));
  stages.push(await safeCall("resolve", handlers.resolve({ limit })));
  stages.push(await safeCall("emerge", handlers.emerge({ limit })));
  stages.push(await safeCall("synthesize", handlers.synthesize({ limit })));
  stages.push(await safeCall("curate", handlers.curate({ limit })));
  if (!skipCompile) {
    stages.push(await safeCall("compile", handlers.compile({ limit })));
  }

  const summary = Object.fromEntries(stages);

  return {
    stages: summary,
    pages_published: Number(
      (summary["compile"] as Record<string, unknown> | undefined)?.["drafts_published"] ?? 0,
    ),
    drafts_approved: Number(
      (summary["curate"] as Record<string, unknown> | undefined)?.["approved"] ?? 0,
    ),
    concepts_inserted: Number(
      (summary["emerge"] as Record<string, unknown> | undefined)?.["concepts_inserted"] ?? 0,
    ),
    claims_inserted: Number(
      (summary["extract"] as Record<string, unknown> | undefined)?.["claims_inserted"] ?? 0,
    ),
  };
}
