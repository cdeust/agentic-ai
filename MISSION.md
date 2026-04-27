# Worktree Mission — `parity-baseline`

> This worktree owns the cross-language parity-oracle corpus. It is the GROUND
> TRUTH that every parallel TS-port worktree's §3.1 acceptance check measures
> against. If the corpus is incomplete or biased, the parity check is worthless —
> every TS port could pass while silently breaking semantics.
>
> This document follows the WORKTREE_MISSION_TEMPLATE.md format; §1 and §2 are
> filled in for the parity-baseline role (corpus design, not a language port).

---

## 1. Source

- **Source repos**:
  - `github.com/cdeust/Cortex` — Python 3.x MCP server; 47 tools; ~9,000 LOC
    across `mcp_server/handlers/`, `mcp_server/core/`, `mcp_server/infrastructure/`
  - `github.com/cdeust/prd-spec-generator` — TypeScript monorepo; 11 MCP tools;
    ~12,000 LOC across 9 workspace packages under `packages/`
  - `github.com/cdeust/automatised-pipeline` (Rust) — AST analysis binary;
    subprocess-wrapped by the `packages/codebase/` TS adapter in the monorepo
- **Source paths this corpus covers**:
  - `Cortex/mcp_server/handlers/recall.py` — WRRF + FlashRank + Hebbian enrichments
  - `Cortex/mcp_server/handlers/remember.py` — predictive-coding write gate
  - `Cortex/mcp_server/handlers/consolidate.py` + `consolidation/decay.py` + `consolidation/compression.py`
  - `Cortex/mcp_server/handlers/query_methodology.py` — cognitive profile + hot memories
  - `Cortex/mcp_server/handlers/detect_domain.py` — domain classification
  - `Cortex/mcp_server/handlers/narrative.py` — project story from memory
  - `Cortex/mcp_server/handlers/import_sessions.py` — JSONL session ingestion
  - `prd-spec-generator/packages/mcp-server/src/pipeline-tools.ts` — start_pipeline, submit_action_result
  - `automatised-pipeline/src/` — Rust binary MCP interface (health_check, index, query, get_symbol, search)
- **Source languages**: Python 3.12, TypeScript (strict), Rust
- **Lines of code (approx.)**:
  - Cortex handlers under test: ~3,200 LOC
  - prd-spec-generator MCP tools under test: ~800 LOC
  - automatised-pipeline MCP interface under test: ~600 LOC
- **Cited papers / sources** (load-bearing; must travel to TS ports):
  - Liu et al. (2023) — "Lost in the Middle" — strategic ordering in recall
  - McClelland (1995) — CLS consolidation; replay → stage advancement
  - Friston (2010) — free-energy minimization (predictive-coding write gate)
  - Hebb (1949) + Bi & Poo (1998) — synaptic plasticity LTP/LTD
  - Turrigiano (2008) — homeostatic scaling
  - Kandel (2001) — cascade stage advancement
  - Wang (2020) — microglial pruning of orphan edges

---

## 2. Target

- **Target package**: `parity-oracle/` (this worktree; no TS code produced here)
- **Target language**: JSON fixtures + Markdown runbooks
- **Public API surface** (what this worktree exports to other worktrees):
  - `parity-oracle/cortex/inputs/**/*.json` — frozen handler input fixtures
  - `parity-oracle/cortex/expected/**/*.json` — expected output shapes (masked where non-deterministic)
  - `parity-oracle/codebase/inputs/**/*.json` — Rust adapter input fixtures
  - `parity-oracle/codebase/expected/**/*.json` — expected Rust adapter output shapes
  - `parity-oracle/prd/inputs/**/*.json` — prd-pipeline input fixtures
  - `parity-oracle/prd/expected/**/*.json` — expected prd-pipeline output shapes
  - `parity-oracle/RUNBOOK.md` — step-by-step capture instructions
  - `parity-oracle/SAMPLING_RATIONALE.md` — Cochrane-style justification
  - `parity-oracle/cortex/MASKING.md` — non-deterministic field masking convention
- **Ports consumed**: none (pure fixture/doc worktree)
- **Ports provided**: frozen corpus that parity-harness CI compares TS outputs against

---

## 3. Acceptance Contract (load-bearing)

This worktree is **complete** when ALL of the following are true.

### 3.1 Corpus completeness
- [ ] At least one fixture per handler file listed in §1 Source paths.
- [ ] Every fixture file includes a top-level `_meta` field with: `source_repo`, `source_tool`, `purpose_one_liner`, `failure_modes_caught`.
- [ ] Every known prior bug from CHANGELOG.md §Fixed is represented by at least one adversarial fixture.
- [ ] Happy path, edge case, and error/rejection path covered for every handler group.

### 3.2 Masking convention documented
- [ ] `parity-oracle/cortex/MASKING.md` exists and lists every masked field with rationale.
- [ ] Every expected file that masks a field uses the exact string `"<MASKED:nondeterministic>"`.

### 3.3 Runbook completeness
- [ ] `RUNBOOK.md` provides exact shell commands for all three source repos.
- [ ] Every expected file with `STATUS: TO-BE-CAPTURED` has a blocking reason documented.

### 3.4 Sampling rationale
- [ ] `SAMPLING_RATIONALE.md` explains selection rationale for every fixture using the Cochrane failure-mode framework.

### 3.5 Fixture repo seeded
- [ ] `parity-oracle/codebase/fixture-repos/small-python/` contains at least 5 Python files for index_codebase testing.

---

## 4. Genius Panel

### 4.1 Truth-finding
- **`feynman`** — Verify that every fixture's `failure_modes_caught` array maps to a real divergence path in the source code. **Sign-off**: ☐
- **`popper`** — Construct one adversarial input per CHANGELOG §Fixed entry that would have caught the bug pre-fix. **Sign-off**: ☐

### 4.2 Structural
- **`cochrane`** — Verify corpus is exhaustive: no handler left uncovered, no known failure mode left without a fixture. Verify publication bias (no cherry-picking only the easy happy paths). **Sign-off**: ☐

### 4.3 Domain-relevant
- **`champollion`** — Verify the import/session fixtures cover all JSONL record shapes the extractor must handle. **Sign-off**: ☐

---

## 5. Findings & Actions

| ID | Severity | Pattern that found it | Description | Status |
|---|---|---|---|---|
| F-001 | HIGH | cochrane | Cortex expected/ files cannot be captured until Postgres DB is seeded; all are TO-BE-CAPTURED | open |
| F-002 | MED | cochrane | Rust binary not available in worktree; codebase expected/ are TO-BE-CAPTURED | open |
| F-003 | LOW | popper | prd-pipeline expected/ CAN be partially captured from the in-memory reducer (no DB needed) | open |

---

## 6. Merge Conditions

This worktree merges to `main` only when:

1. §3.1–§3.5 all checked.
2. Genius panel signed off (§4).
3. CRIT and HIGH findings closed (§5). F-001/F-002 are blocked on Phase 0 Day 1 DB setup — acceptable to merge with TO-BE-CAPTURED markers as long as RUNBOOK.md commands are exact.
4. Human reviewer (you) approves.

---

## 7. Known Risks / Open Questions

- **DB dependency**: all Cortex expected/ outputs require a seeded PostgreSQL + pgvector instance. Cannot be captured without Phase 0 Day 1 infra. Runbook documents exact commands; CI gate runs capture on first green environment.
- **Rust binary**: automatised-pipeline must be compiled from source. Not in this worktree. Runbook documents `cargo build --release` path.
- **Non-determinism scope**: `recall` results vary with DB state. Fixtures are designed to test response SHAPE and key-set invariants, not exact memory content. Masking convention documents this.
- **import_sessions OOM path**: ADR-0045 R2 removed the full-read path in v3.13.0; fixture must NOT trigger the old path to avoid false passes on a port that reintroduces it.

---

## 8. Daily Log

- **2026-04-26**: Initial corpus design and fixture seeding by `cochrane` agent. All inputs written. All expected files marked TO-BE-CAPTURED with runbook commands. MASKING.md and SAMPLING_RATIONALE.md complete. Fixture repo seeded (10 Python files).
