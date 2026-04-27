# codebase plugin

**Source:** `cdeust/automatised-pipeline` v0.0.4

Rust MCP server for codebase intelligence. Index any Rust, Python, or TypeScript repo
into a LadybugDB property graph and query it with 23 MCP tools.

## What you get

- 23 MCP tools: `index_codebase`, `query_graph`, `get_symbol`, `impact_analysis`,
  `semantic_diff`, `find_communities`, `trace_execution`, and more
- No hooks, no skills, no commands — pure MCP tooling

## Dependencies

- **First run**: Rust toolchain (`cargo`) for compilation. Builds once; subsequent starts
  use the pre-compiled binary at `target/release/ai-architect-mcp`.
- No external database — LadybugDB is embedded.

## First-run

On first install, the Rust binary must be compiled:
```
cargo build --release --manifest-path <plugin-root>/Cargo.toml
```
This takes 2–5 minutes on a typical machine. Subsequent Claude Code starts are
instantaneous (binary check → exec).

If the binary is not present and `cargo` is not installed, the MCP server fails to
start. Claude Code will show: `MCP server 'ai-architect' failed to start`.
Diagnosis: install Rust via `rustup` or build the binary separately and place it at
`${CLAUDE_PLUGIN_ROOT}/target/release/ai-architect-mcp`.

## MCP tool prefix

After installation: `mcp__plugin_codebase_ai-architect__<tool_name>`

Example: `mcp__plugin_codebase_ai-architect__index_codebase`
