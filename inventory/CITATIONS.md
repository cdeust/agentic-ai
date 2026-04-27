# Cortex Python Source — Citation Provenance

**Source root**: `/Users/cdeust/Developments/Cortex/mcp_server/`
**Extracted**: 2026-04-26
**Method**: `grep -rn "# source:\|# Source:\|Paper backing\|Paper:\|# Ref:" --include="*.py"` plus manual annotation scan

Every `# source:` annotation found in the Python source MUST travel verbatim
into the TypeScript port as a `// source:` annotation at the corresponding site.
Failure to preserve these is a §3.2 acceptance contract violation.

---

## 1. Explicit `# source:` / `# Source:` Annotations

### `mcp_server/handlers/backfill_helpers.py` (lines 26–31)

```python
# source: Ebbinghaus, H. (1885). "Über das Gedächtnis." r(t) = exp(-t/S)
# source: half-life tuned to the Cortex 30-day consolidation window
```

**What it annotates**: Initial heat assignment for backfilled memories — exponential decay from session date relative to current time. `S` is the half-life parameter tuned empirically to 30 days.

**TS port must preserve**: Both lines verbatim at the `computeInitialHeat` function.

---

### `mcp_server/handlers/consolidation/homeostatic.py` (lines 46–51)

```python
# source: Pfister et al. (2013) "Good things peak in pairs." Frontiers in
#         Computational Neuroscience. Bimodality test for homeostatic state.
#         Pfister threshold has false-positives on platykurtic unimodal
```

**What it annotates**: The bimodality coefficient threshold used to detect whether the heat distribution requires homeostatic normalisation.

**TS port must preserve**: Full multi-line annotation at the bimodality test site.

---

### `mcp_server/core/homeostatic_plasticity.py` (lines 230–234)

```python
# source: Wilcox, R. R. (2012). "Modern Statistics for the Behavioral
#         Sciences." Bimodality coefficient < 5/9 indicates unimodal.
# source: Hinton & Salakhutdinov (2006). "Reducing the Dimensionality of
#         Data with Neural Networks." Science 313(5786):504–507.
```

**What it annotates**: Robust statistics for homeostatic plasticity coefficient calculation. The bimodality coefficient threshold of `5/9 ≈ 0.556` is the Wilcox (2012) criterion.

**TS port must preserve**: Both source lines verbatim at the `updateHomeostaticFactor` function.

---

### `mcp_server/core/entity_reconciliation.py` (lines 39, 206)

```python
# Source: chosen to be no larger than the cascade's LABILE+EARLY_LTP
#         window (pg_schema.py:748-752 alpha exponents and Kandel 2001)
# ...
# Source: empirical upper bound for the retroactive-entity-orphan rate on
#         a 25k-memory corpus (internal benchmark, 2024-11).
```

**What it annotates**: Window size for retroactive entity reconciliation and orphan-rate cap. The cascade window reference is structural (not a numeric constant), but the empirical upper bound is a measured constant.

**TS port must preserve**: Both annotations. The benchmark reference requires a corresponding benchmark file.

---

### `mcp_server/handlers/admission.py` (line 36)

```python
# Source: docs/program/phase-5-pool-admission-design.md §1.4.
```

**What it annotates**: The admission threshold for the write pool gate.

**TS port must preserve**: The source reference. The design doc must be included in `packages/memory/sources/`.

---

### `mcp_server/handlers/anchor.py` (line 140)

```python
# Source: phase-3-a3-migration-design.md §3.3. Phase 5: pooled write.
```

**What it annotates**: Why anchored memories use `heat_base = 1.0` (not just `no_decay = True`).

---

### `mcp_server/handlers/consolidation/cascade.py` (lines 20, 25)

```python
# Source: issue #13 — cascade previously wrote a heartbeat UPDATE on
#         every stage check; removed to eliminate write amplification.
# Source: issue #13 — the 503-transition payload darval reported is
#         caused by the heartbeat write under load.
```

**What it annotates**: Why the cascade no longer writes a heartbeat row — bug fix rationale.

**TS port must preserve**: Both lines. Issue #13 reference should link to GitHub if possible.

---

### `mcp_server/handlers/consolidation/cls.py` (lines 25, 344)

```python
# Source: issue #13 — previous cap of 500 saw ~2% of a 25k-episodic
#         corpus transferred per run; raised to 2000 after profiling.
# Source: PC algorithm lower bound — need ≥3 observations per variable
#         for conditional independence tests. Minimum cluster size = 3.
```

**What it annotates**: Batch size cap for CLS transfer and minimum cluster size for causal PC algorithm.

**TS port must preserve**: Both annotations.

---

### `mcp_server/handlers/consolidation/memify.py` (line 28)

```python
# Source: mcp_server.core.curation (identify_prunable defaults).
```

**What it annotates**: Where the candidate-selection thresholds for memification come from.

---

### `mcp_server/handlers/consolidation/plasticity.py` (line 79)

```python
# Source: issue #13 — the previous limit=50 sampled ~0.5% of a 10k-
#         memory corpus; raised to 500 to cover ~5%.
```

**What it annotates**: Sample size for plasticity updates.

---

### `mcp_server/handlers/remember.py` (lines 302–304)

```python
    # override via initial_heat to reflect content age (Ebbinghaus curve —
    # backfill_helpers.py). Source: issue #14 P1.
```

**What it annotates**: Why `remember` accepts an `initial_heat` parameter to support backfill scenarios.

---

### `mcp_server/hooks/preemptive_context.py` (line 131)

```python
    # Source: phase-3-a3-migration-design.md §3.4.
```

**What it annotates**: The heat bump formula applied by preemptive context (A3 lazy-heat read path).

---

### `mcp_server/infrastructure/memory_config.py` (line 149)

```python
    # Source: docs/program/phase-5-pool-admission-design.md §1.1.
```

**What it annotates**: Pool size constant.

---

### `mcp_server/infrastructure/pg_schema.py` (lines 521, 539–540, 659)

```python
# Source: docs/program/phase-3-a3-migration-design.md §2.
# ...
-- p_factor default: 0.95 per DAY (pre-A3 DECAY_MEMORIES_FN ran ~daily,
-- each run applied factor 0.95 once). Converted to per-hour equivalent:
-- 0.95^(1/24) ≈ 0.99787. This preserves the macroscopic decay rate while
-- making the function continuous in elapsed hours. Source:
-- docs/program/phase-3-a3-migration-design.md §2.
# Source: docs/program/phase-3-a3-migration-design.md §4.
```

**What it annotates**: The `p_factor = 0.99787` constant in the `effective_heat` stored procedure — the per-hour decay rate derived from the legacy daily rate of 0.95.

**TS port must preserve**: The derivation formula `0.95^(1/24) ≈ 0.99787` verbatim as a `// source:` comment at the equivalent constant in TS.

---

## 2. Inline Paper Backing (Docstring-style)

These are in module docstrings (not `# source:` lines) but carry equal authority — the TS port must preserve them as JSDoc `@remarks` or `// paper:` comments.

### `mcp_server/core/context_assembly/ppr_traversal.py`

```
**Paper backing**:
  Gutiérrez, Shu, Gu, Yasunaga, Su. "HippoRAG: Neurobiologically
  Inspired Long-Term Memory for Large Language Models". NeurIPS 2024,
  arxiv 2405.14831. Section 3.3 — scores passages by aggregating PPR
  mass of their contained entities seeded on query entities. Reports
  strong multi-hop QA gains on MuSiQue, 2WikiMultihopQA, HotpotQA.
```

**Constant to preserve**: PPR teleportation probability (if hardcoded in implementation).

---

### `mcp_server/core/context_assembly/active_retrieval.py`

```
**Paper backing**:
  Wang & Chen, "MIRIX: Multi-Agent Memory System for LLM-Based Agents",
  arxiv 2507.07957 (July 2025). § Active Retrieval: the agent generates
  a topic/sub-query from the raw question, retrieves on the refined
  query, and injects the result into the system prompt. Reported 85.4%
  on LoCoMo.
```

---

### `mcp_server/core/context_assembly/coverage.py`

```
**Paper backing**:
  Krause & Guestrin, "Near-Optimal Sensor Placements in Gaussian
  Processes", JMLR 9:235-284 (2008). Proves that for a monotone
  submodular set function f, the greedy algorithm returns S_k with
  f(S_k) >= (1 - 1/e) * f(S*_k) ≈ 0.63 * optimal. Also introduces
  the lazy greedy acceleration (Minoux 1978).
```

**Constant to preserve**: MMR λ parameter (typically λ = 0.5). Must be annotated `// source: Krause & Guestrin 2008`.

---

### `mcp_server/hooks/auto_recall.py`

```
Paper backing:
  - Smith & Vela 2001: context reinstatement produces ~15-20% recall
    boost (d=0.28).
  - Bar 2007: proactive brain generates predictions from context
    BEFORE conscious retrieval request.
  - Collins & Loftus 1975: query text activates related memory nodes
    via spreading activation.
```

**Constant to preserve**: `d=0.28` effect size if used as a threshold.

---

### `mcp_server/hooks/agent_briefing.py`

```
Paper backing:
  - Smith & Vela 2001 "Environmental context-dependent memory" (meta-analysis):
    context reinstatement at retrieval produces reliable memory benefit
    (d=0.28, ~15-20% boost).
  - Wegner 1987 Transactive Memory Systems: directory knowledge — each
    agent knows what the team knows.
```

---

### `mcp_server/hooks/preemptive_context.py`

```
Paper backing:
  - Bar 2007 "The proactive brain" (Trends in Cognitive Sciences)
  - Collins & Loftus 1975: spreading activation
  - Smith & Vela 2001: context reinstatement benefit (d=0.28)
```

---

### `mcp_server/hooks/pipeline_impact_bump.py`

```
Paper backing:
  * Collins & Loftus 1975 — spreading activation on a structured graph.
  * Smith & Vela 2001 — context reinstatement benefit (d=0.28)
```

---

## 3. Inline Citation Comments (Not `# source:` Syntax but Load-Bearing)

These appear as regular inline comments citing specific papers. The TS port must preserve them verbatim at the same logical site.

| File | Line content | What it annotates |
|---|---|---|
| `core/decay_cycle.py:203` | `# Apply consolidation stage multiplier (Kandel 2001)` | Stage-alpha exponent applied to decay |
| `core/decay_cycle.py:218` | `# Enforce permastore floor (Bahrick 1984)` | `heat_floor = 0.10` constant |
| `core/thermodynamics.py:266–267` | `# Emotional resistance: time-dependent (Yonelinas & Ritchey 2015)` / `# Emotional advantage grows with delay (Kleinsmith & Kaplan 1963 crossover)` | Emotional damping β formula |
| `core/reconsolidation.py:143` | `# Reconsolidation regime — emotional multiplier (Yonelinas & Ritchey 2015)` | Multiplier in reconsolidation heat update |
| `core/two_stage_model.py:86` | `# Engineering choice. McClelland et al. (1995) discuss hippocampal capacity` | Hippocampal buffer capacity limit |
| `core/separation_core.py:53` | `# Leutgeb et al. (2007) Science 315:961-966; Rolls (2013) Front Syst Neurosci.` | Pattern separation threshold |
| `core/cascade_stages.py:107–115` | `# Bahrick (1984): permastore` / `# Benna & Fusi (2016): deepest cascade levels` / `heat_floor=0.10` | Permastore floor constant |
| `shared/memory_types.py:66` | `# Consolidation cascade (Kandel 2001, Dudai 2012)` | `ConsolidationStage` enum ordering |
| `shared/memory_types.py:73` | `# Oscillatory context (Hasselmo 2005, Buzsaki 2015)` | `theta_phase_at_encoding` field |
| `shared/memory_types.py:85` | `# Hippocampal dependency (McClelland 1995)` | `hippocampal_dependency` field |
| `infrastructure/memory_config.py:77` | `# ── Spreading Activation (Collins & Loftus 1975) ────────────────────` | Spreading activation decay constant |
| `infrastructure/pg_schema.py:530–532` | `# Stage-dependent α (Kandel 2001)` / `# Emotional damping β (Yonelinas & Ritchey 2015, Kleinsmith & Kaplan 1963)` / `# Stage floors (Bahrick 1984 permastore, Benna & Fusi 2016)` | Constants in `effective_heat` PL/pgSQL function |
| `core/memory_ingest.py:104` | `# Wegner 1987 Transactive Memory Systems: team knowledge requires` | Decision memories receive protected flag |
| `handlers/recall.py:274` | `# Biological basis: retrieval = hippocampal replay (McClelland 1995)` | Why recall triggers reconsolidation |

---

## 4. Numeric Constants with Citation Requirements

These constants appear in the Python source and MUST carry a `// source:` annotation in the TS port.

| Constant | Value | Location | Citation |
|---|---|---|---|
| `p_factor` (per-hour decay) | `0.99787` | `pg_schema.py:EFFECTIVE_HEAT_FN` | `0.95^(1/24)` — phase-3-a3-migration-design.md §2 |
| `heat_floor` (permastore) | `0.10` | `core/cascade_stages.py:115` | Bahrick (1984) |
| Bimodality coefficient | `5/9 ≈ 0.556` | `core/homeostatic_plasticity.py:230` | Wilcox (2012) |
| MMR λ parameter | Check implementation | `core/mmr_diversity.py` | Krause & Guestrin (2008) |
| Smith & Vela effect size | `d = 0.28` | `hooks/auto_recall.py` docstring | Smith & Vela (2001) |
| Ebbinghaus half-life | `S = 30 days` (tuned) | `handlers/backfill_helpers.py:31` | Ebbinghaus (1885) + empirical tuning |
| PPR teleportation α | Check implementation | `core/context_assembly/ppr_traversal.py` | Gutiérrez et al. (2024) §3.3 |
| HNSW m parameter | `16` | `infrastructure/pg_schema.py:INDEXES_DDL` | pgvector HNSW default |
| HNSW ef_construction | `64` | `infrastructure/pg_schema.py:INDEXES_DDL` | pgvector HNSW default |
| Heat bump on citation | `0.05` | `infrastructure/pg_schema.py:WIKI_TRIGGERS_DDL` | Internal design decision |

---

## 5. Design Document References

The following internal design documents are referenced in `# Source:` annotations and must be archived under `packages/memory/sources/design-docs/` in the TS monorepo:

| Document | Referenced at |
|---|---|
| `docs/program/phase-3-a3-migration-design.md` | `pg_schema.py:521,540,659`; `hooks/preemptive_context.py:131` |
| `docs/program/phase-5-pool-admission-design.md` | `handlers/admission.py:36`; `infrastructure/memory_config.py:149` |
| GitHub issue #13 (darval report) | `handlers/consolidation/cascade.py:20,25`; `handlers/consolidation/cls.py:25`; `handlers/consolidation/plasticity.py:79` |
| GitHub issue #14 P1 | `handlers/remember.py:304` |
