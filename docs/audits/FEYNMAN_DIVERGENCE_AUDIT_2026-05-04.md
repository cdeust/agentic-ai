# Feynman Divergence Audit — TS Port vs Cortex Python/Rust Source

**Auditor:** Feynman integrity audit agent  
**Date:** 2026-05-04  
**HEAD audited:** `8b28dbe` (agentic-ai repo)  
**Cortex source ref:** `ed33435` (Cortex repo, Python)  
**User directive:** No simplification. No discordance. TS must behave identically to all four source repos.

---

## §1 Per-PR Verdict

| PR  | Scope | Files Sampled | Verdict |
|-----|-------|---------------|---------|
| #29 | Group B: hopfield, hdc-encoder, spreading-activation, dendritic-clusters, knowledge-graph | 5/5 | **DIVERGENT** |
| #34 | @agentic/memory-dashboard (HTTP server port) | not sampled (no divergence flag raised) | PASS (not sampled) |
| #35 | fractal-drill-down, file-scanner, seed-project, change-impact | 1/4 (fractal-drill-down) | **DIVERGENT** |
| #36 | pg_store_wiki + 10 wiki sub-handlers (wiki-emerge, etc.) | 2/10 (wiki-emerge, wiki-staleness) | **DIVERGENT** |
| #39 | 11 AP Rust tools in RustPipelineAdapter | 1/1 (adapter wiring) | PASS (structural only) |
| #40 | Eng-4 wiki core (5 modules) | wiki-staleness (overlap with #36) | PASS |
| #41 | Eng-5 neuro-models (12 modules) | synaptic-plasticity-hebbian, homeostatic-plasticity | **DIVERGENT** |
| #42 | Eng-7 handlers + 7 tool registries | wiki-emerge-handler (overlap with #36) | **DIVERGENT** |

**Total files sampled (deep read):** 10  
**PASS:** 2 PRs (no divergences in sampled files)  
**DIVERGENT:** 5 PRs (named divergences found in sampled files)  
**FAIL:** 0 (no complete behavioral inversion found)

---

## §2 Per-File Side-by-Side Comparisons

### 2.1 `hopfield.ts` vs `hopfield.py`

**Python source:** `cortex@ed33435 mcp_server/core/hopfield.py`  
**TS port:** `packages/memory/src/recall/hopfield.ts`

| Feature | Python | TypeScript | Verdict |
|---------|--------|------------|---------|
| `retrieve()` ablation guard | Inside `retrieve()` — `is_mechanism_disabled(Mechanism.HOPFIELD)` at line 100 | Moved to caller (`recall-handler.ts`) — `if (!ABLATE_HOPFIELD)` guard at line 313 | MATCH (architectural refactor, equivalent behavior — guard is applied before call, not inside) |
| `retrieve()` algorithm | `softmax(beta * X @ q)`, top-k filter `attention[i] > 0` | Identical: `softmax(beta * matVecMul(rows, q))`, filter `w > 0` | MATCH |
| `retrieve_sparse()` | `sparsemax(logits)`, nonzero filter, top-k slice | Identical algorithm | MATCH |
| `pattern_completion()` | `xi_new = X^T @ softmax(beta * X @ xi_old)`, L2-normalize each step, `iterations=5` | Identical loop, `DEFAULT_ITERATIONS = 5` | MATCH |
| `compute_energy()` | `-logsumexp(beta * X @ q_normed) + 0.5 * |xi|^2` | Identical: `-logSumExp(logits) + ENERGY_NORM_COEFF * normSq`, `ENERGY_NORM_COEFF = 0.5` | MATCH |
| `cosine_similarity()` | `dot / (norm_a * norm_b)`, return `0.0` if norm==0 | **MISSING** — not ported to TS | **DIVERGENT (missing helper)** |
| Default beta | `8.0` | `DEFAULT_BETA = 8.0` | MATCH |
| Default top_k | `10` | `DEFAULT_TOP_K = 10` | MATCH |
| Default iterations | `5` | `DEFAULT_ITERATIONS = 5` | MATCH |

### 2.2 `hdc-encoder.ts` vs `hdc_encoder.py`

**Python source:** `cortex@ed33435 mcp_server/core/hdc_encoder.py`  
**TS port:** `packages/memory/src/recall/hdc-encoder.ts`

| Feature | Python | TypeScript | Verdict |
|---------|--------|------------|---------|
| `HDC_DIM` | `1024` | `HDC_DIM = 1024` | MATCH |
| `_SEED` | `0xDEADBEEF` | `_SEED = 0xdeadbeef` | MATCH |
| `_word_to_hdc()` RNG | `np.random.default_rng(seed=sha256_mod_2^32)` — NumPy's PCG64 PRNG | **xorshift32 substituted** — different PRNG algorithm entirely | **DIVERGENT (algorithm)** |
| Word length filter | `len(w) > 1` → includes 2-char words | `w.length > MIN_WORD_LEN` where `MIN_WORD_LEN = 2` → `length > 2` → excludes 2-char words | **DIVERGENT (algorithm/constant off-by-one)** |
| Ablation guard | `is_mechanism_disabled(Mechanism.HDC)` inside `compute_hdc_scores()` | Moved to recall-handler.ts (`if (!ABLATE_HDC)`) — equivalent behavior | MATCH (refactored) |
| `bundle()` tiebreak | `np.random.default_rng(seed=dim ^ _SEED)` — NumPy PCG64 | xorshift32 with same `dim ^ _SEED` seed — different values per position | **DIVERGENT (algorithm)** |
| `similarity()` | `dot / dim` | `dot / dim` | MATCH |
| `threshold` default | `0.05` | `DEFAULT_HDC_THRESHOLD = 0.05` | MATCH |
| Stop-word list | 38 words | 38 words (identical list) | MATCH |

**Consequence of RNG divergence:** `wordToHdc` in TS produces different bipolar vectors than Python. HDC similarity scores are not numerically reproducible across the two implementations. Any test comparing Python and TS HDC outputs will fail.

**Consequence of word-length divergence:** Words exactly 2 characters long (e.g., "go", "js", "ts", "db", "id", "ui") that appear in technical content are excluded from TS HDC encoding but included in Python. Query vectors and memory vectors are computed differently, reducing HDC retrieval accuracy for technical content.

### 2.3 `spreading-activation.ts` vs `spreading_activation.py`

| Feature | Python | TypeScript | Verdict |
|---------|--------|------------|---------|
| Decay constant | `_DEFAULT_DECAY = 0.65` | `DEFAULT_DECAY = 0.65` | MATCH |
| Threshold | `_DEFAULT_THRESHOLD = 0.1` | `DEFAULT_THRESHOLD = 0.1` | MATCH |
| Max depth | `_DEFAULT_MAX_DEPTH = 3` | `DEFAULT_MAX_DEPTH = 3` | MATCH |
| Max nodes | `_DEFAULT_MAX_NODES = 50` | `DEFAULT_MAX_NODES = 50` | MATCH |
| `half_threshold` | `threshold * 0.5` | `threshold * HALF_THRESHOLD_FACTOR` where `HALF_THRESHOLD_FACTOR = 0.5` | MATCH |
| BFS loop | `for _depth in range(max_depth)` | `for (let _depth = 0; _depth < maxDepth; _depth++)` | MATCH |
| Cap logic | `sorted(items, key=x[1], reverse=True)[:max_nodes]` | `Array.from(entries).sort((a,b) => b[1]-a[1]).slice(0, maxNodes)` | MATCH |
| `map_entity_activation_to_memories` | `max(activation, current)` for each memory | Identical max logic | MATCH |
| Ablation guard | `is_mechanism_disabled(Mechanism.SPREADING_ACTIVATION)` — returns seeds only | `disabled` option passed from recall-handler | MATCH (refactored) |

**Verdict: PASS** — full behavioral parity for spreading activation.

### 2.4 `dendritic-clusters.ts` vs `dendritic_clusters.py`

| Feature | Python | TypeScript | Verdict |
|---------|--------|------------|---------|
| `entity_signature` type | `set[str]` — entity **names** (strings) | `Set<number>` — entity **IDs** (numbers) | **DIVERGENT (algorithm)** |
| `BRANCH_ADMISSION_THRESHOLD` | `0.3` (imported from `dendritic_computation.py`) | `0.3` (locally defined) | MATCH |
| `MAX_BRANCH_SIZE` | `15` | `15` | MATCH |
| Entity weight | `0.7` | `ENTITY_WEIGHT = 0.7` | MATCH |
| Tag weight | `0.3` | `TAG_WEIGHT = 0.3` | MATCH |
| `avg_heat` rounding | `round(new_avg, 4)` | `Math.round(... * ROUND_4DP) / ROUND_4DP` where `ROUND_4DP = 10000` | MATCH |
| Ablation guard | `is_mechanism_disabled(Mechanism.DENDRITIC_CLUSTERS)` inside `find_best_branch()` | `options?.disabled` — moved to recall-handler | MATCH (refactored) |

**Consequence of entity_signature type divergence:** The Jaccard similarity in `computeBranchAffinity` computes over entity integer IDs in TS (which come from the DB's auto-increment IDs) vs entity name strings in Python. Two branches will compute completely different affinity scores because `Set<number>` intersection is computed over opaque integers, not readable semantic names. The Jaccard values produced are numerically different, meaning branch assignment decisions differ between the two implementations for any given memory.

### 2.5 `knowledge-graph.ts` vs `knowledge_graph.py`

| Feature | Python | TypeScript | Verdict |
|---------|--------|------------|---------|
| `extract_entities()` | Present — calls 3 sub-extractors | Present — identical 3-extractor pipeline | MATCH |
| `_deduplicate_entities()` | Tuple key `(name, etype, rel_ctx)` | String key `${name}\0${type}\0${rel_ctx}` | MATCH (equivalent) |
| `detect_co_occurrences()` | Present — finds entity pairs within 500-char window | **MISSING** | **DIVERGENT (missing function)** |
| `_find_entity_positions()` | Present (helper for co-occurrences) | **MISSING** | **DIVERGENT (missing helper)** |
| `_min_pair_distance()` | Present (helper for co-occurrences) | **MISSING** | **DIVERGENT (missing helper)** |
| `infer_relationships()` | Present — creates typed edges from importers/deps/resolved/decisions | **MISSING** | **DIVERGENT (missing function)** |
| `_group_entities_by_context()` | Present (helper for infer_relationships) | **MISSING** | **DIVERGENT (missing helper)** |
| `VALID_REL_TYPES` frozenset | Present — 13 relationship types | **MISSING** | **DIVERGENT (missing constant)** |
| `ENTITY_TYPES` frozenset | Present — 16 entity types | **MISSING** | **DIVERGENT (missing constant)** |

**Consequence:** Any caller that relies on `detect_co_occurrences()` or `infer_relationships()` receives undefined in TS. The knowledge graph will have no co-occurrence edges and no inferred relationship edges, resulting in a structurally different (and much sparser) graph.

### 2.6 `fractal-drill-down.ts` vs `fractal.py` + `fractal_clustering.py`

| Feature | Python | TypeScript | Verdict |
|---------|--------|------------|---------|
| `build_hierarchy()` | Full 3-level hierarchy builder (L0/L1/L2) + `score_against_hierarchy()` | Only L1+L2 built; no score function | **DIVERGENT (missing functions)** |
| `compute_level_weights()` | `word_count < 10` → (0.3, 0.5, 1.0); `> 30` → (1.0, 0.5, 0.3); else → (0.7, 0.7, 0.7) | **MISSING** | **DIVERGENT (missing function)** |
| `score_against_hierarchy()` | Adaptive 3-level scoring with per-level weights | **MISSING** | **DIVERGENT (missing function)** |
| `roll_up()` | Maps memory_id → cluster hierarchy path `[L1_id, L2_id]` | **MISSING** | **DIVERGENT (missing function)** |
| `drill_down()` pure logic | Returns child cluster dicts | `fractalDrillDown()` returns child cluster records — structurally equivalent | MATCH |
| `drillDownHandler()` | Full handler with store I/O | Present and wired | MATCH |
| `_score_level_0/1/2` | Three private scoring helpers | **MISSING** | **DIVERGENT (missing helpers)** |

### 2.7 `wiki-staleness.ts` vs `wiki_staleness.py`

| Feature | Python | TypeScript | Verdict |
|---------|--------|------------|---------|
| `STALE_THRESHOLD` | `0.5` | `0.5` | MATCH |
| `MIN_FILE_REFS` | `2` | `2` | MATCH |
| `extract_file_refs()` | regex + dedup | Identical | MATCH |
| `evaluate_staleness()` | Logic identical | Logic identical | MATCH |
| `harvest_page_refs()` | Logic identical | Logic identical | MATCH |

**Verdict: PASS**

### 2.8 `wiki-emerge-handler.ts` vs `wiki_emerge.py`

| Feature | Python | TypeScript | Verdict |
|---------|--------|------------|---------|
| `conn.commit()` after persist loop | Present at line 261 — `if not dry_run: conn.commit()` | **MISSING** — no explicit commit | **DIVERGENT (missing side effect)** |
| `_fetch_resolved_claims()` SQL | Identical query | Identical query (adapted for pg library) | MATCH |
| `_existing_concepts_index()` | `out.setdefault(eid, r)` (first wins) | `if (!(eid in out)) out[eid] = row` (first wins) | MATCH |
| `_persist_plan()` | Complete insert/update/memo logic | Complete — all fields present | MATCH |
| Cold-start detection | `total_claims < COLD_START_MEMORY_THRESHOLD` | Same logic | MATCH |
| Return shape | `{claims_loaded, claims_grouped, ...}` | Identical shape | MATCH |
| `memory_limit` fallback | Not in Python handler schema | Added as TS-side alias for `limit` — extra input field | **DIVERGENT (extra branch)** |

**Consequence of missing commit:** In PostgreSQL transaction mode, writes made by `persistPlan()` in TS are never committed unless the pg library auto-commits. If the calling layer uses explicit transactions (which `WikiDbClient` may do), all concept inserts/updates will be silently rolled back on handler return.

### 2.9 `synaptic-plasticity-hebbian.ts` vs `synaptic_plasticity_hebbian.py`

| Feature | Python | TypeScript | Verdict |
|---------|--------|------------|---------|
| Ablation guard in `applyHebbianUpdate()` | Returns `[{**edge, weight: edge.get("weight",1.0), delta: 0.0, action: "none"} for edge in edges]` — padded no-op | **MISSING** — no ablation path; raw edges returned | **DIVERGENT (missing side effect / ablation guard)** |
| `co_accessed_pairs` type | `set[tuple[int, int]]` | `ReadonlySet<string>` — comma-separated `"min,max"` strings | **DIVERGENT (API contract)** |
| Pair key construction | `pair = (min(src, tgt), max(src, tgt)); if pair in co_accessed_pairs` | `pk = "${Math.min(src,tgt)},${Math.max(src,tgt)}"; cop.has(pk)` | **DIVERGENT (API contract)** |
| All numerical constants | `LTP=0.05, LTD=0.02, THETA_DECAY=0.95, A+=0.03, A-=0.02, TAU+=24, TAU-=24` | Same values | MATCH |
| `_hebbian_single()` rounding | `round(new_w, 6)` | `Math.round(nw*1_000_000)/1_000_000` | MATCH |
| Code style | Well-formatted functions | **Minified single-line functions** — violates readability standards | Style violation |

---

## §3 All DIVERGENT Sites

| # | File | Line | Divergence Type | Description |
|---|------|------|-----------------|-------------|
| D-01 | `recall/hopfield.ts` | — | missing-helper | `cosine_similarity()` not ported |
| D-02 | `recall/hdc-encoder.ts` | 100–108 | algorithm | `wordToHdc()` uses xorshift32; Python uses NumPy PCG64 — different PRNG produces different hypervectors |
| D-03 | `recall/hdc-encoder.ts` | 240 | constant | Word-length filter: TS `length > 2` (≥3 chars) vs Python `len(w) > 1` (≥2 chars) — 2-char words excluded in TS |
| D-04 | `recall/hdc-encoder.ts` | 157–165 | algorithm | `bundle()` tiebreak uses same PRNG substitution as D-02 — different tiebreak vectors |
| D-05 | `recall/dendritic-clusters.ts` | 42 | algorithm | `entitySignature: Set<number>` (IDs) vs Python `set[str]` (names) — Jaccard computed over different domains |
| D-06 | `recall/knowledge-graph.ts` | — | missing-helper | `detectCoOccurrences()` not ported (with 3 private helpers) |
| D-07 | `recall/knowledge-graph.ts` | — | missing-helper | `inferRelationships()` not ported (with 1 private helper) |
| D-08 | `recall/knowledge-graph.ts` | — | missing-helper | `VALID_REL_TYPES` and `ENTITY_TYPES` frozensets not ported |
| D-09 | `recall/fractal-drill-down.ts` | — | missing-helper | `computeLevelWeights()` not ported — adaptive retrieval logic absent |
| D-10 | `recall/fractal-drill-down.ts` | — | missing-helper | `scoreAgainstHierarchy()` not ported — 3-level scoring absent |
| D-11 | `recall/fractal-drill-down.ts` | — | missing-helper | `rollUp()` not ported — memory→cluster path absent |
| D-12 | `wiki/handlers/wiki-emerge-handler.ts` | — | side-effect | `conn.commit()` missing — DB writes may silently rollback |
| D-13 | `wiki/handlers/wiki-emerge-handler.ts` | 194–198 | algorithm | Extra `memory_limit` fallback branch not in Python handler |
| D-14 | `consolidation/synaptic-plasticity-hebbian.ts` | 36–38 | side-effect | Ablation guard (`SYNAPTIC_PLASTICITY` disabled path with no-op shape) missing |
| D-15 | `consolidation/synaptic-plasticity-hebbian.ts` | 28–33 | algorithm | `coAccessedPairs` type is `ReadonlySet<string>` (comma-separated) vs Python `set[tuple[int,int]]` — callers must serialize differently |

---

## §4 Partial Ports (TS exists but missing Python branches)

| File | Missing Python branches |
|------|------------------------|
| `recall/knowledge-graph.ts` | `detectCoOccurrences`, `inferRelationships`, `_find_entity_positions`, `_min_pair_distance`, `_group_entities_by_context`, `VALID_REL_TYPES`, `ENTITY_TYPES` |
| `recall/fractal-drill-down.ts` | `computeLevelWeights`, `scoreAgainstHierarchy`, `rollUp`, `_scoreLevel0`, `_scoreLevel1`, `_scoreLevel2` — the entire "adaptive hierarchical scoring" half of `fractal.py` |
| `recall/hdc-encoder.ts` | Algorithmically complete but PRNG and word-filter differ — not a missing branch but a different implementation |
| `consolidation/synaptic-plasticity-hebbian.ts` | Ablation guard no-op path in `applyHebbianUpdate` |
| `recall/hopfield.ts` | `cosine_similarity` helper |

---

## §5 Re-Porting Priority

Ranked by severity of behavioral impact (highest first):

### P0 — Data integrity failure
1. **`wiki-emerge-handler.ts` D-12 — missing `conn.commit()`**  
   All concept inserts and updates from `wikiEmergeHandler()` may silently rollback. The wiki's concept graph will not grow. Fix: add explicit commit after the persist loop, or verify that `WikiDbClient` auto-commits per statement.

### P1 — Silent wrong computation (different algorithm, same-shaped output)
2. **`hdc-encoder.ts` D-02, D-03, D-04 — PRNG substitution + word-length off-by-one**  
   Every HDC vector produced by TS differs numerically from its Python counterpart. Similarity scores are not comparable. Any cross-process comparison of HDC scores will produce junk. Re-port: replace xorshift32 with the same PRNG contract (seed-deterministic bipolar vector), or document and test that the substitute is equivalent; fix `MIN_WORD_LEN` to `1` so 2-char words pass the filter.

3. **`dendritic-clusters.ts` D-05 — entity_signature type mismatch**  
   The Jaccard similarity in branch affinity is computed over entity integer IDs in TS vs entity name strings in Python. Branch assignment is systematically different. Re-port: change `DendriticBranch.entitySignature` to `Set<string>` and update all call sites that currently pass entity IDs to pass entity names instead.

4. **`synaptic-plasticity-hebbian.ts` D-14, D-15 — missing ablation guard + co_accessed_pairs API**  
   When ablation is active, TS skips the no-op shape injection, breaking downstream `_apply_updates` in the consolidation pipeline. The `coAccessedPairs` API difference means the TS function is not callable with the same arguments as Python — callers must serialize. Re-port: add the ablation guard; unify the co_accessed_pairs type.

### P2 — Missing capability (callers that depend on these functions get undefined/crash)
5. **`knowledge-graph.ts` D-06, D-07, D-08 — missing `detectCoOccurrences` + `inferRelationships`**  
   Any caller (e.g., the remember pipeline, graph builder) that calls these functions will receive `undefined`. The knowledge graph will have no co-occurrence or inferred edges. Re-port: add all five missing functions and two frozenset constants.

6. **`fractal-drill-down.ts` D-09, D-10, D-11 — missing adaptive scoring half**  
   `scoreAgainstHierarchy`, `computeLevelWeights`, and `rollUp` are entire public API surfaces from `fractal.py` not present in the TS file. Any hierarchical recall path that goes through these functions is broken. Re-port: add the three public functions and their three private `_scoreLevel*` helpers.

### P3 — Missing private helper (low impact if not called externally)
7. **`hopfield.ts` D-01 — missing `cosine_similarity`**  
   Private utility. Impact depends on whether any consumer imports it from this module. Re-port if called.

---

## Audit Integrity Notes (Feynman self-check)

**What I rederived:** All algorithm comparisons were done by reading both files in full and tracing the control flow manually — no inference from doc comments.

**What I am uncertain about:** 
- Whether `WikiDbClient` auto-commits in the calling layer (D-12 may be a false positive if the client uses `autocommit: true`). This requires reading `pg-wiki-store-pages.ts` connection setup — not done in this audit pass.
- Whether `fractal-drill-down.ts` is the only call site for `scoreAgainstHierarchy` or whether a separate recall-hierarchical handler carries that logic. The Python fractal.py `score_against_hierarchy` may be called from `recall_hierarchical.py`; the TS equivalent would then be in `recall-hierarchical-handler.ts`, not this file.
- PR #34 (HTTP dashboard) and PRs #40/#42 Eng-4/Eng-7 beyond the overlap with #36 were not sampled. Their verdict is NOT AUDITED, not PASS.

**What would invalidate the D-05 (entity_signature) finding:** If the TS caller always converts entity names to IDs before constructing the `DendriticBranch`, and the Python caller always uses the same IDs (not names), then both would produce numerically equivalent Jaccard values. This requires auditing the call sites in the consolidation handler — not done here.

**What would invalidate the D-12 (missing commit) finding:** If `WikiDbClient` wraps `pg.PoolClient` with `autocommit: true`, no explicit commit is needed. Inspect `packages/memory/src/wiki/storage/pg-wiki-store-pages.ts` connection setup.
