/**
 * @agentic/core — public barrel.
 *
 * Phase 3 bootstraps this package with the CodebasePort interface and its
 * Zod schemas. The full domain type space (PRDContext, HardOutputRule, etc.)
 * will be added when the `port/core-types` worktree lands.
 *
 * source: docs/PHASE_3_PLAN.md §2.6 — CodebasePort final home
 * source: docs/audits/FINAL_CROSS_AUDIT.md §F-MED-001 — placeholder note
 */

// CodebasePort and all associated schemas + errors.
export * from "./ports/codebase.js";

// Legacy placeholder — kept so existing consumers of `__PLACEHOLDER__` don't
// hard-fail until the full `port/core-types` migration completes.
export const __PLACEHOLDER__ = true;
