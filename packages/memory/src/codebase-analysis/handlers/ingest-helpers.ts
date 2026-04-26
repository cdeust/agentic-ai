/**
 * Shared helpers for ingest-codebase and ingest-prd handlers.
 *
 * Ported from mcp_server/handlers/ingest_helpers.py
 *
 * Two concerns:
 *
 * 1. Graph-path memoisation — after a codebase analysis, the returned
 *    graph_path is stored as a protected Cortex memory tagged
 *    `_code_graph:<project-id>` so subsequent ingest runs can reuse
 *    the same graph without re-indexing.
 *
 * 2. Safe MCP calls — wraps mcp client calls with a uniform error shape
 *    so ingest handlers don't each re-derive the try/catch boilerplate.
 */

import { createHash } from "node:crypto";
import { resolve, basename } from "node:path";

export const CODE_GRAPH_TAG_PREFIX = "_code_graph:";

// ── Project identification ─────────────────────────────────────────────────

export function projectKey(projectPath: string): string {
  /**
   * Stable project key = last path segment + short hash of full path.
   */
  const p = resolve(projectPath);
  const digest = createHash("sha256").update(p, "utf8").digest("hex").slice(0, 8);
  return `${basename(p)}-${digest}`;
}

export function codeGraphTag(projectPath: string): string {
  /**
   * Canonical tag used to memoise a code graph path for a project.
   */
  return `${CODE_GRAPH_TAG_PREFIX}${projectKey(projectPath)}`;
}

// ── Graph path cache ──────────────────────────────────────────────────────

export function findCachedGraph(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  projectPath: string,
): string | null {
  /**
   * Return the cached graph_path for a project, or null if not cached.
   */
  const tag = codeGraphTag(projectPath);
  let mems: Record<string, unknown>[];
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mems = store.getAllMemoriesForDecay() as Record<string, unknown>[];
  } catch {
    return null;
  }
  for (const mem of mems) {
    let rawTags = mem["tags"] ?? [];
    if (typeof rawTags === "string") {
      try {
        rawTags = JSON.parse(rawTags) as unknown[];
      } catch {
        rawTags = [];
      }
    }
    if (!Array.isArray(rawTags) || !rawTags.includes(tag)) continue;
    const content = (mem["content"] as string) ?? "";
    if (content.startsWith("graph_path=")) {
      return content.slice("graph_path=".length).trim();
    }
  }
  return null;
}

export function memoiseGraphPath(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: any,
  projectPath: string,
  graphPath: string,
): number | null {
  /**
   * Persist the graph path as a protected memory for future lookups.
   */
  const tag = codeGraphTag(projectPath);
  const record = {
    content: `graph_path=${graphPath}`,
    tags: [tag, "_ingest", "code-graph"],
    source: "ingest_codebase",
    domain: "cortex-ingest",
    directory_context: resolve(projectPath),
    is_protected: true,
    importance: 1.0,
    heat: 1.0,
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return store.insertMemory(record) as number;
  } catch {
    return null;
  }
}

// ── MCP call helpers ──────────────────────────────────────────────────────

export async function callUpstream(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  /**
   * Invoke a tool on an upstream MCP server; return parsed result.
   *
   * Raises McpConnectionError on connection/transport failure. Returns
   * the tool result as a plain dict when the server answers successfully.
   *
   * NOTE: The MCP client pool is not yet ported to TS. This stub throws
   * McpConnectionError. Replace with real pool when port/cortex-shared
   * lands the infrastructure layer.
   *
   * port-pending: mcp_client_pool
   */
  throw new McpConnectionError(
    `callUpstream(${serverName}, ${toolName}) — MCP client pool not yet ported. ` +
      `port-pending: port/cortex-shared must land first.`,
  );
  // Unreachable; satisfies return type.
  return {};
}

export function normaliseMcpPayload(payload: unknown): unknown {
  /**
   * MCP call() sometimes returns a dict with a 'content' array.
   *
   * The pipeline's tools emit {"content": [{"type": "text", "text": "{...}"}]};
   * callers want the inner JSON. Other servers answer with a plain dict.
   * This helper collapses both shapes to the underlying object.
   */
  if (typeof payload !== "object" || payload === null) return payload;
  const p = payload as Record<string, unknown>;
  if (!("content" in p)) return payload;
  const content = p["content"];
  if (!Array.isArray(content) || content.length === 0) return payload;
  const first = content[0] as Record<string, unknown>;
  if (first["type"] !== "text") return payload;
  const text = (first["text"] as string) ?? "";
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

// ── Error types ───────────────────────────────────────────────────────────

export class McpConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConnectionError";
  }
}
