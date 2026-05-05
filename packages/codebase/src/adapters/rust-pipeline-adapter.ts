/**
 * @agentic/codebase — adapters/rust-pipeline-adapter.ts
 *
 * RustPipelineAdapter: implements CodebasePort by JSON-RPC over the
 * ai-architect-mcp Rust subprocess stdio. This is THE infrastructure
 * deliverable of Phase 3 worktree #2.
 *
 * Tools implemented (decision §7.5 — tools 1–17; 18–23 deferred to Phase 6):
 *   1. health_check
 *   8. index_codebase
 *   9. query_graph
 *  10. get_symbol
 *  11. resolve_graph
 *  12. cluster_graph
 *  13. get_processes
 *  14. get_impact
 *  15. search_codebase
 *  16. get_context
 *  17. analyze_codebase
 *  19. lsp_resolve
 *
 * source: docs/PHASE_3_PLAN.md §5.4#2 — scope
 * source: inventory/MCP_TOOLS.md — full input/output schemas
 * source: docs/ADR/0001 — LSP lifecycle + PGID
 * source: docs/ADR/0002 — serial queue
 * source: docs/ADR/0003 — syntactic-only preconditions
 * source: docs/ADR/0004 — ArtifactWriteSpec
 *
 * Layer: infrastructure / adapters
 * Allowed imports: @agentic/core ports, ./internal/*, node stdlib
 */

import {
  type CodebasePort,
  type HealthCheckInput,
  type HealthCheckOutput,
  type IndexCodebaseInput,
  type IndexCodebaseOutput,
  type QueryGraphInput,
  type QueryGraphOutput,
  type GetSymbolInput,
  type GetSymbolOutput,
  type NotFoundOutput,
  type ResolveGraphInput,
  type ResolveGraphOutput,
  type ClusterGraphInput,
  type ClusterGraphOutput,
  type GetProcessesInput,
  type GetProcessesOutput,
  type GetImpactInput,
  type GetImpactOutput,
  type SearchCodebaseInput,
  type SearchCodebaseOutput,
  type GetContextInput,
  type GetContextOutput,
  type AnalyzeCodebaseInput,
  type AnalyzeCodebaseOutput,
  type LspResolveInput,
  type LspResolveOutput,
  HealthCheckOutputSchema,
  IndexCodebaseOutputSchema,
  QueryGraphOutputSchema,
  GetSymbolOutputSchema,
  NotFoundOutputSchema,
  ResolveGraphOutputSchema,
  ClusterGraphOutputSchema,
  GetProcessesOutputSchema,
  GetImpactOutputSchema,
  SearchCodebaseOutputSchema,
  GetContextOutputSchema,
  AnalyzeCodebaseOutputSchema,
  LspResolveOutputSchema,
  ExtractFindingOutputSchema, RefineFindingOutputSchema, StartVerificationOutputSchema,
  AppendClarificationOutputSchema, FinalizeVerificationOutputSchema, AbortVerificationOutputSchema,
  DetectChangesOutputSchema, PreparePrdInputOutputSchema, ValidatePrdAgainstGraphOutputSchema,
  CheckSecurityGatesOutputSchema, VerifySemanticDiffOutputSchema,
  CodebaseValidationError,
  CodebaseLspError,
  type ExtractFindingInput, type ExtractFindingOutput,
  type RefineFindingInput, type RefineFindingOutput,
  type StartVerificationInput, type StartVerificationOutput,
  type AppendClarificationInput, type AppendClarificationOutput,
  type FinalizeVerificationInput, type FinalizeVerificationOutput,
  type AbortVerificationInput, type AbortVerificationOutput,
  type DetectChangesInput, type DetectChangesOutput,
  type PreparePrdInputInput, type PreparePrdInputOutput,
  type ValidatePrdAgainstGraphInput, type ValidatePrdAgainstGraphOutput,
  type CheckSecurityGatesInput, type CheckSecurityGatesOutput,
  type VerifySemanticDiffInput, type VerifySemanticDiffOutput,
} from "@agentic/core";
import type { ZodSchema } from "zod";
import type { JsonRpcClient } from "../internal/json-rpc-client.js";
import type { ProcessSupervisor } from "../internal/process-supervisor.js";
import { unwrapEnvelope } from "../internal/envelope.js";
import type { QueueMetrics } from "../internal/serial-queue.js";

// ─── camelCase → snake_case key translation ───────────────────────────────────

/**
 * Convert a camelCase key to snake_case.
 * postcondition: every uppercase letter is replaced by _<lowercase>
 */
function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

/**
 * Recursively convert all keys of a plain object from camelCase to snake_case.
 * Handles nested objects and arrays.
 *
 * precondition: value is a JSON-serialisable value
 * postcondition: all string keys in the result are snake_case
 */
function deepToSnake(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepToSnake);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[toSnake(k)] = deepToSnake(v);
    }
    return result;
  }
  return value;
}

/**
 * Convert a snake_case key to camelCase.
 * postcondition: every _<char> sequence is replaced by <uppercase char>
 */
function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Recursively convert all keys of a plain object from snake_case to camelCase.
 *
 * precondition: value is a JSON-parsed value from the Rust binary output
 * postcondition: all string keys in the result are camelCase
 */
function deepToCamel(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepToCamel);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[toCamel(k)] = deepToCamel(v);
    }
    return result;
  }
  return value;
}

// ─── LSP error response detection ─────────────────────────────────────────────

const LSP_ERROR_REASONS = new Set([
  "lsp_command_not_allowed",
  "lsp_not_found",
  "lsp_probe_failed",
  "lsp_resolve_failed",
]);

// ─── RustPipelineAdapter ──────────────────────────────────────────────────────

/**
 * RustPipelineAdapter implements CodebasePort by forwarding each method to the
 * ai-architect-mcp Rust binary via newline-delimited JSON-RPC over stdio.
 *
 * Class invariant:
 *   - All calls are serialised through a single FIFO queue (ADR-0002).
 *   - Inputs are converted from camelCase to snake_case before forwarding.
 *   - Outputs are converted from snake_case to camelCase before returning.
 *   - Output shapes are Zod-validated; schema drift surfaces as
 *     CodebaseValidationError (not a silent accept).
 */
export class RustPipelineAdapter implements CodebasePort {
  private readonly _client: JsonRpcClient;
  private readonly _supervisor: ProcessSupervisor;

  constructor(supervisor: ProcessSupervisor, client: JsonRpcClient) {
    this._supervisor = supervisor;
    this._client = client;
  }

  // ─── Generic dispatch helper ─────────────────────────────────────────────

  /**
   * Forward a tool call to the Rust binary.
   *
   * precondition: toolName matches a valid tool in the binary; input is camelCase
   * postcondition: returns a camelCase-keyed object validated against schema
   *
   * @throws CodebaseValidationError when Zod validation fails (schema drift)
   * @throws CodebaseSubprocessError on JSON-RPC error response
   * @throws CodebaseTimeoutError on timeout
   */
  private async _call<T>(
    toolName: string,
    input: Record<string, unknown>,
    schema: ZodSchema<T>,
  ): Promise<T> {
    const snakeInput = deepToSnake(input) as Record<string, unknown>;
    const rawEnvelope = await this._client.call(toolName, snakeInput);
    const rawPayload = unwrapEnvelope(rawEnvelope);
    const camelPayload = deepToCamel(rawPayload) as Record<string, unknown>;

    const parseResult = schema.safeParse(camelPayload);
    if (!parseResult.success) {
      throw new CodebaseValidationError(
        `Schema validation failed for tool "${toolName}": ${parseResult.error.message}`,
        parseResult.error.message,
        camelPayload,
      );
    }
    return parseResult.data;
  }

  // ─── Stage 0 ─────────────────────────────────────────────────────────────

  async healthCheck(_input: HealthCheckInput): Promise<HealthCheckOutput> {
    // health_check takes empty params but the binary expects tools/call envelope.
    return this._call("health_check", {}, HealthCheckOutputSchema);
  }

  // ─── Stage 3a ────────────────────────────────────────────────────────────

  async indexCodebase(input: IndexCodebaseInput): Promise<IndexCodebaseOutput> {
    return this._call(
      "index_codebase",
      input as unknown as Record<string, unknown>,
      IndexCodebaseOutputSchema,
    );
  }

  async queryGraph(input: QueryGraphInput): Promise<QueryGraphOutput> {
    return this._call(
      "query_graph",
      input as unknown as Record<string, unknown>,
      QueryGraphOutputSchema,
    );
  }

  async getSymbol(
    input: GetSymbolInput,
  ): Promise<GetSymbolOutput | NotFoundOutput> {
    const snakeInput = deepToSnake(
      input as unknown as Record<string, unknown>,
    ) as Record<string, unknown>;
    const rawEnvelope = await this._client.call("get_symbol", snakeInput);
    const rawPayload = unwrapEnvelope(rawEnvelope);
    const camelPayload = deepToCamel(rawPayload) as Record<string, unknown>;

    // Try success schema first, then not-found.
    const success = GetSymbolOutputSchema.safeParse(camelPayload);
    if (success.success) return success.data;

    const notFound = NotFoundOutputSchema.safeParse(camelPayload);
    if (notFound.success) return notFound.data;

    throw new CodebaseValidationError(
      `get_symbol output matches neither success nor not-found schema`,
      "schema_mismatch",
      camelPayload,
    );
  }

  // ─── Stage 3b ────────────────────────────────────────────────────────────

  async resolveGraph(
    input: ResolveGraphInput,
  ): Promise<ResolveGraphOutput> {
    return this._call(
      "resolve_graph",
      input as unknown as Record<string, unknown>,
      ResolveGraphOutputSchema,
    );
  }

  // ─── Stage 3b-v2 (LSP) ───────────────────────────────────────────────────

  /**
   * lspResolve — augment graph edges via LSP subprocess.
   *
   * Translates the four Rust error-reason codes into CodebaseLspError.
   * Callers must branch on err.reason to implement allow-list logic.
   *
   * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — four error codes
   */
  async lspResolve(input: LspResolveInput): Promise<LspResolveOutput> {
    const snakeInput = deepToSnake(
      input as unknown as Record<string, unknown>,
    ) as Record<string, unknown>;
    const rawEnvelope = await this._client.call("lsp_resolve", snakeInput);
    const rawPayload = unwrapEnvelope(rawEnvelope);
    const camelPayload = deepToCamel(rawPayload) as Record<string, unknown>;

    // Detect LSP-specific error payloads before attempting success parse.
    if (
      typeof camelPayload["status"] === "string" &&
      camelPayload["status"] === "error" &&
      typeof camelPayload["reason"] === "string" &&
      LSP_ERROR_REASONS.has(camelPayload["reason"])
    ) {
      const reason = camelPayload["reason"] as
        | "lsp_command_not_allowed"
        | "lsp_not_found"
        | "lsp_probe_failed"
        | "lsp_resolve_failed";

      const allowed = Array.isArray(camelPayload["allowed"])
        ? (camelPayload["allowed"] as string[])
        : undefined;

      throw new CodebaseLspError(
        String(camelPayload["message"] ?? reason),
        reason,
        allowed,
      );
    }

    const parseResult = LspResolveOutputSchema.safeParse(camelPayload);
    if (!parseResult.success) {
      throw new CodebaseValidationError(
        `lsp_resolve output failed schema validation: ${parseResult.error.message}`,
        parseResult.error.message,
        camelPayload,
      );
    }
    return parseResult.data;
  }

  // ─── Stage 3c ────────────────────────────────────────────────────────────

  async clusterGraph(
    input: ClusterGraphInput,
  ): Promise<ClusterGraphOutput> {
    return this._call(
      "cluster_graph",
      input as unknown as Record<string, unknown>,
      ClusterGraphOutputSchema,
    );
  }

  async getProcesses(
    input: GetProcessesInput,
  ): Promise<GetProcessesOutput> {
    return this._call(
      "get_processes",
      input as unknown as Record<string, unknown>,
      GetProcessesOutputSchema,
    );
  }

  async getImpact(input: GetImpactInput): Promise<GetImpactOutput> {
    return this._call(
      "get_impact",
      input as unknown as Record<string, unknown>,
      GetImpactOutputSchema,
    );
  }

  // ─── Stage 3d ────────────────────────────────────────────────────────────

  async searchCodebase(
    input: SearchCodebaseInput,
  ): Promise<SearchCodebaseOutput> {
    return this._call(
      "search_codebase",
      input as unknown as Record<string, unknown>,
      SearchCodebaseOutputSchema,
    );
  }

  async getContext(
    input: GetContextInput,
  ): Promise<GetContextOutput | NotFoundOutput> {
    const snakeInput = deepToSnake(
      input as unknown as Record<string, unknown>,
    ) as Record<string, unknown>;
    const rawEnvelope = await this._client.call("get_context", snakeInput);
    const rawPayload = unwrapEnvelope(rawEnvelope);
    const camelPayload = deepToCamel(rawPayload) as Record<string, unknown>;

    const success = GetContextOutputSchema.safeParse(camelPayload);
    if (success.success) return success.data;

    const notFound = NotFoundOutputSchema.safeParse(camelPayload);
    if (notFound.success) return notFound.data;

    throw new CodebaseValidationError(
      `get_context output matches neither success nor not-found schema`,
      "schema_mismatch",
      camelPayload,
    );
  }

  // ─── Stage 3 composite ───────────────────────────────────────────────────

  async analyzeCodebase(
    input: AnalyzeCodebaseInput,
  ): Promise<AnalyzeCodebaseOutput> {
    return this._call(
      "analyze_codebase",
      input as unknown as Record<string, unknown>,
      AnalyzeCodebaseOutputSchema,
    );
  }


  // Stage 1a - source: tool_schemas.rs:52-80 (2cc3780)
  async extractFinding(input: ExtractFindingInput): Promise<ExtractFindingOutput> { return this._call("extract_finding", input as unknown as Record<string, unknown>, ExtractFindingOutputSchema); }
  // Stage 1b - source: tool_schemas.rs:82-136 (2cc3780)
  async refineFinding(input: RefineFindingInput): Promise<RefineFindingOutput> { return this._call("refine_finding", input as unknown as Record<string, unknown>, RefineFindingOutputSchema); }
  // Stage 2a - source: tool_schemas.rs:138-153 (2cc3780)
  async startVerification(input: StartVerificationInput): Promise<StartVerificationOutput> { return this._call("start_verification", input as unknown as Record<string, unknown>, StartVerificationOutputSchema); }
  // Stage 2b - source: tool_schemas.rs:155-173 (2cc3780)
  async appendClarification(input: AppendClarificationInput): Promise<AppendClarificationOutput> { return this._call("append_clarification", input as unknown as Record<string, unknown>, AppendClarificationOutputSchema); }
  // Stage 2c - source: tool_schemas.rs:175-190 (2cc3780)
  async finalizeVerification(input: FinalizeVerificationInput): Promise<FinalizeVerificationOutput> { return this._call("finalize_verification", input as unknown as Record<string, unknown>, FinalizeVerificationOutputSchema); }
  // Stage 2d - source: tool_schemas.rs:192-208 (2cc3780)
  async abortVerification(input: AbortVerificationInput): Promise<AbortVerificationOutput> { return this._call("abort_verification", input as unknown as Record<string, unknown>, AbortVerificationOutputSchema); }
  // Stage 3e - source: tool_schemas.rs:566-600 (2cc3780)
  async detectChanges(input: DetectChangesInput): Promise<DetectChangesOutput> { return this._call("detect_changes", input as unknown as Record<string, unknown>, DetectChangesOutputSchema); }
  // Stage 4 - source: tool_schemas.rs:492-508 (2cc3780)
  async preparePrdInput(input: PreparePrdInputInput): Promise<PreparePrdInputOutput> { return this._call("prepare_prd_input", input as unknown as Record<string, unknown>, PreparePrdInputOutputSchema); }
  // Stage 6 - source: tool_schemas.rs:510-528 (2cc3780)
  async validatePrdAgainstGraph(input: ValidatePrdAgainstGraphInput): Promise<ValidatePrdAgainstGraphOutput> { return this._call("validate_prd_against_graph", input as unknown as Record<string, unknown>, ValidatePrdAgainstGraphOutputSchema); }
  // Stage 8 - source: tool_schemas.rs:530-547 (2cc3780)
  async checkSecurityGates(input: CheckSecurityGatesInput): Promise<CheckSecurityGatesOutput> { return this._call("check_security_gates", input as unknown as Record<string, unknown>, CheckSecurityGatesOutputSchema); }
  // Stage 9 - source: tool_schemas.rs:549-564 (2cc3780)
  async verifySemanticDiff(input: VerifySemanticDiffInput): Promise<VerifySemanticDiffOutput> { return this._call("verify_semantic_diff", input as unknown as Record<string, unknown>, VerifySemanticDiffOutputSchema); }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    await this._supervisor.dispose();
  }

  /** Queue metrics for telemetry / monitoring. */
  get metrics(): QueueMetrics {
    return this._client.metrics;
  }
}
