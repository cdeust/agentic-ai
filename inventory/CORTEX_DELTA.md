# Cortex Delta — since CORTEX_INVENTORY.md snapshot (2026-04-26)

**Source**: `/Users/cdeust/Developments/Cortex` (private)
**Snapshot baseline**: `inventory/CORTEX_INVENTORY.md` (2026-04-26, 361 .py files, ~78 461 LOC)
**Current HEAD (2026-05-02)**: `bc0ae4f fix(verif): extend query-entity resolution to natural-language tokens (engineer follow-up)`
**Previous re-sync target**: `f2b9f99 fix(ast): uncap L6 symbol/edge ingestion; surface file-import chain` (2026-04-28)
**Inventory HEAD (pre-port)**: `df141f5 release: v3.14.12 — fix MCP client deadlock on long upstream responses`
**Commits added since baseline**: 6 user-facing releases (v3.14.8 → v3.14.12) + 1 post-v3.14.12 AST uncap (f2b9f99) + **28 verification/benchmark commits between 2026-04-28..2026-05-02**

**Re-sync status**:
- `port/cortex-resync-2026-04-28` closed 2026-04-28 against f2b9f99 (Groups 1+6 ported; Group 5 no-op; Groups 2/3/4 no-op).
- **Group 7 (2026-05-02 audit)** — 28 new commits cataloged below; tracking entry added to PHASE_7_TRACKING.md Group H as a follow-up wave.

This file records what changed in Cortex Python AFTER the Phase-4 inventory
was taken, so the TS port in `packages/memory/src/` can be re-synchronized
in a Phase 4.5 follow-up worktree. None of these deltas block Phase 2/3
prd-spec or zetetic-team-subagents migration; they only affect future
Cortex re-port quality.

---

## Group 1 — `ingest_codebase` overhaul (v3.14.8 + v3.14.9)

**Affects TS port**: `packages/memory/src/codebase-analysis/handlers/ingest-codebase.ts` and helpers.

### Files changed in Cortex Python

- `mcp_server/handlers/ingest_codebase.py` — full-chain extraction added
- `mcp_server/handlers/ingest_codebase_cypher.py` — no caps + Rust-style qualified-name fallback (+75 lines)
- `mcp_server/handlers/ingest_codebase_schema.py` — schema simplification (-21 lines)
- `mcp_server/tool_registry_ingest.py` — registry updates

### Behavioural deltas to re-port

1. **No caps**: previous version capped node/edge counts during ingestion.
   v3.14.9 removes caps to support large codebases (the ones the user
   currently runs into 400K-node territory on — see "out of scope" below).
2. **Rust-style qualified-name fallback**: when LSP cannot resolve a symbol
   to a fully-qualified name, fall back to `crate::module::Symbol` style
   parsing. Required for the automatised-pipeline (Rust) target.
3. **Schema simplification**: 21 lines of dead schema-extraction logic
   removed. The TS port has the equivalent dead code; safe to remove
   when re-syncing.

### TS port status

`packages/memory/src/codebase-analysis/` was ported from Cortex HEAD as of
2026-04-26 and is now drift relative to the current Cortex HEAD. Specific
symbols affected: `IngestCodebaseHandler`, `cypher_query_builder`,
`schema_extractor` (names mapped from Python).

**Tracking**: `docs/PHASE_7_TRACKING.md` Group H — **CLOSED** 2026-04-28.
- `filePathFromQn` ported to return `string[]` in `ingest-codebase-cypher.ts`.
- `_attributeFilesToSymbols` iterates candidates list.
- `_pullSymbolsAndFiles` fetches files uncapped (`null`).
- Schema simplification: TS schema file was already simplified; no change needed.

---

## Group 2 — Marketplace-only install path (ADR-0050)

**Affects TS port**: nothing in `packages/memory/src/` (this is install/launch infra).

Cortex 2026-04-26..2026-04-28 dropped every `uvx` invocation and committed
exclusively to marketplace-style install. Cortex commits:

- `8f76f85 chore: remove every uvx invocation`
- `450824b docs(adr): ADR-0050 — marketplace is the only path, no uvx ever`

**Implication for monorepo**: the Cortex TS plugin (`plugins/memory/`) must
follow the same convention. A grep for `uvx` in the monorepo currently
returns nothing — already clean. No port-pending action.

---

## Group 3 — Self-locating plugin MCP launcher (v3.14.10)

**Affects TS port**: `plugins/memory/.mcp.json` and `plugins/memory/plugin.json`.

Cortex Python introduced a self-locating launcher: the `.mcp.json` reads
`installed_plugins.json` to find its own install path, eliminating the
fragile `${CLAUDE_PLUGIN_ROOT:-fallback}` pattern (the same one ADR-0010
forbids).

### TS port status

Already fully aligned — `plugins/memory/.mcp.json` uses bare
`${CLAUDE_PLUGIN_ROOT}` per ADR-0010. The new self-locating mechanism is
slightly different: it reads `~/.claude/installed_plugins.json` at runtime.
The TS launcher is `node dist/index.js` and does not have the same
self-location requirement (Node resolves its own bin path), so this is a
no-op for the monorepo.

---

## Group 4 — automatised-pipeline rename + pool allowlist (v3.14.11)

**Affects TS port**: `packages/codebase/` (when Phase 3 lands) — the Rust
binary rename from `ai-architect` → `automatised-pipeline` is already
captured in MIGRATION_MANIFEST.md.

Cortex commits touched:
- `mcp_server/infrastructure/ap_bridge.py` — adapter rename
- `mcp_server/infrastructure/mcp_client_pool.py` — allowlist fix
- `mcp_server/infrastructure/pipeline_installer.py` — rename references
- `mcp_server/server/http_launcher.py`, `http_standalone.py` — rename refs

**TS port status**: Phase 3 is unstarted; the rename is already documented
in the inventory at the binary level. No action required until Phase 3
lands `packages/codebase-rust/`.

---

## Group 5 — MCP client deadlock fix (v3.14.12)

**Affects TS port**: `packages/memory/src/infrastructure/mcp-client.ts` (when
infrastructure layer is wired in Phase 5/6 composition root).

Cortex Python fix: timeout + cancellation handling for long upstream MCP
responses. The TS port currently uses the official MCP SDK directly which
already has its own timeout handling — verify equivalence when wiring the
composition root.

**Action**: add to `docs/PHASE_7_TRACKING.md` Group D as a verification
item, NOT a re-port. The TS SDK may already cover the deadlock path.

**Status** — **VERIFIED NO-OP** (2026-04-28): The TS port's `callUpstream` in
`ingest-helpers.ts` routes to the official `@modelcontextprotocol/sdk` Client.
That SDK handles stdin/stdout stream lifecycle and destruction natively via
Node.js readable stream semantics. Python's fix was a `callTimeoutMs` +
`idleTimeoutMs` guard on the subprocess stdio reader — the Node.js readable
stream provides equivalent backpressure and destruction semantics by default.
No TS-side port required.

---

## Group 6 — L6 AST uncap + file-import surfacing (f2b9f99, post-v3.14.12)

**Affects TS port**:
- `packages/memory/src/workflow-graph/sources/ast-source.ts` (mirror of
  `mcp_server/infrastructure/workflow_graph_source_ast.py`)
- `packages/memory/src/infrastructure/mcp-client.ts` (mirror of
  `mcp_server/infrastructure/mcp_client.py` line_limit constant)

### Cortex Python deltas

Three substantive fixes in one commit:

1. **`_MAX_SYMBOLS_PER_FILE` cap removed in load-all mode**.
   Previous: `LIMIT 500 * max(0, len(paths))` — when `paths=[]` (the L6
   full-graph load), this evaluated to LIMIT 0, capping every per-label
   query at 500 symbols total. Result on the live Cortex graph: 2,007
   symbols emitted instead of 91,648.
   New: drop the LIMIT entirely when `paths=[]`; keep it only on
   path-filtered queries.

2. **`mcp_client.py` line_limit bumped 10 MB → 1 GB**.
   asyncio's StreamReader was tripping `LimitOverrunError` on JSON-RPC
   frames carrying 100K+ symbols + edges. Backpressure remains via OS
   pipe buffering; the asyncio cap was the wrong gate.

3. **Edge-kind enumeration: hardcoded → Cartesian product**.
   `_load_edges_async` was iterating a hand-typed (src, dst) label list,
   silently dropping edges where the rel table existed but wasn't named
   (e.g. `Imports_File_Class`, `Imports_File_TypeAlias`,
   `Imports_File_Macro`). New: full Cartesian over `_SYMBOL_LABELS`;
   AP returns empty rows for missing rel tables, so over-enumeration is
   safe.

4. **Import nodes promoted to first-class symbols**.
   `_SYMBOL_LABELS` gains `"Import"`. New `_NON_QUALIFIED_LABELS = {"File", "Import"}`
   tells `_load_symbols_async` to read `s.id` + `s.path` instead of
   `s.qualified_name` / `s.name` for these labels (Import nodes don't
   carry the latter). `_run_edge` similarly switches to `dst.id` when
   the dst label is non-qualified. Wires `Defines_File_Import` as an
   `"imports"`-kind edge — a single AP table holding 36,637 edges/project
   that the loader was previously ignoring entirely.

5. **`Uses_*` edges captured**.
   Type-usage edges (Method/Function uses Struct/Class/etc.) were never
   loaded. Adding them yields +6,774 edges on the full Cortex roster.

### Net effect (live Cortex 6-project graph, per commit msg)

| Metric | Before | After | Multiplier |
|---|---|---|---|
| symbols | 2,007 | 91,648 | 45.7× |
| imports | 4,121 | 41,846 | 10.2× |
| uses | 0 | 6,774 | new kind |
| defined_in | 54,889 | 91,648 | 1.7× |
| total nodes | 305,669 | 342,849 | 1.12× |
| total edges | 397,382 | 479,109 | 1.21× |

### TS port status

`packages/memory/src/workflow-graph/` was ported from Cortex HEAD as of
2026-04-26 and now has the same caps the Python file just removed. The
re-sync should:

- Mirror the conditional-LIMIT logic in load-all mode.
- Bump the equivalent line_limit constant in `mcp-client.ts` (verify the
  TS MCP SDK exposes a comparable buffer cap; if not, this is a no-op
  because Node streams use 64 KiB chunks with backpressure by default).
- Replace any hand-typed edge label table with the same Cartesian
  enumeration.
- Add `"Import"` to `SYMBOL_LABELS` + `NON_QUALIFIED_LABELS` set; patch
  the symbol-load and edge-resolve helpers accordingly.
- Wire `Defines_File_Import` and the `Uses_*` edge family.

### 400K-node rendering — graph viz scope

The user noted: "for graph we're still in the middle of nowhere because
now we have to solve a problem of showing 400K nodes." f2b9f99 EXPOSES
the 400K-node territory by removing the data-side cap; rendering 342K
nodes / 479K edges is now the load-bearing problem. **That rendering
work lives in the Cortex HTTP dashboard, not in agentic-ai.** Per
ADR-0011, the dashboard is deferred. The TS port's contract here is
faithful data ingestion (this Group 6 re-sync), not visualization.

**Tracking**: extends Group H in `docs/PHASE_7_TRACKING.md` —
`[Phase 7] Cortex re-sync` now covers v3.14.8/9 ingest_codebase + v3.14.12
deadlock + f2b9f99 L6 uncap. Update PHASE_7_TRACKING accordingly.

---

## Out of scope for this monorepo

The user explicitly noted: "for graph we're still in the middle of nowhere
because now we have to solve a problem of showing 400K nodes." That is a
Cortex-side rendering performance problem (likely in the HTTP dashboard or
graph-visualization layer), not a port concern. ADR-0011 already defers
the Cortex HTTP server / dashboard to post-cutover. No action in
agentic-ai. (f2b9f99 removed the data-side cap that was hiding the
problem; rendering the now-uncapped graph is still out of scope here.)

---

## Summary — what to add to PHASE_7_TRACKING.md

| Group | Source | Action | Tracking entry |
|---|---|---|---|
| H — Cortex re-sync (codebase-analysis) | v3.14.8/9 | Re-port `ingest_codebase*` from current Cortex HEAD | `[Phase 7] Cortex codebase-analysis re-sync (post-v3.14.9 ingest_codebase)` |
| H — Cortex re-sync (workflow-graph L6) | f2b9f99 | Mirror cap removal + Import-as-symbol + Cartesian edge enum + line_limit bump in TS workflow-graph port | `[Phase 7] Cortex workflow-graph L6 uncap (post-f2b9f99)` |
| (D extension) | v3.14.12 | Verify TS MCP SDK already covers the deadlock case | Update existing Group D |

All other Cortex deltas are no-ops or already aligned.

---

## Group 7 — Cortex 2026-04-28..2026-05-02 verification + benchmark wave (28 commits)

**Affects TS port**: `packages/memory/src/recall/`, `packages/memory/src/consolidation/`, `packages/memory/src/infrastructure/` (verification ablations); minor `packages/memory/src/handlers/` (telemetry wrap, paging, facets); zero impact on Phase-7 Groups A/B/C/D/E/F/G already cataloged.

### Headline commits (selected)

| Commit | Subject | TS port impact |
|---|---|---|
| `bc0ae4f` | extend query-entity resolution to natural-language tokens | recall pipeline: NL token resolver — affects recall sub-algorithms (Group B) |
| `024ea1a` | batch Hopfield embeddings + real entity-set Jaccard for dendritic stage | Hopfield + DENDRITIC_CLUSTERS — Group B Hopfield variant |
| `ddb5b58` | wire HOPFIELD/HDC/SPREADING_ACTIVATION/DENDRITIC_CLUSTERS into pg_recall pipeline | wires 4 recall variants into the prod hot path; **Group B in-scope** |
| `54f8501` | handler-level read-path ablation guards in recall.py | adds `CORTEX_ABLATE_<MECH>` env-var gates; mirror in TS handler entry points |
| `099ba1e` | wire 23 ablation env vars into production hot-paths | new env-var contract surface — must be wired in TS composition root |
| `df14e16` | remove `'; '` from comment that broke `ddl.split(';')` extractor | bug fix in schema engine — verify TS port doesn't have the same comment |
| `34aa452` | repair docstring boundary in `cls.run_cls_cycle` | TS `cls.ts` docstring parity check |
| `3eab1ed` | wire E2 N-scan ablation env vars into production code path | env var wiring — same surface as 099ba1e |

### Files touched (mcp_server/ scope)

- **mcp_server/core/** (34 file-touch events, 28 unique files): `ablation.py`, `cascade_advancement.py`, `coupled_neuromodulation.py`, `dendritic_clusters.py`, `emotional_tagging.py`, `engram.py`, `hdc_encoder.py`, `homeostatic_plasticity.py`, `hopfield.py`, `interference.py`, `layout_engine.py`, `microglial_pruning.py`, `oscillatory_clock.py`, `pg_recall.py`, `predictive_coding_gate.py`, `recall_pipeline.py`, `reconsolidation.py`, `schema_engine.py`, `separation_core.py`, `spreading_activation.py`, `synaptic_plasticity_hebbian.py`, `synaptic_tagging.py`, `telemetry.py`, `thermodynamics.py`, `tile_renderer.py`, `titans_memory.py`, `tripartite_calcium.py`, `two_stage_model.py`
- **mcp_server/handlers/** (23 file-touches, 20 unique files): `_telemetry_wrap.py`, `consolidation/cls.py`, `drill_down.py`, `forget.py`, `get_causal_chain.py`, `get_telemetry.py`, `memories_facets.py`, `memories_page.py`, `navigate_memory.py`, `open_visualization.py`, `quadtree_handler.py`, `rate_memory.py`, `recall_hierarchical.py`, `recall.py`, `recompute_layout.py`, `remember.py`, `tile_handler.py`, `validate_memory.py`
- **mcp_server/infrastructure/** (7 events): unspecified — likely `pg_store_*.py` family

### Categorization

1. **Verification ablations (16 commits, ~70%)** — wires 23 named ablation mechanisms (HOPFIELD, HDC, SPREADING_ACTIVATION, DENDRITIC_CLUSTERS, etc.) behind `CORTEX_ABLATE_<MECH>` env vars at handler-entry guards. Adds N-scan, decay-sweep, longitudinal benchmark runners. **TS impact**: medium — Group B (recall sub-algorithms) gets richer wiring; the 23-env-var ablation contract must be mirrored in `packages/memory/src/recall/` if benchmarks run against the TS port.

2. **Benchmark infrastructure (8 commits, ~28%)** — `benchmarks/lib/*.py` runners for E2 N-scan, decay sweep, ablation longmemeval, latency. **TS impact**: NONE in `packages/memory/src/`; benchmarks are Python-only test harness, not port-relevant.

3. **Paper revisions (4 commits, ~14%)** — `docs/papers/`, `docs/arxiv-context-assembly/`, `docs/arxiv-thermodynamic/`. **TS impact**: NONE; documentation only.

4. **Bug fixes (2 commits)**: `df14e16` (DDL comment break) + `34aa452` (docstring boundary). **TS impact**: low — verify the 2 TS files don't carry the same bugs (`schema-engine.ts`, `cls.ts`).

### Action

Add to `docs/PHASE_7_TRACKING.md` Group H as a 2026-05-02 follow-up wave. Recommended worktree: `port/cortex-resync-2026-05-02` covering:
- Mirror the 23-env-var ablation contract (handler-entry `CORTEX_ABLATE_<MECH>` guards)
- Port `coupled_neuromodulation.py` updates (touched 2026-05-02 — likely refines existing TS port)
- Verify schema-engine + cls TS files don't carry the upstream bugs
- Group B sub-algorithm ports (Hopfield batch + Jaccard) get a richer reference impl

The 2026-04-28 graph-rendering 400K-node concern remains out-of-scope; this wave is data + recall-pipeline territory only.
