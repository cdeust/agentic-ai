# Worktree Mission — `inventory-cortex`

> Inventory mission — read-only survey of the Cortex Python source.
> No code is ported here. This file provides §1–§2 for every downstream
> Phase-4 worktree to copy and specialise.

---

## 1. Source

- **Source repo**: `github.com/cdeust/Cortex` (local mirror: `/Users/cdeust/Developments/Cortex`)
- **Source root**: `/Users/cdeust/Developments/Cortex/mcp_server/`
- **Source paths** (all paths owned collectively by Phase-4 worktrees):
  - `mcp_server/__init__.py`, `mcp_server/__main__.py`
  - `mcp_server/tool_registry_core.py`
  - `mcp_server/tool_registry_memory.py`
  - `mcp_server/tool_registry_manage.py`
  - `mcp_server/tool_registry_advanced.py`
  - `mcp_server/tool_registry_nav.py`
  - `mcp_server/tool_registry_wiki.py`
  - `mcp_server/tool_registry_ingest.py`
  - `mcp_server/tool_error_handler.py`
  - `mcp_server/doctor.py`
  - `mcp_server/core/` (163 files, 34 420 LOC)
  - `mcp_server/handlers/` (98 files incl. consolidation/, 18 565 LOC)
  - `mcp_server/hooks/` (9 files, 2 486 LOC)
  - `mcp_server/infrastructure/` (50 files, 12 997 LOC)
  - `mcp_server/shared/` (17 files, 2 298 LOC)
  - `mcp_server/server/` (15 files, 3 668 LOC)
  - `mcp_server/observability/` (2 files)
  - `mcp_server/validation/` (2 files)
  - `mcp_server/errors/` (1 file)
- **Source language**: Python 3.12+
- **Total Python files**: 361 (excluding `__pycache__`)
- **Total lines of code**: ~78 461
- **Cited papers / sources** (every `# source:` annotation must travel — see `inventory/CITATIONS.md` for the exhaustive list):
  - Ebbinghaus (1885) — exponential decay curve, backfill heat
  - Kandel (2001) — stage-dependent alpha decay exponents
  - Bahrick (1984) — permastore floor
  - Benna & Fusi (2016) — deepest cascade level irreversible storage
  - Yonelinas & Ritchey (2015) — emotional damping β
  - Kleinsmith & Kaplan (1963) — emotional advantage crossover
  - McClelland et al. (1995) — hippocampal two-stage model
  - Pfister et al. (2013) — homeostatic bimodality test
  - Wilcox (2012) — robust statistics for homeostatic plasticity
  - Hinton & Salakhutdinov (2006) — dimensionality reduction
  - Collins & Loftus (1975) — spreading activation
  - Wegner (1987) — transactive memory systems
  - Bar (2007) — proactive brain
  - Smith & Vela (2001) — context reinstatement (d=0.28)
  - Gutiérrez et al. (2024) — HippoRAG / PPR traversal, NeurIPS 2024
  - Wang & Chen (2025) — MIRIX active retrieval, arxiv 2507.07957
  - Krause & Guestrin (2008) — near-optimal sensor placements / MMR greedy
  - Leutgeb et al. (2007) — pattern separation
  - Rolls (2013) — pattern separation
  - Phase-3-A3 migration design doc — effective_heat p_factor constant 0.99787

---

## 2. Target

- **Target monorepo**: `github.com/cdeust/agentic-ai` (local: `/Users/cdeust/Developments/agentic-ai`)
- **Target package root**: `packages/memory/src/`
- **Target language**: TypeScript (strict)
- **Sub-packages by Phase-4 worktree** (see `inventory/CORTEX_INVENTORY.md` for file-to-worktree map):

| Worktree branch | TS target package |
|---|---|
| `port/cortex-remember` | `packages/memory/src/remember/` |
| `port/cortex-recall` | `packages/memory/src/recall/` |
| `port/cortex-consolidation` | `packages/memory/src/consolidation/` |
| `port/cortex-hooks` | `packages/memory/src/hooks/` |
| `port/cortex-methodology` | `packages/memory/src/methodology/` |
| `port/cortex-graph-navigation` | `packages/memory/src/graph/` |
| `port/cortex-narrative` | `packages/memory/src/narrative/` |
| `port/cortex-automation` | `packages/memory/src/automation/` |
| `port/cortex-import` | `packages/memory/src/import/` |

- **Ports consumed** (declared in `packages/core/src/ports/`):
  - `MemoryStorePort` — read/write/query memories (PostgreSQL or SQLite)
  - `EmbeddingPort` — encode text to float[384]
  - `ProfileStorePort` — read/write methodology profiles
  - `SessionStorePort` — read session history
  - `WikiStorePort` — wiki pages CRUD
  - `GraphStorePort` — entities + relationships CRUD
- **Ports provided** (this package's interface to the rest of the monorepo):
  - `remember(content, opts): Promise<MemoryResult>`
  - `recall(query, opts): Promise<Memory[]>`
  - `consolidate(opts): Promise<ConsolidationReport>`
  - All 38 MCP tool signatures documented in `inventory/MCP_TOOLS.md`

---

## 3. Acceptance Contract (load-bearing)

(Standard template — see `docs/WORKTREE_MISSION_TEMPLATE.md` §3. Each Phase-4 worktree fills this for its slice.)

### 3.1 Functional parity
- [ ] Parity-oracle suite under `parity-oracle/<module>/` passes 100%.
- [ ] Every input in the Day-0 frozen fixture produces byte-identical output (modulo timestamps and SHA-of-bytes fields).
- [ ] Adversarial corpus from `popper`'s falsification panel produces zero divergences vs Python implementation.

### 3.2 Source-citation provenance
- [ ] Every `# source:` annotation from the Python source is preserved verbatim as a `// source:` annotation in TS.
- [ ] Every cited paper file (PDFs / arXiv markdown) is present at the same relative path under `packages/memory/sources/`.
- [ ] Cite-check pass: `feynman` rederives at least one formula per file from the cited paper.

### 3.3 Type contracts
- [ ] Public types match the frozen Day-0 schemas in `packages/shared-contracts/`.
- [ ] No `any`, no `unknown` outside explicit Zod parse-then-narrow boundaries.
- [ ] `liskov` audit: every adapter substitutable for its port; no postcondition weakened.

### 3.4 Tests
- [ ] Unit tests for every public function (≥1 happy path, ≥1 edge case, ≥1 failure mode).
- [ ] Contract tests for every port implemented.
- [ ] `tests_new ≥ tests_source`.
- [ ] Mutation survival check: pick 3 mutations, confirm at least one test fails for each.

### 3.5 Layer rules
- [ ] `core/` imports stdlib only.
- [ ] `adapters/` may import third-party (pg, yaml, etc.).
- [ ] `mcp-servers/` is the ONLY composition root.
- [ ] No circular imports (verified by `madge --circular`).

### 3.6 Style
- [ ] `pnpm lint` passes with zero warnings.
- [ ] `tsc --strict` passes.
- [ ] Every numeric constant ≥3 significant digits has a `// source:` comment.
- [ ] No file > 500 lines, no function > 50 lines.

---

## 4. Genius Panel

(Per Phase-4 worktree — see `docs/WORKTREE_MISSION_TEMPLATE.md` §4 for panel roster.)

---

## 5. Findings & Actions

| ID | Severity | Pattern | Description | Status |
|---|---|---|---|---|
| F-001 | HIGH | Champollion | PHASE_PLAN §4 lists `mcp_server/automation/` and `mcp_server/import/` as source paths for `port/cortex-automation` and `port/cortex-import` — neither directory exists. Actual source is `handlers/import_sessions.py` (Claude Code JSONL only; no ChatGPT/Gemini/Cursor parsers found). See §"Unaccounted-for" in CORTEX_INVENTORY.md. | open |
| F-002 | HIGH | Champollion | PHASE_PLAN §4 lists `mcp_server/methodology/` and `mcp_server/profile/` as source for `port/cortex-methodology` — neither directory exists. Actual source is `handlers/query_methodology.py`, `handlers/rebuild_profiles.py`, `handlers/get_methodology_graph.py`, `handlers/record_session_end.py`, `core/profile_assembler.py`, `core/profile_builder.py`, `core/behavioral_crosscoder.py`, `core/attribution_tracer.py`, `core/blindspot_detector.py`. | open |
| F-003 | HIGH | Champollion | PHASE_PLAN §4 lists `mcp_server/decay.py` as source for `port/cortex-consolidation` — file does not exist at that path. Actual decay logic is in `core/decay_cycle.py` and `handlers/consolidation/decay.py`. | open |
| F-004 | MED | Champollion | `mcp_server/hooks/` contains 9 files (8 non-empty), not 5. PHASE_PLAN says "5 files". The 4 extra hooks — `session_lifecycle.py`, `pipeline_impact_bump.py`, `preemptive_context.py`, `ingest_codebase_background.py` — are unaccounted-for. | open |
| F-005 | MED | Champollion | `mcp_server/server/` (15 files, 3 668 LOC) and `mcp_server/observability/` are unaccounted-for in PHASE_PLAN §4. HTTP dashboard, standalone graph viewer, and metrics infra need an owner worktree. | open |
| F-006 | MED | Champollion | Large wiki subsystem (`handlers/wiki_*.py` × 21, `core/wiki_*.py` × 15, `infrastructure/pg_store_wiki.py`) is not assigned to any Phase-4 worktree in PHASE_PLAN §4. | open |
| F-007 | LOW | Champollion | `mcp_server/validation/schemas.py` and `mcp_server/errors/__init__.py` are unassigned. | open |

CRIT and HIGH must be closed before merge. MEDs may be deferred with an explicit follow-up issue.

---

## 6. Merge Conditions

This inventory worktree merges to `main` when all 6 deliverables are committed and findings F-001–F-004 are acknowledged by the planning team (findings do not block this inventory merge — they block Phase-4 spawn).

---

## 7. Known Risks / Open Questions

- The `port/cortex-import` worktree is listed as supporting "claude-mem, ChatGPT, Gemini, Cursor, Claude Code" importers but only the Claude Code JSONL format is implemented in `handlers/import_sessions.py`. The other formats either do not exist yet or are planned future work. The Phase-4 scope for that worktree must be narrowed or those parsers must be written from scratch.
- The `server/` HTTP layer (dashboard, graph visualisation, standalone mode) has no Phase-4 owner. Decision needed: port to TS or retain Python.
- `mcp_server/doctor.py` (332 LOC) is a standalone health-check CLI — unassigned to any Phase-4 worktree.

---

## 8. Daily Log

- **2026-04-26**: Initial inventory completed. 361 Python files, ~78 461 LOC catalogued. 7 findings raised against PHASE_PLAN §4 path discrepancies. All 6 deliverables committed.
