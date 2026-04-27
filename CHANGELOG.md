# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

> This entry covers all 71 commits on `main` since the initial foundation commit
> (`63a5097`). It will become `[v0.1.0]` on cutover day once the pre-cutover
> checklist in `docs/RELEASE_CHECKLIST.md` is fully satisfied.

### Added

#### Phase 0 — Foundation (commits `63a5097` → `b0a8cb6`)

- Monorepo skeleton: `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`.
- `scripts/spawn-worktree.sh` — creates a git worktree with pre-populated mission file.
- `docs/WORKTREE_MISSION_TEMPLATE.md` — standardised mission format for parallel worktrees.
- `docs/PHASE_PLAN.md` — authoritative phased migration plan.
- `docs/MIGRATION_MANIFEST.md` — exhaustive per-artifact inventory across 4 source repos.
- `parity-oracle/` — fixture corpus, masking rules, and parity runbook.
- 11 Architecture Decision Records under `docs/ADR/` (ADR-0001 through ADR-0011).
- `inventory/` — exhaustive inventories of all 4 source repos (Cortex Python, Rust
  automatised-pipeline, zetetic genius/team agents, prd-spec-generator).
- `design/` — type space design, core ports, freeze rules, and prd-spec subtree plan.
- `plugins/` — unified plugin manifests and `marketplace.json` for 4 MCP servers.
- `.github/workflows/ci.yml` — CI matrix: Node 20 + 22, build + test + plugin lint.

#### Phase 1 — Tooling and CI (commit `1278fed`)

- `eslint.config.js` — ESLint v9 flat config.
- `vitest.config.ts` — workspace-mode test config.
- `scripts/check-layer-imports.ts` — static layer-import linter.
- `scripts/check-source-citations.sh` — `// source:` annotation pre-commit hook.

#### Phase 2 — Subtree migrations (commits `a9c2be3`, `8669624`, `5efa32b`)

- `packages/core/` — Day-0 frozen type surface (`@agentic/core`); Zod schemas for all
  shared domain types; ports declared in `src/index.ts` (placeholder pending `port/core-types`).
- `migration/` — prd-spec-generator subtree plan, verification manifest, commit graph.

#### Phase 4 — Cortex Python → TypeScript port (commits `b3c0540` → `00e2083`, `abb4bbc` → `1d61dab`)

Thirteen parallel worktrees merged in dependency order:

- `packages/memory/src/hooks/` — 9 lifecycle hooks (SessionStart … ingest-codebase-background).
- `packages/memory/src/shared/` — foundation types, error handler, observability.
- `packages/memory/src/remember/` — write gate, write-post-store, memory ingest, PG+SQLite stores.
- `packages/memory/src/recall/` — multi-signal fusion + hierarchical recall.
- `packages/memory/src/consolidation/` — decay cycle, CLS, replay, plasticity, neurogenesis.
- `packages/memory/src/codebase-analysis/` — AST parser, codebase graph, ingest pipeline.
- `packages/memory/src/wiki/` — classifier, claim extraction, read/write handlers.
- `packages/memory/src/graph/` — navigation + heat propagation.
- `packages/memory/src/methodology/` — cognitive profile, methodology engine, domain detection.
- `packages/memory/src/narrative/` — session extraction + narrative arc.
- `packages/memory/src/import/` — Claude Code JSONL, ChatGPT, Gemini, Cursor, ClaudeMemory importers.
- `packages/memory/src/workflow-graph/` — builder, query, and workflow graph sources.
- `packages/memory/src/automation/` — rule engine, triggers, prospective memory, claude.md sync.

#### Phase 4 → 5 — Type-drift cleanup (commits `3084a98`, `5c8566e`, `2821cbf`, `05d6083`, `63bda4e`)

Resolved 14 tracked type-drift items (see `docs/PHASE_PLAN.md §Phase-4-to-5-cleanup`).
Restored hard CI gates: `pnpm install --frozen-lockfile`, `pnpm test`.
`pnpm build` remains advisory pending CI workflow update (see open finding F-CRIT-001).

#### Phase 5 — MCP Composition Roots + Orchestrator (commits `ec5e279`, `9aa124a`)

- `packages/mcp-servers/memory/` — `@agentic/mcp-server-memory`: exposes all 46 Cortex MCP
  tools via stdio transport; 10 topic files; zero tsc errors; smoke-test verified.
- `packages/mcp-servers/codebase/` — `@agentic/mcp-server-codebase`: stub composition root
  (STATUS: port-pending; Phase 3 TS adapter not yet built).
- `packages/mcp-servers/reasoning/` — `@agentic/mcp-server-reasoning`: stub composition root
  (STATUS: port-pending; zetetic prompt inventory not yet ported).
- `packages/mcp-servers/prd/` — `@agentic/mcp-server-prd`: stub composition root
  (STATUS: port-pending; Phase 2 subtree migration not yet complete).
- `packages/orchestrator/` — `@agentic/orchestrator`: skeleton; spawns Claude with all four
  MCP servers via `@anthropic-ai/sdk`.
- `docs/PATTERNS.md` — Alexander-style pattern language: MCP Composition Root, Tool-as-Adapter,
  Stub-First Composition Root, and generative sequence.
- Phase 5 cross-check (Feynman audit): 4 findings surfaced and immediately closed in `f52f6ce`.

#### Phase 6 — Dual-run harness and cutover staging (commits `c27b9d3`, `e7cdc85`)

- `packages/parity-runner/` — `@agentic/parity-runner`: dual-run parity harness;
  29 self-tests covering specific falsification conditions; 5 adversarial probes (P1–P5);
  Cortex, Codebase, and PRD runner implementations; CLI entry point.
- `scripts/parity-dual-run.sh` — orchestrator script for shell invocation.
- `.github/workflows/parity-dual-run.yml` — CI workflow: self-test job + live dual-run job.
- `parity-oracle/RUNBOOK.md §7` — env vars, 48-hour gate, adversarial probe documentation.
- `cutover-staging/Cortex/MIGRATED.md` — three explicit migration paths for Cortex users.
- `cutover-staging/automatised-pipeline/MIGRATED.md` — Rust binary user migration guide.
- `cutover-staging/zetetic-team-subagents/MIGRATED.md` — 97 genius patterns + 19 team agents.
- `cutover-staging/prd-spec-generator/MIGRATED.md` — 17 tools, zero breaking changes.
- `cutover-staging/cdeust.github.io/announcement.md` — public release announcement (staged).
- `docs/CUTOVER_RUNBOOK.md` — operator runbook: pre-flight, four-repo commit sequence,
  npm publish, GitHub archive commands, rollback procedure.

#### Phase 6 — MIT relicense and release tooling (this branch)

- Root `LICENSE` — MIT, Copyright (c) 2026 Clement Deust.
- Root `package.json` `license` field: `UNLICENSED` → `MIT`.
- All `packages/*/package.json` and `packages/mcp-servers/*/package.json` license fields: MIT.
- `README.md` license section updated from "Proprietary" to MIT with attribution note.
- `.github/workflows/release.yml` — on `v*` tag push: build, test, pack, attach tarballs to
  GitHub Release via `softprops/action-gh-release@v2`.
- `CHANGELOG.md` (this file).
- `docs/RELEASE_CHECKLIST.md` — operator-facing cutover day checklist.
- `docs/audits/FINAL_CROSS_AUDIT.md` — exhaustive cross-audit of all Phase 0–6 deliverables.
- `docs/PHASE_PLAN.md` Phase 6 deliverables updated.

### Changed

- `docs/PHASE_PLAN.md` updated throughout phases 0–6 to mark completed items, record
  resolved type-drift items, and update CI gate status table.
- `.github/workflows/ci.yml` incrementally hardened: `frozen-lockfile` (restored `05d6083`),
  `pnpm test` (restored `2821cbf`).

### Fixed

- Memory `remember` handler: `Memory↔MemoryInsertData` type drift (commit `3084a98`).
- Codebase-analysis: 5 tsc errors (items 7–11, commit `5c8566e`).
- Wiki `wiki-verify.ts:19`: stale `STALE_THRESHOLD` import (renamed to `SYMBOL_STALE_THRESHOLD`).
- Root `vitest.config.ts` ported from removed `defineWorkspace` to vitest v4 `defineConfig`
  with `test.projects` (commit `2821cbf`).
- Wiki `page-classifier.test.ts`: 2 fixture failures from user-rules gate (commit `2821cbf`).

---

[Unreleased]: https://github.com/cdeust/agentic-ai/compare/63a5097...HEAD
