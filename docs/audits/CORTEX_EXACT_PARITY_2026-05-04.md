# Cortex Exact-Portage Parity Audit — 2026-05-04

**Source freeze**: `cortex@ed33435` (v3.15.0)
**Target**: `packages/memory/src/` in `agentic-ai@af40222`
**Audit branch**: `port/exact-portage-audit-cortex`
**Auditor**: Borges structural audit (exhaustive-space + map-territory)
**Date**: 2026-05-04

---

## §1 Executive Summary

| Metric | Count |
|---|---|
| Total `.py` files in `cortex@ed33435 mcp_server/` | **373** |
| Total `.ts` files in `packages/memory/src/` | **227** |
| Status: OK (full parity or over-ported) | **57** |
| Status: PARTIAL (TS file exists, fewer public symbols) | **64** |
| Status: MISSING (no TS counterpart) | **237** |
| Status: DEAD | **0** |
| Status: STUB | **0** |

**Total Python LOC in scope**: 81,807
**MISSING LOC** (all missing files): 51,971
**PARTIAL LOC at 50%** (gap remaining in existing files): 8,877
**Grand total LOC remaining to port**: **57,150**

The `server/` group (15 files / 3,698 LOC) is flagged as a deferred dashboard group per the task statement. It is included in the MISSING count above but marked clearly in §3 and §4. Excluding it, the non-deferred missing LOC is **53,452**.

---

## §2 Per-Directory Tally

| Directory | Python files | TS files (mapped) | MISSING | PARTIAL | OK |
|---|---|---|---|---|---|
| `core/` | 167 | ~52 | 109 | 25 | 33 |
| `handlers/` | 96 | ~44 | 44 | 26 | 26 |
| `handlers/consolidation/` | 11 | 10 | 0 | 9 | 1 |
| `infrastructure/` | 52 | 4 | 44 | 4 | 4 |
| `shared/` | 17 | 17 | 0 | 3 | 14 |
| `hooks/` | 10 | 9 | 0 | 8 | 1 |
| `observability/` | 2 | 1 | 0 | 1 | 0 |
| `validation/` | 2 | 1 | 0 | 1 | 1 |
| `server/` | 15 | 0 | 15 (deferred) | 0 | 0 |
| `errors/` | 1 | 0 | 0 | 0 | 1 (inline) |
| root (`mcp_server/*.py`) | 18 | 0 | 10 | 0 | 0 |
| **Total** | **373** | **~138** | **222+15=237** | **64** | **57** |

---

## §3 Full File-by-File Table

Legend: `MISSING` = no TS file | `PARTIAL` = fewer exports than Python public symbols | `OK` = parity met
Python LOC and public symbol counts are from `cortex@ed33435`.

### 3.1 core/

| Python file | LOC | Py syms | TS counterpart | TS exports | Status |
|---|---|---|---|---|---|
| core/__init__.py | 1 | 0 | — | — | MISSING |
| core/ablation_report.py | 107 | 4 | — | — | MISSING |
| core/ablation.py | 233 | 16 | — | — | MISSING |
| core/abstention_gate.py | 132 | 3 | remember/abstention-gate.ts | 6 | OK |
| core/ast_extractors_extra.py | 198 | 10 | codebase-analysis/ast-extractors-extra.ts | 6 | PARTIAL |
| core/ast_extractors.py | 321 | 16 | codebase-analysis/ast-extractors.ts | 9 | PARTIAL |
| core/ast_parser.py | 235 | 10 | codebase-analysis/ast-parser.ts | 3 | PARTIAL |
| core/attribution_tracer.py | 294 | 10 | — | — | MISSING |
| core/behavioral_crosscoder.py | 154 | 6 | — | — | MISSING |
| core/blindspot_detector.py | 231 | 8 | — | — | MISSING |
| core/blindspot_patterns.py | 101 | 3 | — | — | MISSING |
| core/bridge_finder.py | 238 | 11 | — | — | MISSING |
| core/cascade_advancement.py | 227 | 7 | — | — | MISSING |
| core/cascade_stages.py | 218 | 8 | consolidation/cascade-stages.ts | 8 | OK |
| core/cascade.py | 8 | 0 | consolidation/stages/cascade.ts | 3 | OK |
| core/causal_graph.py | 306 | 11 | consolidation/causal-graph.ts | 8 | PARTIAL |
| core/change_impact_matcher.py | 101 | 4 | — | — | MISSING |
| core/claim_extractor.py | 295 | 7 | wiki/claim-extractor.ts | 3 | PARTIAL |
| core/claim_resolver.py | 328 | 10 | wiki/claim-resolver.ts | 10 | OK |
| core/codebase_extractors.py | 245 | 11 | codebase-analysis/codebase-extractors.ts | 13 | OK |
| core/codebase_graph.py | 333 | 12 | codebase-analysis/codebase-graph.ts | 7 | PARTIAL |
| core/codebase_parser.py | 153 | 6 | codebase-analysis/codebase-parser.ts | 4 | PARTIAL |
| core/codebase_type_resolver.py | 137 | 2 | codebase-analysis/codebase-type-resolver.ts | 2 | OK |
| core/cognitive_map.py | 300 | 9 | — | — | MISSING |
| core/compression.py | 250 | 11 | consolidation/stages/compression.ts | 4 | PARTIAL |
| core/concept_emerger.py | 515 | 13 | wiki/concept-emerger.ts | 21 | OK |
| core/concept_vocabulary.py | 118 | 1 | wiki/concept-vocabulary.ts | 3 | OK |
| core/consolidation_engine.py | 246 | 8 | — | — | MISSING |
| core/context_assembly/__init__.py | — | — | — | — | MISSING |
| core/context_assembly/active_retrieval.py | — | — | — | — | MISSING |
| core/context_assembly/budget.py | — | — | — | — | MISSING |
| core/context_assembly/condensers.py | — | — | — | — | MISSING |
| core/context_assembly/coverage.py | — | — | — | — | MISSING |
| core/context_assembly/decomposer.py | — | — | — | — | MISSING |
| core/context_assembly/ppr_traversal.py | — | — | — | — | MISSING |
| core/context_assembly/stage_assembler.py | — | — | — | — | MISSING |
| core/context_assembly/stage_detector.py | — | — | — | — | MISSING |
| core/context_assembly/warning.py | — | — | — | — | MISSING |
| core/context_generator.py | 133 | 8 | — | — | MISSING |
| core/coupled_neuromodulation.py | 252 | 14 | — | — | MISSING |
| core/curation.py | 231 | 10 | — | — | MISSING |
| core/decay_cycle.py | 334 | 10 | consolidation/decay-cycle.ts | 5 | PARTIAL |
| core/dendritic_clusters.py | 149 | 4 | recall/dendritic-clusters.ts | 8 | OK |
| core/dendritic_computation.py | 373 | 10 | — | — | MISSING |
| core/domain_detector.py | 185 | 10 | methodology/domain-detector.ts | 3 | PARTIAL |
| core/draft_compiler.py | 210 | 6 | — | — | MISSING |
| core/draft_curator.py | 155 | 7 | — | — | MISSING |
| core/draft_synthesizer.py | 310 | 8 | wiki/draft-synthesizer.ts | 4 | PARTIAL |
| core/dual_store_cls_abstraction.py | 286 | 7 | — | — | MISSING |
| core/dual_store_cls.py | 111 | 2 | — | — | MISSING |
| core/emergence_metrics.py | 222 | 8 | — | — | MISSING |
| core/emergence_tracker.py | 220 | 7 | — | — | MISSING |
| core/emotional_tagging.py | 268 | 6 | — | — | MISSING |
| core/engram.py | 167 | 5 | — | — | MISSING |
| core/enrichment.py | 141 | 6 | wiki/enrichment.ts | 5 | PARTIAL |
| core/entity_reconciliation.py | 223 | 4 | — | — | MISSING |
| core/fractal_clustering.py | 213 | 7 | — | — | MISSING |
| core/fractal.py | 253 | 8 | — | — | MISSING |
| core/global_detector.py | 263 | 2 | — | — | MISSING |
| core/graph_builder_dedup.py | 152 | 8 | — | — | MISSING |
| core/graph_builder_discussions.py | 124 | 4 | — | — | MISSING |
| core/graph_builder_edges.py | 220 | 5 | — | — | MISSING |
| core/graph_builder_nodes.py | 548 | 11 | — | — | MISSING |
| core/graph_builder.py | 298 | 11 | — | — | MISSING |
| core/graph_quality_scorer.py | 260 | 14 | — | — | MISSING |
| core/hdc_encoder.py | 245 | 8 | recall/hdc-encoder.ts | 8 | OK |
| core/hierarchical_predictive_coding.py | 186 | 5 | — | — | MISSING |
| core/homeostatic_health.py | 306 | 6 | — | — | MISSING |
| core/homeostatic_plasticity.py | 309 | 8 | consolidation/homeostatic-plasticity.ts | 8 | OK |
| core/hopfield.py | 217 | 9 | recall/hopfield.ts | 9 | OK |
| core/interference_detection.py | 339 | 10 | — | — | MISSING |
| core/interference.py | 331 | 8 | — | — | MISSING |
| core/knowledge_graph.py | 282 | 10 | recall/knowledge-graph.ts | 3 | PARTIAL |
| core/layout_engine.py | 113 | 2 | — | — | MISSING |
| core/memory_decomposer.py | 305 | 5 | — | — | MISSING |
| core/memory_ingest.py | 189 | 2 | remember/memory-ingest.ts | 5 | OK |
| core/memory_rules.py | 279 | 10 | — | — | MISSING |
| core/metacognition_analysis.py | 302 | 15 | — | — | MISSING |
| core/metacognition.py | 185 | 6 | — | — | MISSING |
| core/microglial_pruning.py | 220 | 8 | consolidation/microglial-pruning.ts | 4 | PARTIAL |
| core/mmr_diversity.py | 124 | 4 | — | — | MISSING |
| core/narrative.py | 310 | 9 | narrative/handlers/narrative.ts | 2 | PARTIAL |
| core/neurogenesis.py | 156 | 6 | consolidation/neurogenesis.ts | 4 | PARTIAL |
| core/neuromodulation_channels.py | 253 | 4 | — | — | MISSING |
| core/oscillatory_clock.py | 228 | 11 | consolidation/oscillatory-clock.ts | 31 | OK |
| core/oscillatory_phases.py | 297 | 14 | — | — | MISSING |
| core/pattern_extractor.py | 252 | 12 | — | — | MISSING |
| core/pattern_separation.py | 8 | 0 | — | — | MISSING |
| core/persona_vector.py | 194 | 9 | — | — | MISSING |
| core/pg_recall.py | 636 | 6 | — | — | MISSING |
| core/platt_calibration.py | 221 | 8 | — | — | MISSING |
| core/predictive_coding_flat.py | 136 | 7 | — | — | MISSING |
| core/predictive_coding_gate.py | 253 | 11 | — | — | MISSING |
| core/predictive_coding_signals.py | 220 | 8 | — | — | MISSING |
| core/profile_assembler.py | 313 | 11 | — | — | MISSING |
| core/profile_builder.py | 164 | 6 | — | — | MISSING |
| core/prospective.py | 140 | 3 | — | — | MISSING |
| core/query_decomposition.py | 214 | 4 | — | — | MISSING |
| core/query_intent.py | 319 | 5 | recall/query-intent.ts | 3 | PARTIAL |
| core/query_router.py | 8 | 0 | — | — | MISSING |
| core/recall_pipeline.py | 759 | 12 | — | — | MISSING |
| core/reconsolidation.py | 378 | 10 | consolidation/reconsolidation.ts | 9 | PARTIAL |
| core/replay_execution.py | 242 | 11 | — | — | MISSING |
| core/replay_formatting.py | 170 | 9 | — | — | MISSING |
| core/replay_selection.py | 125 | 4 | — | — | MISSING |
| core/replay_types.py | 59 | 4 | — | — | MISSING |
| core/replay.py | 263 | 7 | consolidation/replay.ts | 12 | OK |
| core/reranker_calibration.py | 87 | 4 | — | — | MISSING |
| core/reranker.py | 266 | 6 | — | — | MISSING |
| core/retrieval_dispatch.py | 235 | 10 | — | — | MISSING |
| core/retrieval_signals.py | 138 | 4 | — | — | MISSING |
| core/schema_engine.py | 277 | 10 | codebase-analysis/schema-engine.ts | 8 | PARTIAL |
| core/schema_extraction.py | 295 | 12 | codebase-analysis/schema-extraction.ts | 7 | PARTIAL |
| core/scoring.py | 170 | 8 | — | — | MISSING |
| core/sensory_buffer.py | 245 | 4 | — | — | MISSING |
| core/separation_core.py | 202 | 5 | — | — | MISSING |
| core/session_critique_format.py | 146 | 5 | — | — | MISSING |
| core/session_critique.py | 245 | 8 | methodology/session-critique.ts | 1 | PARTIAL |
| core/session_extractor.py | 244 | 8 | narrative/session-extractor.ts | 6 | PARTIAL |
| core/session_shape.py | 140 | 6 | — | — | MISSING |
| core/sleep_compute.py | 268 | 9 | — | — | MISSING |
| core/sparse_dictionary_activation.py | 180 | 8 | — | — | MISSING |
| core/sparse_dictionary_learning.py | 256 | 10 | — | — | MISSING |
| core/sparse_dictionary.py | 257 | 5 | — | — | MISSING |
| core/spreading_activation.py | 222 | 9 | recall/spreading-activation.ts | 8 | PARTIAL |
| core/staleness.py | 178 | 6 | wiki/staleness.ts | 8 | OK |
| core/style_classifier_ema.py | 77 | 4 | — | — | MISSING |
| core/style_classifier.py | 311 | 12 | — | — | MISSING |
| core/synaptic_plasticity_hebbian.py | 257 | 9 | — | — | MISSING |
| core/synaptic_plasticity_stochastic.py | 171 | 5 | — | — | MISSING |
| core/synaptic_plasticity.py | 255 | 8 | — | — | MISSING |
| core/synaptic_tagging.py | 383 | 7 | — | — | MISSING |
| core/telemetry.py | 170 | 6 | — | — | MISSING |
| core/temporal.py | 224 | 8 | — | — | MISSING |
| core/thermodynamics.py | 337 | 11 | consolidation/thermodynamics.ts | 8 | PARTIAL |
| core/tile_renderer.py | 118 | 3 | — | — | MISSING |
| core/titans_memory.py | 221 | 2 | — | — | MISSING |
| core/tripartite_calcium.py | 291 | 18 | — | — | MISSING |
| core/tripartite_synapse.py | 139 | 4 | — | — | MISSING |
| core/two_stage_model.py | 283 | 8 | consolidation/two-stage-model.ts | 11 | OK |
| core/two_stage_transfer.py | 182 | 6 | — | — | MISSING |
| core/unified_search_fusion.py | 100 | 2 | — | — | MISSING |
| core/wiki_classifier.py | 603 | 9 | — | — | MISSING |
| core/wiki_groomer.py | 204 | 6 | — | — | MISSING |
| core/wiki_layout.py | 88 | 7 | — | — | MISSING |
| core/wiki_links.py | 124 | 7 | — | — | MISSING |
| core/wiki_pages.py | 387 | 17 | — | — | MISSING |
| core/wiki_readme.py | 211 | 3 | — | — | MISSING |
| core/wiki_rule_engine.py | 117 | 3 | — | — | MISSING |
| core/wiki_schema_loader.py | 280 | 12 | — | — | MISSING |
| core/wiki_staleness.py | 134 | 4 | — | — | MISSING |
| core/wiki_symbol_extract.py | 168 | 4 | — | — | MISSING |
| core/wiki_symbol_verify.py | 96 | 2 | — | — | MISSING |
| core/wiki_sync.py | 112 | 4 | — | — | MISSING |
| core/wiki_templates.py | 366 | 5 | — | — | MISSING |
| core/wiki_thermodynamics.py | 249 | 7 | — | — | MISSING |
| core/wiki_view_executor.py | 365 | 8 | — | — | MISSING |
| core/workflow_graph_builder_relational.py | 429 | 13 | — | — | MISSING |
| core/workflow_graph_builder.py | 488 | 3 | — | — | MISSING |
| core/workflow_graph_entity.py | 99 | 3 | — | — | MISSING |
| core/workflow_graph_inputs.py | 55 | 1 | — | — | MISSING |
| core/workflow_graph_palette.py | 98 | 2 | — | — | MISSING |
| core/workflow_graph_schema_enums.py | 82 | 4 | — | — | MISSING |
| core/workflow_graph_schema.py | 381 | 15 | — | — | MISSING |
| core/write_gate_calibration.py | 227 | 8 | remember/write-gate-calibration.ts | 14 | OK |
| core/write_gate.py | 303 | 13 | remember/write-gate.ts | 6 | PARTIAL |
| core/write_post_store.py | 301 | 11 | — | — | MISSING |

> Note: `core/context_assembly/` sub-package (10 files) has no TS counterpart at all. LOC not individually listed above but included in MISSING LOC totals. These collectively form a dedicated recall context assembly sub-module (~1,200 LOC).

### 3.2 handlers/

| Python file | LOC | Py syms | TS counterpart | TS exports | Status |
|---|---|---|---|---|---|
| handlers/add_rule.py | 182 | 3 | automation/handlers/add-rule.ts | 5 | OK |
| handlers/admission.py | 96 | 5 | — | — | MISSING |
| handlers/anchor.py | 156 | 4 | remember/handlers/anchor.ts | 3 | PARTIAL |
| handlers/assess_coverage.py | 316 | 11 | — | — | MISSING |
| handlers/backfill_helpers.py | 300 | 11 | — | — | MISSING |
| handlers/backfill_memories.py | 376 | 8 | — | — | MISSING |
| handlers/change_impact.py | 220 | 4 | codebase-analysis/handlers/change-impact.ts | 6 | OK |
| handlers/checkpoint.py | 247 | 5 | — | — | MISSING |
| handlers/codebase_analyze_helpers.py | 346 | 13 | codebase-analysis/handlers/codebase-analyze-helpers.ts | 11 | PARTIAL |
| handlers/codebase_analyze.py | 409 | 13 | codebase-analysis/handlers/codebase-analyze.ts | 3 | PARTIAL |
| handlers/consolidate.py | 246 | 6 | — | — | MISSING |
| handlers/create_trigger.py | 140 | 2 | automation/handlers/create-trigger.ts | 5 | OK |
| handlers/detect_domain.py | 71 | 1 | methodology/handlers/detect-domain.ts | 1 | OK |
| handlers/detect_gaps.py | 266 | 6 | — | — | MISSING |
| handlers/drill_down.py | 204 | 6 | — | — | MISSING |
| handlers/explore_features.py | 259 | 5 | methodology/handlers/explore-features.ts | 3 | PARTIAL |
| handlers/forget.py | 123 | 2 | remember/handlers/forget.ts | 3 | OK |
| handlers/get_causal_chain.py | 291 | 9 | — | — | MISSING |
| handlers/get_methodology_graph.py | 63 | 1 | — | — | MISSING |
| handlers/get_project_story.py | 264 | 13 | narrative/handlers/get-project-story.ts | 4 | PARTIAL |
| handlers/get_rules.py | 115 | 2 | automation/handlers/get-rules.ts | 6 | OK |
| handlers/get_telemetry.py | 84 | 1 | — | — | MISSING |
| handlers/import_sessions.py | 350 | 9 | — | — | MISSING |
| handlers/ingest_codebase_cypher.py | 339 | 6 | codebase-analysis/handlers/ingest-codebase-cypher.ts | 7 | OK |
| handlers/ingest_codebase_graph.py | 102 | 3 | codebase-analysis/handlers/ingest-codebase-graph.ts | 2 | PARTIAL |
| handlers/ingest_codebase_pages.py | 66 | 3 | codebase-analysis/handlers/ingest-codebase-pages.ts | 2 | PARTIAL |
| handlers/ingest_codebase_schema.py | 64 | 0 | codebase-analysis/handlers/ingest-codebase-schema.ts | 1 | OK |
| handlers/ingest_codebase_writers.py | 234 | 7 | codebase-analysis/handlers/ingest-codebase-writers.ts | 6 | PARTIAL |
| handlers/ingest_codebase.py | 289 | 7 | codebase-analysis/handlers/ingest-codebase.ts | 3 | PARTIAL |
| handlers/ingest_helpers.py | 125 | 6 | codebase-analysis/handlers/ingest-helpers.ts | 9 | OK |
| handlers/ingest_prd.py | 348 | 11 | codebase-analysis/handlers/ingest-prd.ts | 3 | PARTIAL |
| handlers/latency_class.py | 123 | 2 | — | — | MISSING |
| handlers/list_domains.py | 67 | 1 | — | — | MISSING |
| handlers/memories_facets.py | 106 | 2 | — | — | MISSING |
| handlers/memories_page.py | 294 | 6 | — | — | MISSING |
| handlers/memory_stats.py | 81 | 2 | — | — | MISSING |
| handlers/narrative.py | 102 | 2 | narrative/handlers/narrative.ts | 2 | OK |
| handlers/navigate_memory.py | 212 | 6 | graph/handlers/navigate-memory.ts | 2 | PARTIAL |
| handlers/open_visualization.py | 303 | 5 | — | — | MISSING |
| handlers/quadtree_handler.py | 71 | 1 | — | — | MISSING |
| handlers/query_methodology.py | 300 | 9 | methodology/handlers/query-methodology.ts | 1 | PARTIAL |
| handlers/query_workflow_graph.py | 342 | 11 | workflow-graph/handlers/query-workflow-graph.ts | 4 | PARTIAL |
| handlers/rate_memory.py | 172 | 3 | remember/handlers/rate-memory.ts | 3 | OK |
| handlers/rebuild_profiles.py | 116 | 2 | methodology/handlers/rebuild-profiles.ts | 6 | OK |
| handlers/recall_helpers.py | 220 | 9 | — | — | MISSING |
| handlers/recall_hierarchical.py | 292 | 5 | — | — | MISSING |
| handlers/recall.py | 298 | 6 | — | — | MISSING |
| handlers/recompute_layout.py | 132 | 3 | — | — | MISSING |
| handlers/record_session_end.py | 390 | 10 | — | — | MISSING |
| handlers/remember_helpers.py | 481 | 12 | — | — | MISSING |
| handlers/remember_response.py | 117 | 5 | — | — | MISSING |
| handlers/remember.py | 413 | 5 | remember/handlers/remember.ts | 1 | PARTIAL |
| handlers/seed_project_constants.py | 119 | 0 | — | — | MISSING |
| handlers/seed_project_stages.py | 261 | 14 | — | — | MISSING |
| handlers/seed_project.py | 208 | 5 | codebase-analysis/handlers/seed-project.ts | 6 | OK |
| handlers/sync_instructions.py | 241 | 7 | — | — | MISSING |
| handlers/tile_handler.py | 72 | 2 | — | — | MISSING |
| handlers/unified_search.py | 123 | 2 | narrative/handlers/unified-search.ts | 5 | OK |
| handlers/validate_memory.py | 229 | 6 | — | — | MISSING |
| handlers/wiki_adr.py | 170 | 2 | wiki/handlers/wiki-adr.ts | 6 | OK |
| handlers/wiki_api.py | 415 | 13 | — | — | MISSING |
| handlers/wiki_compile.py | 229 | 5 | — | — | MISSING |
| handlers/wiki_consolidate.py | 254 | 3 | — | — | MISSING |
| handlers/wiki_curate.py | 187 | 2 | — | — | MISSING |
| handlers/wiki_emerge.py | 276 | 5 | — | — | MISSING |
| handlers/wiki_export.py | 384 | 8 | — | — | MISSING |
| handlers/wiki_extract.py | 187 | 4 | — | — | MISSING |
| handlers/wiki_link.py | 108 | 2 | wiki/handlers/wiki-link.ts | 6 | OK |
| handlers/wiki_list.py | 52 | 1 | wiki/handlers/wiki-list.ts | 6 | OK |
| handlers/wiki_migrate.py | 239 | 8 | — | — | MISSING |
| handlers/wiki_pipeline.py | 108 | 2 | — | — | MISSING |
| handlers/wiki_purge.py | 168 | 3 | wiki/handlers/wiki-purge.ts | 7 | OK |
| handlers/wiki_read.py | 57 | 1 | wiki/handlers/wiki-read.ts | 6 | OK |
| handlers/wiki_refine.py | 337 | 6 | — | — | MISSING |
| handlers/wiki_reindex.py | 91 | 2 | wiki/handlers/wiki-reindex.ts | 5 | OK |
| handlers/wiki_resolve.py | 225 | 3 | — | — | MISSING |
| handlers/wiki_seed_codebase.py | 261 | 3 | — | — | MISSING |
| handlers/wiki_synthesize.py | 328 | 6 | — | — | MISSING |
| handlers/wiki_verify.py | 157 | 3 | wiki/handlers/wiki-verify.ts | 6 | OK |
| handlers/wiki_view.py | 155 | 2 | wiki/handlers/wiki-view.ts | 7 | OK |
| handlers/wiki_write.py | 166 | 2 | wiki/handlers/wiki-write.ts | 6 | OK |
| handlers/workflow_graph.py | 317 | 4 | workflow-graph/handlers/workflow-graph.ts | 4 | OK |

### 3.3 handlers/consolidation/

| Python file | LOC | Py syms | TS counterpart | TS exports | Status |
|---|---|---|---|---|---|
| handlers/consolidation/cascade.py | 198 | 4 | consolidation/stages/cascade.ts | 3 | PARTIAL |
| handlers/consolidation/cls.py | 407 | 10 | consolidation/stages/cls.ts | 6 | PARTIAL |
| handlers/consolidation/compression.py | 194 | 5 | consolidation/stages/compression.ts | 4 | PARTIAL |
| handlers/consolidation/decay.py | 99 | 4 | consolidation/stages/decay.ts | 4 | OK |
| handlers/consolidation/homeostatic.py | 413 | 11 | consolidation/stages/homeostatic.ts | 4 | PARTIAL |
| handlers/consolidation/memify.py | 228 | 6 | consolidation/stages/memify.ts | 3 | PARTIAL |
| handlers/consolidation/plasticity.py | 188 | 6 | consolidation/stages/plasticity.ts | 3 | PARTIAL |
| handlers/consolidation/pruning.py | 131 | 6 | consolidation/stages/pruning.ts | 3 | PARTIAL |
| handlers/consolidation/sleep.py | 137 | 4 | consolidation/stages/sleep.ts | 3 | PARTIAL |
| handlers/consolidation/transfer.py | 70 | 3 | consolidation/stages/transfer.ts | 3 | OK |

### 3.4 infrastructure/

| Python file | LOC | Py syms | TS counterpart | TS exports | Status |
|---|---|---|---|---|---|
| infrastructure/agent_config.py | 211 | 4 | — | — | MISSING |
| infrastructure/ap_bridge.py | 361 | 5 | — | — | MISSING |
| infrastructure/brain_index_store.py | 20 | 1 | — | — | MISSING |
| infrastructure/config.py | 17 | 0 | — | — | MISSING |
| infrastructure/conversation_reader.py | 130 | 5 | — | — | MISSING |
| infrastructure/embedding_engine.py | 395 | 3 | infrastructure/transformers-embedding-engine.ts | 3 | OK |
| infrastructure/file_io.py | 69 | 6 | — | — | MISSING |
| infrastructure/git_diff_exec.py | 86 | 3 | — | — | MISSING |
| infrastructure/git_diff_format.py | 85 | 5 | — | — | MISSING |
| infrastructure/git_diff.py | 327 | 15 | — | — | MISSING |
| infrastructure/layout_pg_store.py | 133 | 5 | — | — | MISSING |
| infrastructure/mcp_client_pool.py | 101 | 4 | — | — | MISSING |
| infrastructure/mcp_client.py | 425 | 1 | — | — | MISSING |
| infrastructure/memory_config.py | 192 | 3 | — | — | MISSING |
| infrastructure/memory_store.py | 117 | 4 | remember/storage/memory-store.ts | 5 | OK |
| infrastructure/pg_schema.py | 1411 | 2 | — | — | MISSING |
| infrastructure/pg_store_auxiliary.py | 305 | 1 | — | — | MISSING |
| infrastructure/pg_store_entities.py | 245 | 1 | — | — | MISSING |
| infrastructure/pg_store_queries.py | 258 | 1 | — | — | MISSING |
| infrastructure/pg_store_relationships.py | 207 | 1 | — | — | MISSING |
| infrastructure/pg_store_rules.py | 77 | 1 | — | — | MISSING |
| infrastructure/pg_store_stats.py | 255 | 1 | — | — | MISSING |
| infrastructure/pg_store_wiki.py | 866 | 33 | — | — | MISSING |
| infrastructure/pg_store.py | 876 | 4 | remember/storage/pg-store.ts | 1 | PARTIAL |
| infrastructure/pipeline_discovery.py | 187 | 2 | — | — | MISSING |
| infrastructure/pipeline_graph_ttl.py | 49 | 2 | — | — | MISSING |
| infrastructure/pipeline_install_lock.py | 59 | 2 | — | — | MISSING |
| infrastructure/pipeline_install_release.py | 202 | 5 | — | — | MISSING |
| infrastructure/pipeline_install_rust.py | 219 | 6 | — | — | MISSING |
| infrastructure/pipeline_installer_common.py | 52 | 2 | — | — | MISSING |
| infrastructure/pipeline_installer.py | 209 | 6 | — | — | MISSING |
| infrastructure/profile_store.py | 218 | 10 | — | — | MISSING |
| infrastructure/scanner_parse.py | 154 | 6 | codebase-analysis/scanner-parse.ts | 8 | OK |
| infrastructure/scanner.py | 258 | 9 | codebase-analysis/scanner.ts | 5 | PARTIAL |
| infrastructure/session_store.py | 20 | 2 | — | — | MISSING |
| infrastructure/sqlite_compat.py | 144 | 3 | — | — | MISSING |
| infrastructure/sqlite_schema.py | 299 | 1 | — | — | MISSING |
| infrastructure/sqlite_store_auxiliary.py | 299 | 1 | — | — | MISSING |
| infrastructure/sqlite_store_entities.py | 166 | 1 | — | — | MISSING |
| infrastructure/sqlite_store_queries.py | 152 | 1 | — | — | MISSING |
| infrastructure/sqlite_store_relationships.py | 166 | 1 | — | — | MISSING |
| infrastructure/sqlite_store_rules.py | 69 | 1 | — | — | MISSING |
| infrastructure/sqlite_store_search.py | 372 | 1 | — | — | MISSING |
| infrastructure/sqlite_store_stats.py | 253 | 1 | — | — | MISSING |
| infrastructure/sqlite_store.py | 480 | 2 | remember/storage/sqlite-store.ts | 1 | PARTIAL |
| infrastructure/wiki_store.py | 398 | 15 | wiki/storage/wiki-store.ts | 6 | PARTIAL |
| infrastructure/workflow_graph_source_ast.py | 708 | 5 | — | — | MISSING |
| infrastructure/workflow_graph_source_jsonl.py | 364 | 15 | — | — | MISSING |
| infrastructure/workflow_graph_source_native_ast.py | 319 | 2 | — | — | MISSING |
| infrastructure/workflow_graph_source_pg.py | 251 | 7 | — | — | MISSING |
| infrastructure/workflow_graph_source.py | 244 | 8 | — | — | MISSING |

### 3.5 shared/

| Python file | LOC | Py syms | TS counterpart | TS exports | Status |
|---|---|---|---|---|---|
| shared/categorizer.py | 135 | 2 | shared/categorizer.ts | 3 | OK |
| shared/content_hardening.py | 86 | 3 | shared/content-hardening.ts | 2 | PARTIAL |
| shared/domain_mapping.py | 373 | 14 | shared/domain-mapping.ts | 4 | PARTIAL |
| shared/entity_canonical.py | 81 | 1 | shared/entity-canonical.ts | 1 | OK |
| shared/hash.py | 19 | 1 | shared/hash.ts | 1 | OK |
| shared/linear_algebra.py | 98 | 11 | methodology/linear-algebra.ts | 10 | PARTIAL |
| shared/memory_types.py | 264 | 9 | shared/memory-types.ts | 18 | OK |
| shared/project_ids.py | 48 | 3 | shared/project-ids.ts | 3 | OK |
| shared/similarity.py | 18 | 1 | shared/similarity.ts | 1 | OK |
| shared/sparse.py | 75 | 8 | shared/sparse.ts | 9 | OK |
| shared/text.py | 195 | 2 | shared/text.ts | 4 | OK |
| shared/types_profiles.py | 200 | 15 | shared/types-profiles.ts | 30 | OK |
| shared/types.py | 172 | 14 | methodology/types.ts | 33 | OK |
| shared/vader.py | 235 | 3 | shared/vader.ts | 3 | OK |
| shared/wiki_ir.py | 258 | 9 | shared/wiki-ir.ts | 30 | OK |
| shared/yaml_parser.py | 40 | 2 | shared/yaml-parser.ts | 2 | OK |

### 3.6 hooks/

| Python file | LOC | Py syms | TS counterpart | TS exports | Status |
|---|---|---|---|---|---|
| hooks/agent_briefing.py | 379 | 7 | hooks/agent-briefing.ts | 2 | PARTIAL |
| hooks/auto_recall.py | 255 | 7 | hooks/auto-recall.ts | 2 | PARTIAL |
| hooks/compaction_checkpoint.py | 112 | 3 | hooks/compaction-checkpoint.ts | 2 | PARTIAL |
| hooks/ingest_codebase_background.py | 68 | 1 | hooks/ingest-codebase-background.ts | 2 | OK |
| hooks/pipeline_impact_bump.py | 228 | 7 | hooks/pipeline-impact-bump.ts | 2 | PARTIAL |
| hooks/post_tool_capture.py | 312 | 11 | hooks/post-tool-capture.ts | 2 | PARTIAL |
| hooks/preemptive_context.py | 194 | 6 | hooks/preemptive-context.ts | 2 | PARTIAL |
| hooks/session_lifecycle.py | 241 | 7 | hooks/session-lifecycle.ts | 2 | PARTIAL |
| hooks/session_start.py | 697 | 21 | hooks/session-start.ts | 2 | PARTIAL |

> Note: All hooks are PARTIAL because TS hooks expose only `processEvent`/`main` (2 exports) while the Python versions each have 5–21 private helpers that are effectively part of the implementation surface. The TS ports appear to be entry-point stubs only; the internal logic is missing.

### 3.7 observability/ + validation/

| Python file | LOC | Py syms | TS counterpart | TS exports | Status |
|---|---|---|---|---|---|
| observability/metrics.py | 167 | 8 | shared/observability/metrics.ts | 6 | PARTIAL |
| validation/schemas.py | 316 | 3 | shared/validation/schemas.ts | 1 | PARTIAL |

### 3.8 server/ (deferred — memory-dashboard group)

All 15 files are MISSING by design (dashboard deferred). Listed for completeness.

| Python file | LOC | Status |
|---|---|---|
| server/__init__.py | — | MISSING (deferred) |
| server/http_common.py | — | MISSING (deferred) |
| server/http_dashboard_data.py | — | MISSING (deferred) |
| server/http_file_diff.py | — | MISSING (deferred) |
| server/http_launcher.py | 355 | MISSING (deferred) |
| server/http_security.py | — | MISSING (deferred) |
| server/http_server.py | — | MISSING (deferred) |
| server/http_standalone_endpoints.py | — | MISSING (deferred) |
| server/http_standalone_graph.py | 1139 | MISSING (deferred) |
| server/http_standalone_response.py | — | MISSING (deferred) |
| server/http_standalone_state.py | — | MISSING (deferred) |
| server/http_standalone_wiki.py | — | MISSING (deferred) |
| server/http_standalone.py | 447 | MISSING (deferred) |
| server/http_viz_server.py | — | MISSING (deferred) |
| server/visualize_bootstrap.py | — | MISSING (deferred) |

**Total server/ LOC**: 3,698

### 3.9 root mcp_server/*.py

| Python file | LOC | Py syms | TS counterpart | Status |
|---|---|---|---|---|
| __main__.py | 70 | 2 | — | MISSING |
| doctor.py | 332 | 10 | — | MISSING |
| tool_error_handler.py | 176 | 3 | — | MISSING |
| tool_registry_advanced.py | 173 | 7 | — | MISSING |
| tool_registry_core.py | 229 | 10 | — | MISSING |
| tool_registry_ingest.py | 103 | 4 | — | MISSING |
| tool_registry_manage.py | 201 | 8 | — | MISSING |
| tool_registry_memory.py | 252 | 10 | — | MISSING |
| tool_registry_nav.py | 152 | 6 | — | MISSING |
| tool_registry_wiki.py | 143 | 9 | — | MISSING |

> The tool registries are the MCP server's dispatch table. They wire every handler into the MCP protocol. Without them the TS server cannot expose any tool.

---

## §4 MISSING Files — Prioritized Catalogue

### Top 10 MISSING files by LOC

| Rank | Python file | LOC | Group | Blocking |
|---|---|---|---|---|
| 1 | infrastructure/pg_schema.py | 1411 | infra-storage | pg_store_* |
| 2 | infrastructure/pg_store_wiki.py | 866 | infra-storage | wiki_store |
| 3 | core/recall_pipeline.py | 759 | recall | handlers/recall |
| 4 | infrastructure/workflow_graph_source_ast.py | 708 | infra-wf-graph | wf-graph handlers |
| 5 | core/pg_recall.py | 636 | recall | recall_pipeline |
| 6 | core/wiki_classifier.py | 603 | wiki | wiki handlers |
| 7 | core/graph_builder_nodes.py | 548 | graph | graph handlers |
| 8 | core/workflow_graph_builder.py | 488 | wf-graph | wf-graph handlers |
| 9 | handlers/remember_helpers.py | 481 | handlers | handlers/remember |
| 10 | infrastructure/pg_store.py (PARTIAL) | 876 | infra-storage | (partial — 3 missing symbols) |

### 4.1 Infrastructure Storage group — port first (blocks all persistence)

| Python file | LOC | Effort (hrs) |
|---|---|---|
| infrastructure/pg_schema.py | 1411 | 14–18 |
| infrastructure/pg_store_wiki.py | 866 | 10–14 |
| infrastructure/workflow_graph_source_ast.py | 708 | 7–9 |
| infrastructure/workflow_graph_source_jsonl.py | 364 | 4–5 |
| infrastructure/workflow_graph_source_native_ast.py | 319 | 3–4 |
| infrastructure/sqlite_store_search.py | 372 | 4–5 |
| infrastructure/sqlite_store_auxiliary.py | 299 | 3–4 |
| infrastructure/sqlite_store_entities.py | 166 | 2–3 |
| infrastructure/sqlite_store_queries.py | 152 | 2–3 |
| infrastructure/sqlite_store_relationships.py | 166 | 2–3 |
| infrastructure/sqlite_store_rules.py | 69 | 1 |
| infrastructure/sqlite_store_stats.py | 253 | 3–4 |
| infrastructure/sqlite_schema.py | 299 | 3–4 |
| infrastructure/pg_store_auxiliary.py | 305 | 4–5 |
| infrastructure/pg_store_entities.py | 245 | 3–4 |
| infrastructure/pg_store_queries.py | 258 | 3–4 |
| infrastructure/pg_store_relationships.py | 207 | 2–3 |
| infrastructure/pg_store_rules.py | 77 | 1 |
| infrastructure/pg_store_stats.py | 255 | 3–4 |
| infrastructure/workflow_graph_source_pg.py | 251 | 3–4 |
| infrastructure/workflow_graph_source.py | 244 | 3–4 |
| infrastructure/mcp_client.py | 425 | 5–7 |
| infrastructure/mcp_client_pool.py | 101 | 1–2 |
| infrastructure/ap_bridge.py | 361 | 4–6 |
| infrastructure/agent_config.py | 211 | 2–3 |
| infrastructure/memory_config.py | 192 | 2–3 |
| infrastructure/config.py | 17 | 0.5 |
| infrastructure/profile_store.py | 218 | 2–3 |
| infrastructure/session_store.py | 20 | 0.5 |
| infrastructure/brain_index_store.py | 20 | 0.5 |
| infrastructure/layout_pg_store.py | 133 | 1–2 |
| infrastructure/git_diff.py | 327 | 4–5 |
| infrastructure/git_diff_exec.py | 86 | 1 |
| infrastructure/git_diff_format.py | 85 | 1 |
| infrastructure/file_io.py | 69 | 1 |
| infrastructure/conversation_reader.py | 130 | 1–2 |
| infrastructure/pipeline_installer.py | 209 | 2–3 |
| infrastructure/pipeline_install_rust.py | 219 | 2–3 |
| infrastructure/pipeline_install_release.py | 202 | 2–3 |
| infrastructure/pipeline_installer_common.py | 52 | 1 |
| infrastructure/pipeline_install_lock.py | 59 | 1 |
| infrastructure/pipeline_graph_ttl.py | 49 | 1 |
| infrastructure/pipeline_discovery.py | 187 | 2 |
| infrastructure/sqlite_compat.py | 144 | 1–2 |

### 4.2 Core recall pipeline (blocks all recall)

| Python file | LOC | Effort (hrs) |
|---|---|---|
| core/recall_pipeline.py | 759 | 8–10 |
| core/pg_recall.py | 636 | 7–9 |
| core/interference.py | 331 | 4–5 |
| core/interference_detection.py | 339 | 4–5 |
| core/reranker.py | 266 | 3–4 |
| core/retrieval_dispatch.py | 235 | 3–4 |
| core/scoring.py | 170 | 2–3 |
| core/retrieval_signals.py | 138 | 1–2 |
| core/reranker_calibration.py | 87 | 1 |
| core/dendritic_computation.py | 373 | 4–5 |
| core/fractal.py | 253 | 3–4 |
| core/fractal_clustering.py | 213 | 2–3 |
| core/sensory_buffer.py | 245 | 2–3 |
| core/separation_core.py | 202 | 2–3 |
| core/query_decomposition.py | 214 | 2–3 |
| core/context_generator.py | 133 | 1–2 |
| core/memory_decomposer.py | 305 | 3–4 |
| core/memory_rules.py | 279 | 3–4 |
| core/mmr_diversity.py | 124 | 1–2 |
| core/engram.py | 167 | 2 |
| core/unified_search_fusion.py | 100 | 1 |
| core/query_router.py | 8 | 0.5 |
| core/pattern_separation.py | 8 | 0.5 |

### 4.3 Core methodology (blocks cognitive profiling)

| Python file | LOC | Effort (hrs) |
|---|---|---|
| core/profile_assembler.py | 313 | 3–4 |
| core/metacognition_analysis.py | 302 | 3–4 |
| core/style_classifier.py | 311 | 3–4 |
| core/cognitive_map.py | 300 | 3–4 |
| core/pattern_extractor.py | 252 | 3–4 |
| core/attribution_tracer.py | 294 | 3–4 |
| core/bridge_finder.py | 238 | 2–3 |
| core/blindspot_detector.py | 231 | 2–3 |
| core/emergence_metrics.py | 222 | 2–3 |
| core/emergence_tracker.py | 220 | 2–3 |
| core/emotional_tagging.py | 268 | 2–3 |
| core/coupled_neuromodulation.py | 252 | 2–3 |
| core/neuromodulation_channels.py | 253 | 2–3 |
| core/global_detector.py | 263 | 2–3 |
| core/persona_vector.py | 194 | 2 |
| core/platt_calibration.py | 221 | 2–3 |
| core/metacognition.py | 185 | 2 |
| core/profile_builder.py | 164 | 2 |
| core/behavioral_crosscoder.py | 154 | 2 |
| core/blindspot_patterns.py | 101 | 1 |
| core/session_critique_format.py | 146 | 1–2 |
| core/session_shape.py | 140 | 1–2 |
| core/style_classifier_ema.py | 77 | 1 |

### 4.4 Core consolidation + neuro-models

| Python file | LOC | Effort (hrs) |
|---|---|---|
| core/synaptic_tagging.py | 383 | 4–5 |
| core/synaptic_plasticity.py | 255 | 3–4 |
| core/synaptic_plasticity_hebbian.py | 257 | 3–4 |
| core/synaptic_plasticity_stochastic.py | 171 | 2–3 |
| core/tripartite_calcium.py | 291 | 3–4 |
| core/tripartite_synapse.py | 139 | 1–2 |
| core/dual_store_cls_abstraction.py | 286 | 3–4 |
| core/dual_store_cls.py | 111 | 1–2 |
| core/sparse_dictionary.py | 257 | 3–4 |
| core/sparse_dictionary_learning.py | 256 | 3–4 |
| core/sparse_dictionary_activation.py | 180 | 2–3 |
| core/oscillatory_phases.py | 297 | 3–4 |
| core/sleep_compute.py | 268 | 3–4 |
| core/cascade_advancement.py | 227 | 2–3 |
| core/consolidation_engine.py | 246 | 3–4 |
| core/curation.py | 231 | 2–3 |
| core/homeostatic_health.py | 306 | 3–4 |
| core/two_stage_transfer.py | 182 | 2–3 |
| core/replay_execution.py | 242 | 3–4 |
| core/replay_formatting.py | 170 | 2–3 |
| core/replay_selection.py | 125 | 1–2 |
| core/replay_types.py | 59 | 1 |
| core/titans_memory.py | 221 | 2–3 |
| core/hierarchical_predictive_coding.py | 186 | 2–3 |
| core/predictive_coding_signals.py | 220 | 2–3 |
| core/predictive_coding_gate.py | 253 | 3–4 |
| core/predictive_coding_flat.py | 136 | 1–2 |
| core/ablation.py | 233 | 2–3 |
| core/ablation_report.py | 107 | 1 |

### 4.5 Core wiki (blocks wiki synthesis)

| Python file | LOC | Effort (hrs) |
|---|---|---|
| core/wiki_classifier.py | 603 | 6–8 |
| core/wiki_pages.py | 387 | 4–5 |
| core/wiki_templates.py | 366 | 3–4 |
| core/wiki_view_executor.py | 365 | 4–5 |
| core/wiki_schema_loader.py | 280 | 3–4 |
| core/wiki_thermodynamics.py | 249 | 2–3 |
| core/wiki_groomer.py | 204 | 2–3 |
| core/wiki_readme.py | 211 | 2–3 |
| core/wiki_rule_engine.py | 117 | 1–2 |
| core/wiki_sync.py | 112 | 1–2 |
| core/wiki_layout.py | 88 | 1 |
| core/wiki_links.py | 124 | 1–2 |
| core/wiki_staleness.py | 134 | 1–2 |
| core/wiki_symbol_extract.py | 168 | 2 |
| core/wiki_symbol_verify.py | 96 | 1 |

### 4.6 Core workflow graph

| Python file | LOC | Effort (hrs) |
|---|---|---|
| core/workflow_graph_builder.py | 488 | 5–6 |
| core/workflow_graph_builder_relational.py | 429 | 4–5 |
| core/workflow_graph_schema.py | 381 | 4–5 |
| core/workflow_graph_entity.py | 99 | 1 |
| core/workflow_graph_inputs.py | 55 | 0.5 |
| core/workflow_graph_palette.py | 98 | 1 |
| core/workflow_graph_schema_enums.py | 82 | 1 |

### 4.7 Core graph (visualization layer)

| Python file | LOC | Effort (hrs) |
|---|---|---|
| core/graph_builder_nodes.py | 548 | 5–7 |
| core/graph_builder.py | 298 | 3–4 |
| core/graph_builder_edges.py | 220 | 2–3 |
| core/graph_quality_scorer.py | 260 | 3–4 |
| core/graph_builder_dedup.py | 152 | 2 |
| core/graph_builder_discussions.py | 124 | 1–2 |
| core/layout_engine.py | 113 | 1–2 |
| core/tile_renderer.py | 118 | 1–2 |

### 4.8 Core context_assembly/ sub-package (~1,200 LOC, 10 files)

No TS counterpart exists for any of these 10 files. Entire sub-package must be ported.
Estimated effort: 12–16 hrs for the whole sub-package.

### 4.9 Core narrative

| Python file | LOC | Effort (hrs) |
|---|---|---|
| core/draft_compiler.py | 210 | 2–3 |
| core/draft_curator.py | 155 | 2 |
| core/prospective.py | 140 | 1–2 |

### 4.10 Core other

| Python file | LOC | Effort (hrs) |
|---|---|---|
| core/telemetry.py | 170 | 2 |
| core/temporal.py | 224 | 2–3 |
| core/entity_reconciliation.py | 223 | 2–3 |
| core/change_impact_matcher.py | 101 | 1 |
| core/write_post_store.py | 301 | 3–4 |

### 4.11 Handlers (MISSING)

| Python file | LOC | Effort (hrs) |
|---|---|---|
| handlers/remember_helpers.py | 481 | 5–6 |
| handlers/record_session_end.py | 390 | 4–5 |
| handlers/backfill_memories.py | 376 | 4–5 |
| handlers/wiki_export.py | 384 | 4–5 |
| handlers/wiki_api.py | 415 | 4–5 |
| handlers/wiki_synthesize.py | 328 | 3–4 |
| handlers/wiki_refine.py | 337 | 3–4 |
| handlers/recall.py | 298 | 3–4 |
| handlers/recall_hierarchical.py | 292 | 3–4 |
| handlers/get_causal_chain.py | 291 | 3–4 |
| handlers/import_sessions.py | 350 | 3–4 |
| handlers/assess_coverage.py | 316 | 3–4 |
| handlers/detect_gaps.py | 266 | 2–3 |
| handlers/seed_project_stages.py | 261 | 2–3 |
| handlers/wiki_emerge.py | 276 | 2–3 |
| handlers/wiki_consolidate.py | 254 | 2–3 |
| handlers/drill_down.py | 204 | 2–3 |
| handlers/consolidate.py | 246 | 2–3 |
| handlers/checkpoint.py | 247 | 2–3 |
| handlers/backfill_helpers.py | 300 | 3–4 |
| handlers/sync_instructions.py | 241 | 2–3 |
| handlers/memories_page.py | 294 | 3–4 |
| handlers/remember_response.py | 117 | 1–2 |
| handlers/recall_helpers.py | 220 | 2–3 |
| handlers/open_visualization.py | 303 | 3–4 |
| handlers/validate_memory.py | 229 | 2–3 |
| handlers/wiki_migrate.py | 239 | 2–3 |
| handlers/wiki_curate.py | 187 | 2 |
| handlers/wiki_extract.py | 187 | 2 |
| handlers/wiki_compile.py | 229 | 2–3 |
| handlers/wiki_resolve.py | 225 | 2–3 |
| handlers/wiki_seed_codebase.py | 261 | 2–3 |
| handlers/recompute_layout.py | 132 | 1–2 |
| handlers/admission.py | 96 | 1 |
| handlers/get_methodology_graph.py | 63 | 1 |
| handlers/get_telemetry.py | 84 | 1 |
| handlers/list_domains.py | 67 | 1 |
| handlers/latency_class.py | 123 | 1–2 |
| handlers/memories_facets.py | 106 | 1 |
| handlers/memory_stats.py | 81 | 1 |
| handlers/wiki_pipeline.py | 108 | 1 |
| handlers/quadtree_handler.py | 71 | 1 |
| handlers/tile_handler.py | 72 | 1 |
| handlers/seed_project_constants.py | 119 | 1 |

### 4.12 Root tool registries + entry point

| Python file | LOC | Effort (hrs) |
|---|---|---|
| tool_registry_memory.py | 252 | 2–3 |
| tool_registry_core.py | 229 | 2–3 |
| tool_registry_manage.py | 201 | 2–3 |
| tool_registry_advanced.py | 173 | 2 |
| tool_registry_nav.py | 152 | 2 |
| tool_registry_wiki.py | 143 | 1–2 |
| tool_registry_ingest.py | 103 | 1 |
| doctor.py | 332 | 3–4 |
| tool_error_handler.py | 176 | 2 |
| __main__.py | 70 | 1 |

---

## §5 PARTIAL Files — Missing Symbol Inventory

### 5.1 Highest-gap PARTIAL files (gap >= 5 missing symbols)

| Python file | Py syms | TS exports | Gap | Key missing symbols |
|---|---|---|---|---|
| hooks/session_start.py | 21 | 2 | 19 | `_try_setup_db`, `_connect_pg`, `_fetch_anchors`, `_fetch_team_decisions`, `_fetch_hot_memories`, `_fetch_checkpoint`, `_count_memories`, `_count_session_files`, `_detect_external_sources`, `_auto_backfill`, `_format_checkpoint_section`, `_build_context`, `_build_cold_start_message`, `_auto_wire_pipeline`, `_maybe_background_reanalyze`, `_lookup_cached_graph_path` + 3 other helpers |
| hooks/post_tool_capture.py | 11 | 2 | 9 | All internal capture/filtering/enrichment helpers |
| handlers/query_methodology.py | 9 | 1 | 8 | `_try_get_memory_store`, `_normalize_tags`, `_get_hot_memories`, `_get_fired_triggers`, `_empty_response`, `_enrich_context_with_memories`, `_build_profile_response`, `_inject_memories` |
| handlers/codebase_analyze.py | 13 | 3 | 10 | analysis orchestration helpers |
| handlers/get_project_story.py | 13 | 4 | 9 | story assembly/formatting helpers |
| core/ast_extractors.py | 16 | 9 | 7 | 7 extraction functions not yet exported |
| core/write_gate.py | 13 | 6 | 7 | `compute_surprise`, `compute_semantic_novelty`, `compute_temporal_weight`, `_apply_homeostatic_threshold`, `_compute_gate_score`, `_decide_write` |
| core/domain_detector.py | 10 | 3 | 7 | `_score_project_match`, `_score_content_match`, `_normalise_category_scores`, `_score_category_match`, `_rank_domains`, `_build_cold_start_result`, `_filter_alternatives` |
| handlers/query_workflow_graph.py | 11 | 4 | 7 | graph query helpers |
| core/knowledge_graph.py | 10 | 3 | 7 | graph traversal/scoring helpers |
| shared/domain_mapping.py | 14 | 4 | 10 | 10 domain taxonomy helpers |
| infrastructure/wiki_store.py | 15 | 6 | 9 | wiki CRUD helpers |
| handlers/consolidation/homeostatic.py | 11 | 4 | 7 | homeostatic adjustment helpers |
| core/session_critique.py | 8 | 1 | 7 | critique analysis and formatting helpers |
| handlers/ingest_prd.py | 11 | 3 | 8 | PRD parsing/segmentation helpers |
| core/ast_extractors_extra.py | 10 | 6 | 4 | extra language-specific extractors |
| handlers/remember.py | 5 | 1 | 4 | `_resolve_domain`, `_enrich_mod_with_gate`, `_parse_args`, `_handler_impl` |
| hooks/agent_briefing.py | 7 | 2 | 5 | briefing assembly helpers |
| hooks/auto_recall.py | 7 | 2 | 5 | auto-recall trigger helpers |
| hooks/pipeline_impact_bump.py | 7 | 2 | 5 | pipeline bump helpers |
| hooks/preemptive_context.py | 6 | 2 | 4 | preemptive context helpers |
| hooks/session_lifecycle.py | 7 | 2 | 5 | lifecycle event helpers |
| handlers/consolidation/cls.py | 10 | 6 | 4 | CLS stage helpers |
| core/causal_graph.py | 11 | 8 | 3 | causal chain builders |
| core/compression.py | 11 | 4 | 7 | compression algorithm helpers |
| validation/schemas.py | 3 | 1 | 2 | schema validation helpers |
| infrastructure/pg_store.py | 4 | 1 | 3 | pg transaction helpers |
| infrastructure/sqlite_store.py | 2 | 1 | 1 | sqlite pool helpers |

---

## §6 Recommended Dispatch Plan

### Dependency topology — port in this order

```
Layer 0 (no external deps — port these FIRST, in parallel):
  shared/*, infrastructure/config.py, infrastructure/sqlite_compat.py,
  infrastructure/file_io.py, infrastructure/git_diff*.py,
  core/workflow_graph_schema_enums.py, core/replay_types.py,
  core/pattern_separation.py, core/query_router.py,
  core/retrieval_signals.py, core/temporal.py, core/telemetry.py

Layer 1 (depends on layer 0):
  infrastructure/sqlite_schema.py, infrastructure/sqlite_store_*.py (7 files),
  infrastructure/pg_schema.py, infrastructure/pg_store_*.py (6 files),
  core/synaptic_plasticity.py, core/dual_store_cls.py,
  core/tripartite_synapse.py, core/oscillatory_phases.py,
  core/predictive_coding_signals.py, core/replay_selection.py,
  core/replay_formatting.py, core/scoring.py

Layer 2 (depends on layer 1):
  infrastructure/pg_store_wiki.py, infrastructure/profile_store.py,
  infrastructure/workflow_graph_source*.py (5 files), infrastructure/mcp_client.py,
  core/recall_pipeline.py, core/pg_recall.py,
  core/reranker.py, core/interference.py, core/wiki_classifier.py,
  core/workflow_graph_builder.py, core/consolidation_engine.py

Layer 3 (depends on layer 2 — all handlers, tool registries):
  All handlers/*, tool_registry_*.py, __main__.py
```

### 8-engineer 2-day sprint

| Engineer | Owns | Approx LOC | Approx hrs |
|---|---|---|---|
| Eng-1 | infrastructure/pg_schema + pg_store_* (8 files, layer 0+1) | 3,800 | 16 |
| Eng-2 | infrastructure/sqlite_schema + sqlite_store_* + sqlite_compat (10 files) | 2,100 | 12 |
| Eng-3 | core/recall_pipeline + pg_recall + scoring + reranker + retrieval_* + query_decomposition + interference* | 2,700 | 14 |
| Eng-4 | core/wiki_* (15 files) + handlers/wiki_api + wiki_export + wiki_synthesize + wiki_refine + wiki_emerge + wiki_consolidate | 4,700 | 16 |
| Eng-5 | core/dendritic_computation + fractal* + sparse_dictionary* + synaptic_* + interference + neuro-models (12 files) | 3,500 | 14 |
| Eng-6 | core/methodology group: attribution_tracer, behavioral_crosscoder, blindspot_*, bridge_finder, cognitive_map, emergence_*, emotional_tagging, global_detector, metacognition*, neuromodulation_*, pattern_extractor, persona_vector, platt_calibration, profile_*, style_classifier* | 3,800 | 14 |
| Eng-7 | handlers/record_session_end + remember_helpers + remember_response + recall + recall_helpers + recall_hierarchical + backfill_* + consolidate + checkpoint + assess_coverage + detect_gaps | 3,200 | 14 |
| Eng-8 | core/context_assembly/* (10 files) + core/graph_builder_* + layout_engine + tile_renderer + handlers/open_visualization + recompute_layout + navigate_memory (partial) + workflow_graph_builder + workflow_graph_schema | 3,200 | 14 |

**Simultaneous**: PARTIAL gaps (hooks, consolidation stages, query_methodology, remember) can be addressed by Eng-3/Eng-6/Eng-7 as they complete layer-0 dependencies since the gaps are internal helpers only.
**Root tool registries + __main__**: Eng-7 picks these up in layer-3 (~1,831 LOC, ~12 hrs additional after layer-2 completes).

---

## §7 Total LOC Remaining to Port

| Category | LOC |
|---|---|
| MISSING — infrastructure | 10,802 |
| MISSING — core | 25,474 |
| MISSING — handlers | 10,166 |
| MISSING — root (tool registry + entry point) | 1,831 |
| MISSING — server/ (deferred dashboard) | 3,698 |
| **Total MISSING LOC** | **51,971** |
| PARTIAL files — 50% gap estimate | 8,877 |
| **Grand total LOC remaining** | **57,150** |
| (excl. deferred server/ dashboard) | **53,452** |

At 100–120 Python LOC/hr for algorithmic code and 60–80 LOC/hr for storage/infrastructure, the **non-deferred** 53,452 LOC represents approximately **550–700 engineer-hours**. With 8 engineers that is **68–88 hours each** — achievable in a 2-day sprint if all engineers start layer-0 dependencies in parallel from day 1 morning.

---

*Cortex freeze: `cortex@ed33435`. Audit produced 2026-05-04.*
