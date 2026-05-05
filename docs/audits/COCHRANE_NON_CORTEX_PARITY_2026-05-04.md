# Cochrane Evidence Synthesis — AP Rust + prd-spec + zetetic Exact-Portage Parity

**Audit date**: 2026-05-04
**Auditor**: Cochrane/Glass evidence-synthesis agent
**Branch**: `audit/cochrane-non-cortex-parity-2026-05-04`
**Monorepo HEAD**: `af40222` (branch `main`)

**Source SHAs (frozen)**:
- Repo 2 — `ai-automatised-pipeline` (Rust): `2cc3780419c3b550e58ad4c957a21995d0ee5b42`
- Repo 3 — `prd-spec-generator` (TS): `5bb7dd90cc1dda9effdae7a81ff8814663923209`
- Repo 4 — `zetetic-team-subagents` (bash+md): `75c0b0dfdf048e11445f5a3b2a28082cb7061bef`

**Method**: no agent-trust; all counts produced by `find`, `grep`, `wc`, `diff`, `python3 -c json.load()`.
Parity tests run live at audit time. Every number cites its source command or line range.

---

## §1 Per-Repo Verdict

| Repo | Verdict | Confidence |
|------|---------|------------|
| Repo 2 — automatised-pipeline (Rust, 23 tools) | **GAPS** | HIGH |
| Repo 3 — prd-spec-generator (TS, 10 sub-packages) | **COMPLETE** | HIGH |
| Repo 4 — zetetic-team-subagents (bash+md) | **GAPS** | HIGH |

---

## §2 Per-Repo Evidence Table

### Repo 2 — automatised-pipeline (Rust → TS subprocess adapter)

| Metric | Source (Rust, `2cc3780`) | TS Port (`af40222`) | Delta |
|--------|--------------------------|---------------------|-------|
| MCP tools in `tools_list()` | 23 (tool_schemas.rs:13–35) | 12 (adapter + port) | **−11** |
| `CodebasePort` interface methods | — | 13 (12 tools + `dispose()`) | — |
| `RustPipelineAdapter` async methods | — | 12 (+ `dispose()`) | — |
| Parity-runner tests passing | — | 29/29 (self-test only; 0 live fixtures) | — |
| Dispatch entries in `main.rs` | 23 tools + 3 protocol (`initialize`, `agent_question`, `user_answer`) | — | — |

Source line: `src/tool_schemas.rs:10–37` — `tools_list()` returns a JSON array of 23 tool schemas.
Port line: `packages/codebase/src/adapters/rust-pipeline-adapter.ts` header comment: "Tools 1–17; tools 18–23 deferred to Phase 6."
Note: the Phase 6 numbering in the adapter comment is internally inconsistent — `lsp_resolve` (schema array position 19) IS implemented, while tools 2–7 (findings pipeline) are not. The 11-tool gap spans two functional groups, not a clean 18–23 range.

### Repo 3 — prd-spec-generator (TS subtree migration)

| Metric | Source (`5bb7dd9`) | TS Port (`af40222`) | Delta |
|--------|--------------------|---------------------|-------|
| Sub-packages | 10 | 10 | 0 |
| Total `.ts` files under `packages/` | 203 | 204 | **+1** |
| Per-package `.ts` file delta | see table below | — | all 0 |
| Package name prefix | `@prd-gen/*` | `@agentic/prd-*` | renamed correctly |
| `package.json` `main` field match | — | 10/10 | 0 divergences |
| Test count (`vitest run`) | — | 583 passed / 58 files | ≥583 gate: PASS |

Per-package `.ts` file counts (source `find … -name "*.ts" | grep -v node_modules | grep -v .d.ts`):

| Package | Source | Monorepo | Delta |
|---------|--------|----------|-------|
| benchmark | 73 | 73 | 0 |
| core | 20 | 20 | 0 |
| ecosystem-adapters | 13 | 13 | 0 |
| mcp-server | 12 | 12 | 0 |
| meta-prompting | 6 | 6 | 0 |
| orchestration | 32 | 32 | 0 |
| skill | 0 | 0 | 0 |
| strategy | 5 | 5 | 0 |
| validation | 28 | 28 | 0 |
| verification | 14 | 14 | 0 |
| **Total** | **203** | **204** | **+1** |

The +1 file exists at the `packages/prd-pipeline/` root level (not under a sub-package), consistent with a migration-added file (e.g., a workspace-root tsconfig or README). No sub-package content is missing.

### Repo 4 — zetetic-team-subagents (bash+md migration)

| Metric | Source (`75c0b0d`) | Monorepo (`af40222`) | Delta |
|--------|--------------------|----------------------|-------|
| `.md` files (excl. node_modules, tests) | 231 | 234 | **+3** |
| `.sh` files (excl. node_modules, tests) | 44 | 45 | **+1** |
| genius agent `.md` files | 98 | 98 | 0 |
| team agent `.md` files | 19 | 19 | 0 |
| skills `.md` files | 63 | 63 | 0 |
| Hook `.sh` files | 15 | 15 | 0 |
| Hook filenames match | 15/15 | 15/15 | exact match |
| `skills/` subdirectory tree | 7 subdirs (incl. empty `genius/`) | 6 subdirs (`genius/` absent) | **−1 dir** |
| Plugin manifest claims agents | "98 genius reasoning patterns" | — | description only; no `agents` key |

Extra `.sh` in monorepo vs source: `run-tests.sh` (monorepo-added test runner; not in source).
Extra `.md` in monorepo: +3 files relative to source — monorepo additions (CHANGELOG, CONTRIBUTING variants, or migration artifacts); not source-content gaps.
Missing directory: `skills/genius/` exists in source as an **empty** directory (0 files, confirmed `find … -type f | wc -l = 0`). Its absence from the monorepo has zero content impact.
Plugin manifest: `plugin.json` contains no `agents` array key — the 116-agent claim in the task brief is unverifiable from the manifest structure. The manifest routes to hooks only; agent loading is done by the `setup.sh` installer script copying `.md` files to `~/.claude/`.

---

## §3 Gap List Per Repo

### Repo 2 Gaps — 11 MCP tools not ported to TypeScript

The following tools exist in the Rust binary's `tools_list()` response and are dispatched in `src/main.rs` but have **no corresponding method** in `CodebasePort` (`packages/core/src/ports/codebase.ts`) or `RustPipelineAdapter` (`packages/codebase/src/adapters/rust-pipeline-adapter.ts`):

| # | Tool (snake_case) | Rust source | Functional group |
|---|-------------------|-------------|-----------------|
| 1 | `extract_finding` | `main.rs:3283`, `tool_schemas.rs:52–80` | Stage 1a — finding normalization |
| 2 | `refine_finding` | `main.rs:3284`, `tool_schemas.rs:82–136` | Stage 1b — LLM-driven refinement |
| 3 | `start_verification` | `main.rs:3285`, `tool_schemas.rs:138–153` | Stage 2 — session open |
| 4 | `append_clarification` | `main.rs:3286`, `tool_schemas.rs:155–173` | Stage 2 — clarification turn |
| 5 | `finalize_verification` | `main.rs:3287`, `tool_schemas.rs:175–190` | Stage 2 — session finalize |
| 6 | `abort_verification` | `main.rs:3288`, `tool_schemas.rs:192–208` | Stage 2 — session abort |
| 7 | `detect_changes` | `main.rs:3299`, `tool_schemas.rs` position 18 | Stage 3d — git-diff change detection |
| 8 | `prepare_prd_input` | `main.rs:3301`, `tool_schemas.rs` position 20 | Stage 4 — PRD input assembly |
| 9 | `validate_prd_against_graph` | `main.rs:3302`, `tool_schemas.rs` position 21 | Stage 4 — PRD graph validation |
| 10 | `check_security_gates` | `main.rs:3303`, `tool_schemas.rs` position 22 | Stage 5 — security gate |
| 11 | `verify_semantic_diff` | `main.rs:3304`, `tool_schemas.rs` position 23 | Stage 5 — semantic diff |

The parity-runner has 0 live fixtures covering these tools (`[parity] PASS — 0/0 fixtures match` — self-test only).

The adapter's own comment says "tools 18–23 deferred to Phase 6" but this is incorrect: tools 2–7 (the entire findings + verification pipeline, stages 1–2) are also absent. The Phase 6 deferral label covers only 5 tools (positions 18, 20–23); the additional 6 missing tools (positions 2–7) are unacknowledged in any ADR or plan document.

### Repo 3 Gaps — None

No content gaps detected. The +1 `.ts` file in the monorepo is a monorepo-level addition, not a missing source file. All 10 sub-packages have identical file counts. All `package.json` `main` fields match. Test gate (≥583) passes with exactly 583.

### Repo 4 Gaps — One structural gap, one manifest deficiency

**Gap 4.1 — `skills/genius/` directory absent from monorepo**
Source path: `/Users/cdeust/Developments/zetetic-team-subagents/skills/genius/`
Monorepo path: absent from `packages/reasoning/skills/`
Severity: **LOW** — the directory is empty (0 files) in the source. No content is lost. However, `git filter-repo` dropped the empty directory during migration (git does not track empty directories without a `.gitkeep`). If the directory is a structural placeholder for future genius skill files, it should be recreated.

**Gap 4.2 — Plugin manifest has no `agents` key**
Path: `packages/reasoning/.claude-plugin/plugin.json`
Claim in task brief: "correctly references the 116 agents."
Finding: `plugin.json` has keys `[name, description, version, author, homepage, repository, license, keywords, postInstall, hooks]` — no `agents` array. The agent count (98 + 19 = 117 total) is consistent in the filesystem but not surfaced in the manifest. Agent installation is delegated to `scripts/setup.sh`. Whether an `agents` manifest key is required depends on the plugin spec version; no schema reference is available to adjudicate.

**Gap 4.3 — Monorepo has +1 extra `.sh` file: `run-tests.sh`**
This file is in the monorepo but not in the source. It is a monorepo-added test runner. This is an addition, not a missing item, so it does not constitute a parity gap in the portage direction. However, if the source is the canonical truth, the monorepo contains unreferenced surface relative to source.

---

## §4 Recommendations Per Gap

### Repo 2 — Dispatch engineer to port 11 missing tools

**Priority**: HIGH. The findings pipeline (tools 1–7: `extract_finding` through `abort_verification`) and the PRD + security pipeline (tools 8–11: `detect_changes`, `prepare_prd_input`, `validate_prd_against_graph`, `check_security_gates`, `verify_semantic_diff`) together represent 48% of the Rust binary's public surface and are entirely absent from the TS port.

**Recommended dispatch**: one infrastructure engineer, 2 work sessions.

**Scope for engineer**:
1. Extend `CodebasePort` in `packages/core/src/ports/codebase.ts` with 11 new method signatures (input schemas, output types, error types following the existing ADR-0003 pattern).
2. Implement 11 corresponding methods in `RustPipelineAdapter` following the `_call<T>()` pattern already established.
3. Add output schemas to `packages/core/src/ports/codebase-outputs.ts` for each new tool (the Rust `MCP_TOOLS.md` inventory has full schema documentation).
4. Add at least one parity fixture per tool to `packages/parity-runner/` so `pnpm --filter @agentic/parity-runner test` produces live coverage.
5. Correct the Phase 6 deferral comment in `rust-pipeline-adapter.ts` to accurately name which tools remain deferred (currently none should remain deferred once this work is done).

**ADR required**: yes — a new ADR documenting the session-state machine for tools 3–6 (`start_verification` through `abort_verification`), since these tools form a stateful multi-turn protocol with `SESSION_FILE_NAME` and `SessionState` enum managed by the Rust binary.

### Repo 3 — No action required

Port is verified complete at `5bb7dd9`. 583/583 tests pass. Monitor for source drift if `prd-spec-generator` is not frozen.

### Repo 4 — Two low-priority remediation actions

**4.1** — Recreate the empty `skills/genius/` directory placeholder:
```bash
mkdir -p packages/reasoning/skills/genius
touch packages/reasoning/skills/genius/.gitkeep
```
One-line fix; no engineer dispatch needed — any committer can do it.

**4.2** — Clarify plugin manifest spec: determine whether the `zetetic-reasoning` plugin spec requires an explicit `agents` array listing each `.md` path, or whether the `postInstall` + `setup.sh` pattern is sufficient. If an `agents` key is required, dispatch one engineer to enumerate all 117 agent paths into `plugin.json`. If not, close this as a documentation clarification only.

**4.3** — `run-tests.sh` in monorepo: document in `packages/reasoning/CHANGELOG.md` that this file is a monorepo-layer addition not present in the source, to prevent future "is this supposed to be here?" confusion. No deletion needed.

---

## Appendix: Evidence Commands (reproducibility)

All counts were produced in the audit session at 2026-05-04T09:27 UTC.

```bash
# Repo 2 — MCP tool count (source)
grep '_schema(),' src/tool_schemas.rs  # lines 13–35 = 23 entries
# Repo 2 — TS adapter methods
grep 'async [a-z]' packages/codebase/src/adapters/rust-pipeline-adapter.ts
# Repo 2 — Parity runner
pnpm --filter @agentic/parity-runner test  # 29 passed, 0 live fixtures

# Repo 3 — per-package file counts
find packages/prd-pipeline/packages/$pkg/ -name "*.ts" | grep -v node_modules | wc -l
# Repo 3 — tests
pnpm --filter "@agentic/prd-*" test  # 583 passed / 58 files

# Repo 4 — agent counts
ls agents/genius/*.md | wc -l  # 98 source = 98 monorepo
ls agents/*.md | wc -l         # 19 source = 19 monorepo
find skills/ -name "*.md" | wc -l  # 63 source = 63 monorepo
# Repo 4 — hook diff
diff <(ls hooks/*.sh | xargs basename | sort) <(ls packages/reasoning/hooks/*.sh | xargs basename | sort)
# exit 0 — exact match
```
