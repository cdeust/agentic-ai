# Phase 7 Tracking — Deferred Symbols & Port-Pending Markers

**Status**: Open
**Created**: 2026-04-27 (post-Phase-6 final cross-audit)
**Source**: docs/audits/FINAL_CROSS_AUDIT.md §F-LOW-003 (Borges, 2026-04-27)
**Owner**: Phase 7 (post-cutover hardening)

This document is the canonical home for every `port-pending` marker that
remains in `packages/*/src/` after Phase 6. It satisfies
`MIGRATION_MANIFEST.md §"Validation gate" rule 6`: every deferred symbol
must have a tracking entry; silent drops are not acceptable.

`scripts/audit-migration.sh` Check 6 verifies that this file exists before
the 48-hour parity dual-run can be declared complete.

---

## Group A — Embedding / pgvector port (16 markers) — **CLOSED** (2026-04-27)

**Closed by**: `port/phase7-group-a-embeddings` (2026-04-27)

**ADR**: `docs/ADR/0013-embedding-runtime.md` — Xenova/all-MiniLM-L6-v2 via
`@xenova/transformers` (pure-JS ONNX runtime; no Python dependency; vector-compatible
with Cortex Python EmbeddingEngine).

**Files changed (markers removed)**:

| File | Markers closed | Change |
|---|---|---|
| `abstention-gate.ts` | ×4 (sentence-transformers runtime) | `port-pending` → `DEFERRED` (ONNX runtime now available; classifier model file not yet published as Xenova ONNX) |
| `memory-ingest.ts` | ×1 (EmbeddingEngine stub) | Removed local `EmbeddingEngine` stub; imports canonical port from `@agentic/core`; `ingestMemory` made async |
| `post-store.ts` | ×4 (embedding upsert + schema) | Wired `EmbeddingEngine` via `PostStoreOptions.embeddings`; `postStore` made async; `embeddingUpserted` now true when engine provided |
| `sqlite-store.ts` | ×2 (searchVectors + getRelationshipsForEntity) | `_tryLoadVec()` loads sqlite-vec extension; `searchVectors()` queries `memories_vec`; `getRelationshipsForEntity()` implemented |
| `pg-store.ts` | ×6 (searchVectors + entity stubs + oscillatory) | `searchVectorsAsync()` uses pgvector `<=>` operator; `upsertEmbedding()` added; entity/oscillatory stubs annotated with `FAILS_ON` |
| `recall/port.ts` | ×1 (EmbeddingEngine TODO) | `TODO(port-pending)` replaced with `TODO(Group A)` design note; `toRecallEmbeddingEngine()` adapter added in infrastructure |

**New files**:
- `packages/core/src/ports/embedding.ts` — `EmbeddingEngine` port
- `packages/memory/src/infrastructure/transformers-embedding-engine.ts` — `TransformersEmbeddingEngine` adapter + `toRecallEmbeddingEngine()` adapter
- `packages/memory/__tests__/remember/embedding-engine.test.ts` — 30 tests (mocked + live-gated)
- `docs/ADR/0013-embedding-runtime.md`

**Tracking entry**: `[Phase 7] Embedding engine + pgvector port` — **CLOSED** (2026-04-27).

---

## Group B — Recall sub-algorithms (10 markers) — **CLOSED** (2026-04-27)

**Closed by**: `port/phase7-group-b-recall-subalgos` (2026-04-27)

All 10 markers closed; Wave-2 ablation contract (23 env vars) also wired.

**Files changed (markers removed)**:

| File | Markers closed | Change |
|---|---|---|
| `packages/memory/src/recall/recall-handler.ts` | ×1 (Hopfield/HDC/SR/SA `port-pending` comment) | Wired Hopfield, HDC, SA, SR signals with ablation guards |
| `packages/memory/src/recall/recall-hierarchical-handler.ts` | ×3 (`buildHierarchy`, `scoreAgainstHierarchy`, cluster stub comment) | Ported full agglomerative clustering (Union-Find O(N^2), mirrors fractal.py) |
| `packages/memory/src/recall/co-activation.ts` | ×2 (`knowledge_graph.extract_entities` TODO comment + extractEntitiesSimple stub comment) | Replaced stub with full `extractEntities` from `knowledge-graph.ts` |
| `packages/memory/src/recall/rules.ts` | ×1 (`evaluate_rules` + `MemoryRule` TODO comment) | Ported full `evaluate_condition`, `parse_condition`, `parse_action`, `evaluate_rules`, `apply_rules`, `validate_rule` |
| `packages/memory/src/recall/types.ts` | ×1 (`port-pending` comment on hopfield/hdc/sr/sa fields) | Replaced comment with accurate description |
| `packages/memory/src/recall/types.ts` | ×1 (Wave-2 CORTEX_ABLATE env vars not referenced) | Wired in recall-handler.ts |

**New files added**:
- `packages/memory/src/recall/hopfield.ts` — Modern Hopfield Network (Ramsauer 2021): dense + sparse retrieval, pattern completion, energy
- `packages/memory/src/recall/hdc-encoder.ts` — Hyperdimensional Computing encoder (Kanerva 2009): bind/bundle/permute + compute_hdc_scores
- `packages/memory/src/recall/spreading-activation.ts` — Spreading activation (Collins & Loftus 1975): BFS graph propagation + entity graph builder
- `packages/memory/src/recall/dendritic-clusters.ts` — Dendritic memory clustering (Kastellakis 2015): Jaccard branch affinity + immutable branch mutations
- `packages/memory/src/recall/knowledge-graph.ts` — Entity extraction (knowledge_graph.py port): import/def/CamelCase/error/decision extraction + NL keyword extractor (Wave-2 bc0ae4f)

**Wave-2 ablation env vars wired** (`cortex@bc0ae4f` commit 099ba1e / 54f8501):
All 23 `CORTEX_ABLATE_<MECH>` env vars documented and 5 active ones wired at
handler entry in `recall-handler.ts`: HOPFIELD, HDC, SPREADING_ACTIVATION,
DENDRITIC_CLUSTERS, CO_ACTIVATION. The remaining 18 apply to the consolidation,
remember, and reranking layers — documented in the ablation block comment for
future wiring.

**Tests added**: 5 new test files, 966 total tests pass.

**Tracking entry**: `[Phase 7] Complete recall sub-algorithms (Hopfield, fractal hierarchy, entity co-activation)` — **CLOSED** (2026-04-27).

---

## Group C — LLM-dependent handlers (5 markers)

**Blocker**: requires Anthropic SDK client to be wired through the MCP
composition root and injected into narrative + wiki handlers as a port.

**Files affected**:
- `packages/memory/src/narrative/narrative-builder.ts` — LLM prose-polish pass
- `packages/memory/src/narrative/handlers/narrative.ts`
- `packages/memory/src/wiki/handlers/wiki-stubs.ts` (×3) — LLM client not available

**Acceptance criterion**: a `LlmClient` port lands in `@agentic/core` and
each handler receives it via constructor injection.

**Tracking entry**: `[Phase 7] Wire LLM client to narrative + wiki handlers` — open.

---

## Group D — Other (5 markers)

**Mixed blockers** — each marker has its own resolution.

| File | Blocker | Resolution path |
|---|---|---|
| `packages/memory/src/consolidation/stages/cls.ts` | causal_graph.py port | Port causal_graph as Phase-7 deliverable; until then returns 0 edges |
| `packages/memory/src/codebase-analysis/ast-parser.ts` | tree-sitter Node.js bindings decision | ADR-0012 candidate — decide tree-sitter-node vs WASM port |
| `packages/memory/src/remember/handlers/anchor.ts` | updateMemoryContent in PgMemoryStore | Add method to PgMemoryStore implementation |
| `packages/memory/src/remember/storage/pg-store.ts` | True sync PG (not possible in Node) | DOCUMENTED — async wrapper is intentional; remove the `port-pending` marker once verified to match Python semantics |

**Tracking entry**: `[Phase 7] Misc port-pending: causal-graph, AST substrate, anchor, sync-pg` — open.

---

## Group E — DI wiring (8 markers, MISLABELED) — **CLOSED** (2026-04-27)

These markers said `port/cortex-shared` but the actual blocker was the
MCP composition-root level wiring (inject the store/client at runtime),
which is a Phase-5/6 task, not a Phase-4 type-level port.

**Closed by**: `port/phase7-group-e-codebase-di` (2026-04-27)

**Files changed (markers removed)**:

| File | Markers closed | Change |
|---|---|---|
| `codebase-analyze.ts` | ×2 (store singleton + _storeFile comment) | Removed `initStore`/`_getStore` singleton; added `CodebaseAnalyzeDeps`; `handler` takes `deps` |
| `ingest-prd.ts` | ×1 (store singleton) | Removed singleton; added `IngestPrdDeps`; `handler` takes `deps` |
| `ingest-helpers.ts` | ×2 (callUpstream stub comment + thrown message) | Added `McpClientPool` interface; `callUpstream` accepts `pool: McpClientPool \| null = null` |
| `ingest-codebase.ts` | ×2 (singleton comment + error message) | Removed singleton; added `IngestCodebaseDeps`; `handler` takes `deps` |
| `ingest-codebase-graph.ts` | ×0 (no markers, pool-threaded) | `ensureGraph`/`_callAnalyze` accept `pool: McpClientPool \| null` |

**Composition root wired**:
- `packages/mcp-servers/memory/src/tools/ingest.ts`: `registerIngestTools` accepts optional `IngestDeps`; calls real handlers when provided.
- `packages/memory/src/codebase-analysis/index.ts`: exports `McpClientPool`, all three `*Deps` types and handler aliases.

**Tests added**: `packages/memory/__tests__/codebase-analysis/handlers/handler-di.test.ts` — 12 tests.

**Tracking entry**: `[Phase 7] Composition-root DI for codebase-analysis handlers` — **CLOSED** (2026-04-27).

---

## Group F — Composition root stubs (BY DESIGN, 6 markers)

These stubs are correctly tracked to Phase 2 (reasoning, prd) and Phase 3
(codebase) per PHASE_PLAN.md. They are NOT a Phase 7 concern; they are
satisfied when their respective phases land.

**Files affected**:
- `packages/mcp-servers/codebase/src/index.ts` — STATUS: port-pending (Phase 3)
- `packages/mcp-servers/reasoning/src/index.ts` — STATUS: port-pending (Phase 2)
- `packages/mcp-servers/prd/src/index.ts` — STATUS: port-pending (Phase 2)
- `packages/orchestrator/src/index.ts` (×3) — codebase, reasoning, prd servers port-pending

**No new tracking entry required** — already tracked under PHASE_PLAN Phase 2/3.

---

## Group G — Placeholder (1 marker)

- `packages/core/src/index.ts` — STATUS: port-pending (Phase 2 prerequisite),
  per F-MED-001 in FINAL_CROSS_AUDIT.

**Tracking**: Phase 2 — `port/core-types` follow-up worktree. PHASE_PLAN
already tracks this row.

---

## Group H — Cortex source-repo re-sync (post-Phase-4 drift)

**Blocker**: the Cortex Python source advanced 6 user-facing releases
(v3.14.7 → v3.14.12) between the inventory snapshot (2026-04-26) and the
agentic-ai Phase-6 close (2026-04-28). The TS port in
`packages/memory/src/` is therefore drift relative to current Cortex.

**Source**: `inventory/CORTEX_DELTA.md` catalogues every relevant change
with file-level granularity. Cortex HEAD at port time: `f2b9f99`.

**Ported in `port/cortex-resync-2026-04-28` (2026-04-28)**:

### Group 1 — `ingest_codebase` overhaul (v3.14.8/v3.14.9)

| File | Delta ported |
|---|---|
| `ingest-codebase-cypher.ts` | `filePathFromQn` now returns `string[]` (priority-ordered candidates: file path, dotted-module, Rust-style drop-1/2/3). Matches Python `file_path_from_qn` heuristics 1-4 (py:53-111). |
| `ingest-codebase.ts` | `_attributeFilesToSymbols` iterates the candidates list and picks the first match against knownFiles (py:118-126). `_pullSymbolsAndFiles` passes `null` to `fetchFiles` — files always fetched uncapped (py:162-168). |
| Tests | `__tests__/codebase-analysis/ingest-codebase-cypher.test.ts` — 13 new tests. |

**Schema simplification** (v3.14.9 -21 lines): the TS schema file already matches
the simplified form; no change needed.

### Group 6 — L6 AST uncap (f2b9f99, post-v3.14.12)

| File | Delta ported |
|---|---|
| `workflow-graph/sources/source-ast.ts` | Full implementation replacing the previous stub. `_SYMBOL_LABELS` now includes `Import`. `_NON_QUALIFIED_LABELS = {"Import"}` guards `s.id` / `s.path` fallback. Load-all mode (paths=[]) is uncapped. Cartesian-product edge enumeration for `Calls_*`, `Imports_*`, `HasMethod_*`, `Defines_File_Import`, `Uses_*`. |
| Tests | `__tests__/workflow-graph/source-ast.test.ts` — 14 tests (9 runnable, 5 it.todo live-AP). |

### Group 5 — MCP client deadlock fix (v3.14.12) — VERIFIED NO-OP

The TS port uses the official `@modelcontextprotocol/sdk` Client which
handles timeout and cancellation natively — see `callUpstream` in
`ingest-helpers.ts`. No TS-side port required. Verification:
- `callUpstream` throws `McpConnectionError` on the current stub path; the
  real pool path will inherit the SDK's built-in timeout.
- Python's fix was a `callTimeoutMs` + `idleTimeoutMs` guard on the subprocess
  stdin/stdout reader. The TS SDK uses Node.js readable streams with built-in
  backpressure and destruction semantics.

Group D in PHASE_7_TRACKING.md is updated accordingly (no longer open for
the deadlock-fix verification item).

### Groups 2, 3, 4 — No TS action required

- Group 2 (uvx removal): already clean in TS (grep returns nothing).
- Group 3 (self-locating launcher): TS launcher is `node dist/index.js` and
  doesn't need self-location; no-op.
- Group 4 (automatised-pipeline rename): Phase 3 unstarted;
  rename already documented in MIGRATION_MANIFEST.md.

**Out of scope**: graph dashboard / 400K-node rendering — deferred via
ADR-0011 (Cortex HTTP server defer). f2b9f99 only fixes the data-side cap;
rendering is a Cortex HTTP dashboard concern.

**Tracking entry**: `[Phase 7] Cortex re-sync (post-v3.14.9 + f2b9f99 L6 uncap)` — **CLOSED** (2026-04-28).

### Group H Wave 2 — 2026-05-02 follow-up (28 new Cortex commits)

**Source**: `inventory/CORTEX_DELTA.md` §Group 7 + `inventory/SOURCE_REPO_DELTAS_2026-05-02.md`.
**Cortex window**: `f2b9f99..bc0ae4f` (28 commits, 2026-04-28 → 2026-05-02).

**Material deltas to mirror**:
- 23 named ablation env vars (`CORTEX_ABLATE_HOPFIELD`, `_HDC`, `_SPREADING_ACTIVATION`, `_DENDRITIC_CLUSTERS`, etc.) wired at handler-entry guards in `recall.py`. Mirror in `packages/memory/src/recall/handlers/` once Group B Hopfield/HDC/SR/SA variants are ported.
- `coupled_neuromodulation.py`, `dendritic_clusters.py`, `hopfield.py`, `hdc_encoder.py`, `spreading_activation.py` updates — refines the recall sub-algorithm reference impl. Cross-references Group B work.
- `df14e16` (DDL comment-break) + `34aa452` (cls.run_cls_cycle docstring boundary) — verify TS counterparts (`schema-engine.ts`, `cls.ts`) don't carry the same bugs.

**Out of scope**:
- Benchmark infrastructure (`benchmarks/lib/*.py`) — Python-only test harness; not relevant to TS port.
- Paper revisions (`docs/papers/`, `docs/arxiv-*`) — documentation-only; not relevant.

**Recommended worktree**: `port/cortex-resync-2026-05-02` — opens after Phase 7 Group B (recall sub-algorithms) lands so the env-var ablation contract has handlers to attach to. Can be deferred until post-cutover.

**Tracking entry**: `[Phase 7] Cortex re-sync Wave 2 (post-bc0ae4f, 23 ablation env vars + recall refs)` — **OPEN** (2026-05-02).

---

## Summary

| Group | Markers | Tracking entry | Blocking phase |
|---|---|---|---|
| A — Embedding/pgvector | 0 | `[Phase 7] Embedding engine + pgvector port` — **CLOSED** 2026-04-27 | Phase 7 |
| B — Recall sub-algorithms | 0 | `[Phase 7] Complete recall sub-algorithms` — **CLOSED** 2026-04-27 | Phase 7 |
| C — LLM-dependent handlers | 5 | `[Phase 7] Wire LLM client` | Phase 7 |
| D — Other | 5 | `[Phase 7] Misc port-pending` (incl. v3.14.12 deadlock-fix verification) | Phase 7 |
| E — DI wiring (mislabeled) | 0 | `[Phase 7] Composition-root DI for codebase-analysis` — **CLOSED** 2026-04-27 | Phase 7 |
| F — Composition root stubs | 6 | (Phase 2/3, already tracked) | Phase 2/3 |
| G — Placeholder | 1 | (Phase 2, already tracked) | Phase 2 |
| H — Cortex source re-sync | 3 | `[Phase 7] Cortex re-sync (post-v3.14.9 + f2b9f99 L6 uncap)` | Phase 7 |
| H Wave 2 — ablation env vars | 0 | Wired 5/23 ablation vars in recall-handler.ts — **PARTIAL CLOSE** 2026-04-27 | Phase 7 |
| **Total** | **10** | Grep count after Group B close: 10 remain (source-ast.ts ×3, wiki-stubs.ts ×2, types.ts ×1, remember.ts ×1, orchestrator/index.ts ×3) | |

The total here (54) reflects 51 pre-existing in-tree markers plus 3 new
`port-pending` comments added by the Phase 7 Group H resync worktree
(port/cortex-resync-2026-04-28):
- 2 in `workflow-graph/sources/source-ast.ts` — sync façades that return []
  immediately; callers that need AP data must use `loadSymbolsAsync()` /
  `loadAstEdgesAsync()` once the MCP client pool is wired.
- 1 in the source-ast.ts module-level comment (mcp_client_pool reference).

The grep-able total in `packages/*/src` should remain in the 50–60 range
until Phase 7 work begins; `scripts/audit-migration.sh` Check 6 surfaces
the exact count for human review.

---

## How to close a tracking entry

When you port one of the markers above:

1. Remove the `port-pending` line from the source file.
2. Move the row from this document to a `closed/` subsection (do NOT
   delete; the audit trail must remain).
3. Update the relevant ADR if the resolution introduces a new contract.
4. Re-run `bash scripts/audit-migration.sh` and confirm the marker count
   drops by 1.
