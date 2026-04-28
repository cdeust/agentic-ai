/**
 * @agentic/core — ports/codebase-errors.ts
 *
 * Typed error classes for the CodebasePort.
 * Separated from codebase.ts to keep file size ≤ 500 LOC (§4.1).
 *
 * source: docs/ADR/0003-adapter-precondition-strength.md
 * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md — four LSP error codes
 * source: docs/PHASE_3_PLAN.md §4.2 — per-method timeout
 *
 * Layer: core / domain — no I/O, no infrastructure imports
 */

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
