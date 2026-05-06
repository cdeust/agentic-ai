#!/usr/bin/env node
/**
 * @agentic/mcp-server-reasoning — Composition root.
 *
 * TypeScript port of: zetetic@HEAD tools/memory-mcp-server.py
 *
 * Exposes two MCP tools over stdio (JSON-RPC 2.0):
 *   - memory           (memory_20250818 contract, Anthropic spec)
 *   - memory_extensions (extended backend ops: search, scopes, preamble, sync)
 *
 * Both tools delegate to memory-tool.sh via subprocess.
 * source: zetetic@HEAD tools/memory-mcp-server.py:1-441
 *
 * Transport: stdio (StdioServerTransport — newline-delimited JSON-RPC 2.0).
 * source: zetetic@HEAD tools/memory-mcp-server.py:12-14 (transport note)
 *
 * Env consumed (forwarded verbatim to backend):
 *   MEMORY_AGENT_ID    — audit attribution; defaults to "unknown" if absent.
 *   MEMORY_BACKEND_CMD — non-empty override path to memory-tool.sh (test isolation).
 *   MEMORY_ROOT        — forwarded if set (test isolation).
 *   MEMORY_NO_AUDIT    — forwarded if set.
 *   MEMORY_NO_ACL      — forwarded if set.
 *   MEMORY_NO_SYNC     — forwarded if set.
 * source: zetetic@HEAD tools/memory-mcp-server.py:17-22 (Env consumed)
 *
 * Logging: ONLY to stderr. Never to stdout (corrupts JSON-RPC framing).
 * source: modelcontextprotocol.io/quickstart/server §"Logging in MCP Servers"
 *
 * Design note — low-level Server API:
 *   The McpServer high-level API automatically calls registerCapabilities()
 *   with `{ tools: { listChanged: true } }` and serialises Zod schemas through
 *   zodToJsonSchema(), which adds `$schema` and `additionalProperties: false`.
 *   Neither field is present in the Python source's hand-crafted JSON dicts.
 *   Using the low-level Server with hand-crafted raw JSON schemas and explicit
 *   setRequestHandler() calls produces output byte-equivalent to Python.
 *   source: zetetic@HEAD tools/memory-mcp-server.py:361-397 (MCP method handlers)
 *
 * source: @modelcontextprotocol/sdk v1.29.0 — Server + StdioServerTransport
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  MEMORY_TOOL_SCHEMA,
  handleMemoryCall,
} from "./tools/memory.js";
import {
  MEMORY_EXTENSIONS_TOOL_SCHEMA,
  handleMemoryExtensionsCall,
} from "./tools/memory-extensions.js";

// ── Server identity ───────────────────────────────────────────────────────────
// source: zetetic@HEAD tools/memory-mcp-server.py:41-44 (SERVER_INFO)
// source: zetetic@HEAD tools/memory-mcp-server.py:46  (PROTOCOL_VERSION)
//
// capabilities: { tools: {} } — verbatim from Python:
//   handle_initialize returns {"capabilities": {"tools": {}}}
//   source: zetetic@HEAD tools/memory-mcp-server.py:364-366
//
// NOTE: Do NOT pass capabilities: { tools: { listChanged: true } }.
// McpServer injects listChanged automatically; low-level Server does not.

const server = new Server(
  {
    name: "memory-mcp-server",   // source: zetetic@HEAD tools/memory-mcp-server.py:42
    version: "1.0.0",            // source: zetetic@HEAD tools/memory-mcp-server.py:43
  },
  {
    capabilities: {
      // source: zetetic@HEAD tools/memory-mcp-server.py:365 — "capabilities": {"tools": {}}
      tools: {},
    },
  },
);

// ── tools/list handler ────────────────────────────────────────────────────────
// source: zetetic@HEAD tools/memory-mcp-server.py:369-372 (handle_tools_list)
//
// Returns the two tool schemas verbatim — same fields, same order, no extras.
// The Python source serialises MEMORY_TOOL and MEMORY_EXTENSIONS_TOOL dicts
// directly; we mirror the same structure.

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [MEMORY_TOOL_SCHEMA, MEMORY_EXTENSIONS_TOOL_SCHEMA],
}));

// ── tools/call handler ────────────────────────────────────────────────────────
// source: zetetic@HEAD tools/memory-mcp-server.py:375-397 (handle_tools_call)

server.setRequestHandler(CallToolRequestSchema, (request) => {
  const toolName = request.params.name;
  // source: zetetic@HEAD tools/memory-mcp-server.py:377
  // Python: tool_input = params.get("arguments") or params.get("input") or {}
  const toolInput =
    (request.params.arguments as Record<string, unknown> | undefined) ?? {};

  if (toolName === "memory") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:379-386
    return handleMemoryCall(toolInput);
  }

  if (toolName === "memory_extensions") {
    // source: zetetic@HEAD tools/memory-mcp-server.py:388-395
    return handleMemoryExtensionsCall(toolInput);
  }

  // source: zetetic@HEAD tools/memory-mcp-server.py:397
  // Python: return _error(req_id, -32601, f"Tool not found: {tool_name}")
  // The low-level Server wraps thrown McpErrors as JSON-RPC errors automatically.
  throw new Error(`Tool not found: ${toolName}`);
});

// ── Transport ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    "[mcp-server-reasoning] running on stdio — tools: memory, memory_extensions\n",
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`[mcp-server-reasoning] fatal: ${String(err)}\n`);
  process.exit(1);
});
