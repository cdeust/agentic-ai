/**
 * @agentic/core — ports/codebase.ts
 *
 * CodebasePort: the single interface that describes the 17 codebase-intelligence
 * tools exposed by the ai-architect-mcp Rust binary (Phase 3, tools 1–17 per
 * decision §7.5 of PHASE_3_PLAN.md; tools 18–23 deferred to Phase 6).
 *
 * This file is CORE layer. It must not import from infrastructure or handlers.
 * Allowed imports: stdlib types, zod.
 *
 * source: docs/PHASE_3_PLAN.md §2.7 — sketched CodebasePort interface
 * source: inventory/MCP_TOOLS.md — 23 tools, input/output schemas
 * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — dispose() PGID semantics
 * source: docs/ADR/0002-analyze-codebase-serial-vs-parallel.md — serial queue
 * source: docs/ADR/0003-adapter-precondition-strength.md — syntactic-only validation
 * source: docs/ADR/0004-validation-tool-optional-triple.md — ArtifactWriteSpec
 */

import { z } from "zod";

// ─── Common / shared schemas ──────────────────────────────────────────────────

/**
 * Discriminated bundle for tools that optionally write artifacts to disk.
 * Either all three fields are present (write mode) or all are absent (dry-run).
 *
 * precondition: if any field is present, all three must be present (validated by Zod .refine)
 * postcondition: the discriminated shape prevents the "two of three" footgun documented in ADR-0004
 *
 * source: docs/ADR/0004-validation-tool-optional-triple.md
 */
export const ArtifactWriteSpecSchema = z.object({
  runId: z.string().min(1),
  findingId: z.string().min(1),
  outputDir: z.string().min(1),
});
export type ArtifactWriteSpec = z.infer<typeof ArtifactWriteSpecSchema>;

/**
 * Language hint for tree-sitter parser selection.
 * "auto" triggers heuristic detection by the Rust binary.
 *
 * source: inventory/MCP_TOOLS.md tool #8 index_codebase input schema
 */
export const LanguageSchema = z.enum(["auto", "rust", "python", "typescript"]);
export type Language = z.infer<typeof LanguageSchema>;

// ─── Input schemas (tools 1–17) ───────────────────────────────────────────────

// Tool 1: health_check
export const HealthCheckInputSchema = z.object({}).strict();
export type HealthCheckInput = z.infer<typeof HealthCheckInputSchema>;

// Tool 8: index_codebase
// source: inventory/MCP_TOOLS.md tool #8
export const IndexCodebaseInputSchema = z
  .object({
    path: z.string().min(1),
    language: LanguageSchema.default("auto"),
    outputDir: z.string().min(1),
  })
  .strict();
export type IndexCodebaseInput = z.infer<typeof IndexCodebaseInputSchema>;

// Tool 9: query_graph
// source: inventory/MCP_TOOLS.md tool #9
export const QueryGraphInputSchema = z
  .object({
    graphPath: z.string().min(1),
    query: z.string().min(1),
  })
  .strict();
export type QueryGraphInput = z.infer<typeof QueryGraphInputSchema>;

// Tool 10: get_symbol
// source: inventory/MCP_TOOLS.md tool #10
export const GetSymbolInputSchema = z
  .object({
    graphPath: z.string().min(1),
    qualifiedName: z.string().min(1),
  })
  .strict();
export type GetSymbolInput = z.infer<typeof GetSymbolInputSchema>;

// Tool 11: resolve_graph
// source: inventory/MCP_TOOLS.md tool #11
export const ResolveGraphInputSchema = z
  .object({
    graphPath: z.string().min(1),
  })
  .strict();
export type ResolveGraphInput = z.infer<typeof ResolveGraphInputSchema>;

// Tool 12: cluster_graph
// source: inventory/MCP_TOOLS.md tool #12
export const ClusterGraphInputSchema = z
  .object({
    graphPath: z.string().min(1),
    resolutionParam: z.number().positive().optional(),
  })
  .strict();
export type ClusterGraphInput = z.infer<typeof ClusterGraphInputSchema>;

// Tool 13: get_processes
// source: inventory/MCP_TOOLS.md tool #13
export const GetProcessesInputSchema = z
  .object({
    graphPath: z.string().min(1),
  })
  .strict();
export type GetProcessesInput = z.infer<typeof GetProcessesInputSchema>;

// Tool 14: get_impact
// source: inventory/MCP_TOOLS.md tool #14
export const GetImpactInputSchema = z
  .object({
    graphPath: z.string().min(1),
    qualifiedName: z.string().min(1),
  })
  .strict();
export type GetImpactInput = z.infer<typeof GetImpactInputSchema>;

// Tool 15: search_codebase
// source: inventory/MCP_TOOLS.md tool #15
export const SearchCodebaseInputSchema = z
  .object({
    graphPath: z.string().min(1),
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
    labelFilter: z.string().optional(),
  })
  .strict();
export type SearchCodebaseInput = z.infer<typeof SearchCodebaseInputSchema>;

// Tool 16: get_context
// source: inventory/MCP_TOOLS.md tool #16
export const GetContextInputSchema = z
  .object({
    graphPath: z.string().min(1),
    qualifiedName: z.string().min(1),
  })
  .strict();
export type GetContextInput = z.infer<typeof GetContextInputSchema>;

// Tool 17: analyze_codebase  (composite: index + resolve + cluster + search)
// source: inventory/MCP_TOOLS.md tool #17
export const AnalyzeCodebaseInputSchema = z
  .object({
    path: z.string().min(1),
    language: LanguageSchema.default("auto"),
    outputDir: z.string().min(1),
    resolutionParam: z.number().positive().optional(),
    lsp: z.boolean().optional(),
  })
  .strict();
export type AnalyzeCodebaseInput = z.infer<typeof AnalyzeCodebaseInputSchema>;

// Tool 19: lsp_resolve  (ADR-0001 — four distinct error reason codes)
// source: inventory/MCP_TOOLS.md tool #19
// source: docs/ADR/0001-lsp-resolve-subprocess-chain.md
export const LspResolveInputSchema = z
  .object({
    graphPath: z.string().min(1),
    codebasePath: z.string().min(1),
    language: LanguageSchema.optional(),
    lspCommand: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();
export type LspResolveInput = z.infer<typeof LspResolveInputSchema>;

// ─── Output schemas (tools 1–17) ──────────────────────────────────────────────
//
// SCHEMA POLICY (ADR-0003):
//   The Rust binary is the semantic authority. Output schemas use .passthrough()
//   to tolerate extra fields (e.g. status, tool added by the binary on every
//   response). For numeric fields the binary may emit as strings (e.g.
//   "resolution_rate": "0.48"), z.coerce.number() is used.
//
//   source: docs/ADR/0003-adapter-precondition-strength.md
//   source: measured binary output — see PHASE_3_PLAN.md §4.3 schema drift

// Tool 1: health_check output
// source: inventory/MCP_TOOLS.md tool #1
export const HealthCheckOutputSchema = z
  .object({
    stage: z.number(),
    name: z.string(),
    status: z.string(),
    server: z.string(),
    version: z.string(),
    protocol: z.string(),
    stagesRegistered: z.number().int().nonnegative(),
    toolsCount: z.number().int().nonnegative(),
  })
  .passthrough(); // allow extra fields; health payload is non-contractual
export type HealthCheckOutput = z.infer<typeof HealthCheckOutputSchema>;

/** Stage identifier for graph-build tools. source: inventory/MCP_TOOLS.md §Stage column */
const INDEX_CODEBASE_STAGE = 3; // source: inventory/MCP_TOOLS.md tool #8 — stage field value

// Tool 8: index_codebase output
// source: inventory/MCP_TOOLS.md tool #8
// source: measured binary output — actual response includes status, tool fields
export const IndexCodebaseOutputSchema = z
  .object({
    stage: z.literal(INDEX_CODEBASE_STAGE),
    graphPath: z.string(),
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    filesIndexed: z.number().int().nonnegative(),
    elapsedMs: z.coerce.number().nonnegative(),
  })
  .passthrough(); // binary adds status:"ok", tool:"index_codebase"
export type IndexCodebaseOutput = z.infer<typeof IndexCodebaseOutputSchema>;

// Tool 9: query_graph output
// source: inventory/MCP_TOOLS.md tool #9
export const QueryGraphOutputSchema = z
  .object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.unknown())),
    result: z.unknown(),
    elapsedMs: z.coerce.number().nonnegative(),
  })
  .passthrough();
export type QueryGraphOutput = z.infer<typeof QueryGraphOutputSchema>;

// Tool 10 / 16: symbol-not-found discriminant (shared by get_symbol + get_context)
// source: inventory/MCP_TOOLS.md tools #10, #16
export const NotFoundOutputSchema = z
  .object({
    status: z.literal("error"),
    reason: z.literal("symbol_not_found"),
    didYouMean: z.array(z.string()),
  })
  .passthrough();
export type NotFoundOutput = z.infer<typeof NotFoundOutputSchema>;

// Tool 10: get_symbol output (success branch)
// source: inventory/MCP_TOOLS.md tool #10
export const GetSymbolOutputSchema = z
  .object({
    node: z.record(z.string(), z.unknown()),
    edgesOut: z.array(z.record(z.string(), z.unknown())),
    edgesIn: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();
export type GetSymbolOutput = z.infer<typeof GetSymbolOutputSchema>;

// Tool 11: resolve_graph output
// source: inventory/MCP_TOOLS.md tool #11
// source: measured binary output — resolution_rate is a string like "0.48"
export const ResolveGraphOutputSchema = z
  .object({
    importsResolved: z.coerce.number().int().nonnegative().optional(),
    callsResolved: z.coerce.number().int().nonnegative().optional(),
    implementsResolved: z.coerce.number().int().nonnegative().optional(),
    extendsResolved: z.coerce.number().int().nonnegative().optional(),
    usesResolved: z.coerce.number().int().nonnegative().optional(),
    totalEdges: z.coerce.number().int().nonnegative(),
    totalRefs: z.coerce.number().int().nonnegative().optional(),
    resolutionRate: z.coerce.number().min(0),
    unresolvedCount: z.coerce.number().int().nonnegative().optional(),
    elapsedMs: z.coerce.number().nonnegative().optional(),
  })
  .passthrough();
export type ResolveGraphOutput = z.infer<typeof ResolveGraphOutputSchema>;

// Tool 12: cluster_graph output
// source: inventory/MCP_TOOLS.md tool #12
// source: measured binary output — modularity is emitted as string "0.854890"
export const ClusterGraphOutputSchema = z
  .object({
    communityCount: z.coerce.number().int().nonnegative(),
    modularity: z.coerce.number(),
    processCount: z.coerce.number().int().nonnegative(),
    clusters: z.array(z.record(z.string(), z.unknown())).optional(),
    totalMemberships: z.coerce.number().int().nonnegative().optional(),
    clustersTruncatedAt: z.coerce.number().int().nonnegative().optional(),
    elapsedMs: z.coerce.number().nonnegative().optional(),
  })
  .passthrough();
export type ClusterGraphOutput = z.infer<typeof ClusterGraphOutputSchema>;

// Tool 13: get_processes output
// source: inventory/MCP_TOOLS.md tool #13
export const GetProcessesOutputSchema = z
  .object({
    processCount: z.coerce.number().int().nonnegative(),
    processes: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();
export type GetProcessesOutput = z.infer<typeof GetProcessesOutputSchema>;

// Tool 14: get_impact output
// source: inventory/MCP_TOOLS.md tool #14
export const GetImpactOutputSchema = z
  .object({
    communities: z.array(z.record(z.string(), z.unknown())),
    communitiesAffected: z.coerce.number().int().nonnegative(),
    processes: z.array(z.record(z.string(), z.unknown())),
    processesAffected: z.coerce.number().int().nonnegative(),
  })
  .passthrough();
export type GetImpactOutput = z.infer<typeof GetImpactOutputSchema>;

// Tool 15: search_codebase output
// source: inventory/MCP_TOOLS.md tool #15
export const SearchCodebaseOutputSchema = z
  .object({
    resultCount: z.coerce.number().int().nonnegative(),
    results: z.array(z.record(z.string(), z.unknown())),
    elapsedMs: z.coerce.number().nonnegative(),
  })
  .passthrough();
export type SearchCodebaseOutput = z.infer<typeof SearchCodebaseOutputSchema>;

// Tool 16: get_context output (success branch)
// source: inventory/MCP_TOOLS.md tool #16
export const GetContextOutputSchema = z
  .object({
    symbol: z.record(z.string(), z.unknown()),
    relationships: z.array(z.record(z.string(), z.unknown())),
    community: z.record(z.string(), z.unknown()).nullable(),
    processes: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();
export type GetContextOutput = z.infer<typeof GetContextOutputSchema>;

// Tool 17: analyze_codebase output
// source: inventory/MCP_TOOLS.md tool #17
// source: measured binary output — nested index/resolve/cluster are partial
//   (only a subset of fields; use .passthrough() on sub-schemas)
export const AnalyzeCodebaseOutputSchema = z
  .object({
    graphPath: z.string(),
    index: z.object({
      nodeCount: z.coerce.number().int().nonnegative(),
      edgeCount: z.coerce.number().int().nonnegative(),
      filesIndexed: z.coerce.number().int().nonnegative(),
    }).passthrough(),
    resolve: z.object({
      totalEdges: z.coerce.number().int().nonnegative(),
      resolutionRate: z.coerce.number().min(0),
    }).passthrough(),
    cluster: z.object({
      communityCount: z.coerce.number().int().nonnegative(),
      modularity: z.coerce.number(),
      processCount: z.coerce.number().int().nonnegative(),
    }).passthrough(),
    searchIndex: z.record(z.string(), z.unknown()),
    lspResolve: z
      .object({
        resolvedCount: z.coerce.number().int().nonnegative(),
        failedCount: z.coerce.number().int().nonnegative(),
        skippedCount: z.coerce.number().int().nonnegative(),
        elapsedMs: z.coerce.number().nonnegative(),
      })
      .passthrough()
      .nullable(),
    totalElapsedMs: z.coerce.number().nonnegative(),
  })
  .passthrough();
export type AnalyzeCodebaseOutput = z.infer<typeof AnalyzeCodebaseOutputSchema>;

// Tool 19: lsp_resolve output
// source: inventory/MCP_TOOLS.md tool #19
// source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — four error reason codes
export const LspResolveOutputSchema = z
  .object({
    resolvedCount: z.coerce.number().int().nonnegative(),
    failedCount: z.coerce.number().int().nonnegative(),
    skippedCount: z.coerce.number().int().nonnegative(),
    elapsedMs: z.coerce.number().nonnegative(),
  })
  .passthrough();
export type LspResolveOutput = z.infer<typeof LspResolveOutputSchema>;

// ─── Typed errors ─────────────────────────────────────────────────────────────

/**
 * Raised when a Rust output fails Zod validation (schema drift).
 * Carries the raw Rust response for diagnostics.
 *
 * source: docs/ADR/0003-adapter-precondition-strength.md
 */
export class CodebaseValidationError extends Error {
  readonly reason: string;
  readonly raw: Record<string, unknown>;

  constructor(
    message: string,
    reason: string,
    raw: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CodebaseValidationError";
    this.reason = reason;
    this.raw = raw;
  }
}

/**
 * Raised when a Rust call exceeds its per-method timeout.
 *
 * source: docs/PHASE_3_PLAN.md §4.2 — per-method timeout constants
 */
export class CodebaseTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(
      `Codebase tool "${method}" timed out after ${timeoutMs.toString()}ms`,
    );
    this.name = "CodebaseTimeoutError";
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Raised when the Rust subprocess itself crashes or returns a JSON-RPC error.
 */
export class CodebaseSubprocessError extends Error {
  readonly code: number | undefined;
  readonly rawMessage: string;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "CodebaseSubprocessError";
    this.code = code;
    this.rawMessage = message;
  }
}

/**
 * Raised by lspResolve when the Rust binary reports one of the four LSP error codes.
 *
 * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — four distinct reason codes
 * source: inventory/MCP_TOOLS.md tool #19 — error_reason codes
 */
export class CodebaseLspError extends Error {
  readonly reason:
    | "lsp_command_not_allowed"
    | "lsp_not_found"
    | "lsp_probe_failed"
    | "lsp_resolve_failed";
  readonly allowed: readonly string[] | undefined;

  constructor(
    message: string,
    reason:
      | "lsp_command_not_allowed"
      | "lsp_not_found"
      | "lsp_probe_failed"
      | "lsp_resolve_failed",
    allowed?: readonly string[],
  ) {
    super(message);
    this.name = "CodebaseLspError";
    this.reason = reason;
    this.allowed = allowed;
  }
}

// ─── The port ─────────────────────────────────────────────────────────────────

/**
 * CodebasePort — the interface every codebase adapter must implement.
 *
 * Method naming uses TS camelCase conventions. The adapter translates
 * camelCase ↔ snake_case at the JSON-RPC boundary.
 *
 * Precondition invariant (ADR-0003): all input validation is SYNTACTIC only.
 * Path existence, graph readability, and semantic correctness are delegated
 * to the Rust binary. Errors from the binary surface as CodebaseValidationError
 * or CodebaseSubprocessError with the raw response preserved.
 *
 * source: docs/PHASE_3_PLAN.md §2.7 — sketched interface
 * source: docs/ADR/0003-adapter-precondition-strength.md
 */
export interface CodebasePort {
  // ── Stage 0 ────────────────────────────────────────────────────────────────
  /** Round-trips the binary's serverInfo. Always the cheapest probe. */
  healthCheck(input: HealthCheckInput): Promise<HealthCheckOutput>;

  // ── Stage 3a — graph build ─────────────────────────────────────────────────
  /**
   * Index a codebase directory into a LadybugDB graph file.
   *
   * Side-effect note: Rust sets AA_SEARCH_INDEX_DIR env-var per call.
   * The subprocess is single-threaded; the env-var is benign in a long-lived
   * process (same process overwrites its own env on each call).
   *
   * source: docs/PHASE_3_PLAN.md §1.8 open question 5 — AA_SEARCH_INDEX_DIR
   */
  indexCodebase(input: IndexCodebaseInput): Promise<IndexCodebaseOutput>;

  /** Execute a raw Cypher query against the graph file. */
  queryGraph(input: QueryGraphInput): Promise<QueryGraphOutput>;

  /**
   * Look up a fully-qualified symbol in the graph.
   * Returns NotFoundOutput (not an exception) when the symbol is absent.
   */
  getSymbol(input: GetSymbolInput): Promise<GetSymbolOutput | NotFoundOutput>;

  // ── Stage 3b — resolution ──────────────────────────────────────────────────
  /** Resolve cross-file import/call/extends edges. */
  resolveGraph(input: ResolveGraphInput): Promise<ResolveGraphOutput>;

  // ── Stage 3b-v2 — LSP-augmented resolution ─────────────────────────────────
  /**
   * Augment graph edges using a Language Server Protocol subprocess.
   *
   * Throws CodebaseLspError (not CodebaseSubprocessError) for the four
   * LSP-specific error codes. Callers MUST branch on CodebaseLspError.reason
   * to implement allow-list enforcement.
   *
   * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md
   */
  lspResolve(input: LspResolveInput): Promise<LspResolveOutput>;

  // ── Stage 3c — clustering ──────────────────────────────────────────────────
  /** Run Louvain + C2 community detection. */
  clusterGraph(input: ClusterGraphInput): Promise<ClusterGraphOutput>;

  /** List discovered processes (execution-thread communities). */
  getProcesses(input: GetProcessesInput): Promise<GetProcessesOutput>;

  /** Return communities + processes affected by a symbol change. */
  getImpact(input: GetImpactInput): Promise<GetImpactOutput>;

  // ── Stage 3d — search ──────────────────────────────────────────────────────
  /**
   * Hybrid BM25 + TF-IDF search over the symbol index.
   * source: inventory/MCP_TOOLS.md tool #15
   */
  searchCodebase(input: SearchCodebaseInput): Promise<SearchCodebaseOutput>;

  /**
   * Return full context (symbol + relationships + community + processes).
   * Returns NotFoundOutput (not an exception) when the symbol is absent.
   */
  getContext(input: GetContextInput): Promise<GetContextOutput | NotFoundOutput>;

  // ── Stage 3 composite ──────────────────────────────────────────────────────
  /**
   * Run the full analysis pipeline: index → resolve → cluster → search.
   * Optional LSP pass if input.lsp === true.
   *
   * This is the most expensive call; default timeout is 5 minutes.
   * source: docs/PHASE_3_PLAN.md §4.2 — analyzeCodebase timeout
   */
  analyzeCodebase(input: AnalyzeCodebaseInput): Promise<AnalyzeCodebaseOutput>;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  /**
   * Terminate the Rust subprocess (and any LSP grandchild) gracefully.
   *
   * Sends SIGTERM to the process group (PGID), then SIGKILL after 5 000 ms
   * if the process has not exited.
   *
   * postcondition: no orphan processes with the binary name remain after resolve.
   *
   * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — PGID / setsid
   * source: docs/PHASE_3_PLAN.md §3.6 — supervisor lifecycle
   */
  dispose(): Promise<void>;
}
