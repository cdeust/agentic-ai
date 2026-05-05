/**
 * @agentic/mcp-server-codebase — Composition root (skeletal).
 *
 * STATUS: skeletal — Rust subprocess adapter wired (PR #19 + #39); MCP tool
 * registrations are deferred to a dedicated codebase-server worktree.
 *
 * This package exposes the codebase intelligence subsystem as an MCP server.
 * The adapter layer is live:
 *   1. Rust subprocess adapter: packages/codebase/src/adapters/rust-pipeline-adapter.ts
 *      (ADR-0001, ADR-0002)
 *   2. @agentic/codebase wraps the Rust binary via CodebasePort.
 *
 * Next step: register MCP tools (analyze_codebase, get_symbol, search_codebase, etc.)
 * using the wired adapter.
 *
 * Design ADRs:
 *   ADR-0001 — LSP resolve subprocess chain
 *   ADR-0002 — analyze-codebase serial vs parallel
 *   ADR-0003 — adapter precondition strength
 *   ADR-0004 — validation tool optional triple
 *
 * source: docs/ADR/0001-lsp-resolve-subprocess-chain.md
 * source: docs/ADR/0002-analyze-codebase-serial-vs-parallel.md
 */

// Skeletal export — MCP tool registrations will replace this.
export const PORT_STATUS = "skeletal" as const;
