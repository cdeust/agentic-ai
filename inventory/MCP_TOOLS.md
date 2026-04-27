# Cortex MCP Tools — Exhaustive Registry

**Source files**:
- `/Users/cdeust/Developments/Cortex/mcp_server/tool_registry_core.py` (229 LOC, 9 tools)
- `/Users/cdeust/Developments/Cortex/mcp_server/tool_registry_memory.py` (240 LOC, 8 tools)
- `/Users/cdeust/Developments/Cortex/mcp_server/tool_registry_manage.py` (201 LOC, 7 tools)
- `/Users/cdeust/Developments/Cortex/mcp_server/tool_registry_advanced.py` (173 LOC, 6 tools)
- `/Users/cdeust/Developments/Cortex/mcp_server/tool_registry_nav.py` (152 LOC, 5 tools)
- `/Users/cdeust/Developments/Cortex/mcp_server/tool_registry_wiki.py` (143 LOC, 8 tools)
- `/Users/cdeust/Developments/Cortex/mcp_server/tool_registry_ingest.py` (101 LOC, 3 tools)

**Extracted**: 2026-04-26
**Total tools**: 46

The TS port must register the SAME set of tools with the SAME parameter names, types, and defaults.
Any deviation in tool name, parameter name, or parameter type causes parity-oracle failure.

---

## Tier 1 Core Profiling Tools — `tool_registry_core.py`

### `query_methodology`

**Handler**: `mcp_server.handlers.query_methodology.handler`
**Purpose**: Returns cognitive profile for the current domain (thinking style, entry patterns, blind spots, cross-domain bridges).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `cwd` | `str \| None` | No | `None` |
| `project` | `str \| None` | No | `None` |
| `first_message` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON-encoded profile with fields: `context`, `coldStart: bool`, `domain`, `thinkingStyle`, `entryPatterns`, `blindSpots`, `connectionBridges`, `recurringPatterns`)

---

### `detect_domain`

**Handler**: `mcp_server.handlers.detect_domain.handler`
**Purpose**: Lightweight domain classification from cwd/project without full profile assembly.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `cwd` | `str \| None` | No | `None` |
| `project` | `str \| None` | No | `None` |
| `first_message` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON: `domain`, `confidence`, `candidates[]`)

---

### `rebuild_profiles`

**Handler**: `mcp_server.handlers.rebuild_profiles.handler`
**Purpose**: Full rescan of all session data to rebuild methodology profiles from scratch.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `domain` | `str \| None` | No | `None` |
| `force` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `rebuilt[]`, `duration_ms`)

---

### `list_domains`

**Handler**: `mcp_server.handlers.list_domains.handler`
**Purpose**: Overview of all detected cognitive domains with session counts and last-seen dates.

| Parameter | Type | Required | Default |
|---|---|---|---|
| (none) | — | — | — |

**Return shape**: `str` (JSON: `domains[]` each with `name`, `session_count`, `last_seen`)

---

### `record_session_end`

**Handler**: `mcp_server.handlers.record_session_end.handler`
**Purpose**: Incremental EMA profile update after a session ends.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `session_id` | `str` | **Yes** | — |
| `domain` | `str \| None` | No | `None` |
| `tools_used` | `list[str] \| None` | No | `None` |
| `duration` | `float \| None` | No | `None` |
| `turn_count` | `int \| None` | No | `None` |
| `keywords` | `list[str] \| None` | No | `None` |
| `cwd` | `str \| None` | No | `None` |
| `project` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON: `updated: bool`, `domain`, `session_id`)

---

### `get_methodology_graph`

**Handler**: `mcp_server.handlers.get_methodology_graph.handler`
**Purpose**: Returns methodology map as graph data for 3D visualisation.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `domain` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON: `nodes[]`, `edges[]` for D3/Three.js)

---

### `query_workflow_graph`

**Handler**: `mcp_server.handlers.query_workflow_graph.handler`
**Purpose**: Return a typed subgraph of the unified workflow graph.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `node_kind` | `str \| list[str] \| None` | No | `None` |
| `edge_kind` | `str \| list[str] \| None` | No | `None` |
| `neighbour_of` | `str \| None` | No | `None` |
| `depth` | `int \| None` | No | `None` |
| `domain` | `str \| None` | No | `None` |
| `limit_nodes` | `int \| None` | No | `None` |

**Return shape**: `str` (JSON: `nodes[]`, `edges[]`, `stats`)

---

### `open_visualization`

**Handler**: `mcp_server.handlers.open_visualization.handler`
**Purpose**: Launch the 3D methodology constellation map in the browser.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `domain` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON: `url`, `port`)

---

### `explore_features`

**Handler**: `mcp_server.handlers.explore_features.handler`
**Purpose**: Explore interpretability features: persona vector, attribution trace, crosscoder patterns.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `mode` | `str` | **Yes** | — |
| `domain` | `str \| None` | No | `None` |
| `compare_domain` | `str \| None` | No | `None` |

**Valid `mode` values**: `"features"`, `"persona"`, `"attribution"`, `"crosscoder"`

**Return shape**: `str` (JSON — shape varies by mode)

---

## Tier 1 Memory Read/Write Tools — `tool_registry_memory.py`

### `remember`

**Handler**: `mcp_server.handlers.remember.handler`
**Purpose**: Store a memory through the predictive coding write gate.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `content` | `str` | **Yes** | — |
| `tags` | `list[str] \| None` | No | `[]` |
| `directory` | `str \| None` | No | `""` |
| `domain` | `str \| None` | No | `""` |
| `source` | `str \| None` | No | `"user"` |
| `force` | `bool` | No | `False` |
| `agent_topic` | `str \| None` | No | `""` |

**Return shape**: `str` (JSON: `memory_id: int`, `stored: bool`, `heat: float`, `duplicate_of: int | null`)

---

### `recall`

**Handler**: `mcp_server.handlers.recall.handler`
**Purpose**: Retrieve memories using multi-signal fusion (vector + BM25 + heat + spreading activation).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `query` | `str` | **Yes** | — |
| `domain` | `str \| None` | No | `None` |
| `directory` | `str \| None` | No | `None` |
| `max_results` | `int` | No | `10` |
| `min_heat` | `float` | No | `0.05` |
| `agent_topic` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON: `memories[]` each with `id`, `content`, `heat`, `tags`, `domain`, `created_at`, `score`)

---

### `memory_stats`

**Handler**: `mcp_server.handlers.memory_stats.handler`
**Purpose**: Memory system diagnostics — counts, heat distribution, store sizes.

| Parameter | Type | Required | Default |
|---|---|---|---|
| (none) | — | — | — |

**Return shape**: `str` (JSON: `total_memories`, `domains[]`, `heat_histogram`, `store_type_counts`)

---

### `checkpoint`

**Handler**: `mcp_server.handlers.checkpoint.handler`
**Purpose**: Save or restore working state for hippocampal replay.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `action` | `str` | **Yes** | — |
| `directory` | `str \| None` | No | `""` |
| `current_task` | `str \| None` | No | `""` |
| `files_being_edited` | `list[str] \| None` | No | `[]` |
| `key_decisions` | `list[str] \| None` | No | `[]` |
| `open_questions` | `list[str] \| None` | No | `[]` |
| `next_steps` | `list[str] \| None` | No | `[]` |
| `active_errors` | `list[str] \| None` | No | `[]` |
| `custom_context` | `str \| None` | No | `""` |
| `session_id` | `str \| None` | No | `"default"` |

**Valid `action` values**: `"save"`, `"restore"`, `"list"`

**Return shape**: `str` (JSON — varies by action; `"save"` returns `checkpoint_id`; `"restore"` returns full checkpoint fields)

---

### `narrative`

**Handler**: `mcp_server.handlers.narrative.handler`
**Purpose**: Generate project narrative from stored memories (structured summary).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `directory` | `str \| None` | No | `None` |
| `domain` | `str \| None` | No | `None` |
| `brief` | `bool` | No | `False` |

**Return shape**: `str` (Markdown narrative text)

---

### `consolidate`

**Handler**: `mcp_server.handlers.consolidate.handler`
**Purpose**: Run memory maintenance pipeline: decay, compression, CLS transfer, memify, pruning.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `decay` | `bool` | No | `True` |
| `compress` | `bool` | No | `True` |
| `cls` | `bool` | No | `True` |
| `memify` | `bool` | No | `True` |
| `deep` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `decayed`, `compressed`, `transferred`, `memified`, `pruned`, `duration_ms`)

---

### `import_sessions`

**Handler**: `mcp_server.handlers.import_sessions.handler`
**Purpose**: Import Claude Code JSONL conversation history into the memory store (streams via head+tail, per ADR-0045 R2).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `project` | `str \| None` | No | `""` |
| `domain` | `str \| None` | No | `""` |
| `min_importance` | `float` | No | `0.4` |
| `max_sessions` | `int` | No | `0` (= all) |
| `dry_run` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `imported`, `skipped`, `sessions_processed`, `preview[]` if dry_run)

---

### `unified_search`

**Handler**: `mcp_server.handlers.unified_search.handler`
**Purpose**: RRF-fuse Cortex memory recall with AP code search (ADR-0046 P3).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `query` | `str` | **Yes** | — |
| `domain` | `str \| None` | No | `None` |
| `max_results` | `int` | No | `10` |
| `k` | `int` | No | `60` |

**Return shape**: `str` (JSON: `results[]` with `source: "cortex" | "ap"`, `score`, `content`)

---

## Tier 1 Memory Management Tools — `tool_registry_manage.py`

### `forget`

**Handler**: `mcp_server.handlers.forget.handler`
**Purpose**: Delete or soft-delete a memory by integer ID.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `memory_id` | `int` | **Yes** | — |
| `soft` | `bool` | No | `False` |
| `force` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `deleted: bool`, `archived: bool`)

---

### `validate_memory`

**Handler**: `mcp_server.handlers.validate_memory.handler`
**Purpose**: Validate memories against current filesystem state (mark stale if referenced files no longer exist).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `memory_id` | `int \| None` | No | `None` |
| `domain` | `str \| None` | No | `None` |
| `directory` | `str \| None` | No | `None` |
| `base_dir` | `str \| None` | No | `""` |
| `staleness_threshold` | `float` | No | `0.5` |
| `dry_run` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `validated`, `stale_marked`, `errors[]`)

---

### `rate_memory`

**Handler**: `mcp_server.handlers.rate_memory.handler`
**Purpose**: Rate a memory as useful or not to update metamemory confidence and `useful_count`.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `memory_id` | `int` | **Yes** | — |
| `useful` | `bool` | **Yes** | — |

**Return shape**: `str` (JSON: `memory_id`, `useful_count`, `confidence`)

---

### `seed_project`

**Handler**: `mcp_server.handlers.seed_project.handler`
**Purpose**: Bootstrap memory from an existing codebase by scanning files and creating structured memories.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `directory` | `str \| None` | No | `""` |
| `domain` | `str \| None` | No | `""` |
| `max_file_size_kb` | `int` | No | `64` |
| `dry_run` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `seeded`, `skipped`, `errors[]`)

---

### `anchor`

**Handler**: `mcp_server.handlers.anchor.handler`
**Purpose**: Mark a memory as compaction-resistant (`heat_base=1.0`, `no_decay=True`, `is_protected=True`).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `memory_id` | `int` | **Yes** | — |
| `reason` | `str \| None` | No | `""` |

**Return shape**: `str` (JSON: `memory_id`, `anchored: bool`)

---

### `backfill_memories`

**Handler**: `mcp_server.handlers.backfill_memories.handler`
**Purpose**: Auto-import prior Claude Code conversation JSONL files, applying Ebbinghaus-decay initial heat.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `project` | `str \| None` | No | `""` |
| `max_files` | `int` | No | `20` |
| `min_importance` | `float` | No | `0.35` |
| `dry_run` | `bool` | No | `False` |
| `force_reprocess` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `backfilled`, `skipped`, `files_processed`)

---

### `codebase_analyze`

**Handler**: `mcp_server.handlers.codebase_analyze.handler`
**Purpose**: Analyze codebase and store structural memories (functions, classes, imports, relationships).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `directory` | `str \| None` | No | `""` |
| `languages` | `list[str] \| None` | No | `None` |
| `max_files` | `int` | No | `500` |
| `max_file_size_kb` | `int` | No | `100` |
| `incremental` | `bool` | No | `True` |
| `dry_run` | `bool` | No | `False` |
| `domain` | `str \| None` | No | `""` |

**Return shape**: `str` (JSON: `analyzed`, `memories_created`, `entities_created`)

---

## Tier 2 Navigation Tools — `tool_registry_nav.py`

### `recall_hierarchical`

**Handler**: `mcp_server.handlers.recall_hierarchical.handler`
**Purpose**: Retrieve memories using fractal hierarchy — groups semantically similar results into clusters.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `query` | `str` | **Yes** | — |
| `domain` | `str \| None` | No | `None` |
| `max_results` | `int` | No | `10` |
| `min_heat` | `float` | No | `0.05` |
| `cluster_threshold` | `float` | No | `0.6` |

**Return shape**: `str` (JSON: `clusters[]` each with `cluster_id`, `centroid_label`, `memories[]`)

---

### `drill_down`

**Handler**: `mcp_server.handlers.drill_down.handler`
**Purpose**: Navigate into a fractal memory cluster by cluster_id.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `cluster_id` | `str` | **Yes** | — |
| `domain` | `str \| None` | No | `None` |
| `min_heat` | `float` | No | `0.05` |

**Return shape**: `str` (JSON: `cluster_id`, `memories[]`, `sub_clusters[]`)

---

### `navigate_memory`

**Handler**: `mcp_server.handlers.navigate_memory.handler`
**Purpose**: Navigate memory space using Successor Representation — returns temporally and semantically adjacent memories.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `memory_id` | `int` | **Yes** | — |
| `max_depth` | `int` | No | `2` |
| `include_2d_map` | `bool` | No | `False` |
| `window_hours` | `float` | No | `2.0` |

**Return shape**: `str` (JSON: `memory`, `adjacent[]`, `predecessors[]`, `successors[]`, `map_data` if `include_2d_map`)

---

### `get_causal_chain`

**Handler**: `mcp_server.handlers.get_causal_chain.handler`
**Purpose**: Trace entity relationships through the knowledge graph.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `entity_name` | `str \| None` | No | `None` |
| `memory_id` | `int \| None` | No | `None` |
| `relationship_types` | `list[str] \| None` | No | `None` |
| `max_depth` | `int` | No | `3` |
| `direction` | `str` | No | `"both"` |

**Valid `direction` values**: `"incoming"`, `"outgoing"`, `"both"`

**Return shape**: `str` (JSON: `chain[]` nodes, `relationships[]` edges, `root_entity`)

---

### `detect_gaps`

**Handler**: `mcp_server.handlers.detect_gaps.handler`
**Purpose**: Identify knowledge gaps in the memory store (entity gaps, domain gaps, temporal gaps).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `domain` | `str \| None` | No | `None` |
| `include_entity_gaps` | `bool` | No | `True` |
| `include_domain_gaps` | `bool` | No | `True` |
| `include_temporal_gaps` | `bool` | No | `True` |
| `stale_threshold_days` | `int` | No | `30` |

**Return shape**: `str` (JSON: `entity_gaps[]`, `domain_gaps[]`, `temporal_gaps[]`, `recommendations[]`)

---

## Tier 3 Advanced Tools — `tool_registry_advanced.py`

### `sync_instructions`

**Handler**: `mcp_server.handlers.sync_instructions.handler`
**Purpose**: Push top memory insights into `CLAUDE.md` (or similar instruction file).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `directory` | `str \| None` | No | `""` |
| `max_insights` | `int` | No | `10` |
| `min_heat` | `float` | No | `0.3` |
| `dry_run` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `synced`, `file_path`, `preview[]` if dry_run)

---

### `create_trigger`

**Handler**: `mcp_server.handlers.create_trigger.handler`
**Purpose**: Create a prospective memory trigger (stored in `prospective_memories` table).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `content` | `str` | **Yes** | — |
| `trigger_condition` | `str` | **Yes** | — |
| `trigger_type` | `str` | No | `"keyword"` |
| `target_directory` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON: `trigger_id`, `created: bool`)

---

### `add_rule`

**Handler**: `mcp_server.handlers.add_rule.handler`
**Purpose**: Add a neuro-symbolic rule to the memory store.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `condition` | `str` | **Yes** | — |
| `action` | `str` | **Yes** | — |
| `rule_type` | `str` | No | `"soft"` |
| `scope` | `str` | No | `"global"` |
| `scope_value` | `str \| None` | No | `None` |
| `priority` | `int` | No | `0` |

**Valid `rule_type` values**: `"soft"`, `"hard"`
**Valid `scope` values**: `"global"`, `"domain"`, `"directory"`

**Return shape**: `str` (JSON: `rule_id`, `created: bool`)

---

### `get_rules`

**Handler**: `mcp_server.handlers.get_rules.handler`
**Purpose**: List active neuro-symbolic rules.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `scope` | `str \| None` | No | `None` |
| `rule_type` | `str \| None` | No | `None` |
| `include_inactive` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `rules[]` each with `id`, `condition`, `action`, `rule_type`, `scope`, `priority`, `is_active`)

---

### `get_project_story`

**Handler**: `mcp_server.handlers.get_project_story.handler`
**Purpose**: Generate a period-based autobiographical narrative (week/month/all).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `directory` | `str \| None` | No | `None` |
| `domain` | `str \| None` | No | `None` |
| `period` | `str` | No | `"week"` |
| `max_chapters` | `int` | No | `5` |

**Valid `period` values**: `"day"`, `"week"`, `"month"`, `"all"`

**Return shape**: `str` (Markdown narrative with chapters)

---

### `assess_coverage`

**Handler**: `mcp_server.handlers.assess_coverage.handler`
**Purpose**: Evaluate knowledge coverage completeness for the current domain/directory.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `directory` | `str \| None` | No | `""` |
| `domain` | `str \| None` | No | `""` |
| `stale_days` | `int` | No | `14` |

**Return shape**: `str` (JSON: `coverage_score: float`, `gaps[]`, `stale_count`, `recommendations[]`)

---

## Wiki Tools — `tool_registry_wiki.py`

### `wiki_write`

**Handler**: `mcp_server.handlers.wiki_write.handler`
**Purpose**: Author a wiki page (create/append/replace) with provided Markdown.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `path` | `str` | **Yes** | — |
| `content` | `str` | **Yes** | — |
| `mode` | `str` | No | `"create"` |
| `tags` | `list[str] \| None` | No | `[]` |

**Valid `mode` values**: `"create"`, `"append"`, `"replace"`

**Return shape**: `str` (JSON: `path`, `page_id`, `created: bool`)

---

### `wiki_read`

**Handler**: `mcp_server.handlers.wiki_read.handler`
**Purpose**: Read the raw Markdown of a wiki page by relative path.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `path` | `str` | **Yes** | — |

**Return shape**: `str` (raw Markdown content)

---

### `wiki_list`

**Handler**: `mcp_server.handlers.wiki_list.handler`
**Purpose**: List authored wiki pages, optionally filtered by kind.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `kind` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON: `pages[]` each with `path`, `title`, `kind`, `status`, `heat`)

---

### `wiki_link`

**Handler**: `mcp_server.handlers.wiki_link.handler`
**Purpose**: Add a bidirectional link between two wiki pages (creates Related section entry).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `from_path` | `str` | **Yes** | — |
| `to_path` | `str` | **Yes** | — |
| `relation` | `str` | **Yes** | — |

**Return shape**: `str` (JSON: `linked: bool`, `from_page_id`, `to_page_id`)

---

### `wiki_adr`

**Handler**: `mcp_server.handlers.wiki_adr.handler`
**Purpose**: Create a numbered ADR (Architecture Decision Record) with auto-incremented sequence.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `title` | `str` | **Yes** | — |
| `context` | `str` | **Yes** | — |
| `decision` | `str` | **Yes** | — |
| `consequences` | `str` | **Yes** | — |
| `status` | `str` | No | `"accepted"` |
| `tags` | `list[str] \| None` | No | `[]` |

**Valid `status` values**: `"proposed"`, `"accepted"`, `"deprecated"`, `"superseded"`

**Return shape**: `str` (JSON: `path`, `adr_number`, `page_id`)

---

### `wiki_reindex`

**Handler**: `mcp_server.handlers.wiki_reindex.handler`
**Purpose**: Regenerate the wiki table of contents at `.generated/INDEX.md`.

| Parameter | Type | Required | Default |
|---|---|---|---|
| (none) | — | — | — |

**Return shape**: `str` (JSON: `pages_indexed`, `index_path`)

---

### `wiki_purge`

**Handler**: `mcp_server.handlers.wiki_purge.handler`
**Purpose**: Re-evaluate and purge wiki pages that fail the current classifier.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `apply` | `bool` | No | `False` |
| `kind` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON: `candidates[]`, `purged` if apply=True)

---

### `wiki_verify`

**Handler**: `mcp_server.handlers.wiki_verify.handler`
**Purpose**: Verify wiki-page symbol citations against AP's code graph (ADR-0046 Phase 2).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `path` | `str \| None` | No | `None` (= all pages) |

**Return shape**: `str` (JSON: `verified`, `broken_citations[]`, `missing_symbols[]`)

---

## Upstream Ingest Tools — `tool_registry_ingest.py`

### `ingest_codebase`

**Handler**: `mcp_server.handlers.ingest_codebase.handler`
**Purpose**: Ingest upstream codebase analysis from ai-automatised-pipeline into Cortex.

| Parameter | Type | Required | Default |
|---|---|---|---|
| `project_path` | `str` | **Yes** | — |
| `output_dir` | `str \| None` | No | `None` |
| `language` | `str` | No | `"auto"` |
| `force_reindex` | `bool` | No | `False` |
| `top_symbols` | `int` | No | `50` |
| `top_processes` | `int` | No | `10` |

**Return shape**: `str` (JSON: `ingested`, `symbols_stored`, `processes_stored`)

---

### `ingest_prd`

**Handler**: `mcp_server.handlers.ingest_prd.handler`
**Purpose**: Ingest a PRD document into Cortex (from path or content string).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `path` | `str \| None` | No | `None` |
| `content` | `str \| None` | No | `None` |
| `pipeline_id` | `str \| None` | No | `None` |
| `title` | `str \| None` | No | `None` |
| `validate` | `bool` | No | `False` |
| `domain` | `str \| None` | No | `None` |

**Return shape**: `str` (JSON: `memory_id`, `stored: bool`, `sections_found`)

---

### `change_impact`

**Handler**: `mcp_server.handlers.change_impact.handler`
**Purpose**: Report memories affected by a commit's code changes (ADR-0046 P4).

| Parameter | Type | Required | Default |
|---|---|---|---|
| `base` | `str` | No | `"HEAD~1"` |
| `head` | `str` | No | `"HEAD"` |
| `expand_impact` | `bool` | No | `False` |
| `apply_heat_bump` | `bool` | No | `False` |

**Return shape**: `str` (JSON: `affected_memories[]`, `impacted_symbols[]`, `heat_bumped` if apply_heat_bump)

---

## Tool Count Verification

| Registry file | Declared tool count | Actual tools registered | Match |
|---|---|---|---|
| `tool_registry_core.py` | "8 tools" (docstring) | 9 (`query_methodology` through `explore_features`) | NOTE: docstring says 8, actual is 9 |
| `tool_registry_memory.py` | "8 tools" | 8 | OK |
| `tool_registry_manage.py` | "6 tools" (docstring) | 7 (includes `codebase_analyze`) | NOTE: docstring says 6, actual is 7 |
| `tool_registry_advanced.py` | "6 tools" | 6 | OK |
| `tool_registry_nav.py` | "5 tools" | 5 | OK |
| `tool_registry_wiki.py` | "7 tools" | 8 (includes `wiki_verify`) | NOTE: docstring says 7, actual is 8 |
| `tool_registry_ingest.py` | "2 tools" (docstring) | 3 (includes `change_impact`) | NOTE: docstring says 2, actual is 3 |
| **TOTAL** | 42 (sum of docstrings) | **46** | Counting discrepancy: 4 extra tools |

**Counting disproof applied**: The docstrings undercount by 4 tools. The actual registration code (the `register()` function calls) is authoritative. The TS port must implement all **46 tools**.
