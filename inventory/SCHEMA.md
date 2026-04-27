# Cortex Schema Inventory

**Source files**:
- `/Users/cdeust/Developments/Cortex/mcp_server/infrastructure/pg_schema.py` (1 333 LOC) — PostgreSQL DDL
- `/Users/cdeust/Developments/Cortex/mcp_server/infrastructure/sqlite_schema.py` (299 LOC) — SQLite DDL (fallback)
- `/Users/cdeust/Developments/Cortex/scripts/v3_13_0_a3_migration.sql` — A3 migration
- `/Users/cdeust/Developments/Cortex/scripts/v3_13_0_a3_rollback.sql` — A3 rollback
- `/Users/cdeust/Developments/Cortex/scripts/phase_0_4_5_backfill.sql` — Phase 0.4.5 backfill
- `/Users/cdeust/Developments/Cortex/scripts/v3_12_2_entity_canonical_merge.sql` — Entity canonical merge

**Extracted**: 2026-04-26

The migration manifest (`docs/MIGRATION_MANIFEST.md`) depends on this file being accurate.
All column types and constraints are verbatim from the DDL constants in `pg_schema.py`.

---

## PostgreSQL Schema — `public` schema

### Table: `memories`

Primary persistence store for all memory items.

**Source**: `pg_schema.py:MEMORIES_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | — |
| `content` | `TEXT` | `NOT NULL` | — |
| `embedding` | `vector(384)` | — | NULL |
| `content_tsv` | `tsvector` | `GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` | — |
| `tags` | `JSONB` | — | `'[]'::jsonb` |
| `source` | `TEXT` | — | `''` |
| `domain` | `TEXT` | — | `''` |
| `directory_context` | `TEXT` | — | `''` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `last_accessed` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `heat_base` | `REAL` | `NOT NULL`, `CHECK (heat_base >= 0.0 AND heat_base <= 1.0)` | `1.0` |
| `heat_base_set_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `no_decay` | `BOOLEAN` | `NOT NULL` | `FALSE` |
| `surprise_score` | `REAL` | — | `0.0` |
| `importance` | `REAL` | — | `0.5` |
| `emotional_valence` | `REAL` | — | `0.0` |
| `confidence` | `REAL` | — | `1.0` |
| `access_count` | `INTEGER` | — | `0` |
| `useful_count` | `INTEGER` | — | `0` |
| `plasticity` | `REAL` | — | `1.0` |
| `stability` | `REAL` | — | `0.0` |
| `reconsolidation_count` | `INTEGER` | — | `0` |
| `last_reconsolidated` | `TIMESTAMPTZ` | — | NULL |
| `store_type` | `TEXT` | — | `'episodic'` |
| `compressed` | `BOOLEAN` | — | `FALSE` |
| `compression_level` | `INTEGER` | — | `0` |
| `original_content` | `TEXT` | — | NULL |
| `is_protected` | `BOOLEAN` | — | `FALSE` |
| `is_stale` | `BOOLEAN` | — | `FALSE` |
| `slot_index` | `INTEGER` | — | NULL |
| `excitability` | `REAL` | — | `1.0` |
| `consolidation_stage` | `TEXT` | — | `'labile'` |
| `hours_in_stage` | `REAL` | — | `0.0` |
| `replay_count` | `INTEGER` | — | `0` |
| `theta_phase_at_encoding` | `REAL` | — | `0.0` |
| `encoding_strength` | `REAL` | — | `1.0` |
| `separation_index` | `REAL` | — | `0.0` |
| `interference_score` | `REAL` | — | `0.0` |
| `schema_match_score` | `REAL` | — | `0.0` |
| `schema_id` | `TEXT` | — | NULL |
| `hippocampal_dependency` | `REAL` | — | `1.0` |
| `is_benchmark` | `BOOLEAN` | — | `FALSE` |
| `agent_context` | `TEXT` | — | `''` |
| `is_global` | `BOOLEAN` | — | `FALSE` |

**NOTE**: The A3 migration (`v3_13_0_a3_migration.sql`) adds `stage_entered_at TIMESTAMPTZ` (referenced in `effective_heat` function at `pg_schema.py:574`). This column is NOT in `MEMORIES_DDL` above — it was added via migration. The TS schema must include it.

**Indexes** (from `INDEXES_DDL`):
- `idx_memories_embedding` — HNSW `(embedding vector_cosine_ops)` WITH `(m=16, ef_construction=64)`
- `idx_memories_content_tsv` — GIN `(content_tsv)`
- `idx_memories_content_trgm` — GIN `(content gin_trgm_ops)`
- `idx_memories_heat_base` — BTree `(heat_base)`
- `idx_memories_domain` — BTree `(domain)`
- `idx_memories_store_type` — BTree `(store_type)`
- `idx_memories_created_at` — BTree `(created_at)`
- `idx_memories_stage` — BTree `(consolidation_stage)`
- `idx_memories_agent_context` — BTree `(agent_context)`

**Extensions required**: `vector` (pgvector), `pg_trgm`

---

### Table: `entities`

Knowledge graph nodes — persons, concepts, tools, codebases, etc.

**Source**: `pg_schema.py:ENTITIES_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | — |
| `name` | `TEXT` | `NOT NULL` | — |
| `type` | `TEXT` | `NOT NULL` | — |
| `domain` | `TEXT` | — | `''` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `last_accessed` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `heat` | `REAL` | — | `1.0` |
| `archived` | `BOOLEAN` | — | `FALSE` |

**Indexes**: `idx_entities_name` — BTree `(name)`, `idx_entities_heat` — BTree `(heat)`

---

### Table: `homeostatic_state`

One row per domain — tracks the homeostatic scaling factor.

**Source**: `pg_schema.py:HOMEOSTATIC_STATE_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `domain` | `TEXT` | `PRIMARY KEY` | — |
| `factor` | `REAL` | `NOT NULL`, `CHECK (factor > 0.0 AND factor < 10.0)` | `1.0` |
| `updated_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |

---

### Table: `relationships`

Knowledge graph edges — typed relationships between entities.

**Source**: `pg_schema.py:RELATIONSHIPS_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | — |
| `source_entity_id` | `INTEGER` | `NOT NULL REFERENCES entities(id)` | — |
| `target_entity_id` | `INTEGER` | `NOT NULL REFERENCES entities(id)` | — |
| `relationship_type` | `TEXT` | `NOT NULL` | — |
| `weight` | `REAL` | — | `1.0` |
| `is_causal` | `BOOLEAN` | — | `FALSE` |
| `confidence` | `REAL` | — | `1.0` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `last_reinforced` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `release_probability` | `REAL` | — | `0.5` |
| `facilitation` | `REAL` | — | `0.0` |
| `depression` | `REAL` | — | `0.0` |

**Indexes**: `idx_rel_pair_type` — BTree `(source_entity_id, target_entity_id, relationship_type)`

---

### Table: `memory_entities` (join table)

Many-to-many: memories ↔ entities.

**Source**: `pg_schema.py:MEMORY_ENTITIES_DDL`

| Column | Type | Constraints |
|---|---|---|
| `memory_id` | `INTEGER` | `NOT NULL REFERENCES memories(id) ON DELETE CASCADE` |
| `entity_id` | `INTEGER` | `NOT NULL REFERENCES entities(id) ON DELETE CASCADE` |

**Primary key**: `(memory_id, entity_id)`
**Index**: `idx_memory_entities_entity` on `(entity_id)`

---

### Table: `prospective_memories`

Trigger-based prospective memory (forward-looking).

**Source**: `pg_schema.py:SUPPORT_TABLES_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | — |
| `content` | `TEXT` | `NOT NULL` | — |
| `trigger_condition` | `TEXT` | `NOT NULL` | — |
| `trigger_type` | `TEXT` | `NOT NULL` | — |
| `target_directory` | `TEXT` | — | NULL |
| `is_active` | `BOOLEAN` | — | `TRUE` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `triggered_at` | `TIMESTAMPTZ` | — | NULL |
| `triggered_count` | `INTEGER` | — | `0` |

**Index**: `idx_prospective_active` on `(is_active)`

---

### Table: `checkpoints`

Working-state snapshots (hippocampal checkpoints).

**Source**: `pg_schema.py:SUPPORT_TABLES_DDL`

| Column | Type | Default |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | — |
| `session_id` | `TEXT` | `'default'` |
| `directory_context` | `TEXT` | `''` |
| `current_task` | `TEXT` | `''` |
| `files_being_edited` | `JSONB` | `'[]'::jsonb` |
| `key_decisions` | `JSONB` | `'[]'::jsonb` |
| `open_questions` | `JSONB` | `'[]'::jsonb` |
| `next_steps` | `JSONB` | `'[]'::jsonb` |
| `active_errors` | `JSONB` | `'[]'::jsonb` |
| `custom_context` | `TEXT` | `''` |
| `epoch` | `INTEGER` | `0` |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` |
| `is_active` | `BOOLEAN` | `TRUE` |

---

### Table: `memory_archives`

Archived (soft-deleted) memory records.

**Source**: `pg_schema.py:SUPPORT_TABLES_DDL`

| Column | Type | Default |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | — |
| `original_memory_id` | `INTEGER NOT NULL` | — |
| `content` | `TEXT NOT NULL` | — |
| `embedding` | `vector(384)` | NULL |
| `archived_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` |
| `mismatch_score` | `REAL` | `0.0` |
| `archive_reason` | `TEXT` | `''` |

---

### Table: `consolidation_log`

Audit log for consolidation runs.

**Source**: `pg_schema.py:SUPPORT_TABLES_DDL`

| Column | Type | Default |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | — |
| `timestamp` | `TIMESTAMPTZ NOT NULL` | `NOW()` |
| `memories_added` | `INTEGER` | `0` |
| `memories_updated` | `INTEGER` | `0` |
| `memories_archived` | `INTEGER` | `0` |
| `duration_ms` | `INTEGER` | `0` |

---

### Table: `stage_transitions`

History of memory consolidation stage changes.

**Source**: `pg_schema.py:SUPPORT_TABLES_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | — |
| `memory_id` | `INTEGER` | `NOT NULL REFERENCES memories(id) ON DELETE CASCADE` | — |
| `from_stage` | `TEXT` | `NOT NULL` | — |
| `to_stage` | `TEXT` | `NOT NULL` | — |
| `transitioned_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `hours_in_prev_stage` | `REAL` | — | `0.0` |
| `trigger` | `TEXT` | — | `'cascade'` |

**Indexes**: `idx_stage_transitions_memory` on `(memory_id)`, `idx_stage_transitions_time` on `(transitioned_at)`

---

### Table: `engram_slots`

Fixed-capacity engram cell excitability state.

**Source**: `pg_schema.py:SUPPORT_TABLES_DDL`

| Column | Type | Default |
|---|---|---|
| `slot_index` | `INTEGER PRIMARY KEY` | — |
| `excitability` | `REAL` | `0.5` |
| `last_activated` | `TIMESTAMPTZ` | NULL |

---

### Table: `memory_rules`

Neuro-symbolic rules for memory behaviour.

**Source**: `pg_schema.py:SUPPORT_TABLES_DDL`

| Column | Type | Default |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | — |
| `rule_type` | `TEXT NOT NULL` | `'soft'` |
| `scope` | `TEXT NOT NULL` | `'global'` |
| `scope_value` | `TEXT` | NULL |
| `condition` | `TEXT NOT NULL` | — |
| `action` | `TEXT NOT NULL` | — |
| `priority` | `INTEGER` | `0` |
| `is_active` | `BOOLEAN` | `TRUE` |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` |

---

### Table: `schemas`

Memory schema templates (for schema assimilation / violation detection).

**Source**: `pg_schema.py:SUPPORT_TABLES_DDL`

| Column | Type | Default |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | — |
| `schema_id` | `TEXT UNIQUE NOT NULL` | — |
| `domain` | `TEXT` | `''` |
| `label` | `TEXT` | `''` |
| `entity_signature` | `JSONB` | `'{}'::jsonb` |
| `relationship_types` | `JSONB` | `'[]'::jsonb` |
| `tag_signature` | `JSONB` | `'{}'::jsonb` |
| `consistency_threshold` | `REAL` | `0.7` |
| `formation_count` | `INTEGER` | `0` |
| `assimilation_count` | `INTEGER` | `0` |
| `violation_count` | `INTEGER` | `0` |
| `last_updated` | `TIMESTAMPTZ NOT NULL` | `NOW()` |
| `created_at` | `TIMESTAMPTZ NOT NULL` | `NOW()` |

**Index**: `idx_schemas_domain` on `(domain)`

---

### Table: `oscillatory_state`

Singleton row for oscillatory clock state.

**Source**: `pg_schema.py:SUPPORT_TABLES_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `INTEGER` | `PRIMARY KEY`, `CHECK (id = 1)` | — |
| `state_json` | `TEXT` | `NOT NULL` | `'{}'` |

---

### Stored Function: `effective_heat(m memories, t_now TIMESTAMPTZ, factor REAL, p_factor REAL)`

**Source**: `pg_schema.py:EFFECTIVE_HEAT_FN`

Returns `REAL`. The single source of truth for computed memory heat. Pure (STABLE, PARALLEL SAFE).

**Key constants** (all require `// source:` in TS equivalent):

| Constant | Value | Source |
|---|---|---|
| `p_factor` default | `0.99787` | `0.95^(1/24)` — phase-3-a3-migration-design.md §2 |
| Stage α: `'labile'` | (read from implementation) | Kandel 2001 |
| Stage α: `'early_ltp'` | (read from implementation) | Kandel 2001 |
| Stage α: `'late_ltp'` | (read from implementation) | Kandel 2001 |
| Stage α: `'consolidated'` | (read from implementation) | Kandel 2001 |
| Stage floor: `'consolidated'` | `0.10` | Bahrick 1984 permastore |
| Emotional β formula | (time-dependent) | Yonelinas & Ritchey 2015; Kleinsmith & Kaplan 1963 |

---

## PostgreSQL Schema — `wiki` schema

### Table: `wiki.claim_events`

Atomic extracted assertions from session transcripts.

**Source**: `pg_schema.py:WIKI_SCHEMA_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | — |
| `memory_id` | `INTEGER` | `REFERENCES memories(id) ON DELETE SET NULL` | NULL |
| `session_id` | `TEXT` | `NOT NULL` | `''` |
| `text` | `TEXT` | `NOT NULL` | — |
| `claim_type` | `TEXT` | `NOT NULL`, `CHECK (claim_type IN ('assertion','decision','observation','question','method','result','limitation','reference'))` | `'assertion'` |
| `entity_ids` | `INTEGER[]` | `NOT NULL` | `'{}'` |
| `evidence_refs` | `JSONB` | `NOT NULL` | `'[]'::jsonb` |
| `confidence` | `REAL` | `NOT NULL`, `CHECK (confidence >= 0.0 AND confidence <= 1.0)` | `0.5` |
| `embedding` | `vector(384)` | — | NULL |
| `supersedes` | `BIGINT` | `REFERENCES wiki.claim_events(id) ON DELETE SET NULL` | NULL |
| `extracted_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |

**Indexes**: `idx_wiki_claim_events_memory` `(memory_id)`, `idx_wiki_claim_events_session` `(session_id)`, `idx_wiki_claim_events_embedding` HNSW `(embedding vector_cosine_ops)`

---

### Table: `wiki.concepts`

Emergent knowledge nodes (grounded-theory Strauss axial coding).

**Source**: `pg_schema.py:WIKI_SCHEMA_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | — |
| `label` | `TEXT` | `NOT NULL` | — |
| `status` | `TEXT` | `NOT NULL`, `CHECK (status IN ('candidate','saturating','promoted','merged','split','abandoned'))` | `'candidate'` |
| `centroid_embedding` | `vector(384)` | — | NULL |
| `entity_ids` | `INTEGER[]` | `NOT NULL` | `'{}'` |
| `grounding_memory_ids` | `INTEGER[]` | `NOT NULL` | `'{}'` |
| `grounding_claim_ids` | `BIGINT[]` | `NOT NULL` | `'{}'` |
| `properties` | `JSONB` | `NOT NULL` | `'{}'::jsonb` |
| `axial_slots` | `JSONB` | `NOT NULL` | `'{}'::jsonb` |
| `saturation_rate` | `REAL` | `NOT NULL` | `1.0` |
| `saturation_streak` | `INTEGER` | `NOT NULL` | `0` |
| `first_seen_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `last_property_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `promoted_page_id` | `INTEGER` | — | NULL |
| `merged_into_id` | `BIGINT` | `REFERENCES wiki.concepts(id) ON DELETE SET NULL` | NULL |
| `split_into_ids` | `BIGINT[]` | — | NULL |
| `core_category_link` | `BIGINT` | `REFERENCES wiki.concepts(id) ON DELETE SET NULL` | NULL |

**Indexes**: `idx_wiki_concepts_status` partial `(status) WHERE status IN ('candidate','saturating')`, `idx_wiki_concepts_embedding` HNSW `(centroid_embedding vector_cosine_ops)`

---

### Table: `wiki.drafts`

Synthesised page content awaiting curation.

**Source**: `pg_schema.py:WIKI_SCHEMA_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | — |
| `concept_id` | `BIGINT` | `REFERENCES wiki.concepts(id) ON DELETE CASCADE` | NULL |
| `memory_id` | `INTEGER` | `REFERENCES memories(id) ON DELETE SET NULL` | NULL |
| `title` | `TEXT` | `NOT NULL` | — |
| `kind` | `TEXT` | `NOT NULL` | — |
| `lead` | `TEXT` | `NOT NULL` | `''` |
| `sections` | `JSONB` | `NOT NULL` | `'{}'::jsonb` |
| `frontmatter` | `JSONB` | `NOT NULL` | `'{}'::jsonb` |
| `provenance` | `JSONB` | `NOT NULL` | `'{}'::jsonb` |
| `synth_prompt` | `TEXT` | — | NULL |
| `synth_model` | `TEXT` | — | NULL |
| `confidence` | `REAL` | `NOT NULL` | `0.5` |
| `status` | `TEXT` | `NOT NULL`, `CHECK (status IN ('pending','approved','rejected','published'))` | `'pending'` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `reviewed_at` | `TIMESTAMPTZ` | — | NULL |
| `published_page_id` | `INTEGER` | — | NULL |

**Index**: `idx_wiki_drafts_status` partial `(status) WHERE status = 'pending'`

---

### Table: `wiki.pages`

Authored wiki pages (index of Markdown files).

**Source**: `pg_schema.py:WIKI_SCHEMA_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `SERIAL` | `PRIMARY KEY` | — |
| `memory_id` | `INTEGER` | `UNIQUE REFERENCES memories(id) ON DELETE SET NULL` | NULL |
| `concept_id` | `BIGINT` | `REFERENCES wiki.concepts(id) ON DELETE SET NULL` | NULL |
| `rel_path` | `TEXT` | `UNIQUE NOT NULL` | — |
| `slug` | `TEXT` | `NOT NULL` | — |
| `kind` | `TEXT` | `NOT NULL` | — |
| `title` | `TEXT` | `NOT NULL` | — |
| `domain` | `TEXT` | `NOT NULL` | `''` |
| `domains` | `JSONB` | `NOT NULL` | `'[]'::jsonb` |
| `tags` | `JSONB` | `NOT NULL` | `'[]'::jsonb` |
| `audience` | `JSONB` | `NOT NULL` | `'[]'::jsonb` |
| `requires` | `JSONB` | `NOT NULL` | `'[]'::jsonb` |
| `status` | `TEXT` | `NOT NULL`, `CHECK (status IN ('seedling','budding','evergreen'))` | `'seedling'` |
| `lifecycle_state` | `TEXT` | `NOT NULL`, `CHECK (lifecycle_state IN ('active','area','archived','evergreen'))` | `'active'` |
| `supersedes` | `TEXT` | — | NULL |
| `superseded_by` | `TEXT` | — | NULL |
| `verified` | `TEXT` | — | NULL |
| `lead` | `TEXT` | `NOT NULL` | `''` |
| `sections` | `JSONB` | `NOT NULL` | `'{}'::jsonb` |
| `body_hash` | `TEXT` | `NOT NULL` | `''` |
| `embedding` | `vector(384)` | — | NULL |
| `heat` | `REAL` | `NOT NULL`, `CHECK (heat >= 0.0 AND heat <= 1.0)` | `1.0` |
| `access_count` | `INTEGER` | `NOT NULL` | `0` |
| `citation_count` | `INTEGER` | `NOT NULL` | `0` |
| `backlink_count` | `INTEGER` | `NOT NULL` | `0` |
| `source_memory_heat` | `REAL` | — | NULL |
| `is_stale` | `BOOLEAN` | `NOT NULL` | `FALSE` |
| `planted` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `tended` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |
| `last_accessed_at` | `TIMESTAMPTZ` | — | NULL |
| `last_cited_at` | `TIMESTAMPTZ` | — | NULL |
| `archived_at` | `TIMESTAMPTZ` | — | NULL |

**Indexes**: `idx_wiki_pages_kind_status_domain` `(kind, status, domain)`, `idx_wiki_pages_lifecycle_domain` partial `WHERE lifecycle_state IN ('active','evergreen')`, `idx_wiki_pages_heat` partial `(heat DESC) WHERE NOT is_stale`, `idx_wiki_pages_tags_gin` GIN `(tags)`, `idx_wiki_pages_embedding` HNSW `(embedding vector_cosine_ops)`

---

### Table: `wiki.links`

Typed directed links between wiki pages.

**Source**: `pg_schema.py:WIKI_SCHEMA_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `src_page_id` | `INTEGER` | `NOT NULL REFERENCES wiki.pages(id) ON DELETE CASCADE` | — |
| `dst_slug` | `TEXT` | `NOT NULL` | — |
| `dst_page_id` | `INTEGER` | `REFERENCES wiki.pages(id) ON DELETE SET NULL` | NULL |
| `link_kind` | `TEXT` | `NOT NULL`, `CHECK (link_kind IN ('see-also','requires','supersedes','inline','contradicts','refines','benchmarks'))` | `'see-also'` |

**Primary key**: `(src_page_id, dst_slug, link_kind)`
**Indexes**: `idx_wiki_links_dst` partial `(dst_page_id) WHERE dst_page_id IS NOT NULL`, `idx_wiki_links_dst_slug` `(dst_slug)`

**Trigger**: `trg_wiki_link_change` → `wiki.on_link_change()` — maintains `backlink_count` denormalisation on INSERT/UPDATE/DELETE.

---

### Table: `wiki.citations`

Citation events (page referenced during a session).

**Source**: `pg_schema.py:WIKI_SCHEMA_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | — |
| `page_id` | `INTEGER` | `NOT NULL REFERENCES wiki.pages(id) ON DELETE CASCADE` | — |
| `session_id` | `TEXT` | `NOT NULL` | `''` |
| `domain` | `TEXT` | `NOT NULL` | `''` |
| `memory_id` | `INTEGER` | `REFERENCES memories(id) ON DELETE SET NULL` | NULL |
| `cited_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |

**Indexes**: `idx_wiki_citations_page_time` `(page_id, cited_at DESC)`, `idx_wiki_citations_session` `(session_id)`

**Trigger**: `trg_wiki_citation_bump` → `wiki.on_citation_insert()` — on INSERT, increments `citation_count`, updates `last_cited_at`, bumps `heat` by `+0.05` (capped at 1.0).

---

### Table: `wiki.memos`

Curation decision audit trail (merge/split/promote/abandon rationale).

**Source**: `pg_schema.py:WIKI_SCHEMA_DDL`

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | `BIGSERIAL` | `PRIMARY KEY` | — |
| `subject_type` | `TEXT` | `NOT NULL`, `CHECK (subject_type IN ('concept','draft','page','claim'))` | — |
| `subject_id` | `BIGINT` | `NOT NULL` | — |
| `decision` | `TEXT` | `NOT NULL` | — |
| `rationale` | `TEXT` | `NOT NULL` | `''` |
| `alternatives` | `JSONB` | `NOT NULL` | `'[]'::jsonb` |
| `inputs` | `JSONB` | `NOT NULL` | `'{}'::jsonb` |
| `confidence` | `REAL` | `NOT NULL` | `0.5` |
| `author` | `TEXT` | `NOT NULL` | `'system'` |
| `created_at` | `TIMESTAMPTZ` | `NOT NULL` | `NOW()` |

**Index**: `idx_wiki_memos_subject` `(subject_type, subject_id)`

---

## SQLite Schema (Fallback)

**Source**: `infrastructure/sqlite_schema.py`

The SQLite schema mirrors the PostgreSQL `public` schema with these adaptations:

| PostgreSQL | SQLite |
|---|---|
| `SERIAL` | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `TIMESTAMPTZ` | `TEXT` (ISO-8601 strings) |
| `BOOLEAN` | `INTEGER` (0/1) |
| `JSONB` | `TEXT` (JSON strings) |
| `vector(384)` | Omitted (handled by `sqlite-vec` virtual table `memories_vec`) |
| `tsvector GENERATED` | Handled by FTS5 virtual table `memories_fts` |

**Additional virtual tables**:
- `memories_fts` — FTS5 content table backing `content` column
- `memories_vec` — `vec0(embedding float[384])` for vector similarity

The SQLite schema does NOT include the `wiki` schema — the wiki subsystem requires PostgreSQL.

---

## Migration Scripts

| Script | Purpose |
|---|---|
| `scripts/v3_13_0_a3_migration.sql` | A3 lazy-heat migration: adds `heat_base_set_at`, `stage_entered_at` columns; creates `effective_heat()` function |
| `scripts/v3_13_0_a3_rollback.sql` | Rollback of A3 migration |
| `scripts/phase_0_4_5_backfill.sql` | Backfill `heat_base_set_at` from `last_accessed` for pre-A3 rows |
| `scripts/v3_12_2_entity_canonical_merge.sql` | Merge duplicate entities using canonical form |
| `benchmarks/hnsw_probe/*.sql` | HNSW parameter benchmark queries |
