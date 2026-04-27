# ADR-0008 — `.claude-plugin/` path placement: per-package vs root-aggregated

**Status:** Accepted
**Date:** 2026-04-26
**Originated:** `port/migrate-prd-spec` (ADR-008) and `port/plugin-manifest-design`
**Affects:** Phase 2 — prd-spec migration; Phase 5 — unified plugin manifest

## Context

Each source repo currently has its own `.claude-plugin/plugin.json` at
its repo root, plus a single `.claude-plugin/marketplace.json`. When
merged into the monorepo, where do these manifests live?

Three options:
1. Each package keeps its own `.claude-plugin/plugin.json` at its package
   root (`packages/prd-pipeline/.claude-plugin/plugin.json`).
2. All four manifests live at the monorepo root under
   `.claude-plugin/<plugin>/plugin.json`, with a single
   `.claude-plugin/marketplace.json` listing all four.
3. Hybrid: per-package directories during the migration, then a Phase-5
   aggregation move to root.

## Decision

**Option 2 (root-aggregated) — but staged through Option 3.**

- During Phase 2 (prd-spec subtree migration), the manifest stays at
  `packages/prd-pipeline/.claude-plugin/plugin.json` so the migration
  diff is minimal and `git log --follow` continues to track the
  manifest's history.
- During Phase 5, all four plugin manifests are moved to
  `.claude-plugin/<plugin>/plugin.json` under the monorepo root by a
  dedicated worktree (`port/plugin-manifest-design` already produced the
  target layout). The move is a single rename + a marketplace.json
  composition — no semantic changes.

Rationale:
- Claude Code's marketplace install convention discovers
  `.claude-plugin/marketplace.json` at the REPOSITORY ROOT. There can
  only be one. Per-package manifests work for development but cannot be
  installed from the unified repo without a top-level aggregator.
- Staging through Option 3 keeps the Phase 2 migration cleanly scoped to
  "move the source repo into a subtree" and defers the install-flow
  redesign to Phase 5 where it can be reviewed by the `eco` Model Reader
  audit.

## Consequences

- The `.mcp.json` referenced by each plugin entry must use
  `${CLAUDE_PLUGIN_ROOT}` (NOT `${VAR:-fallback}` — see ADR-0010) to
  resolve paths relative to its plugin directory, not the repo root.
- Phase 5's worktree (`port/plugin-manifest-design` already drafted)
  produces the move script; Phase 6 (cutover) executes it.
- Independent versioning per plugin is preserved: each
  `.claude-plugin/<plugin>/plugin.json` has its own `version` field; the
  marketplace.json's `plugins[].version` is updated when the plugin's
  own version bumps.

## Verification

- Phase 5 deliverable check: `find plugins -name plugin.json | wc -l`
  returns `4` (one per plugin).
  - Path note (2026-04-27): the canonical layout settled on `plugins/<plugin-name>/plugin.json`
    with each plugin's `.claude-plugin/` subdirectory holding additional
    artefacts. Earlier drafts of this ADR referenced a top-level `.claude-plugin/`
    directory; that location was never used in the monorepo. Source: docs/audits/FINAL_CROSS_AUDIT.md §F-MED-003 (Borges, 2026-04-27).
- Marketplace install verification: on a fresh Claude Code session,
  `/plugin marketplace add cdeust/agentic-ai` followed by
  `/plugin install <plugin>@agentic-ai` registers the right MCP servers
  for each of the four plugins.
