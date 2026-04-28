/**
 * @agentic/codebase — public API / composition root
 *
 * createCodebaseAdapter(config) is the ONLY entry point consumers use.
 * It wires ProcessSupervisor → JsonRpcClient → RustPipelineAdapter and
 * returns a CodebasePort.
 *
 * When the binary is not available (pre-PR#18 / CI without codebase-rust built),
 * createCodebaseAdapter throws with a descriptive message. Callers that need to
 * degrade gracefully should catch and return a stub; they own that decision.
 *
 * source: docs/PHASE_3_PLAN.md §3.3 — factory in composition root
 * source: docs/ADR/0001 — dispose() PGID semantics
 *
 * Layer: composition root (handlers-equivalent within this package)
 * Allowed imports: all of the above
 */

export type { CodebasePort } from "@agentic/core";
export {
  // Schemas (for downstream validators)
  HealthCheckInputSchema,
  IndexCodebaseInputSchema,
  QueryGraphInputSchema,
  GetSymbolInputSchema,
  ResolveGraphInputSchema,
  ClusterGraphInputSchema,
  GetProcessesInputSchema,
  GetImpactInputSchema,
  SearchCodebaseInputSchema,
  GetContextInputSchema,
  AnalyzeCodebaseInputSchema,
  LspResolveInputSchema,
  // Output schemas
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
  // Errors
  CodebaseValidationError,
  CodebaseTimeoutError,
  CodebaseSubprocessError,
  CodebaseLspError,
} from "@agentic/core";

import { ProcessSupervisor } from "./internal/process-supervisor.js";
import { JsonRpcClient } from "./internal/json-rpc-client.js";
import { RustPipelineAdapter } from "./adapters/rust-pipeline-adapter.js";
import { requireBinaryPath } from "./adapters/rust-binary-resolver.js";
import type { CodebasePort } from "@agentic/core";

export { resolveBinaryPath } from "./adapters/rust-binary-resolver.js";

/**
 * Configuration for createCodebaseAdapter.
 *
 * source: docs/PHASE_3_PLAN.md §6.2 — "createCodebaseAdapter({ binaryPath })"
 */
export interface CodebaseAdapterConfig {
  /**
   * Absolute path to the ai-architect-mcp binary.
   * Defaults to auto-resolution via AI_ARCH_BIN env-var or workspace package.
   */
  readonly binaryPath?: string;

  /**
   * Additional CLI arguments to pass to the binary.
   * Normally empty; exposed for testing.
   */
  readonly args?: readonly string[];
}

/**
 * Create and initialise a CodebasePort backed by the Rust subprocess.
 *
 * precondition: binaryPath (or auto-resolved path) points to an executable file
 * postcondition: the returned adapter's subprocess is alive and ready to accept
 *   JSON-RPC calls; healthCheck() will succeed immediately
 *
 * @throws Error if the binary cannot be found (see resolveBinaryPath docs)
 * @throws CodebaseTimeoutError if the subprocess does not respond within 10 s
 */
export async function createCodebaseAdapter(
  config: CodebaseAdapterConfig = {},
): Promise<CodebasePort> {
  const binaryPath = config.binaryPath ?? requireBinaryPath();

  const supervisor = new ProcessSupervisor(binaryPath, config.args ?? []);
  await supervisor.spawn();

  const client = new JsonRpcClient(supervisor);
  return new RustPipelineAdapter(supervisor, client);
}
