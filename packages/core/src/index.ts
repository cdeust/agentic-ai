/**
 * @agentic/core — PLACEHOLDER PACKAGE — DO NOT IMPORT FROM CONSUMERS YET.
 *
 * STATUS: port-pending (Phase 2 prerequisite).
 *
 * The full domain type space — Zod schemas (PRDContext, HardOutputRule,
 * SectionType, etc.), agent identities, ports for memory/codebase/reasoning —
 * was designed in the `port/core-types` worktree (commit a9c2be3) but never
 * translated into source. Until that lands, this barrel is empty.
 *
 * Consumers that `import { … } from "@agentic/core"` will find nothing here.
 * Either:
 *   - import the symbol from its current home (`@agentic/memory`, etc.) and
 *     accept that it will move when core types land, OR
 *   - block on the `port/core-types` follow-up worktree.
 *
 * Tracking:
 *   - docs/audits/FINAL_CROSS_AUDIT.md §F-MED-001 (Borges, 2026-04-27)
 *   - docs/PHASE_PLAN.md §Phase-0 → packages/core/ (still `[ ]`)
 *
 * source: post-Phase-4 cleanup, 2026-04-26; placeholder hardened in
 * Phase-6 final-cross-audit follow-up, 2026-04-27.
 */
export const __PLACEHOLDER__ = true;
