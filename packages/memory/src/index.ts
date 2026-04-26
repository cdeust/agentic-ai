/**
 * @agentic/memory — Cortex memory subsystem (TypeScript port).
 *
 * Each Phase-4 worktree contributed a sub-package under src/<module>/.
 * The barrel below re-exports each module's public surface.
 *
 * Per the FREEZE_RULES (`docs/ADR/`), additions to this file require a
 * type-amendment ADR + sign-off from `liskov` + `panini`.
 */

// Foundation (cortex-shared)
export * from "./shared/index.js";

// Phase-4 worktrees, in PHASE_PLAN.md §4 merge order:
export * from "./remember/index.js";
export * from "./recall/index.js";
export * from "./consolidation/index.js";
export * from "./codebase-analysis/index.js";
export * from "./wiki/index.js";
export * from "./graph/index.js";
export * from "./methodology/index.js";
export * from "./narrative/index.js";
export * from "./import/index.js";
export * from "./workflow-graph/index.js";
export * from "./automation/index.js";
export * from "./hooks/index.js";
