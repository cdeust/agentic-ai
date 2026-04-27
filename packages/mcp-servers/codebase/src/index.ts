/**
 * @agentic/mcp-server-codebase — Composition root stub.
 *
 * STATUS: port-pending
 *
 * PATTERN: Stub-First Composition Root (see docs/PATTERNS.md)
 *
 * This package exposes the codebase intelligence subsystem as an MCP server.
 * The actual tool implementations depend on:
 *   1. The Rust subprocess adapter (packages/codebase/src/adapters/rust-pipeline-adapter.ts)
 *      defined in ADR-0001 (docs/ADR/0001-lsp-resolve-subprocess-chain.md)
 *      and ADR-0002 (docs/ADR/0002-analyze-codebase-serial-vs-parallel.md).
 *   2. The @agentic/codebase workspace package (packages/codebase/) which wraps
 *      the Rust binary via the CodebasePort interface.
 *
 * Phase 3 (port/inventory-automatised-pipeline) defined the contract.
 * Phase 5 lands this stub so the workspace topology is stable.
 * Phase 6 (or a dedicated codebase-server worktree) will wire the real adapter.
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

// Stub export — satisfies TypeScript's "no empty module" requirement.
// The real composition root replaces this file.
export const PORT_STATUS = "pending" as const;
