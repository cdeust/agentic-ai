/**
 * @agentic/core — ports/codebase-outputs.ts
 *
 * Output Zod schemas for the 12 CodebasePort tools (tools 1–17 scope).
 * Separated from codebase.ts to keep file size ≤ 500 LOC (§4.1).
 *
 * SCHEMA POLICY (ADR-0003):
 *   The Rust binary is the semantic authority. Output schemas use .passthrough()
 *   to tolerate extra fields (e.g. status, tool added by the binary on every
 *   response). For numeric fields the binary may emit as strings (e.g.
 *   "resolution_rate": "0.48"), z.coerce.number() is used.
 *
 * source: docs/ADR/0003-adapter-precondition-strength.md
 * source: inventory/MCP_TOOLS.md — output shapes for tools 1, 8–17, 19
 * source: measured binary output — docs/PHASE_3_PLAN.md §4.3 schema drift
 *
 * Layer: core / domain — no I/O, no infrastructure imports
 */

import { z } from "zod";

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
// source: packages/codebase-rust/src/main.rs:2337-2346 — do_get_impact
// communities is an array of STRINGS (community_id strings), not objects.
// processes is an array of STRINGS (process names), not objects.
// source: packages/codebase-rust/src/main.rs:2337 — json!({ "communities": impact.communities, ... })
// where impact.communities is Vec<String> (community_id list)
export const GetImpactOutputSchema = z
  .object({
    communities: z.array(z.string()),
    communitiesAffected: z.coerce.number().int().nonnegative(),
    processes: z.array(z.string()),
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
// source: packages/codebase-rust/src/main.rs:2481-2506 — do_get_context
// relationships is a nested OBJECT mapping kind → array<{name, qualified_name, kind}>,
// NOT an array. Keys: imports, imported_by, calls, called_by, implements,
// implemented_by, uses, used_by.
// source: packages/codebase-rust/src/main.rs:2494-2503
export const GetContextRelationshipsSchema = z
  .object({
    imports: z.array(z.record(z.string(), z.unknown())),
    importedBy: z.array(z.record(z.string(), z.unknown())),
    calls: z.array(z.record(z.string(), z.unknown())),
    calledBy: z.array(z.record(z.string(), z.unknown())),
    implements: z.array(z.record(z.string(), z.unknown())),
    implementedBy: z.array(z.record(z.string(), z.unknown())),
    uses: z.array(z.record(z.string(), z.unknown())),
    usedBy: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();
export type GetContextRelationships = z.infer<typeof GetContextRelationshipsSchema>;

export const GetContextOutputSchema = z
  .object({
    symbol: z.record(z.string(), z.unknown()),
    relationships: GetContextRelationshipsSchema,
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
    index: z
      .object({
        nodeCount: z.coerce.number().int().nonnegative(),
        edgeCount: z.coerce.number().int().nonnegative(),
        filesIndexed: z.coerce.number().int().nonnegative(),
      })
      .passthrough(),
    resolve: z
      .object({
        totalEdges: z.coerce.number().int().nonnegative(),
        resolutionRate: z.coerce.number().min(0),
      })
      .passthrough(),
    cluster: z
      .object({
        communityCount: z.coerce.number().int().nonnegative(),
        modularity: z.coerce.number(),
        processCount: z.coerce.number().int().nonnegative(),
      })
      .passthrough(),
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

// Tools 2-7, 18, 20-23 output schemas
// source: ai-automatised-pipeline/src/tool_schemas.rs (commit 2cc3780)
//
// SCHEMA POLICY (consistent with ADR-0003 and the deepToCamel() translation):
// All output schema field names are camelCase because the adapter applies
// deepToCamel() to Rust's snake_case output before Zod validation.
// Rust fields run_id → runId, finding_id → findingId, aborted_at → abortedAt,
// turn_index → turnIndex; all other single-word fields are unchanged.
//
// BUG FIX (ap-tool-test-coverage-2026-05-06): the original schemas used
// snake_case keys (run_id, finding_id, aborted_at, turn_index) which could
// never match the camelCase payload produced by deepToCamel. Every happy-path
// call to these tools failed Zod validation. Corrected to camelCase below.
// source: packages/codebase-rust/src/main.rs:886-894 — do_extract_finding
// Rust response: { stage: 1 (number), status, finding_id, artifact_path, run_id, ... }
// stage is a NUMBER (integer 1), not a string.
export const ExtractFindingOutputSchema = z.object({
  status: z.string(),
  runId: z.string(),
  findingId: z.string(),
  stage: z.coerce.number().int().optional(),
  artifactPath: z.string().optional(),
}).passthrough();
export type ExtractFindingOutput = z.infer<typeof ExtractFindingOutputSchema>;

export const RefineFindingOutputSchema = z.object({
  status: z.string(),
  runId: z.string(),
  findingId: z.string(),
  artifact: z.string().optional(),
}).passthrough();
export type RefineFindingOutput = z.infer<typeof RefineFindingOutputSchema>;

export const StartVerificationOutputSchema = z.object({
  status: z.string(),
  runId: z.string(),
  findingId: z.string(),
  session: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export type StartVerificationOutput = z.infer<typeof StartVerificationOutputSchema>;

// source: packages/codebase-rust/src/main.rs:1538-1544 — do_append_clarification
// Rust response: { stage, status, state, seq, turn_count }
// runId and findingId are NOT echoed back — they are caller-owned context.
export const AppendClarificationOutputSchema = z.object({
  status: z.string(),
  state: z.string().optional(),
  seq: z.coerce.number().int().nonnegative().optional(),
  turnCount: z.coerce.number().int().nonnegative().optional(),
}).passthrough();
export type AppendClarificationOutput = z.infer<typeof AppendClarificationOutputSchema>;

// source: packages/codebase-rust/src/main.rs:1697-1714 — do_finalize_verification
// Rust response: { stage, status, state, verified, verified_kind, verified_path,
//   turn_count, transcript_digest, digest_algorithm, transcript_bytes_at_finalize,
//   bytes_written, verifier_version }
// runId and findingId are NOT echoed back.
// transcript_digest → transcriptDigest (deepToCamel)
// verified_path → verifiedPath (deepToCamel)
export const FinalizeVerificationOutputSchema = z.object({
  status: z.string(),
  state: z.string().optional(),
  verified: z.boolean().optional(),
  verifiedKind: z.record(z.string(), z.unknown()).optional(),
  verifiedPath: z.string().optional(),
  turnCount: z.coerce.number().int().nonnegative().optional(),
  transcriptDigest: z.string().optional(),
  digestAlgorithm: z.string().optional(),
  transcriptBytesAtFinalize: z.coerce.number().int().nonnegative().optional(),
}).passthrough();
export type FinalizeVerificationOutput = z.infer<typeof FinalizeVerificationOutputSchema>;

export const AbortVerificationOutputSchema = z.object({
  status: z.string(),
  runId: z.string(),
  findingId: z.string(),
  // aborted_at → abortedAt after deepToCamel
  abortedAt: z.string().optional(),
}).passthrough();
export type AbortVerificationOutput = z.infer<typeof AbortVerificationOutputSchema>;

// source: packages/codebase-rust/src/main.rs:2792-2804 — do_detect_changes
// Rust response fields (snake_case → camelCase after deepToCamel):
//   files_changed → filesChanged (int)
//   symbols_affected → symbolsAffected (array<object>)
//   symbols_affected_count → symbolsAffectedCount (int)
//   communities_affected → communitiesAffected (array<object>)
//   communities_affected_count → communitiesAffectedCount (int)
//   processes_affected → processesAffected (array<object>)
//   processes_affected_count → processesAffectedCount (int)
//   risk_score → riskScore (string "0.0000", coerced to number)
// Previous schema used affectedCount/affected — completely wrong key names.
export const DetectChangesOutputSchema = z.object({
  filesChanged: z.coerce.number().int().nonnegative().optional(),
  symbolsAffected: z.array(z.record(z.string(), z.unknown())),
  symbolsAffectedCount: z.coerce.number().int().nonnegative(),
  communitiesAffected: z.array(z.record(z.string(), z.unknown())),
  communitiesAffectedCount: z.coerce.number().int().nonnegative(),
  processesAffected: z.array(z.record(z.string(), z.unknown())),
  processesAffectedCount: z.coerce.number().int().nonnegative(),
  riskScore: z.coerce.number().min(0).max(1),
}).passthrough();
export type DetectChangesOutput = z.infer<typeof DetectChangesOutputSchema>;

export const PreparePrdInputOutputSchema = z.object({
  status: z.string(),
  runId: z.string(),
  findingId: z.string(),
  artifact: z.string().optional(),
  symbols: z.array(z.record(z.string(), z.unknown())).optional(),
}).passthrough();
export type PreparePrdInputOutput = z.infer<typeof PreparePrdInputOutputSchema>;
export const ValidatePrdAgainstGraphOutputSchema = z.object({ status: z.string(), gatesPassed: z.boolean().optional(), hallucinations: z.array(z.record(z.string(), z.unknown())).optional(), warnings: z.array(z.record(z.string(), z.unknown())).optional(), criticalCount: z.coerce.number().int().nonnegative().optional(), warningCount: z.coerce.number().int().nonnegative().optional() }).passthrough();
export type ValidatePrdAgainstGraphOutput = z.infer<typeof ValidatePrdAgainstGraphOutputSchema>;
export const CheckSecurityGatesOutputSchema = z.object({ status: z.string(), gatesPassed: z.boolean(), flags: z.array(z.record(z.string(), z.unknown())).optional(), criticalCount: z.coerce.number().int().nonnegative().optional() }).passthrough();
export type CheckSecurityGatesOutput = z.infer<typeof CheckSecurityGatesOutputSchema>;
export const VerifySemanticDiffOutputSchema = z.object({ regressionScore: z.coerce.number().nonnegative(), nodesAdded: z.coerce.number().int().nonnegative().optional(), nodesRemoved: z.coerce.number().int().nonnegative().optional(), edgesAdded: z.coerce.number().int().nonnegative().optional(), edgesRemoved: z.coerce.number().int().nonnegative().optional(), danglingRefs: z.array(z.string()).optional(), newUnresolved: z.array(z.string()).optional(), newCycles: z.array(z.array(z.string())).optional(), report: z.record(z.string(), z.unknown()).optional() }).passthrough();
export type VerifySemanticDiffOutput = z.infer<typeof VerifySemanticDiffOutputSchema>;
