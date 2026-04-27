/**
 * @agentic/orchestrator — Skeleton.
 *
 * This module demonstrates how a Claude-Code host can compose all four MCP
 * servers via the Anthropic SDK. Real conversation logic is post-Phase-5.
 *
 * Architecture:
 *   Host (this file) → Anthropic SDK → Claude
 *                    ↳ MCP server: @agentic/mcp-server-memory   (46 tools)
 *                    ↳ MCP server: @agentic/mcp-server-codebase  (port-pending)
 *                    ↳ MCP server: @agentic/mcp-server-reasoning (port-pending)
 *                    ↳ MCP server: @agentic/mcp-server-prd       (port-pending)
 *
 * Each MCP server is a subprocess launched via stdio transport. The SDK
 * negotiates tool lists automatically during the connection handshake.
 *
 * Design constraints:
 *   - Each MCP server runs in its own subprocess (isolation per failure domain).
 *   - The orchestrator holds no tool-level knowledge; it only manages sessions.
 *   - Real wiring requires ANTHROPIC_API_KEY in environment.
 *
 * source: @anthropic-ai/sdk v0.91.1 — MCP client integration
 * source: docs/PATTERNS.md §"PATTERN: MCP Composition Root"
 */

import Anthropic from "@anthropic-ai/sdk";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Configuration for a single MCP server subprocess. */
export interface McpServerConfig {
  /** Human-readable name for logging. */
  name: string;
  /** Binary/command to run. */
  command: string;
  /** Arguments passed to the command. */
  args: string[];
  /** Port status — "live" servers are spawned; "pending" are skipped. */
  status: "live" | "pending";
}

/** All four MCP servers in the composition. */
export interface OrchestratorConfig {
  servers: McpServerConfig[];
  model: string;
}

// ── Server registry ───────────────────────────────────────────────────────────

/**
 * Returns the canonical set of MCP server configs.
 *
 * The memory server is "live" (Phase 5 delivers it).
 * The other three are "pending" (their ports are not yet complete).
 *
 * source: docs/PATTERNS.md §"PATTERN: Stub-First Composition Root"
 */
export function defaultServerConfigs(): McpServerConfig[] {
  return [
    {
      name:    "@agentic/mcp-server-memory",
      command: "node",
      args:    ["packages/mcp-servers/memory/dist/index.js"],
      status:  "live",
    },
    {
      name:    "@agentic/mcp-server-codebase",
      command: "node",
      args:    ["packages/mcp-servers/codebase/dist/index.js"],
      status:  "pending",
    },
    {
      name:    "@agentic/mcp-server-reasoning",
      command: "node",
      args:    ["packages/mcp-servers/reasoning/dist/index.js"],
      status:  "pending",
    },
    {
      name:    "@agentic/mcp-server-prd",
      command: "node",
      args:    ["packages/mcp-servers/prd/dist/index.js"],
      status:  "pending",
    },
  ];
}

// ── Orchestrator skeleton ─────────────────────────────────────────────────────

/**
 * Skeleton orchestrator that demonstrates MCP server composition.
 *
 * Phase 5 deliverable: this function compiles and exports a typed interface,
 * but does not start a real conversation. Real conversation logic is Phase 6.
 *
 * source: @anthropic-ai/sdk — Beta.messages.stream with MCP config
 */
export async function runOrchestrator(config: OrchestratorConfig): Promise<void> {
  const liveServers = config.servers.filter((s) => s.status === "live");
  const pendingServers = config.servers.filter((s) => s.status === "pending");

  process.stderr.write(
    `[orchestrator] live servers: ${liveServers.map((s) => s.name).join(", ")}\n`,
  );
  process.stderr.write(
    `[orchestrator] pending servers: ${pendingServers.map((s) => s.name).join(", ")}\n`,
  );

  if (liveServers.length === 0) {
    process.stderr.write("[orchestrator] no live servers; exiting\n");
    return;
  }

  // Phase 5 skeleton: log the Anthropic client is constructable.
  // Real tool_choice + mcp_servers config requires SDK beta flag.
  // source: @anthropic-ai/sdk Beta API — MCPServerConfig
  const _client = new Anthropic();
  process.stderr.write(
    `[orchestrator] Anthropic SDK ready; model=${config.model}\n`,
  );
  process.stderr.write(
    "[orchestrator] skeleton only — real conversation wiring is Phase 6\n",
  );
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await runOrchestrator({
    servers: defaultServerConfigs(),
    model:   "claude-opus-4-5",
  });
}
