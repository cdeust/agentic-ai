# @agentic/codebase-rust

Rust workspace housing the `ai-architect-mcp` binary — the graph-intelligence
core of the Cortex codebase-analysis pipeline.

## What lives here

This package is a verbatim copy of the
[`ai-automatised-pipeline`](https://github.com/cdeust/ai-automatised-pipeline)
source as of 2026-04-27 (commit imported into agentic-ai in one batch per
`docs/PHASE_3_PLAN.md §C`).

The upstream repository will be archived on GitHub in Phase 6 of the migration
(per `docs/PHASE_3_PLAN.md §7.7` and `docs/CUTOVER_RUNBOOK.md`). After archival,
`packages/codebase-rust/` is the canonical home.

## Binary produced

`cargo build --release` → `target/release/ai-architect-mcp`

The binary is a stdio-based MCP server that speaks newline-delimited JSON-RPC 2.0.
It is not invoked directly by end users; the TypeScript adapter
[`@agentic/codebase`](../codebase/README.md) wraps it as a subprocess.

## Build

```bash
# From monorepo root
pnpm -F @agentic/codebase-rust build

# Direct cargo invocation
cargo build --release --manifest-path packages/codebase-rust/Cargo.toml
```

## Test

```bash
pnpm -F @agentic/codebase-rust test
# or
cargo test --release --manifest-path packages/codebase-rust/Cargo.toml
```

## Toolchain

Pinned to Rust `1.94.0` via `rust-toolchain.toml`.
Source: `docs/PHASE_3_PLAN.md §7.2` — exact pin for reproducible builds per
`coding-standards.md §8`.

## Architecture notes

- `src/main.rs` — wire layer + stages 1–2 + dispatch (~3 489 LOC). Known god
  file; refactoring deferred to a future ADR per `PHASE_3_PLAN.md §C`.
- 23 MCP tools documented in `inventory/MCP_TOOLS.md`.
- Wire protocol: newline-delimited JSON, one object per line on stdio.
- No external runtime dependencies beyond system libc (fully statically linked).

For the TypeScript surface, see [`@agentic/codebase`](../codebase/README.md).
