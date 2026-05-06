#!/usr/bin/env bash
# Launch the ai-architect-mcp Rust binary, falling back to `cargo run` if not built.
# SEC-006 fix: replaces inline `bash -c "..."` in .mcp.json so that
# ${CLAUDE_PLUGIN_ROOT} is no longer re-evaluated as a shell expression
# substituted into a -c string.  The shell still expands $1, but $1 is an
# argv element delivered by Claude Code — never substituted into source.
#
# Args:
#   $1 — the plugin root (CLAUDE_PLUGIN_ROOT). Required.
#
# Exit:
#   exec's the chosen binary; never returns on success.
set -euo pipefail
PLUGIN_ROOT="${1:?usage: launch.sh <plugin-root>}"
BIN="${PLUGIN_ROOT}/../../packages/codebase-rust/target/release/ai-architect-mcp"
MANIFEST="${PLUGIN_ROOT}/../../packages/codebase-rust/Cargo.toml"
if [ -x "${BIN}" ]; then
  exec "${BIN}"
else
  exec cargo run --quiet --release --manifest-path "${MANIFEST}"
fi
