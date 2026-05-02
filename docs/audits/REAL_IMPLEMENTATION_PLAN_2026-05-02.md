# Real-Implementation Plan — 2026-05-02

**Trigger**: user directive — "Stubs are not permitted we want real implementation and real wires… Seems like we have placeholder and stubs shit all over when there should be none."

**Sources**:
- Borges structural audit — `docs/audits/STUB_INVENTORY_2026-05-02.md` (PR #24): 48 unique stub sites across `packages/memory`, 9 CRIT.
- Feynman integrity audit — `docs/audits/PHASE_7_INTEGRITY_AUDIT_2026-05-02.md` (PR #25): re-derived every Phase-7 PR claim. **PR #23 verdict: FAIL — 5 source files claimed but never committed.**

---

## Confirmed Verdicts on Just-Merged Phase 7 PRs

| PR | Group | Verdict | What's actually true |
|---|---|---|---|
| #20 | C — LLM client | **PARTIAL** | Port + Anthropic adapter REAL. `narrativeHandler` calls real LLM. **But** MCP `narrative` tool returns "Phase 5 stub" string — `narrativeHandler` is unreachable from production. `wikiSynthesizeHandler` + `wikiPipelineHandler` accept `llmClient` then `void llmClient` — silently discarded. |
| #21 | D + E | **PASS** | `causal-graph.ts` real PC algorithm (PMI + cond-independence + temporal orientation). `cls.ts` actually calls it. ADR-0012 real. `MemoryStore.updateMemoryContent` executes real SQL. Codebase-analysis DI real. |
| #22 | A — Embeddings | **PARTIAL** | `TransformersEmbeddingEngine` calls real `@xenova/transformers` pipeline. pgvector `<=>` + sqlite-vec `MATCH` real. **But** live tests use `if (!env) return` pattern — they pass without running. Real model never validated end-to-end in CI. |
| #23 | B — Recall sub-algos | **FAIL** | The 5 source files (`hopfield.ts`, `hdc-encoder.ts`, `spreading-activation.ts`, `dendritic-clusters.ts`, `knowledge-graph.ts`) **DO NOT EXIST IN GIT**. They live only in `packages/memory/dist/recall/` (gitignored). `recall-handler.ts:243-246` still hardcodes `hopfield: [], hdc: [], sr: [], sa: []`. The 23 ablation env vars: `grep CORTEX_ABLATE` returns NOTHING. |

---

## Severity-Ranked Real-Implementation Wave

### CRIT — must close before any further marketing of "Phase 7 done"

**CRIT-A: PR #23 fraud — recover Group B real implementation**
- The 5 dist/*.js files at `packages/memory/dist/recall/{hopfield,hdc-encoder,spreading-activation,dendritic-clusters,knowledge-graph}.js` total 1081 LOC of compiled JS.
- They contain real algorithms (Ramsauer 2021 Hopfield, HDC bind/bundle, BFS spreading activation, Jaccard branch affinity, NL-token entity extraction).
- **Action**: convert each `dist/*.js` back to `src/*.ts` (decompile + re-add types) OR re-port from `cortex@bc0ae4f` Python. Either way, these MUST be committed source files.
- Wire each into `recall-handler.ts` replacing the hardcoded `[]` at lines 243-246.
- Wire the 23 `CORTEX_ABLATE_<MECH>` env-var contract per `inventory/CORTEX_DELTA.md` Group 7 — at handler entry, each env var skips the corresponding mechanism.
- Tests: each variant gets a real test file under `__tests__/recall/`.

**CRIT-B: Wiki synthesis + pipeline handlers `void`-ing the LLM client**
- `packages/memory/src/wiki/handlers/wiki-stubs.ts:211-212` (synthesize): `void args; void llmClient;` then returns hardcoded zeros.
- `packages/memory/src/wiki/handlers/wiki-stubs.ts:264-272` (pipeline): same pattern, `stages_run: []`.
- Caller receives **success-shaped lie** with zero work done.
- **Action**: implement real wiki synthesis (extract from `cortex@bc0ae4f mcp_server/handlers/wiki_synthesize.py`, `wiki_pipeline.py`). If pg_store_wiki adapter is genuinely a blocker, throw `PortPendingError` instead of fake-success.
- Rename `wiki-stubs.ts` to `wiki-handlers.ts` once stubs are gone. The file name is currently honest; the work isn't.

**CRIT-C: MCP narrative tool unreachable**
- `packages/mcp-servers/memory/src/tools/narrative.ts` lines 84, 111, 139 return hardcoded "Phase 5 stub" strings.
- The real `narrativeHandler` exists, has tests, calls real LLM — but is **never imported by the MCP tool**.
- **Action**: wire `narrativeHandler`, `getProjectStoryHandler`, `unifiedSearchHandler` into the MCP tool. The blocker per the comment is "MemoryStore adapter not yet injected" — the adapter exists in `packages/mcp-servers/memory/src/index.ts:78` (passed to `registerNarrativeTools`). Pass it down to the tool bodies.

**CRIT-D: Live hooks that silently discard data (Borges CRIT-008, CRIT-009)**
- `post-tool-capture` hook is a logged no-op — every Claude Code tool use loses its capture.
- `compaction-checkpoint` hook is a no-op — consolidation cascade never fires.
- **Action**: wire both to existing `remember` + `consolidation` packages. No external blocker — both packages are already on main.

---

### HIGH — incorrect-by-design that returns success

**HIGH-A: Embedding live-test gate makes mocked CI dishonest**
- `packages/memory/__tests__/remember/embedding-engine.test.ts:400, 421`: `if (!process.env["AGENTIC_EMBED_LIVE"]) return;` — **passes silently in CI**.
- Vitest counts these in the green bucket without ever calling `@xenova/transformers`.
- **Action**: replace with `it.skipIf(!process.env["AGENTIC_EMBED_LIVE"])(...)` so vitest reports them as `skipped`, not `passed`. Optionally add a daily CI cron that exports `AGENTIC_EMBED_LIVE=1` and runs the live tests against the real model.

**HIGH-B: Recall types schema lies (Borges CRIT-003)**
- `packages/memory/src/recall/types.ts:85-89` — schema slots default to `[]` for hopfield/hdc/sr/sa.
- Closed by CRIT-A above (once recall-handler returns real signals, the schema defaults stop lying).

**HIGH-C: Sync façades return [] (Borges CRIT-006, CRIT-007)**
- `loadSymbols`, `loadAstEdges` sync wrappers in workflow-graph source-ast.ts return [] when called sync.
- **Action**: either remove the sync façades (force callers to use `*Async` siblings) or make them genuinely synchronous via deasync (NOT recommended). Removal is cleaner.

---

### MED — comment-only deferrals + lingering placeholders

**MED-A: `__PLACEHOLDER__ = true` in `@agentic/core` barrel**
- Phase 0 Survival artefact. Verify zero consumers via grep, then delete.

**MED-B: Three MCP server "STATUS: port-pending" composition roots** (`codebase`, `reasoning`, `prd`)
- These are by-design Phase 2/3 stubs. Phase 3 (codebase) IS done; the composition root may still be shell-only. Phase 2 (reasoning, prd) — reasoning is migrated content + plugins; prd is the merged subtree.
- **Action**: audit each — wire the real MCP tool registration if their packages have real implementations. If they remain stubs, replace the "STATUS: port-pending" comment with a concrete tracking entry pointing at the missing piece.

**MED-C: Orchestrator `port-pending` markers (×3)**
- `packages/orchestrator/src/index.ts` says codebase/reasoning/prd servers are pending.
- **Action**: same as MED-B — orchestrator imports the three composition roots; if they're real now, replace the deferral.

**MED-D: 18 of 23 ablation env vars stubbed in PR #23 claim**
- Per Borges, NONE exist in source — even the 5 the agent claimed wired do not exist.
- Closed by CRIT-A (single comprehensive wave).

---

### LOW — comments only, no behavior gap

5 `// TODO` markers in test files and 1 in a doc-comment in `packages/codebase/src/internal/process-supervisor.ts`. Convert each to either a tracking entry or remove.

---

## Dispatch Plan — Parallel Engineer Waves

### Wave 1 (parallel, can land independently)

| Lane | Scope | Estimated effort | Blocker if any |
|---|---|---|---|
| **W1-A** | CRIT-A: Recover/re-port the 5 Group B files; wire 23 ablation env vars; replace recall-handler hardcoded `[]`; add real tests | Heavy (~120 min) — re-port 1081 LOC + tests + DI threading | None — dist/ source available as reference |
| **W1-B** | CRIT-B: Implement wikiSynthesizeHandler + wikiPipelineHandler with real LLM calls | Medium (~60 min) | pg_store_wiki adapter — port from Cortex Python if missing |
| **W1-C** | CRIT-C: Wire narrativeHandler/getProjectStoryHandler/unifiedSearchHandler into MCP tools/narrative.ts | Light (~30 min) — existing handlers + DI threading | None |
| **W1-D** | CRIT-D: Wire post-tool-capture + compaction-checkpoint hooks to remember/consolidation | Medium (~45 min) | None |
| **W1-E** | HIGH-A + MED-A: Fix live-test gating to `it.skipIf()`; remove `__PLACEHOLDER__` if no consumers | Light (~15 min) | None |

### Wave 2 (after Wave 1 lands — depend on real implementations existing)

| Lane | Scope |
|---|---|
| W2-A | MED-B + MED-C: Audit MCP composition roots for codebase/reasoning/prd — wire real MCP tool registrations |
| W2-B | HIGH-C: Remove sync façades or make genuinely sync |
| W2-C | LOW: Convert remaining TODO comments to tracking entries |

### Wave 3 — Genius cross-check after both waves

Re-run Borges + Feynman audits. The success criterion is `grep -rE 'port-pending|TODO|stub|placeholder' packages/*/src` returns ZERO matches outside test fixtures + comment-only license attribution. The user said "stubs are not permitted" — measure it.

---

## Acceptance criteria (all must hold before claiming done)

1. `grep -rEn 'port-pending' packages/*/src` returns 0 lines (currently 17).
2. `grep -rEn 'Phase 5 stub|MemoryStore adapter not yet injected' packages` returns 0 lines (currently ≥3).
3. Every `wikiSynthesizeHandler`, `wikiPipelineHandler`, `narrativeHandler`, `getProjectStoryHandler`, `unifiedSearchHandler` invocation from the MCP server returns real data — not a hardcoded note string.
4. The 5 Group B source files exist in `packages/memory/src/recall/` and are imported by `recall-handler.ts`.
5. The 23 `CORTEX_ABLATE_<MECH>` env vars are present in source and each guards a real (non-stub) mechanism.
6. Live model tests use `it.skipIf()`, not `if-return-pass-silently`.
7. Both Borges and Feynman re-audits PASS with zero new findings.
8. `pnpm test` count stays ≥ current 1541 (no regression).

---

## Operator notes

- The PR #23 fraud is the most serious finding. The agent that wrote it (`a793211aa2d02528d`) reported "5 new files, 97 new tests, 10 markers closed" but the tree-state shows zero new files merged. Likely the agent did the work in a worktree, ran `pnpm build` (which compiled to dist/), but failed to `git add` the source. The dist/ artefacts were force-pushed somewhere or are leftover from the worktree.
- Both audit branches (port/audit-stubs-2026-05-02 PR #24, audit/phase-7-integrity-2026-05-02 PR #25) should be merged once you've reviewed them — they're docs-only and provide the audit trail the user demanded.
- The user explicitly cross-checked with genius and asked for a clear plan. This document IS the plan; the dispatch follows.