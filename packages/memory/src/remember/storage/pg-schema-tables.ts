/**
 * pg-schema-tables.ts — DDL constants: core tables, wiki schema, support tables.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1-529
 * PostgreSQL 15+ with pgvector and pg_trgm required. Pure DDL.
 */

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:13-16
export const EXTENSIONS_DDL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:20-69
export const MEMORIES_DDL = `
CREATE TABLE IF NOT EXISTS memories (
    id              SERIAL PRIMARY KEY,
    content         TEXT NOT NULL,
` +
// source: sentence-transformers all-MiniLM-L6-v2 384D embedding — arxiv:1908.10084
`    embedding       vector(384),
    content_tsv     tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    tags            JSONB DEFAULT '[]'::jsonb,
    source          TEXT DEFAULT '',
    domain          TEXT DEFAULT '',
    directory_context TEXT DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    heat_base       REAL NOT NULL DEFAULT 1.0
                    CHECK (heat_base >= 0.0 AND heat_base <= 1.0),
    heat_base_set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    no_decay        BOOLEAN NOT NULL DEFAULT FALSE,
    surprise_score  REAL DEFAULT 0.0,
    importance      REAL DEFAULT 0.5,
    emotional_valence REAL DEFAULT 0.0,
    confidence      REAL DEFAULT 1.0,
    access_count    INTEGER DEFAULT 0,
    useful_count    INTEGER DEFAULT 0,
    plasticity      REAL DEFAULT 1.0,
    stability       REAL DEFAULT 0.0,
    reconsolidation_count INTEGER DEFAULT 0,
    last_reconsolidated TIMESTAMPTZ,
    store_type      TEXT DEFAULT 'episodic',
    compressed      BOOLEAN DEFAULT FALSE,
    compression_level INTEGER DEFAULT 0,
    original_content TEXT,
    is_protected    BOOLEAN DEFAULT FALSE,
    is_stale        BOOLEAN DEFAULT FALSE,
    slot_index      INTEGER,
    excitability    REAL DEFAULT 1.0,
    consolidation_stage TEXT DEFAULT 'labile',
    hours_in_stage  REAL DEFAULT 0.0,
    replay_count    INTEGER DEFAULT 0,
    theta_phase_at_encoding REAL DEFAULT 0.0,
    encoding_strength REAL DEFAULT 1.0,
    separation_index REAL DEFAULT 0.0,
    interference_score REAL DEFAULT 0.0,
    schema_match_score REAL DEFAULT 0.0,
    schema_id       TEXT,
    hippocampal_dependency REAL DEFAULT 1.0,
    is_benchmark BOOLEAN DEFAULT FALSE,
    agent_context TEXT DEFAULT '',
    is_global BOOLEAN DEFAULT FALSE
);
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:71-82
export const ENTITIES_DDL = `
CREATE TABLE IF NOT EXISTS entities (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,
    domain          TEXT DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    heat            REAL DEFAULT 1.0,
    archived        BOOLEAN DEFAULT FALSE
);
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:84-91
export const HOMEOSTATIC_STATE_DDL = `
CREATE TABLE IF NOT EXISTS homeostatic_state (
    domain     TEXT PRIMARY KEY,
    factor     REAL NOT NULL DEFAULT 1.0
` +
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:88-89 — homeostatic factor bounds
`               CHECK (factor > 0.0 AND factor < 10.0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:93-108
export const RELATIONSHIPS_DDL = `
CREATE TABLE IF NOT EXISTS relationships (
    id                  SERIAL PRIMARY KEY,
    source_entity_id    INTEGER NOT NULL REFERENCES entities(id),
    target_entity_id    INTEGER NOT NULL REFERENCES entities(id),
    relationship_type   TEXT NOT NULL,
    weight              REAL DEFAULT 1.0,
    is_causal           BOOLEAN DEFAULT FALSE,
    confidence          REAL DEFAULT 1.0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_reinforced     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    release_probability REAL DEFAULT 0.5,
    facilitation        REAL DEFAULT 0.0,
    depression          REAL DEFAULT 0.0
);
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:110-118
export const MEMORY_ENTITIES_DDL = `
CREATE TABLE IF NOT EXISTS memory_entities (
    memory_id   INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    entity_id   INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    PRIMARY KEY (memory_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities (entity_id);
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:130-329
export const WIKI_SCHEMA_DDL = `
CREATE SCHEMA IF NOT EXISTS wiki;

CREATE TABLE IF NOT EXISTS wiki.claim_events (
    id              BIGSERIAL PRIMARY KEY,
    memory_id       INTEGER REFERENCES memories(id) ON DELETE SET NULL,
    session_id      TEXT NOT NULL DEFAULT '',
    text            TEXT NOT NULL,
    claim_type      TEXT NOT NULL DEFAULT 'assertion'
                    CHECK (claim_type IN ('assertion','decision','observation','question','method','result','limitation','reference')),
    entity_ids      INTEGER[] NOT NULL DEFAULT '{}',
    evidence_refs   JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence      REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0.0 AND confidence <= 1.0),
` +
// source: sentence-transformers all-MiniLM-L6-v2 384D embedding — arxiv:1908.10084
`    embedding       vector(384),
    supersedes      BIGINT REFERENCES wiki.claim_events(id) ON DELETE SET NULL,
    extracted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wiki.concepts (
    id                      BIGSERIAL PRIMARY KEY,
    label                   TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'candidate'
                            CHECK (status IN ('candidate','saturating','promoted','merged','split','abandoned')),
` +
// source: sentence-transformers all-MiniLM-L6-v2 384D embedding — arxiv:1908.10084
`    centroid_embedding      vector(384),
    entity_ids              INTEGER[] NOT NULL DEFAULT '{}',
    grounding_memory_ids    INTEGER[] NOT NULL DEFAULT '{}',
    grounding_claim_ids     BIGINT[] NOT NULL DEFAULT '{}',
    properties              JSONB NOT NULL DEFAULT '{}'::jsonb,
    axial_slots             JSONB NOT NULL DEFAULT '{}'::jsonb,
    saturation_rate         REAL NOT NULL DEFAULT 1.0,
    saturation_streak       INTEGER NOT NULL DEFAULT 0,
    first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_property_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_page_id        INTEGER,
    merged_into_id          BIGINT REFERENCES wiki.concepts(id) ON DELETE SET NULL,
    split_into_ids          BIGINT[],
    core_category_link      BIGINT REFERENCES wiki.concepts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wiki.drafts (
    id              BIGSERIAL PRIMARY KEY,
    concept_id      BIGINT REFERENCES wiki.concepts(id) ON DELETE CASCADE,
    memory_id       INTEGER REFERENCES memories(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    kind            TEXT NOT NULL,
    lead            TEXT NOT NULL DEFAULT '',
    sections        JSONB NOT NULL DEFAULT '{}'::jsonb,
    frontmatter     JSONB NOT NULL DEFAULT '{}'::jsonb,
    provenance      JSONB NOT NULL DEFAULT '{}'::jsonb,
    synth_prompt    TEXT,
    synth_model     TEXT,
    confidence      REAL NOT NULL DEFAULT 0.5,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','published')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ,
    published_page_id INTEGER
);

CREATE TABLE IF NOT EXISTS wiki.pages (
    id              SERIAL PRIMARY KEY,
    memory_id       INTEGER UNIQUE REFERENCES memories(id) ON DELETE SET NULL,
    concept_id      BIGINT REFERENCES wiki.concepts(id) ON DELETE SET NULL,
    rel_path        TEXT UNIQUE NOT NULL,
    slug            TEXT NOT NULL,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    domain          TEXT NOT NULL DEFAULT '',
    domains         JSONB NOT NULL DEFAULT '[]'::jsonb,
    tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
    audience        JSONB NOT NULL DEFAULT '[]'::jsonb,
    requires        JSONB NOT NULL DEFAULT '[]'::jsonb,
    status          TEXT NOT NULL DEFAULT 'seedling'
                    CHECK (status IN ('seedling','budding','evergreen')),
    lifecycle_state TEXT NOT NULL DEFAULT 'active'
                    CHECK (lifecycle_state IN ('active','area','archived','evergreen')),
    supersedes      TEXT,
    superseded_by   TEXT,
    verified        TEXT,
    lead            TEXT NOT NULL DEFAULT '',
    sections        JSONB NOT NULL DEFAULT '{}'::jsonb,
    body_hash       TEXT NOT NULL DEFAULT '',
` +
// source: sentence-transformers all-MiniLM-L6-v2 384D embedding — arxiv:1908.10084
`    embedding       vector(384),
    heat            REAL NOT NULL DEFAULT 1.0 CHECK (heat >= 0.0 AND heat <= 1.0),
    access_count    INTEGER NOT NULL DEFAULT 0,
    citation_count  INTEGER NOT NULL DEFAULT 0,
    backlink_count  INTEGER NOT NULL DEFAULT 0,
    source_memory_heat REAL,
    is_stale        BOOLEAN NOT NULL DEFAULT FALSE,
    planted         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tended          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ,
    last_cited_at   TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wiki.links (
    src_page_id     INTEGER NOT NULL REFERENCES wiki.pages(id) ON DELETE CASCADE,
    dst_slug        TEXT NOT NULL,
    dst_page_id     INTEGER REFERENCES wiki.pages(id) ON DELETE SET NULL,
    link_kind       TEXT NOT NULL DEFAULT 'see-also'
                    CHECK (link_kind IN ('see-also','requires','supersedes','inline','contradicts','refines','benchmarks')),
    PRIMARY KEY (src_page_id, dst_slug, link_kind)
);

CREATE TABLE IF NOT EXISTS wiki.citations (
    id              BIGSERIAL PRIMARY KEY,
    page_id         INTEGER NOT NULL REFERENCES wiki.pages(id) ON DELETE CASCADE,
    session_id      TEXT NOT NULL DEFAULT '',
    domain          TEXT NOT NULL DEFAULT '',
    memory_id       INTEGER REFERENCES memories(id) ON DELETE SET NULL,
    cited_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wiki.memos (
    id              BIGSERIAL PRIMARY KEY,
    subject_type    TEXT NOT NULL
                    CHECK (subject_type IN ('concept','draft','page','claim')),
    subject_id      BIGINT NOT NULL,
    decision        TEXT NOT NULL,
    rationale       TEXT NOT NULL DEFAULT '',
    alternatives    JSONB NOT NULL DEFAULT '[]'::jsonb,
    inputs          JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence      REAL NOT NULL DEFAULT 0.5,
    author          TEXT NOT NULL DEFAULT 'system',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wiki_claim_events_memory ON wiki.claim_events (memory_id);
CREATE INDEX IF NOT EXISTS idx_wiki_claim_events_session ON wiki.claim_events (session_id);
CREATE INDEX IF NOT EXISTS idx_wiki_claim_events_embedding
    ON wiki.claim_events USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_wiki_concepts_status
    ON wiki.concepts (status) WHERE status IN ('candidate','saturating');
CREATE INDEX IF NOT EXISTS idx_wiki_concepts_embedding
    ON wiki.concepts USING hnsw (centroid_embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_wiki_drafts_status ON wiki.drafts (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wiki_pages_kind_status_domain ON wiki.pages (kind, status, domain);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_lifecycle_domain
    ON wiki.pages (lifecycle_state, domain) WHERE lifecycle_state IN ('active','evergreen');
CREATE INDEX IF NOT EXISTS idx_wiki_pages_heat ON wiki.pages (heat DESC) WHERE NOT is_stale;
CREATE INDEX IF NOT EXISTS idx_wiki_pages_tags_gin ON wiki.pages USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_embedding
    ON wiki.pages USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_wiki_links_dst ON wiki.links (dst_page_id) WHERE dst_page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wiki_links_dst_slug ON wiki.links (dst_slug);
CREATE INDEX IF NOT EXISTS idx_wiki_citations_page_time ON wiki.citations (page_id, cited_at DESC);
CREATE INDEX IF NOT EXISTS idx_wiki_citations_session ON wiki.citations (session_id);
CREATE INDEX IF NOT EXISTS idx_wiki_memos_subject ON wiki.memos (subject_type, subject_id);
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:334-354
export const WIKI_TRIGGERS_DDL = `
CREATE OR REPLACE FUNCTION wiki.on_citation_insert() RETURNS trigger AS $$
BEGIN
    UPDATE wiki.pages
       SET citation_count = citation_count + 1,
           last_cited_at = NEW.cited_at,
` +
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:342 — 0.05 heat bump on citation
`           heat = LEAST(1.0, heat + 0.05),
           tended = NEW.cited_at
     WHERE id = NEW.page_id;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wiki_citation_bump') THEN
    CREATE TRIGGER trg_wiki_citation_bump
      AFTER INSERT ON wiki.citations
      FOR EACH ROW EXECUTE FUNCTION wiki.on_citation_insert();
  END IF;
END $$;
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:357-388
export const WIKI_LINK_TRIGGER_DDL = `
CREATE OR REPLACE FUNCTION wiki.on_link_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.dst_page_id IS NOT NULL THEN
        UPDATE wiki.pages SET backlink_count = backlink_count + 1 WHERE id = NEW.dst_page_id;
    ELSIF TG_OP = 'DELETE' AND OLD.dst_page_id IS NOT NULL THEN
        UPDATE wiki.pages SET backlink_count = GREATEST(0, backlink_count - 1) WHERE id = OLD.dst_page_id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.dst_page_id IS DISTINCT FROM NEW.dst_page_id THEN
            IF OLD.dst_page_id IS NOT NULL THEN
                UPDATE wiki.pages SET backlink_count = GREATEST(0, backlink_count - 1) WHERE id = OLD.dst_page_id;
            END IF;
            IF NEW.dst_page_id IS NOT NULL THEN
                UPDATE wiki.pages SET backlink_count = backlink_count + 1 WHERE id = NEW.dst_page_id;
            END IF;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_wiki_link_change') THEN
    CREATE TRIGGER trg_wiki_link_change
      AFTER INSERT OR UPDATE OR DELETE ON wiki.links
      FOR EACH ROW EXECUTE FUNCTION wiki.on_link_change();
  END IF;
END $$;
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:390-528
export const SUPPORT_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS prospective_memories (
    id                  SERIAL PRIMARY KEY,
    content             TEXT NOT NULL,
    trigger_condition   TEXT NOT NULL,
    trigger_type        TEXT NOT NULL,
    target_directory    TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    triggered_at        TIMESTAMPTZ,
    triggered_count     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checkpoints (
    id                  SERIAL PRIMARY KEY,
    session_id          TEXT DEFAULT 'default',
    directory_context   TEXT DEFAULT '',
    current_task        TEXT DEFAULT '',
    files_being_edited  JSONB DEFAULT '[]'::jsonb,
    key_decisions       JSONB DEFAULT '[]'::jsonb,
    open_questions      JSONB DEFAULT '[]'::jsonb,
    next_steps          JSONB DEFAULT '[]'::jsonb,
    active_errors       JSONB DEFAULT '[]'::jsonb,
    custom_context      TEXT DEFAULT '',
    epoch               INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active           BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS memory_archives (
    id                  SERIAL PRIMARY KEY,
    original_memory_id  INTEGER NOT NULL,
    content             TEXT NOT NULL,
` +
// source: sentence-transformers all-MiniLM-L6-v2 384D embedding — arxiv:1908.10084
`    embedding           vector(384),
    archived_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mismatch_score      REAL DEFAULT 0.0,
    archive_reason      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS consolidation_log (
    id                  SERIAL PRIMARY KEY,
    timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    memories_added      INTEGER DEFAULT 0,
    memories_updated    INTEGER DEFAULT 0,
    memories_archived   INTEGER DEFAULT 0,
    duration_ms         INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stage_transitions (
    id                  SERIAL PRIMARY KEY,
    memory_id           INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    from_stage          TEXT NOT NULL,
    to_stage            TEXT NOT NULL,
    transitioned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hours_in_prev_stage REAL DEFAULT 0.0,
    trigger             TEXT DEFAULT 'cascade'
);
CREATE INDEX IF NOT EXISTS idx_stage_transitions_memory ON stage_transitions (memory_id);
CREATE INDEX IF NOT EXISTS idx_stage_transitions_time ON stage_transitions (transitioned_at);

CREATE TABLE IF NOT EXISTS engram_slots (
    slot_index          INTEGER PRIMARY KEY,
    excitability        REAL DEFAULT 0.5,
    last_activated      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS memory_rules (
    id                  SERIAL PRIMARY KEY,
    rule_type           TEXT NOT NULL DEFAULT 'soft',
    scope               TEXT NOT NULL DEFAULT 'global',
    scope_value         TEXT,
    condition           TEXT NOT NULL,
    action              TEXT NOT NULL,
    priority            INTEGER DEFAULT 0,
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schemas (
    id                      SERIAL PRIMARY KEY,
    schema_id               TEXT UNIQUE NOT NULL,
    domain                  TEXT DEFAULT '',
    label                   TEXT DEFAULT '',
    entity_signature        JSONB DEFAULT '{}'::jsonb,
    relationship_types      JSONB DEFAULT '[]'::jsonb,
    tag_signature           JSONB DEFAULT '{}'::jsonb,
    consistency_threshold   REAL DEFAULT 0.7,
    formation_count         INTEGER DEFAULT 0,
    assimilation_count      INTEGER DEFAULT 0,
    violation_count         INTEGER DEFAULT 0,
    last_updated            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oscillatory_state (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    state_json  TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS user_mood (
    user_id     TEXT PRIMARY KEY DEFAULT 'default',
    valence     REAL NOT NULL DEFAULT 0.0
        CHECK (valence >= -1.0 AND valence <= 1.0),
    arousal     REAL NOT NULL DEFAULT 0.0
        CHECK (arousal >= -1.0 AND arousal <= 1.0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO user_mood (user_id, valence, arousal) VALUES ('default', 0.0, 0.0)
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS workflow_graph_layout (
    node_id              TEXT PRIMARY KEY,
    x                    REAL NOT NULL,
    y                    REAL NOT NULL,
    kind                 TEXT NOT NULL,
    topology_fingerprint TEXT NOT NULL,
    layout_version       BIGINT NOT NULL,
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
