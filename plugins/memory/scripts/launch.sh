#!/usr/bin/env bash
# Launch the memory MCP server bundle.
#
# Args:
#   $1 — CLAUDE_PLUGIN_ROOT (the plugin directory after install). Required.
#
# Behavior:
#   1. cd into the plugin dir.
#   2. If node_modules/ is missing, run npm install --omit=dev to fetch native
#      deps declared in package.json (better-sqlite3, onnxruntime-node, etc).
#   3. exec node dist/index.js.
#
# The bundle inlines pure-JS deps (zod, @modelcontextprotocol/sdk, workspace
# packages). Only native (compiled-binding) deps are external — they are
# resolved from node_modules at runtime via createRequire.
#
# Stdout is reserved for MCP JSON-RPC framing. All shell diagnostics go to
# stderr — writing to stdout would corrupt the protocol.
# source: modelcontextprotocol.io/quickstart/server §"Logging in MCP Servers"
set -euo pipefail
PLUGIN_ROOT="${1:?usage: launch.sh <plugin-root>}"
cd "${PLUGIN_ROOT}"
if [ ! -d node_modules ]; then
  echo "memory plugin: installing native deps (first run)..." >&2
  npm install --omit=dev --no-audit --no-fund --silent >&2
fi
exec node dist/index.js
