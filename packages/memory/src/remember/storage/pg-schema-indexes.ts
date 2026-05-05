/**
 * pg-schema-indexes.ts — Indexes and migrations DDL.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:530-1353
 */

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:532-567
export const INDEXES_DDL = `
CREATE INDEX IF NOT EXISTS idx_memories_embedding
    ON memories USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_memories_content_tsv ON memories USING gin (content_tsv);
CREATE INDEX IF NOT EXISTS idx_memories_content_trgm ON memories USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_memories_heat_base ON memories (heat_base);
CREATE INDEX IF NOT EXISTS idx_memories_domain ON memories (domain);
CREATE INDEX IF NOT EXISTS idx_memories_store_type ON memories (store_type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories (created_at);
CREATE INDEX IF NOT EXISTS idx_memories_stage ON memories (consolidation_stage);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities (name);
CREATE INDEX IF NOT EXISTS idx_entities_heat ON entities (heat);
CREATE INDEX IF NOT EXISTS idx_prospective_active ON prospective_memories (is_active);
CREATE INDEX IF NOT EXISTS idx_schemas_domain ON schemas (domain);
CREATE INDEX IF NOT EXISTS idx_rel_pair_type
    ON relationships (source_entity_id, target_entity_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_memories_agent_context ON memories (agent_context);
CREATE INDEX IF NOT EXISTS idx_workflow_graph_layout_version ON workflow_graph_layout (layout_version);
CREATE INDEX IF NOT EXISTS idx_workflow_graph_layout_kind ON workflow_graph_layout (kind);
CREATE INDEX IF NOT EXISTS idx_workflow_graph_layout_xy ON workflow_graph_layout (x, y);
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1128-1353
export const MIGRATIONS_DDL = `
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memories' AND column_name = 'heat')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memories' AND column_name = 'heat_base')
    THEN ALTER TABLE memories RENAME COLUMN heat TO heat_base;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memories' AND column_name = 'heat_base_set_at')
    THEN
        ALTER TABLE memories ADD COLUMN heat_base_set_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        UPDATE memories SET heat_base_set_at = COALESCE(last_accessed, created_at, NOW());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'memories' AND column_name = 'no_decay')
    THEN ALTER TABLE memories ADD COLUMN no_decay BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_relationships_canonical_co_retrieval')
    THEN
        CREATE UNIQUE INDEX uq_relationships_canonical_co_retrieval
            ON relationships (source_entity_id, target_entity_id, relationship_type)
            WHERE relationship_type = 'co_retrieval';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='is_benchmark')
    THEN ALTER TABLE memories ADD COLUMN is_benchmark BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_memories_not_benchmark ON memories (heat_base DESC) WHERE NOT is_benchmark;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='agent_context')
    THEN ALTER TABLE memories ADD COLUMN agent_context TEXT DEFAULT '';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='is_global')
    THEN ALTER TABLE memories ADD COLUMN is_global BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_memories_is_global ON memories (is_global) WHERE is_global = TRUE;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='stage_entered_at')
    THEN
        ALTER TABLE memories ADD COLUMN stage_entered_at TIMESTAMPTZ;
        UPDATE memories SET stage_entered_at = created_at WHERE stage_entered_at IS NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='ingested_at')
    THEN
        ALTER TABLE memories ADD COLUMN ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        UPDATE memories SET ingested_at = created_at;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='arousal')
    THEN ALTER TABLE memories ADD COLUMN arousal REAL NOT NULL DEFAULT 0.0 CHECK (arousal >= 0.0 AND arousal <= 1.0);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='dominant_emotion')
    THEN ALTER TABLE memories ADD COLUMN dominant_emotion TEXT NOT NULL DEFAULT 'neutral'
        CHECK (dominant_emotion IN ('frustration','satisfaction','confusion','urgency','discovery','neutral'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_memories_dominant_emotion ON memories (dominant_emotion) WHERE dominant_emotion != 'neutral';

CREATE OR REPLACE FUNCTION normalize_domain() RETURNS trigger AS $$
BEGIN
    NEW.domain := LOWER(COALESCE(NEW.domain, ''));
    IF NEW.domain IN ('jarvis', 'cortex-cowork') THEN NEW.domain := 'cortex'; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_memories_domain_normalize') THEN
        CREATE TRIGGER trg_memories_domain_normalize BEFORE INSERT OR UPDATE OF domain ON memories
        FOR EACH ROW EXECUTE FUNCTION normalize_domain();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_entities_domain_normalize') THEN
        CREATE TRIGGER trg_entities_domain_normalize BEFORE INSERT OR UPDATE OF domain ON entities
        FOR EACH ROW EXECUTE FUNCTION normalize_domain();
    END IF;
END $$;
`;
