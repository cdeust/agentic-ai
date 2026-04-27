# Parity Oracle — Sampling Rationale

Cochrane-style evidence synthesis applied to corpus design. The baseline
corpus is the evidence base. Every TS port is a hypothesis ("port X preserves
source semantics"). Each fixture is a trial that tests a specific failure mode.

**Bias risk if sampling is poor:** a corpus composed only of happy-path inputs
is analogous to a publication-biased literature — it overestimates the quality
of a port that silently breaks on error paths, edge cases, or known prior bugs.

**Protocol:** fixtures are selected to collectively cover (a) happy paths,
(b) edge cases, (c) error/rejection paths, and (d) adversarial cases that
encode specific prior bugs from source-repo CHANGELOGs. Every fixture states
its failure modes explicitly.

---

## 1. Cortex — recall handler

### recall_simple_query.json
**Why selected:** Establishes the base schema contract. If a TS port misnames
any top-level key (`results`, `total`, `query_intent`, `dispatch_tier`,
`signals`, `enhancements`), this fixture catches it.
**Failure mode this is the only fixture that tests:** response shape on the
happy path with zero extra parameters.

### recall_multi_signal.json
**Why selected:** Tests two behavioral invariants simultaneously: the `max_results`
cap and the `min_heat` filter. Prior bugs in recall implementations tend to
ignore one of these on the base-retrieval path but apply it on the
enrichment path, producing result counts that are off by one or that
include cold memories.
**Failure modes caught:** filter bypass, cap bypass.

### recall_with_domain.json
**Why selected:** Domain isolation is a load-bearing invariant — a recall
implementation that ignores the domain filter exposes cross-project memory
leakage. The `agent_topic` parameter tests subagent isolation.
**Failure modes caught:** domain filter ignored, agent_topic leak.

### recall_empty_corpus.json
**Why selected:** Tests the most common TS port crash mode: an implementation
that assumes `results[0]` exists crashes on the co-activation or strategic
ordering path when results is empty. This fixture is adversarial in that it
uses `min_heat=0.99` to guarantee an empty result even in a seeded DB.
**Failure modes caught:** crash on empty array, missing fields on zero-result path.

### recall_unicode.json
**Why selected:** Non-ASCII query strings expose character encoding bugs that
Python handles transparently but TS ports (especially those binding to native
embedding libraries) may truncate or mojibake. Japanese characters test the
specific case of multi-byte UTF-8 sequences that are common in Cortex's
user base.
**Failure modes caught:** UTF-8 truncation, embedding engine crash on non-ASCII.

### recall_no_query.json
**Why selected:** The null-args guard is a documented behavioral contract
(handler returns `{results: [], total: 0}` not a throw). TS ports frequently
implement this as a thrown exception instead, which breaks the MCP protocol
contract.
**Failure modes caught:** null input handling, error path shape.

---

## 2. Cortex — remember handler

### remember_basic.json
**Why selected:** The `bypass_error` gate is triggered by error-shaped content.
This is a critical behavioral invariant: if a TS port misses this bypass,
error traces will be silently dropped by the write gate.
**Failure modes caught:** bypass_error gate absent, stored/action/reason shape.

### remember_with_tags.json
**Why selected:** Tests the `important` tag bypass and `bypass_decision` gate.
These are the two most commonly used gate bypasses; both must be preserved.
Also tests domain resolution from `directory` parameter.
**Failure modes caught:** important tag bypass absent, decision bypass absent,
directory→domain resolution broken.

### remember_global.json
**Why selected:** The `is_global` flag is a cross-domain visibility mechanism.
If a TS port ignores it, global memories become invisible from other domains,
silently breaking the user identity memory pattern.
**Failure modes caught:** is_global flag lost, global_reason field absent.

### remember_no_content.json
**Why selected:** The `{stored: false, reason: 'no_content'}` contract is
explicitly tested in the Python test suite. This fixture encodes the same
test as a parity oracle fixture to catch a TS port that throws instead of
returning a structured response.
**Failure modes caught:** null input handling, error response shape.

### remember_with_initial_heat.json
**Why selected:** Encodes issue #14 P1 (bimodal heat cohort regression). This
was a real bug where imported memories all got `heat=1.0` regardless of
`initial_heat`, causing the recall heat distribution to be biased toward
recently imported content. The expected value uses a bounded mask to verify
the heat is significantly below 1.0.
**Failure modes caught:** initial_heat override ignored (issue #14 P1 regression),
Ebbinghaus age-decay not applied on backfill path.

### remember_unicode_content.json
**Why selected:** The Python `content_hardening` module strips bidirectional
override characters and applies NFC normalization. A TS port that skips this
step passes malicious or malformed content to the embedding engine, which can
produce security risks (bidi attack vectors) or silent semantic divergence
(decomposed vs composed Unicode forms stored as different embeddings).
**Failure modes caught:** content_hardening NFC absent, bidi stripping absent.

---

## 3. Cortex — consolidation handler

### decay_recent.json
**Why selected:** The A3 lazy-heat design (v3.12.0) changed `run_decay_cycle`
to return `memories_decayed=0` with `reason_for_zero='lazy_decay_via_effective_heat'`.
A TS port that implements the pre-A3 eager decay would pass the shape test
but fail this invariant test — and would also have a performance regression.
**Failure modes caught:** A3 lazy-heat design reverted (performance + behavioral regression).

### compress_stale.json
**Why selected:** Tests the compress-only path and the `status`/`failed_stages`
reporting contract. Also tests issue #14 P2: `reason_for_inaction` on the
cls stage distinguishing "empty store" from "cls ran but found nothing to do."
**Failure modes caught:** compress stage missing, partial-failure reporting broken,
issue #14 P2 diagnostic fields absent.

---

## 4. Cortex — methodology handlers

### query_methodology_cwd.json
**Why selected:** This is the mandatory session-start tool. All profile
fields must be present. The `hotMemories` and `firedTriggers` arrays are
the Phase 3 memory enrichment feature — if a TS port returns the profile
without these, session calibration is degraded.
**Failure modes caught:** hotMemories absent, firedTriggers absent,
context not enriched with memory summaries.

### detect_domain_cwd.json
**Why selected:** Domain detection drives all subsequent memory scoping.
The three-signal scoring (path tokens, project ID, keyword overlap) must
produce a non-null domain for known paths.
**Failure modes caught:** all three signals collapsed to null, alternativeDomains
absent, signals dict absent.

### query_methodology_cold_start.json
**Why selected:** The `coldStart=true` path has an exact fixed shape. A TS
port that returns `coldStart=false` when profiles.json doesn't exist causes
the agent to skip `rebuild_profiles`, leading to a permanently uncalibrated
session. This fixture is SHAPE-KNOWN and must pass without DB.
**Failure modes caught:** coldStart=false returned incorrectly, empty profile
fields not initialized to null/[]/0, context field absent.

---

## 5. Cortex — narrative handler

### narrative_query.json
**Why selected:** The `narrative` vs `summary` key distinction is the critical
shape difference between `brief=false` and `brief=true` paths. Getting this
wrong breaks README seeding and status update workflows.
**Failure modes caught:** wrong key name ('story', 'text' instead of 'narrative'),
themes array absent.

### narrative_brief.json
**Why selected:** Tests that the brief path does NOT include `narrative` or
`themes` keys — only `summary` and `memory_count`. If a TS port returns all
keys regardless of `brief`, callers may be confused by spurious fields.
**Failure modes caught:** brief path returns full narrative shape instead of
summary-only shape.

---

## 6. Cortex — import handler

### claude_mem_smallset.json
**Why selected:** Encodes ADR-0045 R2 (streaming head+tail only; no full-file
read). A TS port that reads the entire JSONL file into memory reintroduces
the OOM path that Taleb's audit flagged in v3.13.0. The `dry_run=true` flag
also tests that no memories are stored during dry runs.
**Failure modes caught:** full-file read regression (ADR-0045 R2), dry_run=true
storing memories, subagent JSONL included despite filter.

### import_no_sessions.json
**Why selected:** Tests the graceful empty-result path. A TS port that throws
`ENOENT` or returns `null` instead of `{imported:0, ..., error:'no_sessions_found'}`
breaks the caller's ability to distinguish "no sessions" from "import failed."
**Failure modes caught:** crash instead of structured error, error field absent.

---

## 7. Codebase / Rust binary fixtures

### health_check.json
**Why selected:** Tests subprocess lifecycle. A TS adapter that never starts
the Rust binary, or that starts it but doesn't track liveness, fails here.
Also tests for deadlock under the simplest possible call.
**Failure modes caught:** subprocess not started, deadlock on single call.

### index_codebase_smallrepo.json
**Why selected:** Encodes CHANGELOG 3.14.8's two critical regressions:
(1) BM25 tip-of-iceberg returning 2 symbols from a large project, (2) cache
poisoning memoising an error path as success. The fixture uses a 10-file
Python project with ~20 symbols to produce assertions that are strong enough
to catch a regression (symbols >= 20, not symbols == 2) without requiring
an exact count.
**Failure modes caught:** CHANGELOG 3.14.8 BM25 regression (2 symbols),
cache poisoning, zero edges extracted.

### query_graph_simple.json
**Why selected:** Tests that call edges are extracted. CHANGELOG 3.14.8
showed that edges were 0 before the fix. This fixture verifies at least one
callee edge exists for `src.retrieval.recall`.
**Failure modes caught:** zero edges in graph, Function→Process noise not filtered.

### get_symbol_known.json
**Why selected:** Tests file attribution. CHANGELOG 3.14.8 fixed file_path
attribution to use containment edges rather than the `qn.split('::')[0]`
heuristic that produced fake file paths for Rust-style qualified names.
**Failure modes caught:** file_path absent, file_path wrong (heuristic regression).

### search_codebase_keyword.json
**Why selected:** Specifically guards against the CHANGELOG 3.14.8 BM25
cap regression. Uses `max_results=20` to ensure the cap is not re-introduced
at 2. The fixture asserts `total != 2`.
**Failure modes caught:** CHANGELOG 3.14.8 BM25 2-result cap regression.

---

## 8. prd-pipeline fixtures

### start_pipeline_no_codebase.json
**Why selected:** Tests the fundamental start → first-action contract. All
callers of the pipeline depend on receiving a `run_id` and a `NextAction`.
Also guards CHANGELOG 0.2.0 HIGH: start_pipeline not draining
`strategy_executions` after initial step.
**Failure modes caught:** run_id absent, action absent, strategy drain missing.

### start_pipeline_with_codebase.json
**Why selected:** Tests that `codebase_path` is stored in state and
propagated. Without this, the context_detection step cannot trigger
`index_codebase`.
**Failure modes caught:** codebase_path lost in state.

### start_pipeline_skip_preflight.json
**Why selected:** Tests `emit_message` coalescing. The runner must advance
past preflight without pausing for host input. If coalescing is broken, the
host gets stuck on `emit_message` actions forever.
**Failure modes caught:** emit_message coalescing broken, skip_preflight=true
not respected.

### submit_clarification_proceed.json
**Why selected:** Encodes CHANGELOG 0.2.0 CRIT: `runner.ts` coalesce-cap
path bypassing `appendError`, breaking the `errors`/`error_kinds` lockstep
invariant. Also tests the `inFlight` Set that rejects concurrent submissions
for the same run_id.
**Failure modes caught:** errors/error_kinds lockstep broken, concurrent
submission not rejected.

---

## 9. Coverage assessment

| Dimension | Coverage |
|---|---|
| Happy paths | recall_simple_query, remember_basic, methodology_cwd, narrative_query, health_check, start_pipeline_no_codebase |
| Edge cases | recall_empty_corpus, recall_unicode, remember_unicode_content, import_no_sessions, query_methodology_cold_start |
| Error/rejection paths | recall_no_query, remember_no_content, import_no_sessions |
| Prior bugs (CHANGELOG) | recall_empty_corpus (co-activation crash), remember_with_initial_heat (issue #14 P1), decay_recent (A3 lazy-heat), index_codebase (3.14.8 BM25 regression + cache poisoning), search_codebase_keyword (3.14.8 BM25 cap), submit_clarification (0.2.0 CRIT errors/error_kinds) |
| Unicode / encoding | recall_unicode, remember_unicode_content |
| Security / bidi | remember_unicode_content (bidi strip) |
| Performance regressions | decay_recent (A3 lazy-heat reverted = O(n) UPDATE), index_codebase (OOM via full-file read) |
| Protocol contracts | recall_no_query (null-arg handler contract), remember_no_content (null-arg handler contract), health_check (subprocess liveness) |

**Gaps not covered (deferred to Popper adversarial corpus):**
- Recall with very long query (>4096 chars) — embedding truncation
- Remember with content at the 100k byte cap boundary — content_hardening byte cap
- Consolidation deep-sleep path — too slow for a fixture corpus
- Wiki sync partial failure path (wiki_sync error surfaced in warnings[])
- Rate limit / timeout behavior of Rust subprocess

These gaps are acceptable for the Day-0 baseline. The Popper adversarial panel
(§4.1 of every TS-port MISSION.md) is responsible for the remaining
adversarial cases.
