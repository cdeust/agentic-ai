/**
 * pg-schema-functions.ts — PL/pgSQL stored procedures and getAllDdl().
 *
 * source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:570-1411
 * Pure DDL. Numeric constants extracted to named TS constants with citations.
 */

import {
  EXTENSIONS_DDL, MEMORIES_DDL, ENTITIES_DDL, HOMEOSTATIC_STATE_DDL,
  RELATIONSHIPS_DDL, MEMORY_ENTITIES_DDL, WIKI_SCHEMA_DDL,
  WIKI_TRIGGERS_DDL, WIKI_LINK_TRIGGER_DDL, SUPPORT_TABLES_DDL,
} from "./pg-schema-tables.js";
import { INDEXES_DDL, MIGRATIONS_DDL } from "./pg-schema-indexes.js";

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:597
// 0.95^(1/24) ≈ 0.99787 — converts daily decay factor to per-hour rate.
// Source: docs/program/phase-3-a3-migration-design.md §2.
const PG_P_FACTOR_DEFAULT = 0.99787; // source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:597

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:646
// Yonelinas & Ritchey (2015) emotional enhancement coefficient = 0.30.
const PG_EMOTIONAL_DAMPING = 0.30; // source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:646

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:943
const PG_SPREAD_DECAY_DEFAULT = 0.65; // source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:943

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:944
const PG_SPREAD_THRESHOLD_DEFAULT = 0.10; // source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:944

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:735
const PG_MIN_HEAT_DEFAULT = 0.05; // source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:735

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1065
const PG_HOT_EMBEDDINGS_LIMIT = 500; // source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1065

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1095
const PG_CO_ACCESS_LIMIT = 100; // source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1095

// source: SI base unit (3600 seconds per hour)
const SECS_PER_HOUR = 3600.0; // source: SI — International System of Units

// source: SI base unit (86400 seconds per day)
const SECS_PER_DAY = 86400.0; // source: SI — International System of Units

// source: Bahrick, H.P. (1984). "Semantic memory content in permastore." JECP 33(3).
const PERMASTORE_FLOOR_CONSOLIDATED = 0.10; // source: Bahrick (1984) — consolidated permastore floor

// source: Benna, M.K. & Fusi, S. (2016). "Computational principles of synaptic memory." Nature Neurosci 19(12).
const PERMASTORE_FLOOR_LATE = 0.05; // source: Benna & Fusi (2016) — late_ltp/reconsolidating floor

// ── PL/pgSQL: effective_heat ──────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:586-683

export const EFFECTIVE_HEAT_FN = `
CREATE OR REPLACE FUNCTION effective_heat(
    m           memories,
    t_now       TIMESTAMPTZ,
    factor      REAL DEFAULT 1.0,
    p_factor    REAL DEFAULT ${PG_P_FACTOR_DEFAULT}
) RETURNS REAL AS $$
DECLARE
    hours_elapsed  DOUBLE PRECISION;
    stage_hours    DOUBLE PRECISION;
    alpha          DOUBLE PRECISION;
    beta           DOUBLE PRECISION;
    stage_floor    DOUBLE PRECISION;
    base_scaled    DOUBLE PRECISION;
    decayed        DOUBLE PRECISION;
BEGIN
    IF m.is_protected OR COALESCE(m.no_decay, FALSE) THEN
        RETURN LEAST(1.0::REAL, GREATEST(0.0::REAL, m.heat_base * factor));
    END IF;
    hours_elapsed := GREATEST(0.0, EXTRACT(EPOCH FROM
        (t_now - COALESCE(m.heat_base_set_at, m.last_accessed, m.created_at)))
        / ${SECS_PER_HOUR});
    stage_hours := GREATEST(0.0, EXTRACT(EPOCH FROM
        (t_now - COALESCE(m.stage_entered_at, m.created_at))) / ${SECS_PER_HOUR});
    alpha := CASE m.consolidation_stage
        WHEN 'labile'          THEN 2.0
        WHEN 'early_ltp'       THEN 1.2
        WHEN 'late_ltp'        THEN 0.8
        WHEN 'consolidated'    THEN 0.5
        WHEN 'reconsolidating' THEN 1.5
        ELSE 1.0
    END;
    beta := 1.0 - ${PG_EMOTIONAL_DAMPING} * ABS(COALESCE(m.emotional_valence, 0.0))
                * (1.0 - EXP(-LEAST(stage_hours / 1.0, 80.0)));
    stage_floor := CASE m.consolidation_stage
        WHEN 'consolidated'    THEN ${PERMASTORE_FLOOR_CONSOLIDATED}
        WHEN 'late_ltp'        THEN ${PERMASTORE_FLOOR_LATE}
        WHEN 'reconsolidating' THEN ${PERMASTORE_FLOOR_LATE}
        ELSE 0.0
    END;
    base_scaled := m.heat_base::DOUBLE PRECISION * factor::DOUBLE PRECISION;
    decayed := base_scaled * POWER(p_factor::DOUBLE PRECISION, alpha * beta * hours_elapsed);
    decayed := LEAST(1.0::DOUBLE PRECISION,
` +
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:677 — 1e-38 prevents REAL underflow on cast
`                     GREATEST(GREATEST(stage_floor, 1e-38::DOUBLE PRECISION), decayed));
    RETURN decayed::REAL;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:691-706
export const EFFECTIVE_HEAT_FROZEN_FN = `
CREATE OR REPLACE FUNCTION effective_heat_frozen(
    m           memories,
    t_now       TIMESTAMPTZ,
    factor      REAL DEFAULT 1.0,
` +
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:697 — 0.95 pre-A3 daily decay factor
`    p_factor    REAL DEFAULT 0.95
) RETURNS REAL AS $$
BEGIN
    RETURN LEAST(1.0, GREATEST(0.0, m.heat_base));
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:729-937
export const RECALL_MEMORIES_LAZY_FN = `
DROP FUNCTION IF EXISTS recall_memories(
    TEXT, vector, TEXT, TEXT, TEXT, TEXT, REAL, INT, INT,
    REAL, REAL, REAL, REAL, REAL, BOOLEAN
);
CREATE OR REPLACE FUNCTION recall_memories(
    p_query_text    TEXT,
` +
// source: sentence-transformers all-MiniLM-L6-v2 384D embedding — arxiv:1908.10084
`    p_query_emb     vector(384),
    p_intent        TEXT DEFAULT 'general',
    p_domain        TEXT DEFAULT NULL,
    p_directory     TEXT DEFAULT NULL,
    p_agent_topic   TEXT DEFAULT NULL,
    p_min_heat      REAL DEFAULT ${PG_MIN_HEAT_DEFAULT},
    p_max_results   INT DEFAULT 10,
    p_wrrf_k        INT DEFAULT 60,
    p_w_vector      REAL DEFAULT 1.0,
    p_w_fts         REAL DEFAULT 0.5,
    p_w_heat        REAL DEFAULT 0.3,
    p_w_ngram       REAL DEFAULT 0.3,
    p_w_recency     REAL DEFAULT 0.0,
    p_include_globals BOOLEAN DEFAULT TRUE
) RETURNS TABLE (
    memory_id       INT,
    content         TEXT,
    score           REAL,
    heat            REAL,
    domain          TEXT,
    created_at      TIMESTAMPTZ,
    store_type      TEXT,
    tags            JSONB,
    importance      REAL,
    surprise_score  REAL,
    emotional_valence REAL,
    source          TEXT
) AS $$
DECLARE
    v_pool   INT := p_max_results * 10;
    v_factor REAL;
    v_words  TEXT[] := regexp_split_to_array(
        regexp_replace(lower(p_query_text), '[^a-z0-9 ]', ' ', 'g'), '\\s+');
    v_or_expr TEXT := array_to_string(
        ARRAY(SELECT w FROM unnest(v_words) w WHERE length(w) > 1), ' | ');
    v_tsq  tsquery := CASE WHEN v_or_expr = '' THEN plainto_tsquery('english', p_query_text)
                            ELSE to_tsquery('english', v_or_expr) END;
    v_min_heat_base REAL;
BEGIN
    SELECT COALESCE(MAX(hs.factor), 1.0) INTO v_factor FROM homeostatic_state hs
    WHERE hs.domain = COALESCE(p_domain, '');
` +
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:787 — 0.001 floor prevents div-by-zero
`    v_min_heat_base := p_min_heat / GREATEST(v_factor, 0.001);
    RETURN QUERY
    WITH
    candidates AS (
        SELECT m.* FROM memories m
        WHERE m.heat_base >= v_min_heat_base AND NOT m.is_stale
          AND (p_domain IS NULL OR m.domain = p_domain OR (p_include_globals AND m.is_global = TRUE))
          AND (p_directory IS NULL OR m.directory_context = p_directory)
    ),
    vec AS (
        SELECT c.id, (1.0 - (c.embedding <=> p_query_emb))::REAL AS raw_score
        FROM candidates c
        WHERE c.embedding IS NOT NULL AND effective_heat(c, NOW(), v_factor) >= p_min_heat
        ORDER BY c.embedding <=> p_query_emb LIMIT v_pool
    ),
    fts AS (
        SELECT c.id, ts_rank_cd(c.content_tsv, v_tsq)::REAL AS raw_score
        FROM candidates c
        WHERE c.content_tsv @@ v_tsq AND effective_heat(c, NOW(), v_factor) >= p_min_heat
        ORDER BY ts_rank_cd(c.content_tsv, v_tsq) DESC LIMIT v_pool
    ),
    ngram AS (
        SELECT c.id, similarity(c.content, p_query_text)::REAL AS raw_score
        FROM candidates c
        WHERE effective_heat(c, NOW(), v_factor) >= p_min_heat
          AND similarity(c.content, p_query_text) > 0.1
        ORDER BY similarity(c.content, p_query_text) DESC LIMIT v_pool
    ),
    hot AS (
        SELECT c.id, effective_heat(c, NOW(), v_factor) AS raw_score FROM candidates c
        WHERE effective_heat(c, NOW(), v_factor) >= p_min_heat
        ORDER BY effective_heat(c, NOW(), v_factor) DESC LIMIT v_pool
    ),
    recency AS (
        SELECT c.id,
` +
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:849 — 0.01 recency decay rate per day
`               EXP(-0.01 * EXTRACT(EPOCH FROM (NOW() - c.created_at)) / ${SECS_PER_DAY})::REAL AS raw_score
        FROM candidates c
        WHERE effective_heat(c, NOW(), v_factor) >= p_min_heat
        ORDER BY c.created_at DESC LIMIT v_pool
    ),
` +
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:856-860 — 0.001 TMM normalization floor (Bruch 2023)
`    vec_max  AS (SELECT COALESCE(MAX(raw_score), 0.001) AS hi FROM vec),
    fts_max  AS (SELECT COALESCE(MAX(raw_score), 0.001) AS hi FROM fts),
    ng_max   AS (SELECT COALESCE(MAX(raw_score), 0.001) AS hi FROM ngram),
    hot_max  AS (SELECT COALESCE(MAX(raw_score), 0.001) AS hi FROM hot),
    rec_max  AS (SELECT COALESCE(MAX(raw_score), 0.001) AS hi FROM recency),
    fused AS (
        SELECT id, SUM(contribution) AS fused_score FROM (
` +
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:863-883 — 0.001 WRRF denominator floor (Bruch 2023)
`            SELECT v.id, p_w_vector * (v.raw_score - (-1.0)) / GREATEST(b.hi - (-1.0), 0.001) AS contribution
            FROM vec v, vec_max b
            UNION ALL
            SELECT f.id, p_w_fts * f.raw_score / GREATEST(b.hi, 0.001) FROM fts f, fts_max b
            UNION ALL
            SELECT n.id, p_w_ngram * n.raw_score / GREATEST(b.hi, 0.001) FROM ngram n, ng_max b
            UNION ALL
            SELECT h.id, p_w_heat * h.raw_score / GREATEST(b.hi, 0.001) FROM hot h, hot_max b
            UNION ALL
            SELECT r.id, p_w_recency * r.raw_score / GREATEST(b.hi, 0.001)
            FROM recency r, rec_max b WHERE p_w_recency > 0
        ) signals GROUP BY id
    ),
    agent_boosted AS (
        SELECT f.id,
               CASE WHEN p_agent_topic IS NOT NULL AND c.agent_context = p_agent_topic
                    THEN f.fused_score + 0.3 * (p_w_vector / p_wrrf_k)
                    ELSE f.fused_score END AS boosted_score
        FROM fused f JOIN candidates c ON c.id = f.id
    ),
    emotional_boosted AS (
        SELECT ab.id,
               ab.boosted_score * (
` +
// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:900 — 0.15 emotional boost coefficient
`                   1.0 + ABS(COALESCE(c.emotional_valence, 0.0)) * 0.15
                   * (1.0 - EXP(-EXTRACT(EPOCH FROM (NOW() - c.created_at)) / ${SECS_PER_HOUR}))
               ) AS emo_score
        FROM agent_boosted ab JOIN candidates c ON c.id = ab.id
    ),
    tag_boosted AS (
        SELECT eb.id,
               eb.emo_score * (1.0 + CASE
                   WHEN p_intent IN ('preference', 'instruction') AND c.tags @> to_jsonb(p_intent::TEXT)
                   THEN 0.4 ELSE 0.0 END) AS final_score
        FROM emotional_boosted eb JOIN candidates c ON c.id = eb.id
    )
    SELECT tb.id, c.content, tb.final_score::REAL,
           effective_heat(c, NOW(), v_factor)::REAL AS heat,
           c.domain, c.created_at, c.store_type, c.tags,
           c.importance, c.surprise_score, c.emotional_valence, c.source
    FROM tag_boosted tb JOIN candidates c ON c.id = tb.id
    ORDER BY tb.final_score DESC LIMIT p_max_results * 3;
END;
$$ LANGUAGE plpgsql STABLE;
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:941-978
export const SPREAD_ACTIVATION_FN = `
CREATE OR REPLACE FUNCTION spread_activation(
    p_seed_entity_ids INT[],
    p_decay           REAL DEFAULT ${PG_SPREAD_DECAY_DEFAULT},
    p_threshold       REAL DEFAULT ${PG_SPREAD_THRESHOLD_DEFAULT},
    p_max_depth       INT DEFAULT 3
) RETURNS TABLE (entity_id INT, activation REAL) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE spread AS (
        SELECT unnest(p_seed_entity_ids) AS eid, 1.0::REAL AS act, 0 AS depth
        UNION ALL
        SELECT CASE WHEN r.source_entity_id = s.eid THEN r.target_entity_id ELSE r.source_entity_id END AS eid,
               (s.act * p_decay * r.weight)::REAL AS act,
               s.depth + 1 AS depth
        FROM spread s
        JOIN relationships r ON r.source_entity_id = s.eid OR r.target_entity_id = s.eid
        WHERE s.depth < p_max_depth AND s.act * p_decay * r.weight >= p_threshold
    )
    SELECT s.eid, MAX(s.act)::REAL FROM spread s
    JOIN entities e ON e.id = s.eid
    WHERE e.heat >= ${PG_MIN_HEAT_DEFAULT} AND NOT e.archived
    GROUP BY s.eid ORDER BY MAX(s.act) DESC;
END;
$$ LANGUAGE plpgsql STABLE;
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:985-1053
export const SPREAD_ACTIVATION_MEMORIES_FN = `
CREATE OR REPLACE FUNCTION spread_activation_memories(
    p_query_terms   TEXT[],
    p_decay         REAL DEFAULT ${PG_SPREAD_DECAY_DEFAULT},
    p_threshold     REAL DEFAULT ${PG_SPREAD_THRESHOLD_DEFAULT},
    p_max_depth     INT DEFAULT 3,
    p_max_results   INT DEFAULT 50,
    p_min_heat      REAL DEFAULT ${PG_MIN_HEAT_DEFAULT}
) RETURNS TABLE (memory_id INT, activation REAL) AS $$
BEGIN
    RETURN QUERY
    WITH
    seed_entities AS (
        SELECT DISTINCT e.id AS eid FROM entities e, unnest(p_query_terms) AS t(term)
        WHERE LOWER(e.name) = LOWER(t.term) AND e.heat >= p_min_heat AND NOT e.archived
    ),
    seed_ids AS (SELECT ARRAY_AGG(eid) AS ids FROM seed_entities),
    spread AS (
        SELECT se.eid, 1.0::REAL AS act, 0 AS depth FROM seed_entities se
        UNION ALL
        SELECT CASE WHEN r.source_entity_id = s.eid THEN r.target_entity_id ELSE r.source_entity_id END AS eid,
               (s.act * p_decay * r.weight * r.confidence)::REAL AS act,
               s.depth + 1 AS depth
        FROM spread s
        JOIN relationships r ON r.source_entity_id = s.eid OR r.target_entity_id = s.eid
        WHERE s.depth < p_max_depth AND s.act * p_decay * r.weight * r.confidence >= p_threshold
    ),
    entity_acts AS (
        SELECT s.eid, MAX(s.act)::REAL AS act FROM spread s
        JOIN entities e ON e.id = s.eid
        WHERE e.heat >= p_min_heat AND NOT e.archived GROUP BY s.eid
    ),
    entity_memories AS (
        SELECT DISTINCT m.id AS mid, ea.act FROM entity_acts ea
        JOIN entities e ON e.id = ea.eid
        JOIN memories m ON m.content_tsv @@ phraseto_tsquery('english', e.name)
        WHERE m.heat_base >= p_min_heat AND NOT m.is_stale
    )
    SELECT em.mid, MAX(em.act)::REAL FROM entity_memories em
    GROUP BY em.mid ORDER BY MAX(em.act) DESC LIMIT p_max_results;
END;
$$ LANGUAGE plpgsql STABLE;
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1060-1082
export const GET_HOT_EMBEDDINGS_FN = `
CREATE OR REPLACE FUNCTION get_hot_embeddings(
    p_min_heat    REAL DEFAULT ${PG_MIN_HEAT_DEFAULT},
    p_domain      TEXT DEFAULT NULL,
    p_limit       INT DEFAULT ${PG_HOT_EMBEDDINGS_LIMIT}
` +
// source: sentence-transformers all-MiniLM-L6-v2 384D embedding — arxiv:1908.10084
`) RETURNS TABLE (memory_id INT, embedding vector(384), heat REAL) AS $$
BEGIN
    RETURN QUERY
    SELECT m.id, m.embedding, effective_heat(m, NOW(), 1.0) FROM memories m
    WHERE m.heat_base >= p_min_heat AND NOT m.is_stale AND m.embedding IS NOT NULL
      AND (p_domain IS NULL OR m.domain = p_domain OR (p_include_globals AND m.is_global = TRUE))
    ORDER BY m.heat_base DESC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;
`;

// source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1088-1123
export const GET_TEMPORAL_CO_ACCESS_FN = `
CREATE OR REPLACE FUNCTION get_temporal_co_access(
    p_window_hours  REAL DEFAULT 2.0,
    p_min_access    INT DEFAULT 1,
    p_limit         INT DEFAULT ${PG_CO_ACCESS_LIMIT}
) RETURNS TABLE (mem_a INT, mem_b INT, proximity REAL) AS $$
DECLARE
    v_window INTERVAL := (p_window_hours || ' hours')::INTERVAL;
BEGIN
    RETURN QUERY
    WITH recent AS (
        SELECT id, last_accessed FROM memories
        WHERE access_count >= p_min_access AND NOT is_stale AND last_accessed IS NOT NULL
        ORDER BY last_accessed DESC LIMIT p_limit
    )
    SELECT a.id AS mem_a, b.id AS mem_b,
        (1.0 - EXTRACT(EPOCH FROM (b.last_accessed - a.last_accessed))
             / EXTRACT(EPOCH FROM v_window))::REAL AS proximity
    FROM recent a JOIN recent b
        ON b.id > a.id AND b.last_accessed BETWEEN a.last_accessed AND a.last_accessed + v_window
    ORDER BY proximity DESC;
END;
$$ LANGUAGE plpgsql STABLE;
`;

/**
 * Split a multi-statement DDL string into individual statements.
 *
 * precondition:  ddl is a non-empty string.
 * postcondition: each returned string is a single executable DDL statement.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1358-1372
 */
export function splitStatements(ddl: string): string[] {
  if (ddl.includes("$$")) {
    const trimmed = ddl.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  const statements: string[] = [];
  for (const part of ddl.split(";")) {
    const stmt = part.trim();
    if (stmt.length > 0) statements.push(stmt + ";");
  }
  return statements;
}

/**
 * Return all DDL as individual statements for safe per-statement execution.
 *
 * MIGRATIONS_DDL runs before INDEXES_DDL so heat->heat_base rename lands first.
 * postcondition: returned array is non-empty; each element is executable SQL.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:1375-1411
 */
export function getAllDdl(): string[] {
  const blocks: string[] = [
    EXTENSIONS_DDL, MEMORIES_DDL, HOMEOSTATIC_STATE_DDL, ENTITIES_DDL,
    RELATIONSHIPS_DDL, MEMORY_ENTITIES_DDL, WIKI_SCHEMA_DDL,
    WIKI_TRIGGERS_DDL, WIKI_LINK_TRIGGER_DDL, SUPPORT_TABLES_DDL,
    MIGRATIONS_DDL, INDEXES_DDL,
    EFFECTIVE_HEAT_FN, EFFECTIVE_HEAT_FROZEN_FN, RECALL_MEMORIES_LAZY_FN,
    SPREAD_ACTIVATION_FN, SPREAD_ACTIVATION_MEMORIES_FN,
    GET_HOT_EMBEDDINGS_FN, GET_TEMPORAL_CO_ACCESS_FN,
  ];
  const result: string[] = [];
  for (const block of blocks) result.push(...splitStatements(block));
  return result;
}
