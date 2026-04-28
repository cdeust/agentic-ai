/**
 * @agentic/core — ports/codebase.ts
 *
 * CodebasePort: the single interface that describes the 12 codebase-intelligence
 * tools exposed by the ai-architect-mcp Rust binary (Phase 3, tools 1–17 per
 * decision §7.5 of PHASE_3_PLAN.md; tools 18–23 deferred to Phase 6).
 *
 * This file contains: common schemas, all input schemas, the port interface.
 * Output schemas are in codebase-outputs.ts (§4.1 LOC split).
 * Error classes are in codebase-errors.ts (§4.1 LOC split).
 *
 * This file is CORE layer. It must not import from infrastructure or handlers.
 * Allowed imports: stdlib types, zod, sibling ports/ files.
 *
 * source: docs/PHASE_3_PLAN.md §2.7 — sketched CodebasePort interface
 * source: inventory/MCP_TOOLS.md — 23 tools, input/output schemas
 * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — dispose() PGID semantics
 * source: docs/ADR/0002-analyze-codebase-serial-vs-parallel.md — serial queue
 * source: docs/ADR/0003-adapter-precondition-strength.md — syntactic-only validation
 * source: docs/ADR/0004-validation-tool-optional-triple.md — ArtifactWriteSpec
 */

import { z } from "zod";

// Re-export output schemas and errors so callers only need one import.
export * from "./codebase-outputs.js";
export * from "./codebase-errors.js";

import type {
  HealthCheckOutput,
  IndexCodebaseOutput,
  QueryGraphOutput,
  GetSymbolOutput,
  NotFoundOutput,
  ResolveGraphOutput,
  ClusterGraphOutput,
  GetProcessesOutput,
  GetImpactOutput,
  SearchCodebaseOutput,
  GetContextOutput,
  AnalyzeCodebaseOutput,
  LspResolveOutput,
} from "./codebase-outputs.js";

// ─── Common / shared schemas ──────────────────────────────────────────────────

/**
 * Discriminated bundle for tools that optionally write artifacts to disk.
 * Either all three fields are present (write mode) or all are absent (dry-run).
 *
 * precondition: if any field is present, all three must be present (validated by Zod .refine)
 * postcondition: the discriminated shape prevents the "two of three" footgun
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
