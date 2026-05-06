#!/usr/bin/env bash
# postInstall hook for the codebase plugin.
#
# Builds ai-architect-mcp from the vendored Rust source so that on first MCP
# connection Claude Code finds the compiled binary at
# ${PLUGIN_ROOT}/src-rust/target/release/ai-architect-mcp and launches it
# instantly. Without this hook, launch.sh would shell out to `cargo build`
# at connect time and consistently overshoot the 30s MCP connect timeout.
#
# Args:
#   $1 — CLAUDE_PLUGIN_ROOT. Required.
#
# Behavior:
#   - No-op if the binary already exists (re-install on the same machine).
#   - Errors loudly if cargo is not on PATH; the user must install rustup.
#   - All build noise goes to stderr; this hook does not produce stdout.
#
# source: modelcontextprotocol.io/quickstart/server §"Initialization"
#         (30s connect timeout is enforced by Claude Code's MCP host).
set -euo pipefail
PLUGIN_ROOT="${1:?usage: postinstall.sh <plugin-root>}"
src_dir="${PLUGIN_ROOT}/src-rust"
prebuilt_in_src="${src_dir}/target/release/ai-architect-mcp"

if [ -x "${prebuilt_in_src}" ]; then
  echo "codebase plugin: ai-architect-mcp already built — skipping." >&2
  exit 0
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "codebase plugin: cannot pre-build ai-architect-mcp — cargo not on PATH." >&2
  echo "  Install Rust toolchain: https://rustup.rs" >&2
  echo "  Then run: claude plugin reinstall codebase@agentic-ai" >&2
  exit 1
fi

if [ ! -f "${src_dir}/Cargo.toml" ]; then
  echo "codebase plugin: src-rust/Cargo.toml missing — corrupt install?" >&2
  exit 1
fi

echo "codebase plugin: building ai-architect-mcp from source (one-time, ~2-5 min)..." >&2
( cd "${src_dir}" && cargo build --release --quiet >&2 )
echo "codebase plugin: build complete — binary at ${prebuilt_in_src}" >&2
