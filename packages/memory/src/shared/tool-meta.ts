/**
 * Shared tool-metadata helpers for MCP registration.
 *
 * Port of: mcp_server/handlers/_tool_meta.py
 *
 * Glama tool score fields:
 *   1. title — human-readable name shown in tool lists.
 *   2. outputSchema — declared return-shape JSON Schema.
 *   3. annotations — readOnlyHint / destructiveHint /
 *      idempotentHint / openWorldHint (spec: MCP 2024-11-05+).
 *
 * source: cortex@ed33435 mcp_server/handlers/_tool_meta.py
 */

// ── Annotation presets ────────────────────────────────────────────────────

/** Pure read. Safe to call repeatedly. No state change. */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Reads and produces new state, but running twice equals running once
 *  (e.g. storing a memory that dedups / merges). */
export const IDEMPOTENT_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Writes new state on every call; subsequent calls produce new rows. */
export const NON_IDEMPOTENT_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Mutates or removes existing state in a way that can't be undone
 *  without data loss. */
export const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Read-only but reaches to external state (browser, subprocess,
 *  filesystem outside our DB). */
export const READ_ONLY_EXTERNAL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolSchema {
  title?: string;
  description?: string;
  outputSchema?: Record<string, unknown>;
  /** Support both camelCase (Python source) and snake_case. */
  output_schema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  tags?: string[];
  inputSchema?: Record<string, unknown>;
}

// ── Helper ────────────────────────────────────────────────────────────────

/**
 * Extract mcp.tool(**kwargs) from a handler schema dict.
 *
 * Returns the keys FastMCP accepts: description, title,
 * output_schema, annotations, tags. Unknown keys are ignored.
 *
 * precondition: schema is a ToolSchema object.
 * postcondition: returned object contains only keys FastMCP accepts;
 *   outputSchema/output_schema are normalised to output_schema.
 *
 * Port of: mcp_server/handlers/_tool_meta.py::tool_kwargs
 * source: cortex@ed33435 mcp_server/handlers/_tool_meta.py:71
 */
export function toolKwargs(schema: ToolSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.description !== undefined) out["description"] = schema.description;
  if (schema.title !== undefined) out["title"] = schema.title;
  // Support both output_schema (snake) and outputSchema (camel).
  if (schema.output_schema !== undefined) {
    out["output_schema"] = schema.output_schema;
  } else if (schema.outputSchema !== undefined) {
    out["output_schema"] = schema.outputSchema;
  }
  if (schema.annotations !== undefined) out["annotations"] = schema.annotations;
  if (schema.tags !== undefined) out["tags"] = schema.tags;
  return out;
}
