/**
 * tools/memory.ts — Schema definition and handler for the `memory` tool.
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
 * Design note: this module exports a raw JSON schema object (not a Zod schema)
 * so that the MCP tools/list response is byte-equivalent to the Python source.
 * The McpServer high-level API passes Zod schemas through zodToJsonSchema()
 * which injects `$schema` and `additionalProperties: false` — fields that the
 * Python server's hand-crafted dict does not contain.  Using the low-level
 * Server API with the raw schema preserves exact field parity.
 *
 * Layer: handlers — consumed by the composition root (index.ts).
 */

import { runBackend, mapMemoryArgs } from "../backend.js";

// ── Raw JSON schema (verbatim from Python source) ─────────────────────────────
// source: zetetic@HEAD tools/memory-mcp-server.py:60-128 (MEMORY_TOOL.inputSchema)
//
// Do NOT add `$schema`, `additionalProperties`, or any field not present in the
// Python source.  The Python server serialises this dict directly via
// json.dumps() — the output is the ground truth.

export const MEMORY_TOOL_SCHEMA = {
  name: "memory",
  // source: zetetic@HEAD tools/memory-mcp-server.py:55-59 (description)
  description:
    "Manages a persistent memory store across sessions. " +
    "All paths must be under /memories. " +
    "Commands: view, create, str_replace, insert, delete, rename.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        // source: zetetic@HEAD tools/memory-mcp-server.py:65
        enum: ["view", "create", "str_replace", "insert", "delete", "rename"],
        description: "The operation to perform.",
      },
      path: {
        type: "string",
        description:
          "Absolute path starting with /memories. " +
          "Required for: view, create, str_replace, insert, delete.",
      },
      view_range: {
        type: "array",
        items: { type: "integer" },
        // source: zetetic@HEAD tools/memory-mcp-server.py:79-80
        minItems: 2,
        maxItems: 2,
        description:
          "Optional [start_line, end_line] (1-indexed, inclusive). " +
          "Only valid with command=view on a file.",
      },
      file_text: {
        type: "string",
        description: "Content to write. Required for command=create.",
      },
      old_str: {
        type: "string",
        description:
          "Exact string to find (must appear exactly once). " +
          "Required for command=str_replace.",
      },
      new_str: {
        type: "string",
        description: "Replacement string. Required for command=str_replace.",
      },
      insert_line: {
        type: "integer",
        description:
          "0-indexed line number before which to insert. " +
          "0 = before first line. Required for command=insert.",
      },
      insert_text: {
        type: "string",
        description: "Text to insert. Required for command=insert.",
      },
      old_path: {
        type: "string",
        description: "Source path (must exist). Required for command=rename.",
      },
      new_path: {
        type: "string",
        description:
          "Destination path (must not exist). Required for command=rename.",
      },
    },
    // source: zetetic@HEAD tools/memory-mcp-server.py:126
    required: ["command"],
  },
} as const;

// ── Tool call handler ─────────────────────────────────────────────────────────

/**
 * Handle a tools/call request for the memory tool.
 *
 * Precondition:  toolInput is the `arguments` field from the JSON-RPC request.
 * Postcondition: returns a _tool_result dict compatible with the Python source.
 *
 * source: zetetic@HEAD tools/memory-mcp-server.py:379-386 (handle_tools_call memory branch)
 */
export function handleMemoryCall(
  toolInput: Record<string, unknown>,
): { content: Array<{ type: "text"; text: string }>; isError?: true } {
  const args = mapMemoryArgs(toolInput);

  if (args === null) {
    // source: zetetic@HEAD tools/memory-mcp-server.py:382-384
    const unknownCmd = toolInput["command"] as string | undefined;
    return {
      content: [{ type: "text", text: `Error: unknown command '${unknownCmd ?? ""}'` }],
      isError: true,
    };
  }

  const [text, isError] = runBackend(args);
  // source: zetetic@HEAD tools/memory-mcp-server.py:350-357 (_tool_result)
  return isError
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}
