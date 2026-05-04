/**
 * @agentic/core — public barrel.
 *
 * Phase 3 bootstraps this package with the CodebasePort interface and its
 * Zod schemas. The full domain type space (PRDContext, HardOutputRule, etc.)
 * will be added when the `port/core-types` worktree lands.
 *
 * source: docs/PHASE_3_PLAN.md §2.6 — CodebasePort final home
 */

// CodebasePort interface + input schemas.
export * from "./ports/codebase.js";

// Output Zod schemas (split into a sibling file to keep each file ≤500 LOC
// per coding-standards.md §4.1).
export * from "./ports/codebase-outputs.js";

// Typed CodebasePort errors (split for §4.1).
export * from "./ports/codebase-errors.js";

// LlmClient port — single-turn completion interface for narrative + wiki handlers.
// source: docs/PHASE_7_TRACKING.md §Group C
export * from "./ports/llm-client.js";

// EmbeddingEngine port — text-to-dense-vector interface used by the memory
// subsystem (abstention-gate, memory-ingest, post-store, vector storage).
// source: docs/ADR/0013-embedding-runtime.md
// source: docs/PHASE_7_TRACKING.md §Group A
export * from "./ports/embedding.js";
