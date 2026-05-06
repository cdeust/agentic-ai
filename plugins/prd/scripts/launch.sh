#!/usr/bin/env bash
# Launch the prd-spec MCP server bundle.
#
# Args:
#   $1 — CLAUDE_PLUGIN_ROOT. Required.
#
# Behavior:
#   1. cd into the plugin dir.
#   2. If node_modules/ is missing, install runtime deps (ajv, used via
#      createRequire by schema-oracle's CodeGen path that esbuild cannot
#      pre-bundle).
#   3. exec node dist/index.js.
set -euo pipefail
PLUGIN_ROOT="${1:?usage: launch.sh <plugin-root>}"
cd "${PLUGIN_ROOT}"
if [ ! -d node_modules ]; then
  echo "prd plugin: installing runtime deps (first run)..." >&2
  npm install --omit=dev --no-audit --no-fund --silent >&2
fi
exec node dist/index.js
