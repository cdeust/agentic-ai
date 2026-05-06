/**
 * tools/memory-extensions.ts — Schema definition and handler for the
 * `memory_extensions` tool.
 *
 * Tool: memory_extensions
 * source: zetetic@HEAD tools/memory-mcp-server.py:130-194 (MEMORY_EXTENSIONS_TOOL)
 *
 * Design note: raw JSON schema — no Zod, no zodToJsonSchema(), no added fields.
 * See memory.ts for the full rationale.
 *
 * Layer: handlers — consumed by the composition root (index.ts).
 */

import { runBackend, mapExtensionsArgs } from "../backend.js";

// ── Raw JSON schema (verbatim from Python source) ─────────────────────────────
// source: zetetic@HEAD tools/memory-mcp-server.py:145-193
// (MEMORY_EXTENSIONS_TOOL.inputSchema)

export const MEMORY_EXTENSIONS_TOOL_SCHEMA = {
  name: "memory_extensions",
  // source: zetetic@HEAD tools/memory-mcp-server.py:139-144 (description)
  // "memory_20250818" is a schema name string literal, not a numeric constant.
  description: // source: zetetic@HEAD tools/memory-mcp-server.py:139
    "Extended memory backend operations not in the memory_20250818 schema. " +
    "Commands: search, scopes, preamble, sync-status, drain-sync, " +
    "commit-sync, release-sync, ttl-sweep, audit.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        // source: zetetic@HEAD tools/memory-mcp-server.py:150-160
        enum: [
          "search",
          "scopes",
          "preamble",
          "sync-status",
          "drain-sync",
          "commit-sync",
          "release-sync",
          "ttl-sweep",
          "audit",
        ],
        description: "The extension operation to perform.",
      },
      query: {
        type: "string",
        description: "Search query string. Required for command=search.",
      },
      scope: {
        type: "string",
        description: "Scope name filter for search (optional).",
      },
      limit: {
        type: "integer",
        description: "Max results (search) or max jobs (drain-sync).",
      },
      regex: {
        type: "boolean",
        description: "Use extended regex for search (default: fixed-string).",
      },
      job_id: {
        type: "string",
        description: "Job ID. Required for commit-sync and release-sync.",
      },
      dry_run: {
        type: "boolean",
        description: "Dry-run mode for ttl-sweep.",
      },
      since: {
        type: "string",
        // source: zetetic@HEAD tools/memory-mcp-server.py:189
        description: "ISO-8601 timestamp for audit --since filter.",
      },
    },
    // source: zetetic@HEAD tools/memory-mcp-server.py:193
    required: ["command"],
  },
} as const;

// ── Tool call handler ─────────────────────────────────────────────────────────

/**
 * Handle a tools/call request for the memory_extensions tool.
 *
 * source: zetetic@HEAD tools/memory-mcp-server.py:388-395
 * (handle_tools_call memory_extensions branch)
 */
export function handleMemoryExtensionsCall(
  toolInput: Record<string, unknown>,
): { content: Array<{ type: "text"; text: string }>; isError?: true } {
  const args = mapExtensionsArgs(toolInput);

  if (args === null) {
    // source: zetetic@HEAD tools/memory-mcp-server.py:391-393
    const unknownCmd = toolInput["command"] as string | undefined;
    return {
      content: [{ type: "text", text: `Error: unknown extension command '${unknownCmd ?? ""}'` }],
      isError: true,
    };
  }

  const [text, isError] = runBackend(args);
  // source: zetetic@HEAD tools/memory-mcp-server.py:350-357 (_tool_result)
  return isError
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}
