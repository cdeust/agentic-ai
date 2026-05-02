#!/usr/bin/env node
/**
 * @agentic/mcp-server-memory — Composition root.
 *
 * PATTERN: MCP Composition Root (see docs/PATTERNS.md)
 *
 * This file is the single boundary between the @agentic/memory domain layer
 * and the stdio MCP transport. It:
 *   1. Instantiates an McpServer with identity metadata.
 *   2. Constructs infrastructure adapters (AnthropicLlmClient when
 *      ANTHROPIC_API_KEY is set; null otherwise — graceful degradation).
 *   3. Delegates tool registration to one file per topic in src/tools/.
 *   4. Connects the server to StdioServerTransport.
 *   5. Keeps this file under 50 lines of logic — all substance is in tools/.
 *
 * All 46 tools from MCP_TOOLS.md are registered by the register* functions.
 *
 * LLM client (Phase 7 Group C):
 *   Set ANTHROPIC_API_KEY in the environment to enable prose-polish on the
 *   narrative handler and wiki refinement.  When the variable is absent the
 *   handlers degrade gracefully (structural output, no LLM rewrite).
 *
 * Logging: ONLY to stderr. Never to stdout. Writing to stdout corrupts the
 * JSON-RPC framing on the stdio transport.
 * source: modelcontextprotocol.io/quickstart/server §"Logging in MCP Servers"
 *
 * source: @modelcontextprotocol/sdk v1.29.0 API — McpServer + StdioServerTransport
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { LlmClient } from "@agentic/core";
import { AnthropicLlmClient } from "@agentic/memory/infrastructure/anthropic-llm-client.js";

import { registerRecallTools } from "./tools/recall.js";
import { registerRememberTools } from "./tools/remember.js";
import { registerMethodologyTools } from "./tools/methodology.js";
import { registerConsolidationTools } from "./tools/consolidation.js";
import { registerManagementTools } from "./tools/management.js";
import { registerNarrativeTools } from "./tools/narrative.js";
import { registerAdvancedTools } from "./tools/advanced.js";
import { registerWikiTools } from "./tools/wiki.js";
import { registerIngestTools } from "./tools/ingest.js";
import { registerNavigationTools } from "./tools/navigation.js";

// ── Server identity ───────────────────────────────────────────────────────────

const server = new McpServer({
  name: "@agentic/mcp-server-memory",
  version: "0.1.0",
});

// ── LLM client (Phase 7 Group C) ─────────────────────────────────────────────
// Construct when ANTHROPIC_API_KEY is present; null = graceful degradation.
// source: docs/PHASE_7_TRACKING.md §Group C — LLM client wiring
// source: https://docs.anthropic.com/en/api/getting-started — auth via env var

const llmClient: LlmClient | null = process.env["ANTHROPIC_API_KEY"]
  ? new AnthropicLlmClient()
  : null;

if (llmClient !== null) {
  process.stderr.write("[mcp-server-memory] ANTHROPIC_API_KEY present — LLM client active\n");
} else {
  process.stderr.write("[mcp-server-memory] ANTHROPIC_API_KEY absent — LLM client disabled (graceful degradation)\n");
}

// ── Tool registration — one call per topic file ───────────────────────────────
// Order follows the generative sequence: core read/write → methodology →
// consolidation → management → narrative → advanced → wiki → ingest → nav.
// source: docs/PHASE_PLAN.md §"Phase 4 merge order"

registerRecallTools(server);        // 4 tools
registerRememberTools(server);      // 4 tools
registerMethodologyTools(server);   // 5 tools
registerConsolidationTools(server); // 4 tools
registerManagementTools(server);    // 5 tools
registerNarrativeTools(server, llmClient); // 3 tools — LLM client injected (Phase 7 Group C)
registerAdvancedTools(server);      // 6 tools
registerWikiTools(server);          // 8 tools
registerIngestTools(server);        // 5 tools
registerNavigationTools(server);    // 2 tools
// Total: 46 tools (matches MCP_TOOLS.md §"Tool Count Verification")

// ── Transport ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is the only safe output channel on a stdio MCP server
  process.stderr.write("[mcp-server-memory] running on stdio, 46 tools registered\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`[mcp-server-memory] fatal: ${String(err)}\n`);
  process.exit(1);
});
