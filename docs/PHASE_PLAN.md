# Phase Plan

Authoritative plan for the four-repo unification. Updated as phases complete.

---

## Phase 0 — Foundation (1 day, blocking)

**Mission:** Land everything that downstream worktrees depend on, BEFORE spawning parallel work. While Day 0 is in-flight, no other worktree starts.

### Deliverables
- [x] Private repo created (`cdeust/agentic-ai`)
- [x] `README.md`
- [x] `.gitignore`
- [x] `docs/WORKTREE_MISSION_TEMPLATE.md`
- [x] `docs/PHASE_PLAN.md` (this file)
- [x] `docs/MIGRATION_MANIFEST.md` — every artifact from every source repo, tagged (updated per inventory worktrees 2026-04-26)
- [x] `pnpm-workspace.yaml`
- [x] Root `package.json`
- [x] `tsconfig.base.json`
- [x] `scripts/spawn-worktree.sh` — creates worktree + pre-populated MISSION.md
- [x] `.github/workflows/ci.yml` — pnpm install + build + test + parity gate + manifest lint
- [x] First commit pushed to `origin/main`
- [x] 8 inventory + design worktrees executed in parallel (`port/inventory-*`, `port/migrate-prd-spec`, `port/core-types`, `port/parity-baseline`, `port/tooling-ci`, `port/plugin-manifest-design`)
- [x] 11 ADRs landed under `docs/ADR/` resolving open questions from the inventory worktrees
- [ ] `packages/core/` — domain types + ports + Zod schemas (designed in `port/core-types`; awaits merge)
- [ ] `packages/shared-contracts/` — cross-MCP-server schemas (designed in `port/core-types`; awaits merge)
- [ ] `parity-oracle/` — fixture corpus seeded (in `port/parity-baseline`; 22 inputs awaiting Phase-0-Day-1 baseline capture against live source repos)

### Genius gate at exit
- `architect` — package boundaries are correct, no leakage
- `liskov` + `panini` — type space is exhaustive, no public surface left undefined
- `noether` — schema migrations preserve invariants
- `coase` — package boundaries minimize cross-worktree coordination cost

---

## Phase 1 — Skeleton + CI (2 days)

**Mission:** Make the empty monorepo build, test, and lint cleanly. Single CI matrix; one tsconfig.

### Deliverables
- [x] Each `packages/<x>/` has its own `package.json` + `tsconfig.json` extending the base (5 of 8 expected packages exist; `prd-pipeline`, `reasoning`, `codebase` blocked on Phase 2/3 — see audits/FINAL_CROSS_AUDIT.md §1)
- [x] ESLint config (flat config, single root) — `eslint.config.js` at repo root
- [x] Vitest config (workspace mode) — `vitest.config.ts`, v4-compliant
- [x] Layer-import lint — `scripts/check-layer-imports.ts` (full transitive tracing, hard CI gate as of 2026-04-27)
- [x] `// source:` annotation pre-commit hook — `scripts/check-source-citations.sh` (hard CI gate as of 2026-04-27)
- [x] CI matrix: Node 20, 22; pnpm 10 — `.github/workflows/ci.yml`
- [x] Smoke test: `pnpm install && pnpm build && pnpm test` green on a fresh clone (build hard-gated 2026-04-27 per F-CRIT-001)

### Genius gate
- `liskov` — port interfaces in `packages/core/src/ports/`
- `lamport` — build-order dep graph (no cycles)

---

## Phase 2 — Move TS repos preserving git history (3 days)

**Mission:** Migrate `prd-spec-generator` and `zetetic-team-subagents` into the monorepo with full commit history.

### Deliverables
- [x] `git subtree add` (or `git filter-repo --to-subdirectory-filter`) for each repo — `migration/SCRIPT.sh` and `migration/ZETETIC_SCRIPT.sh` use `git filter-repo --to-subdirectory-filter` per ADR-0005
- [x] `prd-spec-generator/` → `packages/prd-pipeline/` (rename `@prd-gen/*` → `@agentic/prd-*`) — merged to main 2026-04-28 via PR #14 (commit `bc3c2fc`); 123 commits + 11 sub-package renames + Liskov F1/F2/F3/F4 closures applied post-merge
- [x] `zetetic-team-subagents/` → `packages/reasoning/` — landed on branch `feat/zetetic-migration` 2026-04-27; 77 commits rewritten + 308 files; all CI gates pass; rebased onto main 2026-04-28 post-prd-merge
- [x] Verify `git log --all --format=%H | wc -l` matches sum of source repos — rewritten ancestry depth check passes (prd: 123 commits, zetetic: 77 commits, both via `git rev-list <remote>/main --count` invariant in the migration scripts)
- [x] All prd-spec tests pass inside the monorepo — **2041 tests pass** (was 583 in source; new total includes 771 from agentic-ai memory + 1270 from prd-pipeline subpackages)

### Genius gate
- `feynman` — rederive 3 random formulas (consensus weighting, strategy scoring, validator penalty) from scratch in the new layout
- `popper` — adversarial parity tests vs the source repos

---

## Phase 3 — Wrap Rust (automatised-pipeline) as subprocess (3 days)

**Mission:** Keep the Rust binary, give it a TS adapter that implements `CodebasePort`.

### Deliverables
- [x] `packages/codebase-rust/` — relocate Rust source under cargo workspace — landed via PR #18 (commit `813c91e`); 17 749 LOC verbatim copy + cargo workspace + `rust-toolchain.toml` pinning to 1.94.0; CI matrix expanded to ubuntu+macos × node 20+22
- [x] `packages/codebase/src/adapters/rust-pipeline-adapter.ts` — subprocess JSON-RPC bridge — landed via PR #19 (commit `5da7b28`); 1 906 LOC across 10 files (NDJSON framing, serial queue per ADR-0002, process supervisor per ADR-0001, binary resolver, adapter); 60 new tests (genius gates dijkstra+lamport verified)
- [x] CI builds the Rust binary as part of the monorepo build — `pnpm build` invokes `cargo build --release` on `@agentic/codebase-rust`; verified ubuntu (with `ZSTD_SYS_USE_PKG_CONFIG=1` workaround for duplicate symbols) + macos
- [x] Parity test: `index_codebase` on a 100-file fixture — 6 live parity tests in `packages/codebase/__tests__/parity/` (5 it.todo gated on running binary; index_codebase parity verified)

### Genius gate
- `dijkstra` — stdio framing race-free, no deadlock under concurrent calls
- `lamport` — no global "now" assumption between TS host and Rust child

---

## Phase 4 — Cortex Python → TS port (parallel worktrees, ~7 days wall-clock)

**Mission:** Port every Cortex module to TS, parity-tested, dual-runnable.

### Worktree roster (one per row, all parallel after Day 0)

| Worktree branch | Source paths | TS target | Genius panel |
|---|---|---|---|
> **Updated 2026-04-26 from `port/inventory-cortex` findings**: source paths
> in the original draft did not match Cortex's actual layout. The roster
> below uses paths verified against `/Users/cdeust/Developments/Cortex/mcp_server/`
> in commit `5c80850` of `port/inventory-cortex`. Three new worktrees were
> added (wiki, workflow-graph, codebase-analysis, server-decision); the
> `import` worktree was narrowed; `methodology`, `consolidation`, and `hooks`
> source paths corrected.

### Worktree roster (12 parallel ports + 1 follow-up decision)

| Worktree branch | Source paths (verified) | TS target | Genius panel |
|---|---|---|---|
| `port/cortex-shared` | `mcp_server/shared/`, `mcp_server/__init__.py`, `mcp_server/__main__.py`, `mcp_server/tool_error_handler.py`, `mcp_server/observability/`, `mcp_server/validation/`, `mcp_server/errors/` | `packages/memory/src/shared/` + `packages/memory/src/index.ts` | liskov + panini + noether |
| `port/cortex-recall` | `mcp_server/handlers/recall.py`, `recall_hierarchical.py`, `mcp_server/core/multi_signal_fusion.py` | `packages/memory/src/recall/` | cochrane + feynman + pearl + liskov + lamport |
| `port/cortex-remember` | `mcp_server/handlers/remember.py`, `remember_global.py`, `anchor.py`, `forget.py`, `rate_memory.py`, `mcp_server/core/{write_gate,write_post_store,memory_ingest,predictive_coding_*,abstention_gate}*.py`, `mcp_server/infrastructure/{pg_store,sqlite_store,memory_store}*.py` | `packages/memory/src/remember/` | dijkstra + liskov + noether |
| `port/cortex-consolidation` | `mcp_server/handlers/consolidate.py`, `mcp_server/handlers/consolidation/`, `mcp_server/core/{decay_cycle,consolidation_engine,cascade*,two_stage_*,homeostatic_*,reconsolidation,replay*,sleep_compute,oscillatory_*,thermodynamics,microglial_pruning,neurogenesis}.py` (NOTE: `decay.py` is at `handlers/consolidation/decay.py`, not `mcp_server/decay.py`) | `packages/memory/src/consolidation/` | darwin + margulis + meadows + popper |
| `port/cortex-hooks` | `mcp_server/hooks/` — **9 files** (not 5): `session_start`, `auto_recall`, `post_tool_capture`, `agent_briefing`, `compaction_checkpoint`, `session_lifecycle`, `preemptive_context`, `pipeline_impact_bump`, `ingest_codebase_background` | `packages/memory/src/hooks/` | lamport + hamilton + dijkstra |
| `port/cortex-methodology` | NO `mcp_server/methodology/` or `mcp_server/profile/` directory — actual sources: `mcp_server/handlers/{methodology,detect_domain,explore_features,query_methodology,rebuild_profiles,update_profiles}.py`, `mcp_server/core/{cognitive_profile,methodology_engine,domain_detector,attribution_pipeline}*.py`, `mcp_server/shared/types_profiles.py` | `packages/memory/src/methodology/` | bateson + kahneman + feinstein |
| `port/cortex-graph-navigation` | `mcp_server/handlers/{navigate_memory,explore_features}.py`, `mcp_server/core/{graph,navigation,heat_propagation}*.py` | `packages/memory/src/graph/` | kekule + mandelbrot + euler |
| `port/cortex-narrative` | `mcp_server/handlers/narrative.py`, `mcp_server/core/{narrative_*,session_extractor}*.py` | `packages/memory/src/narrative/` | propp + bruner + eco |
| `port/cortex-automation` | NO `mcp_server/automation/` directory — actual sources: `mcp_server/handlers/{automate,prospective,trigger_engine}*.py`, `mcp_server/core/{rule_engine,trigger_matcher}*.py`, `mcp_server/handlers/sync_to_claude_md.py` | `packages/memory/src/automation/` | kay + boyd + simon |
| `port/cortex-import` | NO `mcp_server/import/` directory — actual sources: `mcp_server/handlers/{import_claude_code,import_chatgpt,import_gemini,import_cursor,import_claude_mem}*.py` (each is a single handler file, not a sub-package) | `packages/memory/src/import/` | champollion + ventris + rejewski |
| `port/cortex-wiki` (NEW) | `mcp_server/handlers/wiki_*.py` (21 files), `mcp_server/core/{wiki_*,concept_emerger,concept_vocabulary,claim_extractor,claim_resolver,enrichment}*.py` (15 files), `mcp_server/infrastructure/{pg_store_wiki,wiki_store}.py` (2 files) | `packages/memory/src/wiki/` | propp + ranganathan + ginzburg |
| `port/cortex-workflow-graph` (NEW) | `mcp_server/handlers/{workflow_graph,query_workflow_graph}.py`, `mcp_server/core/workflow_graph_*.py` (6 files), `mcp_server/infrastructure/workflow_graph_source*.py` (4 files) | `packages/memory/src/workflow-graph/` | kekule + lamport + thompson |
| `port/cortex-codebase-analysis` (NEW) | `mcp_server/handlers/{codebase_analyze,ingest_codebase*,ingest_prd,ingest_helpers}.py` (9 files), `mcp_server/core/{ast_*,codebase_*,schema_engine,schema_extraction}*.py`, `mcp_server/infrastructure/scanner*.py` | `packages/memory/src/codebase-analysis/` | champollion + kekule + euler |
| `port/cortex-server` (DECISION REQUIRED) | `mcp_server/server/` — 15 HTTP-server / dashboard files (3 668 LOC) | DEFER pending ADR-0011 | (none — defer) |

### Merge order (fixed; do NOT merge out of order)

The dependency graph from `port/inventory-cortex` field analysis (which modules
write to which schema tables, which modules read from which others' outputs):

1.  `port/cortex-shared`           — types + error handler + observability (every other worktree imports these)
2.  `port/cortex-remember`         — write path + persistence (foundation)
3.  `port/cortex-recall`           — read path (depends on remember's schema)
4.  `port/cortex-consolidation`    — operates on remember + recall outputs
5.  `port/cortex-codebase-analysis`— writes via remember; ingests external graphs
6.  `port/cortex-wiki`              — writes via remember; depends on codebase-analysis for symbol verification
7.  `port/cortex-graph-navigation` — operates on persisted graph
8.  `port/cortex-methodology`      — writes profile via remember
9.  `port/cortex-narrative`         — reads recall + methodology
10. `port/cortex-import`            — writes via remember; isolated
11. `port/cortex-workflow-graph`    — depends on session data + ingestion outputs
12. `port/cortex-automation`        — orchestrates all above
13. `port/cortex-hooks`             — last — wires the orchestrator into Claude Code lifecycle

After each merge: full parity-oracle suite must pass. Any regression blocks the next merge.

### Phase 4 → 5 cleanup (post-merge type drift)

After all 13 cortex-* worktrees were merged into main on 2026-04-26 (commits
`abb4bbc` through `1d61dab` + cleanup `5ede263`), CI surfaced known type
drift between sub-packages. The following is the EXPLICIT cleanup list
that Phase 5 must close before `pnpm build` and `pnpm test` are restored
to hard CI gates (currently `|| echo "::warning::"` per `.github/workflows/ci.yml`):

**Resolved (2026-04-26 cleanup commit):**

4. **Wiki internal duplicate-export** (`STALE_THRESHOLD` in both `staleness.ts` and `symbol-verify.ts`) — fixed in cleanup commit by renaming the symbol-verify constant to `SYMBOL_STALE_THRESHOLD`. (resolved 2026-04-26)
   - NOTE: `wiki/handlers/wiki-verify.ts:19` still imports the OLD name `STALE_THRESHOLD` — the import was not updated when the export was renamed. Opened as item (7) below.
5. **`pg` `verbatimModuleSyntax` `PoolClient` type-only import** — fixed in cleanup commit (`import { Pool, type PoolClient } from "pg"`). (resolved 2026-04-26)
6. **Top-level `src/index.ts` namespace re-exports** — fixed in cleanup commit by switching to `export * as <module>` form. Eliminated 50+ TS2308 collisions. (resolved 2026-04-26)

**Resolved (2026-04-27 `port/cortex-remember-types-cleanup`):**

1. **`remember/handlers/remember.ts:146`** — return type `{ stored: false; reason; novelty: Record<string, number>; importance }` does not satisfy the declared `Memory.novelty` shape. Fixed in commit `3084a98`. (resolved 2026-04-27)
2. **`remember/handlers/remember.ts:152` + `remember/memory-ingest.ts:236`** — `Memory` shape passed to `pg-store.insertMemory` missing required fields. Fixed in commit `3084a98`. (resolved 2026-04-27)

**Resolved (2026-04-27 `port/ci-restore-hard-gates`):**

3. **`pnpm-lock.yaml`** — regenerated against the unified dependency graph in commit on branch `port/ci-restore-hard-gates`. CI install step reverted to `--frozen-lockfile`. (resolved 2026-04-27)

**Resolved (2026-04-27 `port/codebase-analysis-types-cleanup`, commit `5c8566e`):**

7. **`wiki/handlers/wiki-verify.ts:19`** — updated import `STALE_THRESHOLD` →
   `SYMBOL_STALE_THRESHOLD` and both usage sites in the handler. (resolved 2026-04-27)

8. **`codebase-analysis/codebase-graph.ts:276-280`** — fixed Map iteration: `for (const [a, neighbors] of adj)`,
   adding `a` and iterating `neighbors` to populate the nodes set. (resolved 2026-04-27)

9. **`codebase-analysis/handlers/codebase-analyze-helpers.ts:48,53,54`** — added
   `import type { Dirent } from "node:fs"` and typed `entries` as `Dirent<string>[]`
   to unambiguously fix the `@types/node@25` `Dirent<NonSharedBuffer>` resolution. (resolved 2026-04-27)

10. **`codebase-analysis/index.ts:29`** — replaced `export * from "./ast-parser.js"` with
    `export { isAvailable, parseFileAst } from "./ast-parser.js"` to exclude the duplicate
    `nodeText` (already exported by `ast-extractors.js`). (resolved 2026-04-27)

11. **`codebase-analysis/scanner.ts:259`** — imported `ConversationRecord` type from
    `scanner-parse.js`; changed `_parseConversationFile`, `discoverConversations`, and
    `groupByProject` to use `ConversationRecord` instead of `Record<string, unknown>`.
    (resolved 2026-04-27)

**Resolved (2026-04-27 `port/test-config-cleanup`, commit `2821cbf`):**

12. **`vitest.config.ts` root — `defineWorkspace` removed in vitest v4**. Ported root
    `vitest.config.ts` from `defineWorkspace([...])` to `defineConfig({ test: { projects:
    [...] } })` per vitest v4 migration guide (vitest.dev/guide/projects). The
    `defineWorkspace` export was removed from `vitest/config` entirely; v4 exports only
    `defineConfig` and `defineProject`. (resolved 2026-04-27)

13. **`packages/core` — no test files** exits vitest with code 1 ("No test files found").
    Added `passWithNoTests: true` to `packages/core/vitest.config.ts`. The core package
    is a placeholder pending `port/core-types` merge; no tests expected yet. (resolved
    2026-04-27)

14. **`wiki/page-classifier.test.ts` — 2 test failures** (740 passing, 2 failing).
    Root cause: both failing fixtures relied on user rules (Gate 0, loaded from
    `~/.claude/methodology/wiki/_rules/*.md`) being present in the test environment.
    Without a `wikiRoot`, Gate 0 is skipped and the fixtures failed Gate 2 and Gate 3:
    - `admits ADR content by pattern`: title `# Use PostgreSQL for primary storage` is
      imperative (verb `use`); hard-negative gate rejected it before ADR_PATTERNS fired.
      Fix: changed title to `# PostgreSQL as primary storage` (non-imperative). Verified
      against `wiki_classifier.py` — both produce `"adr"`.
    - `admits convention via pattern`: 6-line fixture scored 3/8 positive signals (one
      below threshold 4). Fix: added a file-reference line (`mcp_server/__init__.py`,
      `wiki_classifier.py`) to trigger signal 8 (_FILE_OR_ENTITY_REF), raising score to
      5. Verified against `wiki_classifier.py` — both produce `"convention"`.
    Final: 742/742 tests pass. (resolved 2026-04-27)

**CI gate status after `port/test-config-cleanup` (2026-04-27):**

| Gate | Status | Justification |
|---|---|---|
| `pnpm install --frozen-lockfile` | **HARD** (restored) | Lockfile regenerated; no unresolved deps |
| `pnpm build` | **HARD** (restorable — items 7–11 resolved in `5c8566e`) | Zero tsc errors confirmed 2026-04-27 |
| `pnpm test` | **HARD** (restored) | Items 12–14 resolved in `2821cbf` |
| `pnpm lint` | soft (`\|\| true`) | No ESLint config wired (port/tooling-ci pending) |
| `pnpm parity` | soft (no-op echo) | port/parity-baseline pending |
| Plugin manifest lint | **HARD** (always was) | ADR-0010 |

Gates will be hardened individually as each blocking item is resolved. The blanket
"Phase-4 type drift" rationale has been retired; each remaining soft-fail now has a
specific tracking item number above.

### Open follow-up: `port/cortex-server` decision (ADR-0011)

The HTTP server / 3D graph visualisation dashboard (15 files, 3 668 LOC under
`mcp_server/server/`) is NOT in the merge order above. It is decided in
`docs/ADR/0011-cortex-http-server.md` whether to (a) defer to a post-cutover
phase, (b) discard with explicit justification, or (c) add as worktree #14.
Default per ADR-0011: **defer** to post-Phase-6 hardening.

---

## Phase 5 — MCP Server Composition Roots + Orchestrator Scaffold

**Mission:** Scaffold the four MCP server packages and the top-level orchestrator
that compose the merged Cortex memory subsystem into a runnable agent toolchain.

**Branch:** `port/phase5-mcp-servers` — landed 2026-04-27.

### Deliverables

#### Landed (live)

- [x] `packages/mcp-servers/memory/` — `@agentic/mcp-server-memory`
  - Exposes all **46 Cortex MCP tools** via stdio transport.
  - 10 topic files in `src/tools/`: recall, remember, methodology, consolidation,
    management, narrative, advanced, wiki, ingest, navigation.
  - Tool adapters are Phase-5 stubs: return stub JSON with `note:` field explaining
    what store adapter is pending.
  - Compiles clean (zero tsc errors); smoke test verified (see §Smoke test below).
  - Bin entry: `mcp-server-memory` → `dist/index.js`.
  - source: `inventory/MCP_TOOLS.md` — 46 tools, names + parameter names verified.

- [x] `docs/PATTERNS.md` — Alexander-style pattern language document.
  - PATTERN: MCP Composition Root (most load-bearing)
  - PATTERN: Tool-as-Adapter
  - PATTERN: Stub-First Composition Root
  - Generative sequence for adding a fifth MCP server.
  - Fifteen-properties audit of the memory server.

#### Landed (stubs — compile, do not run)

- [x] `packages/mcp-servers/codebase/` — `@agentic/mcp-server-codebase`
  - STATUS: port-pending. Depends on `@agentic/codebase` (Phase 3).
  - References ADR-0001 through ADR-0004.
  - Bin entry: `mcp-server-codebase` → `dist/index.js`.

- [x] `packages/mcp-servers/reasoning/` — `@agentic/mcp-server-reasoning`
  - STATUS: port-pending. Depends on `@agentic/reasoning` (Phase 2 zetetic migration).
  - References `port-inventory-zetetic` prompt inventory.
  - Bin entry: `mcp-server-reasoning` → `dist/index.js`.

- [x] `packages/mcp-servers/prd/` — `@agentic/mcp-server-prd`
  - STATUS: port-pending. Depends on `@agentic/prd-pipeline` (Phase 2 prd migration).
  - References ADR-0005, ADR-0006.
  - Bin entry: `mcp-server-prd` → `dist/index.js`.

- [x] `packages/orchestrator/` — `@agentic/orchestrator`
  - Skeleton: spawns Claude with all four MCP servers via `@anthropic-ai/sdk`.
  - Exports `defaultServerConfigs()` and `runOrchestrator(config)`.
  - Real conversation logic is Phase 6.

#### pnpm-workspace.yaml

Already included `"packages/mcp-servers/*"` from Phase 0; no change needed.

### Smoke test (memory server)

After `pnpm install && pnpm -F @agentic/mcp-server-memory build`:

```
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | node packages/mcp-servers/memory/dist/index.js
```

Expected: JSON-RPC response with `"tools": [...]` containing ≥ 10 tool entries.
Server startup message appears on stderr:
`[mcp-server-memory] running on stdio, 46 tools registered`

### Genius gate
- `alexander` — pattern language is coherent and self-consistent
- `liskov` — tool adapter stubs satisfy the MCP tool contract (returntype shape)
- `dijkstra` — stdio transport: no writes to stdout in any tool adapter path

---

## Phase 6 — Cutover, archive old repos (4 days)

**Mission:** Switch to the unified install path; archive the four source repos.

### Deliverables

#### Landed (2026-04-27, `port/phase6-dual-run-harness`)

- [x] `packages/parity-runner/` — dual-run parity harness package
  - `src/index.ts` — public API: `runParityCorpus({ source, repoRoot, ... }): ParityReport`
  - `src/types.ts` — shared types: `ParityReport`, `SourceReport`, `Divergence`, `FixtureResult`
  - `src/diff.ts` — JSON-diff with MASKING.md sentinel support (nondeterministic + bounded)
  - `src/report.ts` — `buildParityReport` / `buildSourceReport` / `printReport`
  - `src/adversarial.ts` — 5 adversarial probes per fixture (P1–P5 mutation catalogue)
  - `src/runners/cortex.ts` — Cortex Python vs TS diff; CORTEX_PYTHON_BIN optional
  - `src/runners/codebase.ts` — Rust binary vs TS diff; AI_ARCH_BIN optional (stub-runner fallback)
  - `src/runners/prd.ts` — prd-spec-generator vs TS diff; PRD_GEN_BIN optional (stub-runner fallback)
  - `src/cli.ts` — CLI entry point for shell invocation
  - `src/__tests__/self-test.test.ts` — 29 self-tests targeting specific falsification conditions
    (NOTE: PHASE_PLAN said 23 — actual count is 29; corrected 2026-04-27 per cross-audit)
- [x] `scripts/parity-dual-run.sh` — orchestrator script; discovers env vars; exits 0 on all-match
- [x] `.github/workflows/parity-dual-run.yml` — CI workflow (self-test job + live-dual-run job)
- [x] `parity-oracle/RUNBOOK.md` §7 — env vars, invocation, 48-hour gate, adversarial probe docs
- [x] `docs/PHASE_PLAN.md` Phase 6 deliverables updated

#### Landed (2026-04-27, `port/phase6-source-redirects`)

- [x] `cutover-staging/Cortex/MIGRATED.md` — staged; addresses MCP-over-stdio users, HTTP
  dashboard users (stay until v0.4.x per ADR-0011), and hook users. Three explicit paths.
- [x] `cutover-staging/automatised-pipeline/MIGRATED.md` — staged; addresses Rust binary
  users. Breaking change for partial `(run_id, finding_id, output_dir)` triples per ADR-0004.
  Cites ADR-0001, ADR-0002, ADR-0003, ADR-0004.
- [x] `cutover-staging/zetetic-team-subagents/MIGRATED.md` — staged; 97 genius patterns +
  19 team agents migrated as `.md` files, no behaviour change.
- [x] `cutover-staging/prd-spec-generator/MIGRATED.md` — staged; 17 tools preserved,
  zero breaking changes for MCP users. Cites ADR-0005, ADR-0006.
- [x] `cutover-staging/cdeust.github.io/announcement.md` — public release announcement
  staged; three Model Reader sections (curious user, existing user, contributor).
- [x] `docs/CUTOVER_RUNBOOK.md` — operator runbook: pre-flight checks, four-repo commit
  sequence, npm publish sequence, GitHub archive commands, rollback procedure.

#### Landed (2026-04-27, `port/phase6-license-release`)

- [x] Root `LICENSE` — MIT, Copyright (c) 2026 Clement Deust
- [x] Root `package.json` `license` field: `UNLICENSED` → `MIT`
- [x] All `packages/*/package.json` and `packages/mcp-servers/*/package.json` license fields: MIT
- [x] `README.md` license section updated from "Proprietary" to MIT
- [x] `.github/workflows/release.yml` — on `v*` tag push: build, test, pack, GitHub Release
- [x] `CHANGELOG.md` — Keep-a-Changelog format; `[Unreleased]` entry covering all 71 commits
- [x] `docs/RELEASE_CHECKLIST.md` — operator-facing cutover day checklist
- [x] `docs/audits/FINAL_CROSS_AUDIT.md` — exhaustive cross-audit Phases 0–6
- [x] `docs/PHASE_PLAN.md` Phase 6 deliverables updated (this edit)

#### Pending (pre-cutover)

- [ ] 48-hour dual-run with zero divergence between source-repo MCPs and monorepo MCPs
  - **Falsification condition:** `exit_code === 1` in ANY run over 48 hours falsifies the claim.
  - **Gate:** `exit_code === 0` for 48 consecutive hours with all three live binaries available.
- [ ] TODO: commit MIGRATED.md to each source repo (cdeust/Cortex, cdeust/automatised-pipeline,
  cdeust/zetetic-team-subagents, cdeust/prd-spec-generator) per runbook §2.1–§2.4
- [ ] Old repos archived (not deleted) on GitHub per runbook §3
- [ ] CI build gate hardened: remove `|| echo "::warning::"` from `.github/workflows/ci.yml`
  Build step (PHASE_PLAN says HARD but ci.yml is still soft — F-CRIT-001 in cross-audit)
- [ ] CI lint gate hardened: remove `|| true` from Lint step; eslint.config.js already exists
  (ci.yml comment is stale — F-HIGH-002 in cross-audit)
- [ ] `agentic-ai` flipped from private to public per runbook §2.6

### Genius gate
- `popper` — severity tests (could the new system fail in a way the old one wouldn't?)
- `borges` — exhaustive-space audit (every public symbol from every old repo accounted for)
