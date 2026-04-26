/**
 * Input validation schemas for MCP tool arguments.
 *
 * Lightweight schema validation: define expected types and required fields
 * per tool, validate before handler execution, throw ValidationError on
 * failure. Unknown tool names pass through (no schema = no validation).
 *
 * Port of: mcp_server/validation/schemas.py
 */

import { ValidationError } from "../errors.js";

interface PropertySpec {
  type: "string" | "number" | "boolean" | "array";
  default?: unknown;
  maxLength?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  items?: {
    type: "string" | "number" | "boolean";
    maxLength?: number;
  };
}

interface ToolSchema {
  properties: Record<string, PropertySpec>;
  required: string[];
}

// Schema definitions per tool.
// source: ADR-0045 R2/R5 (fragility sweep v3.13.0) — bounded envelopes.
const SCHEMAS: Readonly<Record<string, ToolSchema>> = {
  query_methodology: {
    properties: {
      cwd: { type: "string" },
      project: { type: "string" },
      first_message: { type: "string" },
    },
    required: [],
  },
  detect_domain: {
    properties: {
      cwd: { type: "string" },
      project: { type: "string" },
      first_message: { type: "string" },
    },
    required: [],
  },
  rebuild_profiles: {
    properties: {
      domain: { type: "string" },
      force: { type: "boolean", default: false },
    },
    required: [],
  },
  list_domains: {
    properties: {},
    required: [],
  },
  record_session_end: {
    properties: {
      session_id: { type: "string" },
      domain: { type: "string" },
      tools_used: { type: "array" },
      duration: { type: "number" },
      turn_count: { type: "number" },
      keywords: { type: "array" },
      cwd: { type: "string" },
      project: { type: "string" },
    },
    required: ["session_id"],
  },
  get_methodology_graph: {
    properties: { domain: { type: "string" } },
    required: [],
  },
  open_visualization: {
    properties: { domain: { type: "string" } },
    required: [],
  },
  explore_features: {
    properties: {
      mode: { type: "string" },
      domain: { type: "string" },
      compare_domain: { type: "string" },
    },
    required: ["mode"],
  },
  run_pipeline: {
    properties: {
      codebase_path: { type: "string" },
      task_path: { type: "string" },
      context_path: { type: "string" },
      github_repo: { type: "string" },
      server: { type: "string", default: "ai-architect" },
      max_findings: { type: "number", default: 5 },
    },
    required: ["codebase_path", "task_path"],
  },
  remember: {
    properties: {
      // source: ADR-0045 R2/R5 (fragility sweep v3.13.0 E3):
      // content maxLength tightened from 50_000 → 10_000 chars.
      content: { type: "string", maxLength: 10000 },
      // source: ADR-0045 R2 (fragility sweep v3.13.0 E4):
      // Bounded tags envelope — at most 20 tags, each <= 80 chars.
      tags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
      source: { type: "string", maxLength: 200 },
      domain: { type: "string", maxLength: 200 },
      directory: { type: "string", maxLength: 500 },
      agent_topic: { type: "string", maxLength: 200 },
      importance: { type: "number" },
      created_at: { type: "string", maxLength: 64 },
      initial_heat: { type: "number", minimum: 0.0, maximum: 1.0 },
    },
    required: ["content"],
  },
  recall: {
    properties: {
      query: { type: "string", maxLength: 10000 },
      limit: { type: "number" },
      domain: { type: "string", maxLength: 200 },
      directory: { type: "string", maxLength: 500 },
      agent_topic: { type: "string", maxLength: 200 },
    },
    required: ["query"],
  },
  wiki_write: {
    properties: {
      path: { type: "string", maxLength: 500 },
      content: { type: "string", maxLength: 200000 },
      mode: { type: "string" },
      title: { type: "string", maxLength: 500 },
      summary: { type: "string", maxLength: 5000 },
      body: { type: "string", maxLength: 200000 },
      tags: { type: "array" },
    },
    required: ["path"],
  },
  wiki_read: {
    properties: { path: { type: "string", maxLength: 500 } },
    required: ["path"],
  },
  wiki_list: {
    properties: { kind: { type: "string", maxLength: 20 } },
    required: [],
  },
  wiki_link: {
    properties: {
      from_path: { type: "string", maxLength: 500 },
      to_path: { type: "string", maxLength: 500 },
      relation: { type: "string", maxLength: 40 },
    },
    required: ["from_path", "to_path", "relation"],
  },
  wiki_adr: {
    properties: {
      title: { type: "string", maxLength: 500 },
      context: { type: "string", maxLength: 20000 },
      decision: { type: "string", maxLength: 20000 },
      consequences: { type: "string", maxLength: 20000 },
      status: { type: "string", maxLength: 40 },
      tags: { type: "array" },
    },
    required: ["title", "context", "decision", "consequences"],
  },
  wiki_reindex: {
    properties: {},
    required: [],
  },
  codebase_analyze: {
    properties: {
      directory: { type: "string" },
      languages: { type: "array" },
      max_files: { type: "number" },
      max_file_size_kb: { type: "number" },
      incremental: { type: "boolean" },
      dry_run: { type: "boolean" },
      domain: { type: "string" },
    },
    required: [],
  },
} as const;

function checkArrayEnvelope(
  toolName: string,
  field: string,
  value: unknown[],
  spec: PropertySpec,
): void {
  if (spec.maxItems !== undefined && value.length > spec.maxItems) {
    throw new ValidationError(
      `Field "${field}" exceeds maxItems (${value.length} > ${spec.maxItems})`,
      { tool: toolName, field, maxItems: spec.maxItems },
    );
  }
  const itemSpec = spec.items;
  if (!itemSpec) return;

  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (itemSpec.type === "string" && typeof item !== "string") {
      throw new ValidationError(
        `Field "${field}[${i}]" must be a string, got ${typeof item}`,
        { tool: toolName, field, index: i, expected: "string", got: typeof item },
      );
    }
    if (
      itemSpec.maxLength !== undefined &&
      typeof item === "string" &&
      item.length > itemSpec.maxLength
    ) {
      throw new ValidationError(
        `Field "${field}[${i}]" exceeds maximum length (${item.length} > ${itemSpec.maxLength})`,
        { tool: toolName, field, index: i, maxLength: itemSpec.maxLength },
      );
    }
  }
}

function checkFieldType(
  toolName: string,
  field: string,
  value: unknown,
  spec: PropertySpec,
): void {
  if (spec.type === "string" && typeof value !== "string") {
    throw new ValidationError(
      `Field "${field}" must be a string, got ${typeof value}`,
      { tool: toolName, field, expected: "string", got: typeof value },
    );
  }
  if (spec.type === "number") {
    if (typeof value === "boolean") {
      throw new ValidationError(
        `Field "${field}" must be a number, got bool`,
        { tool: toolName, field, expected: "number", got: "bool" },
      );
    }
    if (typeof value !== "number") {
      throw new ValidationError(
        `Field "${field}" must be a number, got ${typeof value}`,
        { tool: toolName, field, expected: "number", got: typeof value },
      );
    }
  }
  if (spec.type === "boolean" && typeof value !== "boolean") {
    throw new ValidationError(
      `Field "${field}" must be a boolean, got ${typeof value}`,
      { tool: toolName, field, expected: "boolean", got: typeof value },
    );
  }
  if (spec.type === "array" && !Array.isArray(value)) {
    throw new ValidationError(
      `Field "${field}" must be an array, got ${typeof value}`,
      { tool: toolName, field, expected: "array", got: typeof value },
    );
  }

  if (spec.maxLength !== undefined && typeof value === "string" && value.length > spec.maxLength) {
    throw new ValidationError(
      `Field "${field}" exceeds maximum length (${value.length} > ${spec.maxLength})`,
      { tool: toolName, field, maxLength: spec.maxLength },
    );
  }
  if (spec.type === "array" && Array.isArray(value)) {
    checkArrayEnvelope(toolName, field, value, spec);
  }
}

/**
 * Validate and sanitize tool arguments against the schema.
 *
 * Returns validated arguments with defaults applied.
 * Throws ValidationError for missing required fields or type mismatches.
 * Unknown tool names pass through unchanged.
 */
export function validateToolArgs(
  toolName: string,
  args: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const schema = SCHEMAS[toolName];
  if (!schema) return args ?? {};

  const safeArgs = args ?? {};
  const result: Record<string, unknown> = {};

  for (const field of schema.required) {
    if (safeArgs[field] == null) {
      throw new ValidationError(`Missing required field: ${field}`, {
        tool: toolName,
        field,
      });
    }
  }

  for (const [field, spec] of Object.entries(schema.properties)) {
    const value = safeArgs[field];
    if (value == null) {
      if ("default" in spec) result[field] = spec.default;
      continue;
    }
    checkFieldType(toolName, field, value, spec);
    result[field] = value;
  }

  return result;
}
