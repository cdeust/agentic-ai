/**
 * Singleton connection pool for MCP clients — lazy connect, reuse, idle timeout.
 *
 * Reads server config from mcp-connections.json, creates MCPClient instances on
 * demand, caches by server name.
 *
 * source: Cortex mcp_server/infrastructure/mcp_client_pool.py
 */

import { readFileSync, existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { McpConnectionError } from "../shared/errors.js";
import { MCPClient } from "./mcp-client.js";

// source: Cortex mcp_server/infrastructure/config.py:MCP_CONNECTIONS_PATH
const _MCP_CONNECTIONS_PATH = path.join(
  os.homedir(),
  ".claude",
  "methodology",
  "mcp-connections.json",
);

// source: mcp_client_pool.py:19
const _pool = new Map<string, MCPClient>();

function _readJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function _loadServerConfig(serverName: string): Record<string, unknown> {
  /** Load server configuration from mcp-connections.json.
   * source: mcp_client_pool.py:22-50
   */
  const config = _readJson(_MCP_CONNECTIONS_PATH);
  if (!config || !config["servers"]) {
    throw new McpConnectionError(
      `MCP connections config not found at ${_MCP_CONNECTIONS_PATH}. Create it with server definitions.`,
      { path: _MCP_CONNECTIONS_PATH },
    );
  }

  const servers = config["servers"] as Record<string, unknown>;
  const serverConfig = servers[serverName] as Record<string, unknown> | undefined;
  if (!serverConfig) {
    const available = Object.keys(servers).join(", ");
    throw new McpConnectionError(
      `Server "${serverName}" not found in MCP connections config. Available: ${available}`,
      { serverName, available: Object.keys(servers) },
    );
  }

  // Resolve ${VAR} references in env block
  // source: mcp_client_pool.py:39-48
  const env = serverConfig["env"] as Record<string, string> | undefined;
  if (env) {
    for (const key of Object.keys(env)) {
      const val = env[key];
      if (typeof val === "string") {
        env[key] = val.replace(/\$\{(\w+)\}/g, (_, varName: string) =>
          process.env[varName] ?? "",
        );
      }
    }
  }

  return serverConfig;
}

export async function getClient(serverName: string): Promise<MCPClient> {
  /** Get a connected MCP client for the named server.
   * source: mcp_client_pool.py:53-84
   */
  const existing = _pool.get(serverName);
  if (existing && existing.connected) {
    return existing;
  }

  // Clean up stale entry
  if (existing) {
    existing.close();
    _pool.delete(serverName);
  }

  const config = _loadServerConfig(serverName);
  // Cast via unknown to bridge the generic Record to the typed McpClientConfig.
  // The pool receives configs from mcp-connections.json which matches McpClientConfig shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new MCPClient(config as any);

  // Upstream MCP servers ship binaries that are not in the default allowlist.
  // Mirror the extension that ap_bridge.py applies on its bridge path so
  // the pool path is not silently rejected.
  // source: mcp_client_pool.py:72-73
  client._extraAllowedCommands = new Set(["node", "automatised-pipeline"]);

  await client.connect();
  _pool.set(serverName, client);

  process.stderr.write(
    `[mcp-pool] Connected to "${serverName}" ` +
      `(${Object.keys(client.listTools()).length} tools, protocol ${client.protocolVersion})\n`,
  );

  return client;
}

export function closeClient(serverName: string): void {
  /** Close a specific client connection.
   * source: mcp_client_pool.py:87-93
   */
  const client = _pool.get(serverName);
  if (client) {
    client.close();
    _pool.delete(serverName);
    process.stderr.write(`[mcp-pool] Closed "${serverName}"\n`);
  }
}

export function closeAll(): void {
  /** Close all client connections. Safe for shutdown hooks.
   * source: mcp_client_pool.py:96-101
   */
  for (const [name, client] of _pool) {
    client.close();
    process.stderr.write(`[mcp-pool] Closed "${name}"\n`);
  }
  _pool.clear();
}

export { MCPClient };
