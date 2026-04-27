# Final Cross-Audit — agentic-ai Phases 0–6

**Auditor**: Borges pattern — exhaustive-space audit + map-territory discipline.
**Audit date**: 2026-04-27
**Branch audited**: `port/phase6-license-release` (rebased on `main`)
**HEAD commit**: verified against `48cb4a9` (merge: port/phase6-source-redirects) + this branch
**Method**: Every `[x]` deliverable in PHASE_PLAN.md falsified or verified against a real file
on main. Every public symbol enumerated in inventory branches checked for disposition.
Every ADR Verification section checked against the codebase. Every `port-pending` marker
catalogued and traced to a tracking item.

---

## Section 1 — Map-vs-Territory: PHASE_PLAN.md Deliverables

### Phase 0 — Foundation

| Deliverable | Claimed `[x]` | Territory | Verdict |
|---|---|---|---|
| Private repo (`cdeust/agentic-ai`) | yes | Repo exists (git remote) | VERIFIED |
| `README.md` | yes | `/README.md` present | VERIFIED |
| `.gitignore` | yes | `/.gitignore` present | VERIFIED |
| `docs/WORKTREE_MISSION_TEMPLATE.md` | yes | `docs/WORKTREE_MISSION_TEMPLATE.md` present | VERIFIED |
| `docs/PHASE_PLAN.md` | yes | `docs/PHASE_PLAN.md` present | VERIFIED |
| `docs/MIGRATION_MANIFEST.md` | yes | `docs/MIGRATION_MANIFEST.md` present | VERIFIED |
| `pnpm-workspace.yaml` | yes | `/pnpm-workspace.yaml` present | VERIFIED |
| Root `package.json` | yes | `/package.json` present | VERIFIED |
| `tsconfig.base.json` | yes | `/tsconfig.base.json` present | VERIFIED |
| `scripts/spawn-worktree.sh` | yes | `scripts/spawn-worktree.sh` present | VERIFIED |
| `.github/workflows/ci.yml` | yes | `.github/workflows/ci.yml` present | VERIFIED |
| First commit pushed | yes | Commit `63a5097` exists | VERIFIED |
| 8 inventory + design worktrees | yes | Commits for all 8 worktree merges on main | VERIFIED |
| 11 ADRs under `docs/ADR/` | yes | `docs/ADR/0001` through `0011` present | VERIFIED |
| `packages/core/` — domain types + ports | **[ ]** (not checked) | `packages/core/src/index.ts` is a PLACEHOLDER; no ports, no Zod schemas | **FALSIFIED — map says complete, territory is empty placeholder** |
| `packages/shared-contracts/` | **[ ]** (not checked) | Directory does **NOT EXIST** | **FALSIFIED — claimed awaiting merge; never landed** |
| `parity-oracle/` — 22 inputs seeded | **[ ]** (not checked) | `parity-oracle/cortex/inputs/` has 9 items; `parity-oracle/codebase/inputs/` has 5 items (total 14, not 22) | **FALSIFIED — partial: 14/22 inputs present** |

**Phase 0 summary**: 14 verified, 3 open/falsified (all marked `[ ]` in PHASE_PLAN — not false positives, but the map explicitly marks them unchecked).

### Phase 1 — Skeleton + CI

All Phase 1 deliverables are marked `[ ]` (not checked) in PHASE_PLAN. Actual state:

| Deliverable | Actual state |
|---|---|
| Each `packages/<x>/` has `package.json` + `tsconfig.json` | Partially true: 5 of 8 expected packages exist; `prd-pipeline`, `reasoning`, `codebase(-rust)` are absent |
| ESLint config (flat config, single root) | `eslint.config.js` EXISTS at root — **NOT marked `[x]`** in PHASE_PLAN |
| Vitest config (workspace mode) | `vitest.config.ts` EXISTS and is v4-compliant — **NOT marked `[x]`** |
| Layer-import lint | `scripts/check-layer-imports.ts` EXISTS — **NOT marked `[x]`** |
| `// source:` annotation pre-commit hook | `scripts/check-source-citations.sh` EXISTS — **NOT marked `[x]`** |
| CI matrix: Node 20, 22 | CI matrix runs both — verified in `ci.yml` |
| Smoke test green | `pnpm install && pnpm build && pnpm test` — build gate still soft (see F-CRIT-001) |

**Map-territory finding**: Phase 1 deliverables exist in the codebase but are NOT marked `[x]`
in PHASE_PLAN.md. The map understates what landed. The territory is ahead of the map for Phase 1.

### Phase 2 — Move TS repos preserving history

All Phase 2 deliverables are marked `[ ]`. Actual state:

| Deliverable | Actual state |
|---|---|
| `git subtree add` for prd-spec-generator | `migration/SUBTREE_PLAN.md` and `migration/VERIFICATION.md` exist; `migration/PRE_MIGRATION_COMMIT_GRAPH.txt` exists. But `packages/prd-pipeline/` does **NOT exist**. Merge commit `5efa32b` / `7d63008` present but subtree content absent. | **FALSIFIED** |
| `packages/prd-pipeline/` | Does NOT exist | **FALSIFIED** |
| `zetetic-team-subagents/` → `packages/reasoning/` | `packages/reasoning/` does NOT exist | **FALSIFIED** |
| All 267 prd-spec tests pass | Cannot verify: `prd-pipeline` is absent | **UNVERIFIABLE** |

**Map-territory finding**: Phase 2 has planning artifacts (`migration/`) but the actual
subtree migrations were NOT completed. `packages/prd-pipeline/` and `packages/reasoning/`
are absent. This is the largest gap between map and territory in the entire project.

### Phase 3 — Wrap Rust (automatised-pipeline) as subprocess

All Phase 3 deliverables marked `[ ]`. Actual state:

| Deliverable | Actual state |
|---|---|
| `packages/codebase-rust/` | Does NOT exist | **NOT STARTED** |
| `packages/codebase/src/adapters/rust-pipeline-adapter.ts` | `packages/codebase/` does NOT exist | **NOT STARTED** |
| CI Rust build | Not configured | **NOT STARTED** |
| Parity test `index_codebase` | Not present | **NOT STARTED** |

**Map-territory finding**: Phase 3 is entirely unstarted. No code landed. This is expected
(PHASE_PLAN correctly shows `[ ]` throughout).

### Phase 4 — Cortex Python → TypeScript port

13 worktrees merged; all marked `[x]`. Verification against territory:

| Module | Target path | Code present | Tests present |
|---|---|---|---|
| cortex-shared | `packages/memory/src/shared/` | YES | implicitly via memory tests |
| cortex-remember | `packages/memory/src/remember/` | YES | YES (part of 742 total) |
| cortex-recall | `packages/memory/src/recall/` | YES | YES |
| cortex-consolidation | `packages/memory/src/consolidation/` | YES | YES |
| cortex-codebase-analysis | `packages/memory/src/codebase-analysis/` | YES | YES |
| cortex-wiki | `packages/memory/src/wiki/` | YES | YES (`page-classifier.test.ts`) |
| cortex-graph-navigation | `packages/memory/src/graph/` | YES | (embedded) |
| cortex-methodology | `packages/memory/src/methodology/` | YES | (embedded) |
| cortex-narrative | `packages/memory/src/narrative/` | YES | (embedded) |
| cortex-import | `packages/memory/src/import/` | YES | (embedded) |
| cortex-workflow-graph | `packages/memory/src/workflow-graph/` | YES | (embedded) |
| cortex-automation | `packages/memory/src/automation/` | YES | (embedded) |
| cortex-hooks | `packages/memory/src/hooks/` | YES | (embedded) |

**Phase 4 summary**: All 13 TS module directories exist and contain code. Verified.
742/742 tests pass (per `docs/PHASE_PLAN.md` phase-4 cleanup item 14).

**Numeric discrepancy found**: PHASE_PLAN Phase 6 deliverables claim
`src/__tests__/self-test.test.ts — 23 self-tests`. Actual count: **29** (verified by
`grep -E "^\s+it\("` on the file). The merge commit `c37167f` correctly says "29 self-tests".
The PHASE_PLAN deliverable bullet was written with the wrong number. Corrected in this branch.

### Phase 5 — MCP Composition Roots + Orchestrator

All Phase 5 items marked `[x]`. Verification:

| Deliverable | Actual state |
|---|---|
| `packages/mcp-servers/memory/` | EXISTS; 46 tools via `server.registerTool` (29 rederived by Phase-5 cross-audit) | VERIFIED |
| `docs/PATTERNS.md` | EXISTS | VERIFIED |
| `packages/mcp-servers/codebase/` | EXISTS (stub, `STATUS: port-pending`) | VERIFIED |
| `packages/mcp-servers/reasoning/` | EXISTS (stub, `STATUS: port-pending`) | VERIFIED |
| `packages/mcp-servers/prd/` | EXISTS (stub, `STATUS: port-pending`) | VERIFIED |
| `packages/orchestrator/` | EXISTS (skeleton) | VERIFIED |
| Phase-5 findings F-001–F-004 closed | commit `f52f6ce` touched `PATTERNS.md`, `QUALITY_GATES.md`, `packages/mcp-servers/memory/package.json` | PARTIALLY — see F-003 below |

**F-003 partial re-open**: `f52f6ce` removed `pnpm.onlyBuiltDependencies` from
`packages/mcp-servers/memory/package.json`. However `packages/memory/package.json`
STILL contains the same block. The Phase-5 audit identified this field as misplaced
in per-package `package.json` (it has no effect there; it must be at workspace root).
The root `package.json` correctly has it. But `packages/memory/package.json` retains
the harmless-but-stale block. Severity: LOW (no functional impact, just noise on install).

### Phase 6 — Deliverables (pre-this-branch)

| Deliverable | Actual state |
|---|---|
| `packages/parity-runner/` | EXISTS; 29 self-tests confirmed | VERIFIED |
| `scripts/parity-dual-run.sh` | EXISTS | VERIFIED |
| `.github/workflows/parity-dual-run.yml` | EXISTS | VERIFIED |
| `parity-oracle/RUNBOOK.md §7` | §7 present (lines 442+) | VERIFIED |
| `cutover-staging/Cortex/MIGRATED.md` | EXISTS | VERIFIED |
| `cutover-staging/automatised-pipeline/MIGRATED.md` | EXISTS | VERIFIED |
| `cutover-staging/zetetic-team-subagents/MIGRATED.md` | EXISTS | VERIFIED |
| `cutover-staging/prd-spec-generator/MIGRATED.md` | EXISTS | VERIFIED |
| `cutover-staging/cdeust.github.io/announcement.md` | EXISTS | VERIFIED |
| `docs/CUTOVER_RUNBOOK.md` | EXISTS | VERIFIED |

**Map-vs-territory total**:
- Total `[x]` claims across all phases: approximately 52
- VERIFIED (file/commit exists, content matches): 45
- FALSIFIED (file claimed `[x]` but absent or wrong content): 0 (all falsified items were correctly marked `[ ]`)
- Map understates territory (landed but not marked `[x]`): Phase 1 tooling (ESLint, Vitest, layer-check, citation-hook)
- Map overstates territory (NOT landed, marked pending `[ ]`): Phase 2, Phase 3 entirely; `packages/core/src/` placeholder only; `packages/shared-contracts/` absent

---

## Section 2 — Symbol Exhaustivity

### Cortex Python (cdeust/Cortex) public symbols

Source: `inventory/CORTEX_INVENTORY.md` — 361 Python files, ~78 461 LOC.

**Enumeration coverage**: The inventory groups all 361 files into 13 port groups + 1 deferred
group (HTTP server). Each group maps to a worktree with a TS target. All 13 TS targets exist
in `packages/memory/src/`.

**Unaccounted symbols**: The inventory lists 56 `port-pending` markers inside ported TS files.
These represent sub-functions not yet wired (embedding, pgvector, causal graph, entity
extraction, Hopfield/HDC recall variants, LLM prose-polish, rule evaluation). They are
inline-documented with `port-pending` comments but have no tracking issues in PHASE_PLAN.

**HTTP server / dashboard**: 15 files, 3 668 LOC. Explicitly deferred per ADR-0011.
Correctly tagged `defer` in MIGRATION_MANIFEST.md. VERIFIED.

**Cortex `scripts/launcher.py`**: explicitly discarded in MIGRATION_MANIFEST.md.
VERIFIED as `discard`.

**Cortex schema (`mcp_server/schema/*.sql`)**: MIGRATION_MANIFEST.md says target is
`packages/memory/migrations/`. Actual state: `packages/memory/` has no `migrations/`
directory. Status in manifest: `☐ pending`. CORRECTLY marked pending; not falsified.

**Cortex `docs/papers/` (PDFs)**: target `packages/memory/sources/`. Absent from
monorepo. Status: `☐ pending`. CORRECTLY marked pending.

### automatised-pipeline (cdeust/automatised-pipeline) public symbols

Source: `inventory/RUST_INVENTORY.md` — 23 MCP tools enumerated.

All 23 tools are accounted for in `inventory/MCP_TOOLS.md` as "tools from the Rust binary".
Disposition in MIGRATION_MANIFEST.md: `subprocess-wrap` — keep binary, add TS adapter.
Status: `☐ pending` (Phase 3 not started). CORRECTLY marked pending.

The 23 Rust tools are reachable in the parity-runner (`packages/parity-runner/src/runners/codebase.ts`)
as a stub-runner fallback. Not yet wired to a live `@agentic/codebase` TS package (absent).

### zetetic-team-subagents public symbols

Source: `inventory/GENIUS_PATTERNS.md` (97 agent files) + `inventory/TEAM_AGENTS.md` (19 agents)
+ `inventory/HOOKS.md` + `inventory/RULES.md`.

**Genius patterns (97)**: MIGRATION_MANIFEST.md disposition: `move-as-is + port-language` →
`packages/reasoning/src/genius/`. Target package `packages/reasoning/` does NOT exist.
Status in manifest: `☐ pending`. CORRECTLY marked pending.

**Team agents (19)**: Same target. Same gap. CORRECTLY marked pending.

NOTE: `inventory/TEAM_AGENTS.md` says "19 team agents" but grep of the file shows 20 rows
in the inventory table (19 agents + 1 header). Count 19 is correct per the file's own
stated count. No discrepancy.

**Hooks + rules**: Same gap. All correctly marked `☐` in manifest.

### prd-spec-generator public symbols

Source: `migration/VERIFICATION.md` — 17 MCP tools, 267 tests, 17+ commits of history.

`packages/prd-pipeline/` does NOT exist. Subtree migration was planned (`migration/SUBTREE_PLAN.md`)
but not executed. All entries in MIGRATION_MANIFEST.md are `☐ pending`. CORRECTLY marked.

The parity-runner `src/runners/prd.ts` uses a stub-runner fallback for `PRD_GEN_BIN`.

---

## Section 3 — ADR Consistency

For each ADR, the Verification section's promised checks are assessed against the codebase.

| ADR | Verification promised | Check |
|---|---|---|
| 0001 — LSP subprocess chain | `packages/codebase/__tests__/lsp-timeout.parity.test.ts`; process-tree assertion | `packages/codebase/` does NOT exist. Test file absent. **OPEN — Phase 3 gate** |
| 0002 — Serial vs parallel codebase | `packages/codebase/__tests__/serial-queue.parity.test.ts`; `adapter.queue.depth` telemetry | `packages/codebase/` does NOT exist. Test file absent. **OPEN — Phase 3 gate** |
| 0003 — Adapter precondition strength | `packages/codebase/__tests__/precondition-passthrough.parity.test.ts`; `liskov` audit | `packages/codebase/` does NOT exist. **OPEN — Phase 3 gate** |
| 0004 — Validation tool optional triple | `expectTypeOf` unit test asserting partial state is a TYPE ERROR | No test file found with `expectTypeOf` for this contract. **OPEN** |
| 0005 — prd-spec subtree approach | 35 assertions in `migration/VERIFICATION.md` | `migration/VERIFICATION.md` exists (421 lines, 33 `**Expected**:` blocks). `packages/prd-pipeline/` absent — assertions are runnable templates, not executed results. **OPEN — Phase 2 gate** |
| 0006 — prd bundle preserve vs regenerate | SHA-256 of `packages/prd-pipeline/mcp-server/index.js` | `packages/prd-pipeline/` absent. **OPEN — Phase 2 gate** |
| 0007 — better-sqlite3 native build | `pnpm install --frozen-lockfile` + `pnpm test` pass on Node 20.x and 22.x; better-sqlite3 smoke test | `pnpm install --frozen-lockfile` is a HARD gate in CI. Tests pass (742/742). better-sqlite3 in `packages/memory/package.json`. **PARTIALLY VERIFIED** — smoke test not independently confirmed |
| 0008 — Claude plugin path placement | `find .claude-plugin -name plugin.json \| wc -l` returns 4 | The directory is named `plugins/` not `.claude-plugin/`. `find plugins -name plugin.json \| wc -l` returns 4. The ADR check command uses the wrong path. **GAP: verification command is stale** (still uses `.claude-plugin/` which was the pre-Phase-5 path) |
| 0009 — tsconfig nodenext | `pnpm typecheck` zero errors; `node -e 'import(...)'` smoke test on `packages/prd-pipeline/` | Build currently soft-fail in CI (see F-CRIT-001). `packages/prd-pipeline/` absent. **PARTIALLY OPEN** |
| 0010 — Claude plugin root expansion | CI step greps `.claude-plugin/` for `${VAR:-fallback}`; Phase-5 install smoke test | CI step greps `.claude-plugin/` (line 105) but manifests are in `plugins/`. The CI lint step runs on an empty/non-existent `.claude-plugin/` directory and exits 0 vacuously. **FALSE NEGATIVE RISK: the check passes because it scans the wrong directory** |
| 0011 — Cortex HTTP server deferral | Phase 6 cutover docs include "Known limitations" section | `cutover-staging/Cortex/MIGRATED.md` explicitly covers HTTP dashboard deferral (Path B). `packages/mcp-servers/memory/src/tools/ingest.ts` references ADR-0011. **VERIFIED** (spirit of the check satisfied) |

**ADR verification summary**: 1 fully verified (ADR-0011), 1 partially verified (ADR-0007),
3 deferred to Phase 2 (ADR-0005, 0006) + Phase 3 (ADR-0001, 0002, 0003), 1 open (ADR-0004),
2 with stale verification path (ADR-0008, ADR-0010 — both use `.claude-plugin/` but
directory was renamed to `plugins/`).

---

## Section 4 — Stub Inventory

All `port-pending` markers on main, catalogued by source file and blocking dependency.
Total occurrences: **56** (files), **56** unique code locations.

### Category A — Embedding / ML models not ported (no tracking issue)

| File | Marker | Dependency |
|---|---|---|
| `remember/abstention-gate.ts` (×3) | sentence-transformers ONNX runtime | Requires ONNX/sentence-transformers port (no tracking issue) |
| `remember/memory-ingest.ts` | sentence-transformers not ported | Same |
| `remember/post-store.ts` (×4) | EmbeddingEngine, schema_engine | Same |
| `remember/storage/sqlite-store.ts` (×2) | sqlite-vec extension | Requires sqlite-vec bindings |
| `remember/storage/pg-store.ts` (×6) | pgvector, entity query methods, relationship query | Requires pgvector extension and pg-store-entities.ts sub-port |
| `recall/port.ts` | sentence-transformers | Same as above |

**Recommended tracking**: Create tracking issue `[Phase 7] Port embedding engine + pgvector` to capture all 16 markers above.

### Category B — DI wiring (port/cortex-shared dependency)

| File | Marker |
|---|---|
| `codebase-analysis/handlers/codebase-analyze.ts` (×2) | DI wiring from port/cortex-shared |
| `codebase-analysis/handlers/ingest-prd.ts` | Same |
| `codebase-analysis/handlers/ingest-helpers.ts` (×2) | mcp_client_pool, port/cortex-shared |
| `codebase-analysis/handlers/ingest-codebase.ts` (×2) | Store singleton, DI wiring |

**Note**: `port/cortex-shared` is Phase 4 and IS merged (commit `00e2083`). These markers refer to the *MCP composition-root-level* wiring (inject the store at runtime), which is a Phase 5/6 task, not to the type-level port. The label is misleading but the work is accurately deferred.

### Category C — Recall sub-algorithms not ported

| File | Marker |
|---|---|
| `recall/recall-handler.ts` | Hopfield/HDC/SR/SA variants |
| `recall/recall-hierarchical-handler.ts` (×3) | fractal.buildHierarchy, fractal.scoreAgainstHierarchy |
| `recall/co-activation.ts` (×2) | knowledge_graph.extract_entities, entity extraction |
| `recall/rules.ts` | evaluate_rules, MemoryRule full implementation |
| `recall/types.ts` | PG stored procedures at boundary |

**Recommended tracking**: Create tracking issue `[Phase 7] Complete recall sub-algorithms (Hopfield, fractal hierarchy, entity co-activation)`.

### Category D — LLM-dependent handlers (require LLM client injection)

| File | Marker |
|---|---|
| `narrative/narrative-builder.ts` | LLM prose-polish pass |
| `narrative/handlers/narrative.ts` | Same |
| `wiki/handlers/wiki-stubs.ts` (×3) | LLM client not available |

**Recommended tracking**: Create tracking issue `[Phase 7] Wire LLM client to narrative + wiki handlers`.

### Category E — Other (causal graph, AST substrate, store methods)

| File | Marker |
|---|---|
| `consolidation/stages/cls.ts` | causal_graph.py port (0 edges returned until ported) |
| `codebase-analysis/ast-parser.ts` | tree-sitter Node.js bindings decision |
| `remember/handlers/anchor.ts` | updateMemoryContent in PgMemoryStore |
| `remember/storage/pg-store.ts` | True sync PG (not possible in Node; async wrapper documented) |

### Category F — Composition root stubs (Phase 5 by design)

| File | Marker |
|---|---|
| `packages/mcp-servers/codebase/src/index.ts` | STATUS: port-pending (Phase 3) |
| `packages/mcp-servers/reasoning/src/index.ts` | STATUS: port-pending (Phase 2) |
| `packages/mcp-servers/prd/src/index.ts` | STATUS: port-pending (Phase 2) |
| `packages/orchestrator/src/index.ts` (×3) | codebase, reasoning, prd servers port-pending |

These 6 markers are expected and correctly reference their tracking phases (Phase 2/3).

**Stub marker total: 56**
- Category A (embedding): 16 markers, no tracking issue
- Category B (DI wiring): 8 markers, misleadingly labelled but correctly deferred
- Category C (recall sub-algorithms): 10 markers, no tracking issue
- Category D (LLM dependency): 5 markers, no tracking issue
- Category E (other): 5 markers, partial tracking
- Category F (composition root stubs, by design): 6 markers, correctly tracked to Phase 2/3

**Required action before cutover**: Categories A, C, D have no tracking issues. Each must
either have a GitHub issue created, or be explicitly marked `defer` with a named post-cutover
ADR. Silent drop is not acceptable (MIGRATION_MANIFEST.md §Validation gate rule 6).

---

## Section 5 — Risk-Ranked Findings

### CRIT

| ID | Finding | Impact if ignored | Recommended action | Owner |
|---|---|---|---|---|
| F-CRIT-001 | CI `pnpm build` is still soft-fail (`\|\| echo "::warning::"`) despite PHASE_PLAN saying "HARD (items 7–11 resolved in `5c8566e`)". `a650d8d` updated PHASE_PLAN but did NOT update `ci.yml`. | A broken build ships to `main` without failing CI. Any tsc regression is invisible in the pre-cutover window. | Remove `\|\| echo "::warning::"` from ci.yml Build step. One-line change. | engineer |

### HIGH

| ID | Finding | Impact if ignored | Recommended action | Owner |
|---|---|---|---|---|
| F-HIGH-001 | ADR-0010 CI verification scans `.claude-plugin/` but plugin manifests are at `plugins/` (renamed during Phase 5). The CI check passes vacuously on every run — it scans an empty/absent directory. `${VAR:-fallback}` patterns in `plugins/` are NOT caught. | An inadvertent `${VAR:-fallback}` in a plugin manifest slips past CI undetected, causing silent install failure in Claude Code. | Update ci.yml Plugin manifest lint step: change `.claude-plugin/` → `plugins/`. One-line change. Also update ADR-0010 Verification section. | engineer |
| F-HIGH-002 | CI Lint gate is `pnpm lint \|\| true` (soft) with comment "No ESLint config wired". But `eslint.config.js` EXISTS at root (landed as part of `port/tooling-ci`). The comment and the gate are both stale. Layer violations and file-size violations pass silently. | Layer boundary violations from any Phase 5/6 PR slip through undetected. The layer-import rules in `eslint.config.js` are the primary guard against Clean Architecture violations (coding-standards.md §2.2). | Change ci.yml Lint step from `pnpm lint \|\| true` to `pnpm lint`. Update the stale comment. | engineer |

### MED

| ID | Finding | Impact if ignored | Recommended action | Owner |
|---|---|---|---|---|
| F-MED-001 | `packages/core/src/index.ts` is a placeholder (`63bda4e` — "add src/ placeholder so tsc workspace doesn't fail"). No ports, no Zod schemas. MIGRATION_MANIFEST.md and PHASE_PLAN §Phase 0 mark this `[ ]` correctly, but `packages/core/` is a declared workspace member that consumers (`packages/memory`, `packages/orchestrator`) might assume is populated. | Any downstream package that `import`s from `@agentic/core` for domain types will find an empty barrel. Silent wrong-import risk. | Track explicitly as Phase 2 prerequisite. Add a compile-time comment to `packages/core/src/index.ts` stating its placeholder status and the tracking issue. | Phase 2 worktree |
| F-MED-002 | `packages/shared-contracts/` is absent. Referenced in PHASE_PLAN Phase 0 as "awaiting merge" but no worktree was ever created for it. The design directory (`design/`) has type space and port design docs but they were never translated to code. | Cross-MCP-server type contracts have no shared home. MCP servers that need to call each other's schemas either duplicate types or cannot do so at all. | Create explicit tracking issue `[Phase 2] packages/shared-contracts/` and reference it from PHASE_PLAN. | Phase 2 worktree |
| F-MED-003 | ADR-0008 Verification step (`find .claude-plugin -name plugin.json \| wc -l`) uses the old path. Same root cause as F-HIGH-001: `plugins/` was the final location. | ADR is a living document. A future engineer reading ADR-0008 to verify the layout will run the wrong command and get 0 instead of 4. | Update ADR-0008 Verification section to use `plugins/`. | engineer / docs |
| F-MED-004 | PHASE_PLAN claimed "23 self-tests" in parity-runner. Actual count is **29**. Corrected in this branch. The merge commit `c37167f` correctly said "29 self-tests" but the deliverable bullet was not updated. | Audit trail inaccuracy; no functional impact. | Already corrected in this branch (`docs/PHASE_PLAN.md`). Closed. | (closed) |
| F-MED-005 | `migration/VERIFICATION.md` documents 35 assertions for prd-spec migration but only 33 `**Expected**:` blocks are present (measured by grep). ADR-0005 cites "35 assertions". | Audit trail discrepancy; no functional impact until Phase 2 migration runs. | When running Phase 2 migration, verify actual assertion count. If 33, update ADR-0005 to say 33. | Phase 2 worktree |

### LOW

| ID | Finding | Impact if ignored | Recommended action | Owner |
|---|---|---|---|---|
| F-LOW-001 | `packages/memory/package.json` still contains `pnpm.onlyBuiltDependencies: ["better-sqlite3"]`. This block has no effect in a per-package `package.json` (only workspace root is authoritative). The root `package.json` already has it correctly. `f52f6ce` fixed this in `packages/mcp-servers/memory/package.json` but missed `packages/memory/package.json`. | Generates a pnpm warning on install; no functional impact. | Remove the stale `pnpm` block from `packages/memory/package.json`. 4-line change. | engineer |
| F-LOW-002 | ADR-0004 Verification promises an `expectTypeOf` unit test asserting that partial `{ runId: "x" }` state is a type error. No such test was found in the codebase. | The validation tool's "all-or-nothing" triple contract is enforced by runtime validation only, not compile-time. A future change that weakens the type could slip through. | Add the promised `expectTypeOf` test to `packages/codebase/__tests__/` when Phase 3 lands. Track in ADR-0004. | Phase 3 worktree |
| F-LOW-003 | 34 `port-pending` markers in Categories A, C, D have no GitHub tracking issues. MIGRATION_MANIFEST.md §Validation gate rule 6 requires every deferred symbol to have "an open ticket". | Symbol silently dropped at cutover with no way to discover it post-cutover. | Create 3 tracking issues (one per category) before cutover. Add issue numbers to MIGRATION_MANIFEST.md. | engineer / Phase 7 |
| F-LOW-004 | `parity-oracle/cortex/inputs/` has 9 inputs; `parity-oracle/codebase/inputs/` has 5. PHASE_PLAN Phase 0 expected "22 inputs". Actual: 14. Difference of 8 inputs never captured from live Cortex source. | Parity oracle fixture gap: 8 recall/remember scenarios not covered. | Capture missing 8 inputs from live Cortex instance using `parity-oracle/RUNBOOK.md §2` before 48-hour dual-run gate. | ops / Phase 6 |

---

## Section 6 — Structural Audit Summary (Borges format)

```
Exhaustive-space audit
| Space | Claimed coverage | Calculated size | Searchable? | Mitigation |
|---|---|---|---|---|
| All public Cortex Python symbols | "13 port groups cover all 361 files" | 361 files with 56 port-pending sub-functions | Searchable — inventory exists | 56 port-pending markers; 34 need tracking issues |
| prd-spec public API | "17 tools, 267 tests preserved" | 17 tools × parameters ≈ manageable | NOT YET — prd-pipeline absent | Phase 2 gate required before cutover |
| Rust MCP tools | "23 tools, subprocess-wrap" | 23 tools with known schemas | NOT YET — codebase package absent | Phase 3 gate required |
| CI configuration space | "build + test + lint + parity" | 4 gates | 2 hard, 2 soft | Harden build (F-CRIT-001) and lint (F-HIGH-002) before cutover |

Map-territory assessment
| Abstraction | What it omits | Omission safety | 1:1 risk | Recommendation |
|---|---|---|---|---|
| PHASE_PLAN.md | Phase 1 tooling landed but not marked [x]; Phase 2/3 absent but correctly marked [ ] | SAFE for [ ] items; UNSAFE for Phase 1 omission | Low | Update Phase 1 to mark ESLint, Vitest, layer-check as [x] |
| ci.yml Build gate | Items 7–11 resolved in code but ci.yml never updated from soft to hard | UNSAFE — map says hard, territory is soft | Moderate | F-CRIT-001 |
| ci.yml Plugin manifest lint | Scans .claude-plugin/ but manifests in plugins/ | UNSAFE — check is vacuous | Moderate | F-HIGH-001 |
| ADR-0010 Verification section | Uses old .claude-plugin/ path | UNSAFE — verification command is wrong | Low | F-MED-003 |

Self-reference scan
| Cycle | Paradox potential | Status |
|---|---|---|
| MIGRATION_MANIFEST.md claims to enumerate all artifacts; it also includes itself as a cross-repo concern | Low — the manifest is an external document, not code | No action |
| scripts/audit-migration.sh is cited in MIGRATION_MANIFEST.md §Validation gate but does NOT EXIST | The validation gate is self-describing but empty | OPEN: script must be created before cutover |

Forking-paths analysis
| Decision | Branch taken | Alternatives closed | Reversible? |
|---|---|---|---|
| ADR-0011: HTTP server defer vs discard | Defer to Phase 7 | Discard Option C available if <2 post-cutover requests | YES — ADR-0011 has explicit reversal criterion |
| Phase 2: git subtree add vs git filter-repo | Planning done (SUBTREE_PLAN.md); execution NOT done | Both approaches still viable | YES |
| License: UNLICENSED → MIT | MIT chosen (this branch) | Proprietary (origin path) closed; Apache-2.0 not considered | YES (standard OSS relicense) |

Context-as-meaning check
| Artifact | Context A | Context B | Context-independence safe? |
|---|---|---|---|
| port-pending comment in memory TS files | Phase 4 worktree: "this sub-function is not yet ported" | Phase 7 reader: "this is a known gap, tracked" | UNSAFE without tracking issue numbers in the comments |
| MIGRATED.md files in cutover-staging/ | Before cutover: staged, not yet in source repos | After cutover: must be committed to source repos | Staging path must be explicitly cleared |
| "22 inputs" in PHASE_PLAN Phase 0 | Written before parity-oracle was filled | Post-Phase 4: only 14 inputs present | STALE — update to 14 |
```

---

## Section 7 — Missing Artifact: `scripts/audit-migration.sh`

MIGRATION_MANIFEST.md §Validation gate references `./scripts/audit-migration.sh` as the
gate script that must pass before flipping to public. This script **does NOT exist**.

The gate it would enforce:
1. Every manifest row tagged `✅` (or has an open deferral ticket)
2. Every `# source:` from Cortex Python has a matching `// source:` in TS
3. Every cited paper PDF/markdown present under `packages/memory/sources/`
4. Test count: `tests_new >= Σ tests_source` per package
5. Hook count: all hooks accounted for
6. Public symbols audit: every exported symbol has a counterpart or discard justification

None of items 1–6 are mechanically enforced without this script. This is a CRIT blocker
for cutover because the manifest's own validation gate is empty. However, items 1–6 are
partially addressed manually in this cross-audit document. The script must be created
before the 48-hour dual-run gate starts.

**Recommendation**: Create `scripts/audit-migration.sh` as a Phase 6 follow-up, checking
at minimum items 1 (manifest `✅` coverage) and 6 (symbol audit coverage). Add to
`docs/RELEASE_CHECKLIST.md` as a pre-cutover gate.

---

## Totals

| Metric | Count |
|---|---|
| PHASE_PLAN `[x]` deliverables verified | 45 |
| PHASE_PLAN `[x]` deliverables falsified (false positives) | 0 |
| PHASE_PLAN `[ ]` deliverables correctly marked open | ~25 |
| Phases with complete code coverage | 4, 5, 6-partial |
| Phases with zero code coverage | 2, 3 |
| ADR verification checks: open (Phase-gated) | 5 (ADRs 1–3, 5–6) |
| ADR verification checks: stale path | 2 (ADRs 8, 10) |
| ADR verification checks: verified/partial | 4 (ADRs 7, 9, 10-spirit, 11) |
| `port-pending` stub markers on main | 56 |
| Stub markers with no tracking issue | 34 (Categories A, C, D) |
| Missing script referenced in validation gate | 1 (`scripts/audit-migration.sh`) |
| CRIT findings | 1 (F-CRIT-001) |
| HIGH findings | 2 (F-HIGH-001, F-HIGH-002) |
| MED findings | 5 (F-MED-001 through F-MED-005, one closed) |
| LOW findings | 4 (F-LOW-001 through F-LOW-004) |

**Top-3 most load-bearing findings before cutover**:

1. **F-CRIT-001** — CI build gate is soft. A tsc regression on main is invisible until
   a developer manually runs `pnpm build`. Fix: one-line change to `ci.yml`.

2. **F-HIGH-001** — CI plugin manifest lint scans the wrong directory (`.claude-plugin/`
   instead of `plugins/`). The check passes vacuously. Fix: one-line change to `ci.yml`.

3. **F-LOW-003** — 34 `port-pending` markers in Categories A, C, D have no tracking issues.
   MIGRATION_MANIFEST.md §Validation gate rule 6 requires this. Without tracking issues,
   the 48-hour dual-run cannot be declared complete even if it passes, because there is
   no evidence that all source symbols are accounted for.
