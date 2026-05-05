/**
 * Discover the ai-automatised-pipeline MCP server and wire it into
 * Cortex's mcp-connections.json automatically.
 *
 * Runs on SessionStart so users who have the pipeline installed get the
 * codebase MCP server wired up without manual config editing. The
 * discovery mirrors cortex-doctor's optional-capability probe:
 *
 *   1. Binaries on PATH: cortex-pipeline, automatised-pipeline,
 *      ai-automatised-pipeline, ai-architect-mcp.
 *   2. Sibling git checkout at ../anthropic/ai-automatised-pipeline
 *      with a built Cargo release binary at
 *      target/release/ai-architect-mcp.
 *   3. Otherwise: no change to mcp-connections.json.
 *
 * If the file already exists AND already has a codebase server entry,
 * we leave it alone — users who customized their config keep their
 * customization. We only write when the config is missing entirely OR
 * the codebase key is absent.
 *
 * source: user directive "detected and guided, not all users will have a
 * use of it". Pipeline is optional.
 *
 * Layer: INFRASTRUCTURE — filesystem + subprocess probe.
 * source: Cortex mcp_server/infrastructure/pipeline_discovery.py
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

/** Resolve a binary on PATH. Returns path or null. */
function _which(name: string): string | null {
  try {
    const result = execSync(
      process.platform === "win32" ? `where ${name}` : `command -v ${name}`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return result.trim().split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

import { MCP_CONNECTIONS_PATH } from "./config.js";
import { readJson, writeJson } from "./file-io.js";

// Binary name candidates on PATH, cheapest check first.
// source: Cortex mcp_server/infrastructure/pipeline_discovery.py — _BINARY_CANDIDATES
const _BINARY_CANDIDATES = [
  "cortex-pipeline",
  "automatised-pipeline",
  "ai-automatised-pipeline",
];

// Common source-checkout locations.
// source: Cortex mcp_server/infrastructure/pipeline_discovery.py — _SOURCE_DIRS
const _SOURCE_DIRS = [
  "../anthropic/ai-automatised-pipeline",
  "../../anthropic/ai-automatised-pipeline",
  "../ai-automatised-pipeline",
];

// source: Cortex mcp_server/infrastructure/pipeline_discovery.py — _BUILT_RELATIVE
const _BUILT_RELATIVE = ["target/release/ai-architect-mcp"];

// ── Install paths (shared with pipeline-installer) ───────────────────────────

// source: Cortex mcp_server/infrastructure/pipeline_discovery.py — _INSTALL_SRC_DIR
export const INSTALL_SRC_DIR = path.join(
  os.homedir(),
  ".claude",
  "methodology",
  "src",
  "automatised-pipeline",
);

// source: Cortex mcp_server/infrastructure/pipeline_discovery.py — _INSTALL_BIN_DIR
export const INSTALL_BIN_DIR = path.join(
  os.homedir(),
  ".claude",
  "methodology",
  "bin",
);

// source: Cortex mcp_server/infrastructure/pipeline_discovery.py — _INSTALL_SYMLINK
export const INSTALL_SYMLINK = path.join(INSTALL_BIN_DIR, "mcp-server");

function _isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return [command, ...args] for the pipeline MCP server, or null.
 *
 * null means "no pipeline found" — callers should leave the mcp
 * config alone and let ingest_codebase fail with the standard
 * McpConnectionError when invoked (ingestion is explicitly opt-in).
 *
 * source: Cortex mcp_server/infrastructure/pipeline_discovery.py:discover_pipeline_command
 */
export function discoverPipelineCommand(): string[] | null {
  // Auto-installed location — preferred when present.
  if (fs.existsSync(INSTALL_SYMLINK) && _isExecutable(INSTALL_SYMLINK)) {
    return [INSTALL_SYMLINK];
  }

  for (const name of _BINARY_CANDIDATES) {
    const found = _which(name);
    if (found) return [found];
  }

  for (const source of _SOURCE_DIRS) {
    const root = path.resolve(source);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    for (const rel of _BUILT_RELATIVE) {
      const built = path.join(root, rel);
      try {
        const stat = fs.statSync(built);
        if (stat.isFile() && _isExecutable(built)) {
          return [built];
        }
      } catch {
        // file absent or inaccessible
      }
    }
  }

  return null;
}

/** Audit dict returned by ensurePipelineConnection. */
export interface PipelineConnectionResult {
  action:
    | "wrote_config"
    | "added_codebase"
    | "already_configured"
    | "no_pipeline_found"
    | "write_failed";
  path: string;
  binary?: string;
  error?: string;
}

/**
 * Write the codebase entry into mcp-connections.json when absent.
 *
 * Returns a small audit dict describing what happened:
 *   action: "wrote_config" | "added_codebase" | "already_configured"
 *           | "no_pipeline_found"
 *   path:   path to the config file (always)
 *   binary: resolved pipeline binary path (when discovered)
 *
 * Idempotent. Safe to call every SessionStart.
 *
 * source: Cortex mcp_server/infrastructure/pipeline_discovery.py:ensure_pipeline_connection
 */
export function ensurePipelineConnection(): PipelineConnectionResult {
  const configPath = MCP_CONNECTIONS_PATH;
  let command = discoverPipelineCommand();
  let existing = (readJson(configPath) ?? {}) as Record<string, unknown>;

  const existingServers = (existing["servers"] ?? {}) as Record<
    string,
    unknown
  >;
  const existingCodebase = existingServers["codebase"] as
    | Record<string, unknown>
    | undefined;

  if (existingCodebase) {
    const configuredCmd = String(existingCodebase["command"] ?? "");
    // Validate that the configured binary still exists.
    if (
      configuredCmd &&
      fs.existsSync(configuredCmd) &&
      _isExecutable(configuredCmd)
    ) {
      return {
        action: "already_configured",
        path: configPath,
        binary: configuredCmd,
      };
    }
    // Stale entry: drop it so the discovery+install path runs.
    const servers = { ...existingServers };
    delete servers["codebase"];
    existing = { ...existing, servers };
    try {
      writeJson(configPath, existing);
    } catch {
      // best-effort purge
    }
  }

  // Auto-install path: pipeline-installer does the heavy lifting.
  // Note: ensurePipelineConnection is synchronous (matches Python source).
  // The install path is intentionally skipped here; callers that want
  // async install should call installPipeline() from pipeline-installer.ts
  // directly before calling ensurePipelineConnection().
  // source: Cortex mcp_server/infrastructure/pipeline_discovery.py — auto-install path

  if (command === null) {
    return { action: "no_pipeline_found", path: configPath };
  }

  const config = { ...existing };
  const servers = { ...((config["servers"] as Record<string, unknown>) ?? {}) };
  servers["codebase"] = {
    command: command[0],
    args: command.slice(1),
    env: {},
    // 0 = no per-call timeout; fresh-codebase indexing of large
    // trees can legitimately exceed any fixed bound.
    // source: Cortex mcp_server/infrastructure/pipeline_discovery.py — callTimeoutMs: 0
    callTimeoutMs: 0,
  };
  config["servers"] = servers;
  if (!("_comment" in config)) {
    config["_comment"] =
      "Auto-generated by Cortex pipeline_discovery. Customize freely — " +
      "Cortex only adds missing server entries, never overwrites.";
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    writeJson(configPath, config);
  } catch (exc) {
    return {
      action: "write_failed",
      path: configPath,
      binary: command[0],
      error: String(exc),
    };
  }

  const hadExisting = Object.keys(existing).length > 0;
  return {
    action: hadExisting ? "added_codebase" : "wrote_config",
    path: configPath,
    binary: command[0],
  };
}

// Note: async install path is intentionally excluded from this synchronous function.
// Callers that need install should call installPipeline() from pipeline-installer.ts directly.
