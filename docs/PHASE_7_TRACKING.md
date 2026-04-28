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

## Group A — Embedding / pgvector port (16 markers)

**Blocker**: requires sentence-transformers ONNX runtime port + sqlite-vec/pgvector
extension bindings. None of the three exist in the TS ecosystem at parity
quality with the Python originals.

**Files affected**:
- `packages/memory/src/remember/abstention-gate.ts` (×3 — lines: any with `port-pending`)
- `packages/memory/src/remember/memory-ingest.ts`
- `packages/memory/src/remember/post-store.ts` (×4)
- `packages/memory/src/remember/storage/sqlite-store.ts` (×2)
- `packages/memory/src/remember/storage/pg-store.ts` (×6)
- `packages/memory/src/recall/port.ts`

**Acceptance criterion**: each marker either (a) wires to an embedding
adapter (Phase 7 deliverable), or (b) is replaced by a typed `defer` error
with a documented fallback path.

**Tracking entry**: `[Phase 7] Embedding engine + pgvector port` — open.

---

## Group B — Recall sub-algorithms (10 markers)

**Blocker**: Hopfield/HDC associative recall, fractal hierarchy scoring, and
entity co-activation extraction were not ported in Phase 4 because they
depend on (a) Group A embeddings, and (b) a knowledge_graph entity
extractor that the Cortex Python source ships separately.

**Files affected**:
- `packages/memory/src/recall/recall-handler.ts` — Hopfield/HDC/SR/SA variants
- `packages/memory/src/recall/recall-hierarchical-handler.ts` (×3) — fractal.buildHierarchy, fractal.scoreAgainstHierarchy
- `packages/memory/src/recall/co-activation.ts` (×2) — knowledge_graph.extract_entities
- `packages/memory/src/recall/rules.ts` — evaluate_rules, MemoryRule full implementation
- `packages/memory/src/recall/types.ts` — PG stored procedures at boundary

**Acceptance criterion**: each variant either ports or is explicitly removed
from the Recall API (with version bump to signal the contract change).

**Tracking entry**: `[Phase 7] Complete recall sub-algorithms (Hopfield, fractal hierarchy, entity co-activation)` — open.

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

## Group E — DI wiring (8 markers, MISLABELED)

These markers say `port/cortex-shared` but the actual blocker is the
MCP composition-root level wiring (inject the store/client at runtime),
which is a Phase-5/6 task, not a Phase-4 type-level port. The label is
misleading but the work is correctly deferred to Phase 7 hardening.

**Files affected**:
- `packages/memory/src/codebase-analysis/handlers/codebase-analyze.ts` (×2)
- `packages/memory/src/codebase-analysis/handlers/ingest-prd.ts`
- `packages/memory/src/codebase-analysis/handlers/ingest-helpers.ts` (×2)
- `packages/memory/src/codebase-analysis/handlers/ingest-codebase.ts` (×2)

**Acceptance criterion**: every handler receives its `Store` and
`McpClientPool` via constructor injection; markers replaced by usage.

**Tracking entry**: `[Phase 7] Composition-root DI for codebase-analysis handlers` — open.

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

**Source**: `inventory/CORTEX_DELTA.md` (commit landing alongside this
update) catalogues every relevant change with file-level granularity.

**Material deltas to re-sync**:
- v3.14.8/9 — `ingest_codebase` no caps + Rust-style qn fallback +
  schema simplification → re-port `packages/memory/src/codebase-analysis/handlers/ingest-codebase.ts`
  and helpers.
- v3.14.12 — MCP client deadlock fix → verify TS SDK already covers the
  long-upstream-response cancellation path.
- **f2b9f99 (post-v3.14.12)** — workflow-graph L6 uncap: drop
  `_MAX_SYMBOLS_PER_FILE` LIMIT in load-all mode, bump asyncio
  `line_limit` 10 MB → 1 GB, replace hand-typed edge-label list with
  Cartesian enumeration, promote `Import` to a first-class symbol label
  (with `_NON_QUALIFIED_LABELS` set), wire `Defines_File_Import` and
  `Uses_*` edges. Net effect on live Cortex 6-project graph: 305K → 342K
  nodes, 397K → 479K edges (+45.7× symbol count). Mirror in
  `packages/memory/src/workflow-graph/sources/ast-source.ts` and
  `packages/memory/src/infrastructure/mcp-client.ts`. Source:
  `inventory/CORTEX_DELTA.md` Group 6.

**Out of scope**: graph dashboard / 400K-node rendering — already deferred
to post-cutover via ADR-0011 (Cortex HTTP server defer). f2b9f99 removed
the Cortex-side data cap that was hiding the rendering problem; the
rendering work itself remains a separate Cortex-only concern.

**Acceptance criterion**: new `port/cortex-resync-2026-04-28` worktree
that ports the v3.14.8..f2b9f99 deltas, with each TS file carrying a
`source: cortex@f2b9f99` line so future drift is immediately visible.

**Tracking entry**: `[Phase 7] Cortex re-sync (post-v3.14.9 ingest_codebase + v3.14.12 deadlock fix + f2b9f99 L6 uncap)` — open.

---

## Summary

| Group | Markers | Tracking entry | Blocking phase |
|---|---|---|---|
| A — Embedding/pgvector | 16 | `[Phase 7] Embedding engine + pgvector port` | Phase 7 |
| B — Recall sub-algorithms | 10 | `[Phase 7] Complete recall sub-algorithms` | Phase 7 |
| C — LLM-dependent handlers | 5 | `[Phase 7] Wire LLM client` | Phase 7 |
| D — Other | 5 | `[Phase 7] Misc port-pending` (incl. v3.14.12 deadlock-fix verification) | Phase 7 |
| E — DI wiring (mislabeled) | 8 | `[Phase 7] Composition-root DI for codebase-analysis` | Phase 7 |
| F — Composition root stubs | 6 | (Phase 2/3, already tracked) | Phase 2/3 |
| G — Placeholder | 1 | (Phase 2, already tracked) | Phase 2 |
| H — Cortex source re-sync | n/a (drift, not in-tree port-pending markers) | `[Phase 7] Cortex re-sync (post-v3.14.9)` | Phase 7 |
| **Total in-tree markers** | **51** | | |

The total here (51) differs from the audit's count of 56 due to two
reconciliations: (a) the `packages/core/src/index.ts` placeholder was
hardened in this same commit and now carries one explicit `port-pending`
marker (Group G); (b) some Phase-4 files had multiple port-pending lines
collapsed into a single conceptual marker in the audit. The grep-able
total in `packages/*/src` should remain in the 50–60 range until Phase 7
work begins; `scripts/audit-migration.sh` Check 6 surfaces the exact
count for human review.

---

## How to close a tracking entry

When you port one of the markers above:

1. Remove the `port-pending` line from the source file.
2. Move the row from this document to a `closed/` subsection (do NOT
   delete; the audit trail must remain).
3. Update the relevant ADR if the resolution introduces a new contract.
4. Re-run `bash scripts/audit-migration.sh` and confirm the marker count
   drops by 1.
