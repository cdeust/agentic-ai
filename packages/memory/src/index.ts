/**
 * @agentic/memory — Cortex memory subsystem (TypeScript port).
 *
 * Each Phase-4 worktree contributed a sub-package under src/<module>/. The
 * sub-packages are re-exported as **namespaces** (`export * as <name>`) to
 * eliminate the cross-module name collisions that arose because multiple
 * worktrees independently re-exported the same shared types via `export *`.
 *
 * Callers import from a sub-namespace:
 *   import { shared, recall, remember } from "@agentic/memory";
 *   const item: shared.Memory = ...;
 *   const result = await recall.recallHandler(...);
 *
 * Per the FREEZE_RULES (`docs/ADR/`), additions to this file require a
 * type-amendment ADR + sign-off from `liskov` + `panini`.
 *
 * source: post-Phase-4 merge cleanup, 2026-04-26. Pre-fix, multiple
 * worktrees re-exported `Memory`, `Concept`, `MemoryRecord`, `linear-algebra
 * helpers`, etc. via `export *`, causing TS2308 duplicate-export errors at
 * build time. Namespace exports preserve every symbol while disambiguating
 * by sub-package.
 */

export * as shared from "./shared/index.js";
export * as remember from "./remember/index.js";
export * as recall from "./recall/index.js";
export * as consolidation from "./consolidation/index.js";
export * as codebaseAnalysis from "./codebase-analysis/index.js";
export * as wiki from "./wiki/index.js";
export * as graph from "./graph/index.js";
export * as methodology from "./methodology/index.js";
export * as narrative from "./narrative/index.js";
export * as importer from "./import/index.js";
export * as workflowGraph from "./workflow-graph/index.js";
export * as automation from "./automation/index.js";
export * as hooks from "./hooks/index.js";
