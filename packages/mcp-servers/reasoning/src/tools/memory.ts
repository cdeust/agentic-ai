/**
 * tools/memory.ts — Registers the `memory` tool on an McpServer.
 *
 * Tool: memory
 * Schema: verbatim from the Anthropic memory_20250818 spec.
 * source: zetetic@HEAD tools/memory-mcp-server.py:53-128 (MEMORY_TOOL)
 * source: platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
 *
 * IMPORTANT: parameter names, types, and descriptions are taken from the
 * Anthropic spec and MUST NOT be altered — the model is trained on these
 * exact strings.
 * source: zetetic@HEAD tools/memory-mcp-server.py:48-51 (note above MEMORY_TOOL)
 *
 * Layer: handlers — registers against the McpServer composition root.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runBackend, mapMemoryArgs } from "../backend.js";

// ── Input schema (Zod) ────────────────────────────────────────────────────────
// source: zetetic@HEAD tools/memory-mcp-server.py:61-127 (MEMORY_TOOL.inputSchema)

const MemoryInputSchema = z.object({
  command: z.enum(["view", "create", "str_replace", "insert", "delete", "rename"]).describe(
    "The operation to perform.",
  ),
  path: z.string().optional().describe(
    "Absolute path starting with /memories. " +
    "Required for: view, create, str_replace, insert, delete.",
  ),
  view_range: z
    .array(z.number().int())
    .min(2) // source: zetetic@HEAD tools/memory-mcp-server.py:79 (minItems: 2)
    .max(2) // source: zetetic@HEAD tools/memory-mcp-server.py:80 (maxItems: 2)
    .optional()
    .describe(
      "Optional [start_line, end_line] (1-indexed, inclusive). " +
      "Only valid with command=view on a file.",
    ),
  file_text: z.string().optional().describe(
    "Content to write. Required for command=create.",
  ),
  old_str: z.string().optional().describe(
    "Exact string to find (must appear exactly once). " +
    "Required for command=str_replace.",
  ),
  new_str: z.string().optional().describe(
    "Replacement string. Required for command=str_replace.",
  ),
  insert_line: z.number().int().optional().describe(
    "0-indexed line number before which to insert. " +
    "0 = before first line. Required for command=insert.",
  ),
  insert_text: z.string().optional().describe(
    "Text to insert. Required for command=insert.",
  ),
  old_path: z.string().optional().describe(
    "Source path (must exist). Required for command=rename.",
  ),
  new_path: z.string().optional().describe(
    "Destination path (must not exist). Required for command=rename.",
  ),
});

// ── Tool registration ─────────────────────────────────────────────────────────

/**
 * Register the `memory` tool on the given McpServer.
 *
 * Precondition:  server is a live McpServer instance (not yet connected).
 * Postcondition: server has one additional tool named "memory" that delegates
 *                all calls to the memory-tool.sh backend subprocess.
 */
export function registerMemoryTool(server: McpServer): void {
  server.tool(
    "memory",
    // source: zetetic@HEAD tools/memory-mcp-server.py:55-59 (description)
    "Manages a persistent memory store across sessions. " +
    "All paths must be under /memories. " +
    "Commands: view, create, str_replace, insert, delete, rename.",
    MemoryInputSchema.shape,
    async (params) => {
      // params is typed by Zod; cast to loose dict for mapMemoryArgs.
      const input = params as unknown as Record<string, unknown>;
      const args = mapMemoryArgs(input);

      if (args === null) {
        // Unknown command — source: zetetic@HEAD tools/memory-mcp-server.py:382-384
        const unknownCmd = input["command"] as string | undefined;
        return {
          content: [{ type: "text" as const, text: `Error: unknown command '${unknownCmd ?? ""}'` }],
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
