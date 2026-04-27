# Cortex Python Source — Exhaustive Inventory

**Source root**: `/Users/cdeust/Developments/Cortex/mcp_server/`
**Extracted**: 2026-04-26
**Total Python files**: 361 (excluding `__pycache__`)
**Total LOC**: ~78 461

Cross-reference: `docs/PHASE_PLAN.md §4` in `/Users/cdeust/Developments/agentic-ai/docs/PHASE_PLAN.md`

---

## Legend

- **Phase-4 worktree**: the branch assigned in PHASE_PLAN.md §4 that owns this file's port
- **LOC**: non-blank source lines (from `wc -l`)
- **External imports**: third-party packages imported; stdlib excluded

---

## Group 1 — `port/cortex-remember`

Source: `mcp_server/handlers/remember*.py`
Target: `packages/memory/src/remember/`

| File | Purpose | Public exports | External imports | LOC |
|---|---|---|---|---|
| `handlers/remember.py` | Core write path — validates content, runs write-gate, stores memory via predictive coding gate | `handler`, `schema` | fastmcp, pgvector (indirect) | 395 |
| `handlers/remember_helpers.py` | Helper functions for remember: dedup detection, heat assignment, entity extraction | `build_memory_dict`, `compute_initial_heat`, `deduplicate_check` + 8 helpers | sentence-transformers (indirect) | 413 |
| `handlers/remember_response.py` | Formats the JSON response returned to the MCP caller after a write | `build_response` | — | 117 |
| `handlers/admission.py` | Pool admission gate — decides whether a candidate memory passes the write threshold | `should_admit`, `AdmissionResult` | — | 96 |
| `handlers/anchor.py` | Set a memory's heat to 1.0 and mark it compaction-resistant (`no_decay=True`) | `handler`, `schema` | — | 156 |
| `handlers/forget.py` | Hard-delete or soft-delete a memory by integer ID | `handler`, `schema` | — | 117 |
| `handlers/rate_memory.py` | Increment `useful_count` or penalise confidence based on user rating | `handler`, `schema` | — | 166 |
| `core/write_gate.py` | Predictive coding write gate — scores candidate against existing memories to suppress duplicates | `WriteGate`, `score_candidate` | sentence-transformers | 297 |
| `core/write_gate_calibration.py` | Platt-scaling calibration for write-gate scores | `calibrate_gate`, `PlattCalibrator` | scipy | 71 (approx) |
| `core/write_post_store.py` | Post-storage side-effects: entity extraction, embedding upsert, schema matching | `run_post_store` | sentence-transformers | 294 |
| `core/memory_ingest.py` | Ingest pipeline for a single memory item: classify store_type, assign fields | `ingest_memory` | — | ~120 |
| `core/write_gate_calibration.py` | (see above) | — | scipy | — |
| `core/predictive_coding_flat.py` | Flat (non-hierarchical) predictive coding error signal | `compute_pc_error` | numpy | 136 |
| `core/predictive_coding_gate.py` | Gate wrapper that calls flat PC and thresholds | `gate_write` | — | ~90 |
| `core/predictive_coding_signals.py` | Raw signal extraction from content (surprise, novelty) | `extract_signals` | — | ~80 |
| `core/abstention_gate.py` | Abstention policy — when to refuse a write entirely | `should_abstain` | — | 132 |
| `infrastructure/memory_store.py` | Abstract memory store interface + dispatch to pg or sqlite | `MemoryStore`, `get_store` | — | ~100 |
| `infrastructure/pg_store.py` | PostgreSQL implementation of MemoryStore: CRUD + search | `PGStore` | asyncpg, pgvector | 768 |
| `infrastructure/pg_store_entities.py` | Entity upsert/query helpers for PGStore | `upsert_entity`, `query_entities` | asyncpg | 218 |
| `infrastructure/pg_store_relationships.py` | Relationship upsert/query helpers | `upsert_relationship` | asyncpg | 207 |
| `infrastructure/pg_store_auxiliary.py` | Auxiliary PG operations: archive, stats, batch ops | `archive_memory`, `batch_update_heat` | asyncpg | 305 |
| `infrastructure/pg_store_queries.py` | Named SQL query builders for PGStore | `build_search_query`, `build_heat_query` | asyncpg | 258 |
| `infrastructure/pg_store_stats.py` | Memory statistics queries | `get_stats` | asyncpg | 255 |
| `infrastructure/sqlite_store.py` | SQLite fallback implementation of MemoryStore | `SQLiteStore` | aiosqlite, sqlite-vec | 480 |
| `infrastructure/sqlite_store_entities.py` | Entity helpers for SQLiteStore | `upsert_entity` | aiosqlite | ~150 |
| `infrastructure/sqlite_store_relationships.py` | Relationship helpers for SQLiteStore | `upsert_relationship` | aiosqlite | ~120 |
| `infrastructure/sqlite_store_auxiliary.py` | Auxiliary SQLite operations | `archive_memory` | aiosqlite | 299 |
| `infrastructure/sqlite_store_search.py` | FTS5 + vec0 search for SQLiteStore | `fts_search`, `vec_search` | aiosqlite, sqlite-vec | 372 |
| `infrastructure/sqlite_store_stats.py` | Statistics queries for SQLiteStore | `get_stats` | aiosqlite | 253 |
| `infrastructure/sqlite_compat.py` | SQLite/PostgreSQL compatibility shims | `adapt_query` | — | ~80 |
| `infrastructure/profile_store.py` | Profile persistence (JSON files on disk) | `ProfileStore`, `load_profile`, `save_profile` | — | 218 |
| `infrastructure/session_store.py` | Session log read/write | `SessionStore`, `append_session` | — | ~100 |
| `infrastructure/memory_config.py` | Runtime memory configuration dataclass + defaults | `MemoryConfig`, `get_config` | pydantic | ~150 |

---

## Group 2 — `port/cortex-recall`

Source: `mcp_server/handlers/recall.py`, `recall_hierarchical.py`
Target: `packages/memory/src/recall/`

| File | Purpose | Public exports | External imports | LOC |
|---|---|---|---|---|
| `handlers/recall.py` | Multi-signal fusion recall: vector + BM25 + heat + spreading activation → RRF rank | `handler`, `schema` | — | 287 |
| `handlers/recall_helpers.py` | Helpers: query embedding, filter builder, result formatting | `embed_query`, `build_filters`, `format_results` | sentence-transformers | 220 |
| `handlers/recall_hierarchical.py` | Fractal-cluster recall: groups results by similarity cluster before returning | `handler`, `schema` | — | 286 |
| `handlers/drill_down.py` | Navigate into a specific fractal cluster by cluster_id | `handler`, `schema` | — | 198 |
| `core/pg_recall.py` | PL/pgSQL-backed recall: calls `effective_heat` stored procedure, multi-signal fusion | `recall_pg`, `build_recall_query` | asyncpg | 535 |
| `core/reranker.py` | Cross-encoder reranking of recall candidates | `rerank`, `Reranker` | sentence-transformers | 266 |
| `core/reranker_calibration.py` | Platt calibration for reranker scores | `calibrate_reranker` | scipy | 87 |
| `core/mmr_diversity.py` | Maximal Marginal Relevance diversity filter (Krause & Guestrin 2008) | `mmr_select` | numpy | 124 |
| `core/retrieval_dispatch.py` | Route recall to PG or SQLite path | `dispatch_recall` | — | ~80 |
| `core/retrieval_signals.py` | Compute individual retrieval signals (semantic, BM25, heat, temporal) | `compute_signals` | numpy | 138 |
| `core/query_decomposition.py` | Decompose complex queries into sub-queries | `decompose_query` | — | ~100 |
| `core/query_intent.py` | Classify query intent (factual, relational, temporal, etc.) | `classify_intent` | — | 319 |
| `core/query_router.py` | Route query to appropriate search strategy | `route_query` | — | 8 |
| `core/spreading_activation.py` | Collins & Loftus (1975) spreading activation on entity graph | `spread_activation` | numpy | ~120 |
| `core/scoring.py` | Final score assembly: combine signals with learned weights | `compute_final_score` | numpy | 170 |
| `core/unified_search_fusion.py` | RRF-fuse Cortex recall with AP code search | `fuse_results`, `rrf_score` | — | 100 |
| `core/context_assembly/__init__.py` | Package init | — | — | 0 |
| `core/context_assembly/active_retrieval.py` | MIRIX-style active retrieval: generates sub-queries, refines (Wang & Chen 2025) | `active_retrieve` | — | 188 |
| `core/context_assembly/budget.py` | Token budget management for assembled context | `BudgetManager`, `fit_to_budget` | tiktoken | 122 |
| `core/context_assembly/condensers.py` | Condense memories to fit budget | `condense_memories` | — | 276 |
| `core/context_assembly/coverage.py` | Greedy coverage scoring (Krause & Guestrin 2008 submodular) | `score_coverage` | numpy | 127 |
| `core/context_assembly/decomposer.py` | Decompose recall query into stage-appropriate sub-queries | `decompose` | — | 194 |
| `core/context_assembly/ppr_traversal.py` | HippoRAG PPR traversal over entity graph (Gutiérrez et al. 2024) | `ppr_traverse` | numpy | 176 |
| `core/context_assembly/stage_assembler.py` | Assemble context by retrieval stage (Stage 1 BM25 → Stage 2 semantic → Stage 3 PPR) | `assemble_context` | — | 319 |
| `core/context_assembly/stage_detector.py` | Detect which assembly stage is appropriate for the query | `detect_stage` | — | 213 |
| `core/context_assembly/warning.py` | Warning generator for insufficient context | `build_warning` | — | 61 |
| `infrastructure/embedding_engine.py` | sentence-transformers model wrapper with caching | `EmbeddingEngine`, `encode`, `encode_batch` | sentence-transformers, numpy | 395 |
| `infrastructure/brain_index_store.py` | In-memory brain index (Hopfield/HDC cache) | `BrainIndexStore` | numpy | ~150 |

---

## Group 3 — `port/cortex-consolidation`

Source: `mcp_server/handlers/consolidation/`, `mcp_server/core/decay_cycle.py` (not `mcp_server/decay.py` — see F-003)
Target: `packages/memory/src/consolidation/`

| File | Purpose | Public exports | External imports | LOC |
|---|---|---|---|---|
| `handlers/consolidate.py` | Top-level consolidation orchestrator — calls decay, compress, CLS, memify, deep paths | `handler`, `schema` | — | 246 |
| `handlers/consolidation/__init__.py` | Package init | — | — | 5 |
| `handlers/consolidation/cascade.py` | Memory cascade stage transitions (labile → early_ltp → late_ltp → consolidated) | `run_cascade` | — | 198 |
| `handlers/consolidation/cls.py` | Complementary Learning Systems transfer: episodic → semantic memories | `run_cls` | — | 396 |
| `handlers/consolidation/compression.py` | Memory compression: deduplicate + cluster + summarise | `run_compression` | — | 194 |
| `handlers/consolidation/decay.py` | Apply exponential decay to heat_base values | `run_decay` | — | 99 |
| `handlers/consolidation/homeostatic.py` | Homeostatic plasticity: normalise total memory heat per domain | `run_homeostatic` | scipy | 413 |
| `handlers/consolidation/memify.py` | Memification: select candidate episodic memories for semantic promotion | `run_memify` | — | 228 |
| `handlers/consolidation/plasticity.py` | Synaptic plasticity updates post-consolidation | `run_plasticity` | — | 188 |
| `handlers/consolidation/pruning.py` | Microglial pruning: remove low-heat stale memories | `run_pruning` | — | 131 |
| `handlers/consolidation/sleep.py` | Sleep-phase replay: select + replay high-value episodic memories | `run_sleep` | — | 137 |
| `handlers/consolidation/transfer.py` | Transfer memories between stores (episodic → semantic) | `run_transfer` | — | 70 |
| `core/decay_cycle.py` | Decay computation: Ebbinghaus curve + stage multiplier (Kandel 2001) | `compute_decay`, `apply_decay` | numpy | 302 |
| `core/consolidation_engine.py` | Core CLS engine: pattern separation + completion | `ConsolidationEngine` | numpy | ~200 |
| `core/cascade.py` | Re-exports from cascade_stages | — | — | 8 |
| `core/cascade_stages.py` | Stage definitions, thresholds, heat floors (Bahrick 1984, Benna & Fusi 2016) | `STAGES`, `CascadeStage`, `get_stage` | — | ~150 |
| `core/cascade_advancement.py` | Advance memories between cascade stages | `advance_stages` | — | ~120 |
| `core/two_stage_model.py` | McClelland et al. (1995) hippocampal-neocortical two-stage model | `TwoStageModel`, `transfer_to_semantic` | numpy | 278 |
| `core/two_stage_transfer.py` | Mechanics of two-stage transfer | `transfer_batch` | — | ~100 |
| `core/homeostatic_health.py` | Health metrics for homeostatic state | `compute_health` | — | 306 |
| `core/homeostatic_plasticity.py` | Homeostatic plasticity algorithm (Pfister 2013, Wilcox 2012, Hinton 2006) | `update_homeostatic_factor` | scipy, numpy | 304 |
| `core/reconsolidation.py` | Reconsolidation: re-open and update memory on recall (Yonelinas & Ritchey 2015) | `reconsolidate` | — | ~180 |
| `core/replay.py` | Hippocampal replay selection and execution | `Replay`, `select_for_replay` | — | 263 |
| `core/replay_selection.py` | Selection strategy for replay candidates | `select_candidates` | — | 125 |
| `core/replay_execution.py` | Execute replay: update heat, trigger reconsolidation | `execute_replay` | — | ~100 |
| `core/replay_formatting.py` | Format replay results for logging | `format_replay` | — | 170 |
| `core/replay_types.py` | Type definitions for replay | `ReplayItem`, `ReplayResult` | — | 59 |
| `core/sleep_compute.py` | Sleep-phase computations: theta oscillation phase selection | `compute_sleep_selection` | numpy | 268 |
| `core/oscillatory_clock.py` | Theta oscillation clock (Hasselmo 2005, Buzsaki 2015) | `OscillatoryClock`, `get_phase` | — | ~150 |
| `core/oscillatory_phases.py` | Phase-specific encoding/retrieval mode selection | `get_encoding_phase`, `get_retrieval_phase` | — | 297 |
| `core/thermodynamics.py` | Thermodynamic memory survival physics (Yonelinas, Kleinsmith 1963) | `compute_thermodynamic_heat` | numpy | 319 |
| `core/microglial_pruning.py` | Microglial pruning: remove weak synaptic connections | `prune_memories` | — | ~130 |
| `core/neurogenesis.py` | Adult neurogenesis: create new memory slots on saturation | `trigger_neurogenesis` | — | 156 |
| `core/synaptic_plasticity.py` | Base synaptic plasticity | `update_plasticity` | — | ~100 |
| `core/synaptic_plasticity_hebbian.py` | Hebbian rule implementation | `hebbian_update` | numpy | ~120 |
| `core/synaptic_plasticity_stochastic.py` | Stochastic plasticity rule | `stochastic_update` | numpy | 171 |
| `core/synaptic_tagging.py` | Synaptic tagging and capture (late-LTP) | `tag_synapse`, `capture_tag` | numpy | 377 |
| `core/curation.py` | Curation: identify prunable memories | `identify_prunable` | — | ~120 |
| `core/compression.py` | Compression algorithms for memory content | `compress_memory`, `decompress_memory` | zlib | ~100 |
| `core/emergence_tracker.py` | Track emergent memory patterns | `track_emergence` | — | ~150 |
| `core/emergence_metrics.py` | Metrics for emergence detection | `compute_emergence_score` | numpy | ~100 |
| `core/staleness.py` | Staleness detection: file-based and temporal | `is_stale`, `compute_staleness` | — | 178 |
| `core/sensory_buffer.py` | Short-term sensory buffer (pre-encoding) | `SensoryBuffer` | — | ~80 |
| `core/coupled_neuromodulation.py` | Coupled neuromodulation channels | `modulate` | — | ~100 |
| `core/neuromodulation_channels.py` | Neuromodulation channel definitions | `CHANNELS` | — | ~80 |
| `infrastructure/sqlite_schema.py` | SQLite DDL (mirror of pg_schema for fallback store) | SQL string constants | — | 299 |

---

## Group 4 — `port/cortex-hooks`

Source: `mcp_server/hooks/` (9 files — NOTE: PHASE_PLAN says 5, actual count is 9; see F-004)
Target: `packages/memory/src/hooks/`

| File | Purpose | Public exports | External imports | LOC |
|---|---|---|---|---|
| `hooks/__init__.py` | Package init (empty) | — | — | 0 |
| `hooks/session_start.py` | Claude Code `SessionStart` hook — injects anchored + hot memories to context | `main` | psycopg2 or asyncpg | 697 |
| `hooks/auto_recall.py` | Claude Code `UserPromptSubmit` hook — automatic memory recall injection (Smith & Vela 2001) | `main` | — | 255 |
| `hooks/post_tool_capture.py` | Claude Code `PostToolUse` hook — captures tool outputs as memories | `main` | — | 312 |
| `hooks/agent_briefing.py` | Claude Code `SubagentStart` hook — briefs subagents with task-relevant memories | `main` | — | 379 |
| `hooks/compaction_checkpoint.py` | Claude Code `Notification(compacted)` hook — saves checkpoint before compaction | `main`, `process_event` | — | 112 |
| `hooks/session_lifecycle.py` | Claude Code `SessionEnd` hook — profile update after session (EMA) | `main`, `process_event` | — | 241 |
| `hooks/preemptive_context.py` | Claude Code `PostToolUse` hook — heat boost on file-path-matching memories (Bar 2007) | `main` | — | 194 |
| `hooks/pipeline_impact_bump.py` | Claude Code `PostToolUse` hook — graph-based heat bump via AP pipeline (Collins & Loftus 1975) | `main` | — | 228 |
| `hooks/ingest_codebase_background.py` | Background worker spawned by `session_start.py` to ingest stale codebase graph | `main` (module entry) | asyncio | 68 |

---

## Group 5 — `port/cortex-methodology`

Source: `handlers/query_methodology.py`, `handlers/rebuild_profiles.py`, `handlers/get_methodology_graph.py`, `handlers/record_session_end.py`, plus core modules (NOTE: no `mcp_server/methodology/` or `mcp_server/profile/` directory — see F-002)
Target: `packages/memory/src/methodology/`

| File | Purpose | Public exports | External imports | LOC |
|---|---|---|---|---|
| `handlers/query_methodology.py` | Returns cognitive profile for current domain: thinking style, blind spots, entry patterns | `handler`, `schema` | — | 300 |
| `handlers/detect_domain.py` | Lightweight domain classification from cwd/project | `handler`, `schema` | — | 71 |
| `handlers/rebuild_profiles.py` | Full rescan of all session data to rebuild methodology profiles | `handler`, `schema` | — | 116 |
| `handlers/get_methodology_graph.py` | Returns methodology map as graph data for 3D visualisation | `handler`, `schema` | — | 63 |
| `handlers/record_session_end.py` | Incremental EMA profile update after a session ends | `handler`, `schema` | — | 390 |
| `handlers/explore_features.py` | Explore interpretability features (features/persona/attribution/crosscoder modes) | `handler`, `schema` | — | 259 |
| `handlers/list_domains.py` | Overview of all detected cognitive domains | `handler`, `schema` | — | 67 |
| `core/profile_assembler.py` | Assembles a full profile DTO from stored session data | `assemble_profile` | — | 313 |
| `core/profile_builder.py` | Builds the methodology profile from raw session stats (EMA update) | `build_profile`, `update_ema` | numpy | 164 |
| `core/behavioral_crosscoder.py` | Cross-domain behavior pattern analysis | `find_cross_patterns` | numpy | 154 |
| `core/attribution_tracer.py` | Traces which memories and patterns contributed to a profile value | `trace_attribution` | — | 294 |
| `core/blindspot_detector.py` | Detects knowledge blind spots from pattern absence | `detect_blindspots` | — | ~150 |
| `core/blindspot_patterns.py` | Catalog of known blind-spot pattern templates | `PATTERNS`, `match_patterns` | — | 101 |
| `core/bridge_finder.py` | Finds cross-domain connection bridges | `find_bridges` | — | ~120 |
| `core/persona_vector.py` | 12-dimensional persona vector computation | `compute_persona_vector` | numpy | ~150 |
| `core/cognitive_map.py` | Topological map of cognitive patterns over time | `CognitiveMap` | numpy | 300 |
| `core/domain_detector.py` | Domain detection from codebase path and content | `detect_domain` | — | ~150 |
| `core/metacognition.py` | Metacognitive monitoring: track when the model is uncertain | `MetacognitionMonitor` | — | ~200 |
| `core/metacognition_analysis.py` | Analysis of metacognitive signals | `analyse_metacognition` | numpy | 302 |
| `core/style_classifier.py` | Classify reasoning/writing style (EMA-smoothed) | `StyleClassifier`, `classify` | numpy | 311 |
| `core/style_classifier_ema.py` | EMA smoothing for style classifier | `EMAClassifier` | numpy | 77 |
| `core/session_critique.py` | Post-session critique generation | `critique_session` | — | ~200 |
| `core/session_critique_format.py` | Format session critique output | `format_critique` | — | 146 |
| `core/session_extractor.py` | Extract structured data from session JSONL | `extract_session` | — | ~180 |
| `core/session_shape.py` | Compute session shape metrics (turns, tool use, breadth) | `compute_shape` | — | 140 |
| `core/platt_calibration.py` | Platt scaling for profile confidence scores | `platt_scale` | scipy | ~80 |
| `infrastructure/agent_config.py` | Agent configuration: domain → Cortex config mapping | `AgentConfig`, `get_agent_config` | pydantic | 211 |
| `infrastructure/conversation_reader.py` | Read Claude Code JSONL conversation files | `read_conversation`, `iter_turns` | — | ~120 |

---

## Group 6 — `port/cortex-graph-navigation`

Source: `mcp_server/handlers/navigate*.py`, plus `core/` graph modules (NOTE: no `mcp_server/graph/` directory in the source)
Target: `packages/memory/src/graph/`

| File | Purpose | Public exports | External imports | LOC |
|---|---|---|---|---|
| `handlers/navigate_memory.py` | Navigate memory space using Successor Representation | `handler`, `schema` | — | 206 |
| `handlers/get_causal_chain.py` | Trace entity relationships through the knowledge graph | `handler`, `schema` | — | 285 |
| `handlers/detect_gaps.py` | Identify knowledge gaps (entity, domain, temporal) | `handler`, `schema` | — | 266 |
| `core/knowledge_graph.py` | Core knowledge graph: entity + relationship CRUD, traversal | `KnowledgeGraph`, `add_entity`, `traverse` | networkx | 282 |
| `core/causal_graph.py` | Causal subgraph: directed causal relationships (Pearl-style) | `CausalGraph`, `find_causal_chain` | networkx | 306 |
| `core/graph_builder.py` | Builds the in-memory graph from PG entities and relationships | `GraphBuilder`, `build_graph` | networkx | 298 |
| `core/graph_builder_nodes.py` | Node construction helpers | `build_node`, `build_nodes_batch` | — | 548 |
| `core/graph_builder_edges.py` | Edge construction helpers | `build_edge`, `build_edges_batch` | — | ~200 |
| `core/graph_builder_dedup.py` | Deduplication logic for graph nodes | `dedup_nodes` | — | 152 |
| `core/graph_builder_discussions.py` | Discussion-thread subgraph builder | `build_discussion_graph` | — | 124 |
| `core/graph_quality_scorer.py` | Quality scoring for graph nodes (coverage, connectivity) | `score_graph_quality` | networkx | 260 |
| `core/fractal.py` | Fractal memory hierarchy: build and query | `FractalHierarchy` | numpy | ~200 |
| `core/fractal_clustering.py` | Fractal clustering algorithm | `cluster_fractal` | numpy, scipy | ~180 |
| `core/hopfield.py` | Hopfield network associative memory | `HopfieldNetwork`, `store_pattern`, `recall_pattern` | numpy | ~200 |
| `core/hdc_encoder.py` | Hyperdimensional Computing encoder | `HDCEncoder`, `encode_memory` | numpy | ~150 |
| `core/interference.py` | Memory interference detection (retroactive/proactive) | `detect_interference` | numpy | 315 |
| `core/interference_detection.py` | Low-level interference signal computation | `compute_interference` | numpy | 339 |
| `core/pattern_extractor.py` | Extract recurring patterns from memory graph | `extract_patterns` | — | ~200 |
| `core/pattern_separation.py` | Pattern separation via hippocampal model (Leutgeb 2007, Rolls 2013) | `separate_patterns` | — | 8 |
| `core/separation_core.py` | Core separation computation | `compute_separation` | numpy | ~150 |
| `core/temporal.py` | Temporal indexing and time-based graph queries | `TemporalIndex`, `query_temporal` | — | ~150 |
| `core/prospective.py` | Prospective memory: trigger-condition matching | `ProspectiveMemory`, `check_triggers` | — | 140 |
| `core/dendritic_computation.py` | Dendritic computation model: compartmentalised integration | `DendriticCompartment` | numpy | 373 |
| `core/dendritic_clusters.py` | Dendritic cluster groupings | `build_dendritic_clusters` | — | 143 |
| `core/titans_memory.py` | Titans memory architecture (external neural memory) | `TitansMemory` | numpy | ~200 |
| `core/tripartite_synapse.py` | Tripartite synapse model (astrocyte-mediated) | `TripartiteSynapse` | — | 139 |
| `core/tripartite_calcium.py` | Calcium signalling in tripartite synapse | `compute_calcium` | numpy | 286 |
| `core/entity_reconciliation.py` | Reconcile duplicate entities across imports | `reconcile_entities` | — | ~250 |
| `core/engram.py` | Engram slot model: fixed-capacity memory cells | `Engram`, `EngramSlot` | — | 161 |
| `core/dual_store_cls.py` | Dual-store CLS implementation | `DualStoreCLS` | — | 111 |
| `core/dual_store_cls_abstraction.py` | Abstraction layer over dual-store | `DualStoreAbstraction` | — | 286 |
| `infrastructure/pg_store_rules.py` | Memory rules storage (neuro-symbolic rules) | `upsert_rule`, `query_rules` | asyncpg | ~180 |
| `infrastructure/sqlite_store_rules.py` | SQLite rules storage | `upsert_rule`, `query_rules` | aiosqlite | ~150 |
| `handlers/validate_memory.py` | Validate memories against current filesystem state | `handler`, `schema` | — | 223 |

---

## Group 7 — `port/cortex-narrative`

Source: `mcp_server/handlers/narrative.py`
Target: `packages/memory/src/narrative/`

| File | Purpose | Public exports | External imports | LOC |
|---|---|---|---|---|
| `handlers/narrative.py` | Generate project narrative from stored memories | `handler`, `schema` | — | 102 |
| `handlers/get_project_story.py` | Period-based autobiographical narrative (week/month/all) | `handler`, `schema` | — | 264 |
| `core/narrative.py` | Core narrative generation: select, order, synthesise memories into story | `generate_narrative`, `NarrativeResult` | — | 310 |
| `core/context_generator.py` | Generate context summary from memory cluster | `generate_context` | — | 133 |
| `core/draft_synthesizer.py` | Synthesise draft page content from claim clusters | `synthesise_draft` | — | 310 |
| `core/draft_compiler.py` | Compile draft into final page markdown | `compile_draft` | — | ~180 |
| `core/draft_curator.py` | Curate drafts: select, score, approve or reject | `curate_draft` | — | 155 |
| `core/memory_decomposer.py` | Decompose memory into atomic claim-level units | `decompose_memory` | — | 305 |

---

## Group 8 — `port/cortex-automation`

Source: handlers for automation-style tools (NOTE: no `mcp_server/automation/` directory — see F-001)
Target: `packages/memory/src/automation/`

| File | Purpose | Public exports | External imports | LOC |
|---|---|---|---|---|
| `handlers/sync_instructions.py` | Push top memory insights into CLAUDE.md | `handler`, `schema` | — | 241 |
| `handlers/create_trigger.py` | Create a prospective memory trigger | `handler`, `schema` | — | 140 |
| `handlers/add_rule.py` | Add a neuro-symbolic rule | `handler`, `schema` | ~30 (approx) | ~60 |
| `handlers/get_rules.py` | List active neuro-symbolic rules | `handler`, `schema` | — | 115 |
| `handlers/assess_coverage.py` | Evaluate knowledge coverage completeness | `handler`, `schema` | — | 316 |
| `handlers/backfill_memories.py` | Auto-import prior Claude Code conversations into memory | `handler`, `schema` | — | 376 |
| `handlers/backfill_helpers.py` | Ebbinghaus-decay initial heat for backfill (Ebbinghaus 1885) | `compute_initial_heat`, `process_session` | — | 285 |
| `handlers/checkpoint.py` | Save or restore working state (hippocampal checkpoint) | `handler`, `schema` | — | 247 |
| `handlers/seed_project.py` | Bootstrap memory from existing codebase | `handler`, `schema` | — | 208 |
| `handlers/seed_project_stages.py` | Stage-specific seeding logic | `run_stage` | — | 261 |
| `handlers/seed_project_constants.py` | Constants and configuration for seed_project | `SEED_CONFIG` | — | 119 |
| `core/memory_rules.py` | Neuro-symbolic rule evaluation engine | `evaluate_rules`, `MemoryRule` | — | 279 |
| `core/global_detector.py` | Detect globally-relevant memories (cross-project) | `detect_globals` | — | 263 |
| `core/ablation.py` | Ablation testing: disable specific memory subsystems | `AblationConfig` | — | ~120 |
| `core/ablation_report.py` | Report ablation test results | `format_ablation_report` | — | 107 |
| `handlers/change_impact.py` | Report memories affected by commit's code changes | `handler`, `schema` | — | 220 |
| `core/change_impact_matcher.py` | Match changed symbols to memory tags | `match_impact` | — | 101 |
| `infrastructure/git_diff.py` | Git diff extraction and parsing | `extract_diff`, `parse_diff` | gitpython or subprocess | 327 |
| `infrastructure/git_diff_exec.py` | Git command execution helpers | `run_git` | subprocess | ~100 |
| `infrastructure/git_diff_format.py` | Format git diff for memory tagging | `format_diff` | — | ~80 |
| `infrastructure/ap_bridge.py` | Bridge to ai-automatised-pipeline MCP server | `APBridge`, `call_tool` | httpx or mcp | 362 |
| `infrastructure/mcp_client.py` | MCP client for cross-server tool calls | `MCPClient`, `call_tool` | mcp | 367 |
| `infrastructure/mcp_client_pool.py` | Connection pool for MCP clients | `MCPClientPool` | mcp | ~150 |
| `infrastructure/pipeline_discovery.py` | Discover installed pipeline servers | `discover_pipelines` | — | ~100 |
| `infrastructure/pipeline_installer.py` | Install pipeline dependencies | `install_pipeline` | subprocess | 209 |
| `infrastructure/pipeline_install_rust.py` | Rust binary installation | `install_rust_binary` | subprocess | 219 |
| `infrastructure/pipeline_install_release.py` | GitHub release download logic | `download_release` | httpx | 202 |
| `infrastructure/pipeline_install_lock.py` | Installation lock file management | `acquire_lock`, `release_lock` | — | ~80 |
| `infrastructure/pipeline_installer_common.py` | Common installer utilities | `get_platform_target` | — | ~100 |
| `infrastructure/pipeline_graph_ttl.py` | TTL-based expiry for cached pipeline graph | `check_ttl`, `reset_ttl` | — | ~80 |
| `handlers/latency_class.py` | Classify memory operation latency (fast/medium/slow) | `classify_latency` | — | 123 |

---

## Group 9 — `port/cortex-import`

Source: `mcp_server/handlers/import_sessions.py` (NOTE: PHASE_PLAN lists claude-mem, ChatGPT, Gemini, Cursor, Claude Code importers; only the Claude Code JSONL format exists — see F-001)
Target: `packages/memory/src/import/`

| File | Purpose | Public exports | External imports | LOC |
|---|---|---|---|---|
| `handlers/import_sessions.py` | Import Claude Code JSONL conversation history into memory store | `handler`, `schema`, `_discover_jsonl_files`, `_process_session_items` | — | 350 |

---

## Group 10 — Unaccounted-for in PHASE_PLAN.md §4

The following files exist in the Cortex source but are NOT assigned to any Phase-4 worktree. Each requires an explicit planning decision (new worktree, fold into existing, or explicit out-of-scope declaration).

### 10.1 Wiki Subsystem (`port/cortex-wiki` — does not exist in plan)

21 handler files + 15 core files + 1 infrastructure file = ~37 files, ~6 000+ LOC.

| File | Purpose | LOC |
|---|---|---|
| `handlers/wiki_api.py` | HTTP API handlers for wiki (internal) | 415 |
| `handlers/wiki_export.py` | Export wiki to static site | 384 |
| `handlers/wiki_refine.py` | Refine wiki pages via LLM pass | 337 |
| `handlers/wiki_synthesize.py` | Synthesise wiki pages from claim clusters | 328 |
| `handlers/wiki_emerge.py` | Run concept emergence pipeline | 276 |
| `handlers/wiki_consolidate.py` | Consolidate wiki (merge/prune/promote) | 254 |
| `handlers/wiki_migrate.py` | Migrate wiki schema | 239 |
| `handlers/wiki_compile.py` | Compile wiki pages to rendered HTML/MD | 229 |
| `handlers/wiki_resolve.py` | Resolve wiki links and citations | 225 |
| `handlers/wiki_seed_codebase.py` | Seed wiki from codebase analysis | 261 |
| `handlers/wiki_curate.py` | Curate wiki pages | ~150 |
| `handlers/wiki_view.py` | View wiki pages with rendered output | 155 |
| `handlers/wiki_extract.py` | Extract claims from memory to wiki | ~120 |
| `handlers/wiki_pipeline.py` | Pipeline orchestration for wiki updates | 108 |
| `handlers/wiki_link.py` | Add bidirectional links (MCP tool) | 108 |
| `handlers/wiki_adr.py` | Create numbered ADR pages (MCP tool) | ~80 |
| `handlers/wiki_write.py` | Author wiki pages create/append/replace (MCP tool) | 166 |
| `handlers/wiki_read.py` | Read wiki page markdown (MCP tool) | 57 |
| `handlers/wiki_list.py` | List wiki pages (MCP tool) | 52 |
| `handlers/wiki_reindex.py` | Regenerate wiki INDEX.md (MCP tool) | 91 |
| `handlers/wiki_purge.py` | Purge failing wiki pages (MCP tool) | 168 |
| `handlers/wiki_verify.py` | Verify wiki symbol citations vs code graph (MCP tool) | 157 |
| `core/wiki_classifier.py` | Classify wiki page kind (concept/adr/spec/process/glossary) | 603 |
| `core/wiki_pages.py` | Wiki page lifecycle management | 387 |
| `core/wiki_templates.py` | Markdown templates per page kind | 366 |
| `core/wiki_view_executor.py` | Execute wiki view queries | 365 |
| `core/wiki_schema_loader.py` | Load wiki schema definitions | 280 |
| `core/wiki_rule_engine.py` | Rule engine for wiki curation decisions | 117 |
| `core/wiki_sync.py` | Sync wiki files with PG index | 112 |
| `core/wiki_groomer.py` | Groom wiki: staleness, cleanup | ~150 |
| `core/wiki_layout.py` | Layout helpers for page rendering | 88 |
| `core/wiki_links.py` | Link extraction and resolution | 124 |
| `core/wiki_staleness.py` | Staleness detection for wiki pages | 134 |
| `core/wiki_symbol_extract.py` | Extract code symbols referenced in wiki | 168 |
| `core/wiki_symbol_verify.py` | Verify symbols exist in AP graph | 96 |
| `core/wiki_readme.py` | README.md auto-generation | ~80 |
| `core/wiki_thermodynamics.py` | Thermodynamic survival physics for wiki pages | ~120 |
| `core/concept_emerger.py` | Grounded-theory concept emergence (Strauss axial coding) | 515 |
| `core/concept_vocabulary.py` | Concept vocabulary management | 118 |
| `core/claim_extractor.py` | Extract atomic claims from memories | 295 |
| `core/claim_resolver.py` | Resolve conflicting claims | 328 |
| `core/enrichment.py` | Enrich wiki pages with entity links | 141 |
| `infrastructure/pg_store_wiki.py` | PostgreSQL wiki table CRUD | 866 |
| `infrastructure/wiki_store.py` | Abstract wiki store interface + dispatch | 398 |

### 10.2 Workflow Graph Subsystem (partially `port/cortex-graph-navigation`)

| File | Purpose | LOC |
|---|---|---|
| `handlers/workflow_graph.py` | Workflow graph build/query orchestrator | 317 |
| `handlers/query_workflow_graph.py` | Query the unified workflow graph (MCP tool) | 342 |
| `core/workflow_graph_builder.py` | Build workflow graph from session data | 488 |
| `core/workflow_graph_builder_relational.py` | Relational workflow graph builder | 429 |
| `core/workflow_graph_schema.py` | Workflow graph schema types | 381 |
| `core/workflow_graph_schema_enums.py` | Enum types for workflow graph | 82 |
| `core/workflow_graph_entity.py` | Entity types for workflow graph | 99 |
| `core/workflow_graph_inputs.py` | Input types for workflow graph builder | 55 |
| `core/workflow_graph_palette.py` | Colour palette for visualisation | 98 |
| `infrastructure/workflow_graph_source.py` | Abstract source interface for workflow graph | 244 |
| `infrastructure/workflow_graph_source_ast.py` | AST-based source (from Python code) | 635 |
| `infrastructure/workflow_graph_source_jsonl.py` | JSONL-based source (from session logs) | 364 |
| `infrastructure/workflow_graph_source_native_ast.py` | Native AST source | 319 |
| `infrastructure/workflow_graph_source_pg.py` | PG-backed source | 251 |

### 10.3 Codebase Analysis Subsystem (partially `port/cortex-automation`)

| File | Purpose | LOC |
|---|---|---|
| `handlers/codebase_analyze.py` | Analyze codebase structure as memories (MCP tool) | 409 |
| `handlers/codebase_analyze_helpers.py` | Helpers for codebase analysis | 346 |
| `handlers/ingest_codebase.py` | Ingest from AI-automatised-pipeline (MCP tool) | 279 |
| `handlers/ingest_codebase_cypher.py` | Cypher query generation for graph ingest | 299 |
| `handlers/ingest_codebase_graph.py` | Graph write path for ingest | 102 |
| `handlers/ingest_codebase_pages.py` | Wiki page creation during ingest | 66 |
| `handlers/ingest_codebase_schema.py` | Schema extraction during ingest | 85 |
| `handlers/ingest_codebase_writers.py` | Write orchestration for ingest | 234 |
| `handlers/ingest_helpers.py` | Shared ingest helpers | 125 |
| `handlers/ingest_prd.py` | Ingest a PRD document (MCP tool) | 348 |
| `core/ast_parser.py` | Python AST parser | ~200 |
| `core/ast_extractors.py` | AST extraction for symbols, imports, calls | 321 |
| `core/ast_extractors_extra.py` | Extended AST extraction | ~150 |
| `core/codebase_graph.py` | Codebase structure as a graph | 333 |
| `core/codebase_parser.py` | Parse codebase files | 153 |
| `core/codebase_extractors.py` | Extract symbols from parsed files | ~180 |
| `core/codebase_type_resolver.py` | Resolve type references | 137 |
| `core/schema_engine.py` | Memory schema engine | 271 |
| `core/schema_extraction.py` | Extract schema patterns from memories | 295 |
| `infrastructure/scanner.py` | File system scanner for codebase analysis | 258 |
| `infrastructure/scanner_parse.py` | Parse scanner output | ~150 |

### 10.4 HTTP Server / Dashboard (no Phase-4 worktree)

| File | Purpose | LOC |
|---|---|---|
| `server/__init__.py` | Package init | 0 |
| `server/http_server.py` | FastAPI/Starlette HTTP server | 219 |
| `server/http_launcher.py` | HTTP server startup | 355 |
| `server/http_common.py` | Shared HTTP utilities | 306 |
| `server/http_security.py` | Security middleware | 127 |
| `server/http_dashboard_data.py` | Dashboard data endpoints | 202 |
| `server/http_file_diff.py` | File diff viewer endpoints | 200 |
| `server/http_standalone.py` | Standalone server mode | 417 |
| `server/http_standalone_endpoints.py` | Standalone endpoints | 218 |
| `server/http_standalone_graph.py` | 3D graph visualisation (D3/Three.js backend) | 1 139 |
| `server/http_standalone_response.py` | Response helpers | 62 |
| `server/http_standalone_state.py` | Server state management | 54 |
| `server/http_standalone_wiki.py` | Wiki viewer endpoints | 177 |
| `server/http_viz_server.py` | Visualisation server | 25 |
| `server/visualize_bootstrap.py` | Bootstrap visualisation assets | 167 |

### 10.5 Miscellaneous Top-Level

| File | Purpose | LOC |
|---|---|---|
| `doctor.py` | Standalone health-check CLI | 332 |
| `tool_error_handler.py` | `safe_handler` wrapper: catches all exceptions, formats MCP errors | 176 |
| `__main__.py` | Entry point: `python -m mcp_server` | 70 |
| `__init__.py` | Package init | 1 |
| `observability/metrics.py` | Prometheus/structlog metrics | ~150 |
| `validation/schemas.py` | Input validation schemas (Pydantic) | ~200 |
| `errors/__init__.py` | Custom exception hierarchy | ~30 |
| `shared/__init__.py` | Package init | 1 |
| `shared/types.py` | Core type definitions (MemoryItem, etc.) | 172 |
| `shared/types_profiles.py` | Profile type definitions | 200 |
| `shared/memory_types.py` | Memory enum types + MemoryItem dataclass | 264 |
| `shared/categorizer.py` | Memory category classification | 135 |
| `shared/content_hardening.py` | Content sanitisation and hardening | 86 |
| `shared/domain_mapping.py` | Domain name normalisation | 373 |
| `shared/entity_canonical.py` | Canonical entity name normalisation | 81 |
| `shared/hash.py` | SHA-256 hashing utilities | 19 |
| `shared/linear_algebra.py` | Vector math helpers (cosine sim, norms) | 98 |
| `shared/project_ids.py` | Project ID extraction from cwd | 48 |
| `shared/similarity.py` | Similarity computation wrappers | 18 |
| `shared/sparse.py` | Sparse vector utilities | 75 |
| `shared/text.py` | Text preprocessing helpers | 195 |
| `shared/vader.py` | VADER sentiment scoring (emotional valence) | 235 |
| `shared/wiki_ir.py` | Wiki intermediate representation types | 258 |
| `shared/yaml_parser.py` | YAML frontmatter parser | 40 |
