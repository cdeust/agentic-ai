/**
 * Typed error hierarchy for the methodology-agent system.
 *
 * Typed errors enable the router to distinguish user errors (validation)
 * from system errors (storage) and return appropriate MCP error codes.
 *
 * Port of: mcp_server/errors/__init__.py
 */

export class MethodologyError extends Error {
  readonly code: number;
  readonly details: Readonly<Record<string, unknown>> | null;

  constructor(
    message: string,
    code = -32000,
    details: Readonly<Record<string, unknown>> | null = null,
  ) {
    super(message);
    this.name = "MethodologyError";
    this.code = code;
    this.details = details;
  }
}

/** Invalid input (user-correctable). MCP error code -32602. */
export class ValidationError extends MethodologyError {
  constructor(
    message: string,
    details: Readonly<Record<string, unknown>> | null = null,
  ) {
    super(message, -32602, details);
    this.name = "ValidationError";
  }
}

/** Filesystem/persistence failures. MCP error code -32001. */
export class StorageError extends MethodologyError {
  constructor(
    message: string,
    details: Readonly<Record<string, unknown>> | null = null,
  ) {
    super(message, -32001, details);
    this.name = "StorageError";
  }
}

/** Core algorithm failures. MCP error code -32002. */
export class AnalysisError extends MethodologyError {
  constructor(
    message: string,
    details: Readonly<Record<string, unknown>> | null = null,
  ) {
    super(message, -32002, details);
    this.name = "AnalysisError";
  }
}

/** MCP client connection failures. MCP error code -32003. */
export class McpConnectionError extends MethodologyError {
  constructor(
    message: string,
    details: Readonly<Record<string, unknown>> | null = null,
  ) {
    super(message, -32003, details);
    this.name = "McpConnectionError";
  }
}
