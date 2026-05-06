/**
 * tools/memory-extensions.ts — Registers the `memory_extensions` tool on an McpServer.
 *
 * Tool: memory_extensions
 * Rationale: agents benefit from search, scopes, preamble, and sync ops
 * without dropping back to Bash. These are NOT part of the Anthropic
 * memory_20250818 schema, so they live in a separate tool to avoid schema
 * pollution while still raising the abstraction barrier for the full backend.
 * source: zetetic@HEAD tools/memory-mcp-server.py:130-194 (MEMORY_EXTENSIONS_TOOL)
 *
 * Layer: handlers — registers against the McpServer composition root.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runBackend, mapExtensionsArgs } from "../backend.js";

// ── Input schema (Zod) ────────────────────────────────────────────────────────
// source: zetetic@HEAD tools/memory-mcp-server.py:145-193 (MEMORY_EXTENSIONS_TOOL.inputSchema)

const MemoryExtensionsInputSchema = z.object({
  command: z
    .enum([
      "search",
      "scopes",
      "preamble",
      "sync-status",
      "drain-sync",
      "commit-sync",
      "release-sync",
      "ttl-sweep",
      "audit",
    ])
    .describe("The extension operation to perform."),
  query: z.string().optional().describe(
    "Search query string. Required for command=search.",
  ),
  scope: z.string().optional().describe(
    "Scope name filter for search (optional).",
  ),
  limit: z.number().int().optional().describe(
    "Max results (search) or max jobs (drain-sync).",
  ),
  regex: z.boolean().optional().describe(
    "Use extended regex for search (default: fixed-string).",
  ),
  job_id: z.string().optional().describe(
    "Job ID. Required for commit-sync and release-sync.",
  ),
  dry_run: z.boolean().optional().describe(
    "Dry-run mode for ttl-sweep.",
  ),
  since: z.string().optional().describe(
    "ISO-8601 timestamp for audit --since filter.", // source: zetetic@HEAD tools/memory-mcp-server.py:189 (ISO-8601 = RFC 3339 datetime format name)
  ),
});

// ── Tool registration ─────────────────────────────────────────────────────────

/**
 * Register the `memory_extensions` tool on the given McpServer.
 *
 * Precondition:  server is a live McpServer instance (not yet connected).
 * Postcondition: server has one additional tool named "memory_extensions" that
 *                delegates all calls to the memory-tool.sh backend subprocess.
 */
export function registerMemoryExtensionsTool(server: McpServer): void {
  server.tool(
    "memory_extensions",
    // source: zetetic@HEAD tools/memory-mcp-server.py:139-144 (description)
    "Extended memory backend operations not in the memory_20250818 schema. " +
    "Commands: search, scopes, preamble, sync-status, drain-sync, " +
    "commit-sync, release-sync, ttl-sweep, audit.",
    MemoryExtensionsInputSchema.shape,
    async (params) => {
      const input = params as unknown as Record<string, unknown>;
      const args = mapExtensionsArgs(input);

      if (args === null) {
        // Unknown command — source: zetetic@HEAD tools/memory-mcp-server.py:391-393
        const unknownCmd = input["command"] as string | undefined;
        return {
          content: [{ type: "text" as const, text: `Error: unknown extension command '${unknownCmd ?? ""}'` }],
          isError: true,
        };
      }

      const [text, isError] = runBackend(args);
      // source: zetetic@HEAD tools/memory-mcp-server.py:350-357 (_tool_result)
      return {
        content: [{ type: "text" as const, text }],
        ...(isError ? { isError: true } : {}),
      };
    },
  );
}
