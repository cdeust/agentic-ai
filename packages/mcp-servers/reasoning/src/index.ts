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
 *   MEMORY_AGENT_ID   — audit attribution; defaults to "unknown" if absent.
 *   MEMORY_BACKEND_CMD — override path to memory-tool.sh (for test isolation).
 *   MEMORY_ROOT       — forwarded if set (test isolation).
 *   MEMORY_NO_AUDIT   — forwarded if set.
 *   MEMORY_NO_ACL     — forwarded if set.
 *   MEMORY_NO_SYNC    — forwarded if set.
 * source: zetetic@HEAD tools/memory-mcp-server.py:17-22 (Env consumed)
 *
 * Logging: ONLY to stderr. Never to stdout (corrupts JSON-RPC framing).
 * source: modelcontextprotocol.io/quickstart/server §"Logging in MCP Servers"
 *
 * source: @modelcontextprotocol/sdk v1.29.0 — McpServer + StdioServerTransport
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerMemoryTool } from "./tools/memory.js";
import { registerMemoryExtensionsTool } from "./tools/memory-extensions.js";

// ── Server identity ───────────────────────────────────────────────────────────
// source: zetetic@HEAD tools/memory-mcp-server.py:41-44 (SERVER_INFO)
// source: zetetic@HEAD tools/memory-mcp-server.py:46 (PROTOCOL_VERSION)

const server = new McpServer({
  name: "memory-mcp-server",   // source: zetetic@HEAD tools/memory-mcp-server.py:42
  version: "1.0.0",            // source: zetetic@HEAD tools/memory-mcp-server.py:43
});

// ── Tool registration ─────────────────────────────────────────────────────────
// source: zetetic@HEAD tools/memory-mcp-server.py:369-372 (handle_tools_list — 2 tools)

registerMemoryTool(server);           // registers "memory"
registerMemoryExtensionsTool(server); // registers "memory_extensions"

// ── Transport ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[mcp-server-reasoning] running on stdio — tools: memory, memory_extensions\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`[mcp-server-reasoning] fatal: ${String(err)}\n`);
  process.exit(1);
});
