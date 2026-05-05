/**
 * @agentic/mcp-server-prd — Composition root (skeletal).
 *
 * STATUS: skeletal — @agentic/prd-pipeline migration approach defined (ADR-0005,
 * ADR-0006); MCP tool registrations not yet wired.
 *
 * PATTERN: Stub-First Composition Root (see docs/PATTERNS.md)
 *
 * This package exposes the prd-spec-generator pipeline as an MCP server.
 * It wraps the @agentic/prd-pipeline workspace package, which is the result
 * of migrating the prd-spec-generator repo (267 tests) into the monorepo.
 *
 * Migration plan and design:
 *   worktrees/port-migrate-prd-spec/ — migration plan + package renaming
 *   docs/ADR/0005-prd-spec-subtree-approach.md — subtree vs. filter-repo decision
 *   docs/ADR/0006-prd-bundle-preserve-vs-regenerate.md — bundle strategy
 *
 * Phase 2 (port/migrate-prd-spec) defined the migration approach.
 * Phase 5 lands this stub so the workspace topology is stable.
 * Once @agentic/prd-pipeline exists, this server will expose tools:
 *   generate_prd, validate_prd, run_pipeline, list_strategies, get_consensus
 *
 * source: worktrees/port-migrate-prd-spec/ — migration plan
 * source: docs/ADR/0005-prd-spec-subtree-approach.md
 * source: docs/ADR/0006-prd-bundle-preserve-vs-regenerate.md
 */

// Skeletal export — MCP tool registrations will replace this.
export const PORT_STATUS = "skeletal" as const;
