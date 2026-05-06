#!/usr/bin/env bash
# Launch the ai-architect-mcp Rust binary that powers the codebase plugin.
#
# Args:
#   $1 — CLAUDE_PLUGIN_ROOT. Required.
#
# Resolution order (first that succeeds wins; never falls through silently):
#   1. ${PLUGIN_ROOT}/bin/ai-architect-mcp           (pre-built artifact shipped with plugin)
#   2. command -v ai-architect-mcp                    (already on PATH; e.g. cargo install)
#   3. ${PLUGIN_ROOT}/src-rust/target/release/ai-architect-mcp
#                                                     (already built in the plugin dir)
#   4. cargo build --release in ${PLUGIN_ROOT}/src-rust then exec the freshly built binary
#
# All diagnostics go to stderr — stdout is reserved for MCP JSON-RPC framing.
# source: modelcontextprotocol.io/quickstart/server §"Logging in MCP Servers"
set -euo pipefail
PLUGIN_ROOT="${1:?usage: launch.sh <plugin-root>}"

shipped_bin="${PLUGIN_ROOT}/bin/ai-architect-mcp"
if [ -x "${shipped_bin}" ]; then
  exec "${shipped_bin}"
fi

if command -v ai-architect-mcp >/dev/null 2>&1; then
  exec ai-architect-mcp
fi

src_dir="${PLUGIN_ROOT}/src-rust"
prebuilt_in_src="${src_dir}/target/release/ai-architect-mcp"
if [ -x "${prebuilt_in_src}" ]; then
  exec "${prebuilt_in_src}"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "codebase plugin: ai-architect-mcp not found and cargo is not installed." >&2
  echo "  Install Rust toolchain: https://rustup.rs" >&2
  echo "  Or install the binary:  cargo install --path ${src_dir}" >&2
  exit 1
fi

if [ ! -f "${src_dir}/Cargo.toml" ]; then
  echo "codebase plugin: src-rust/Cargo.toml missing — corrupt install?" >&2
  exit 1
fi

echo "codebase plugin: building ai-architect-mcp from source (first run)..." >&2
( cd "${src_dir}" && cargo build --release --quiet >&2 )
exec "${prebuilt_in_src}"
