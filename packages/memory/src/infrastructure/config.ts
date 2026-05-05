/**
 * Centralized path constants for all filesystem locations.
 *
 * All paths are absolute, derived from os.homedir() + constants.
 * No I/O operations — only path construction.
 *
 * Layer: INFRASTRUCTURE (shared path constants).
 * source: Cortex mcp_server/infrastructure/config.py
 */

import * as os from "node:os";
import * as path from "node:path";

// source: Cortex mcp_server/infrastructure/config.py — CLAUDE_DIR = Path.home() / ".claude"
export const CLAUDE_DIR = path.join(os.homedir(), ".claude");

// source: Cortex mcp_server/infrastructure/config.py — METHODOLOGY_DIR = CLAUDE_DIR / "methodology"
export const METHODOLOGY_DIR = path.join(CLAUDE_DIR, "methodology");

// source: Cortex mcp_server/infrastructure/config.py — PROFILES_PATH = METHODOLOGY_DIR / "profiles.json"
export const PROFILES_PATH = path.join(METHODOLOGY_DIR, "profiles.json");

// source: Cortex mcp_server/infrastructure/config.py — SESSION_LOG_PATH = METHODOLOGY_DIR / "session-log.json"
export const SESSION_LOG_PATH = path.join(METHODOLOGY_DIR, "session-log.json");

// source: Cortex mcp_server/infrastructure/config.py — BRAIN_INDEX_PATH = CLAUDE_DIR / "brain-index.json"
export const BRAIN_INDEX_PATH = path.join(CLAUDE_DIR, "brain-index.json");

// source: Cortex mcp_server/infrastructure/config.py — MCP_CONNECTIONS_PATH = METHODOLOGY_DIR / "mcp-connections.json"
export const MCP_CONNECTIONS_PATH = path.join(
  METHODOLOGY_DIR,
  "mcp-connections.json",
);

// source: Cortex mcp_server/infrastructure/config.py — WIKI_ROOT = METHODOLOGY_DIR / "wiki"
export const WIKI_ROOT = path.join(METHODOLOGY_DIR, "wiki");
