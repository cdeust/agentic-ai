#!/usr/bin/env bash
# Launch the ai-architect-mcp Rust binary that powers the codebase plugin.
#
# Args:
#   $1 — CLAUDE_PLUGIN_ROOT. Required.
#
# Resolution order (first that succeeds wins; never falls through silently):
#   1. ${PLUGIN_ROOT}/bin/ai-architect-mcp
#        Pre-built artifact shipped with the plugin (override slot for power
#        users / CI). Empty by default.
#   2. ${PLUGIN_ROOT}/src-rust/target/release/ai-architect-mcp
#        Already built from this plugin's vendored Cargo source — guaranteed
#        protocol/version match. This is the steady-state path after the
#        first-run cargo build below.
#   3. cargo build --release in ${PLUGIN_ROOT}/src-rust/ then exec.
#        Triggered on first launch after install. Requires Rust toolchain
#        (rustup) on the host. Compilation typically takes 2–5 minutes.
#
# Notes
# -----
# - We deliberately do NOT fall back to `command -v ai-architect-mcp` on PATH.
#   The plugin name collides with at least one third-party Python wrapper of
#   the same name (e.g. /opt/homebrew/bin/ai-architect-mcp from the upstream
#   ai-architect Python package), which crashes with ModuleNotFoundError when
#   Claude Code tries to use it as our MCP server. The vendored Rust source
#   under src-rust/ is the only authoritative server for THIS plugin.
# - Stdout is reserved for MCP JSON-RPC framing. All shell diagnostics go to
#   stderr.
#   source: modelcontextprotocol.io/quickstart/server §"Logging in MCP Servers"
set -euo pipefail
PLUGIN_ROOT="${1:?usage: launch.sh <plugin-root>}"

shipped_bin="${PLUGIN_ROOT}/bin/ai-architect-mcp"
if [ -x "${shipped_bin}" ]; then
  exec "${shipped_bin}"
fi

src_dir="${PLUGIN_ROOT}/src-rust"
prebuilt_in_src="${src_dir}/target/release/ai-architect-mcp"
if [ -x "${prebuilt_in_src}" ]; then
  exec "${prebuilt_in_src}"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "codebase plugin: vendored binary not yet built and cargo is not installed." >&2
  echo "  Install Rust toolchain: https://rustup.rs" >&2
  echo "  Then re-launch the plugin (Claude Code will retry on next session)." >&2
  echo "  Or install manually:    cargo install --path ${src_dir}" >&2
  echo "                          (then place the binary at ${shipped_bin})" >&2
  exit 1
fi

if [ ! -f "${src_dir}/Cargo.toml" ]; then
  echo "codebase plugin: src-rust/Cargo.toml missing — corrupt install?" >&2
  exit 1
fi

echo "codebase plugin: building ai-architect-mcp from source (first run, ~2-5 min)..." >&2
( cd "${src_dir}" && cargo build --release --quiet >&2 )
exec "${prebuilt_in_src}"
