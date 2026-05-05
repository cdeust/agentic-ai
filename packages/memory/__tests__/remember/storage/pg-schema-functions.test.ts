/**
 * pg-schema-functions.test.ts — PL/pgSQL DDL and getAllDdl() tests.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py:570-1411
 */
import { describe, it, expect } from "vitest";
import {
  EFFECTIVE_HEAT_FN, EFFECTIVE_HEAT_FROZEN_FN, RECALL_MEMORIES_LAZY_FN,
  SPREAD_ACTIVATION_FN, SPREAD_ACTIVATION_MEMORIES_FN,
  splitStatements, getAllDdl,
} from "../../../src/remember/storage/pg-schema-functions.js";

describe("EFFECTIVE_HEAT_FN", () => {
  it("is STABLE PARALLEL SAFE", () => {
    expect(EFFECTIVE_HEAT_FN).toContain("LANGUAGE plpgsql STABLE PARALLEL SAFE");
  });
  it("interpolates p_factor 0.99787 from named constant", () => {
    // source: cortex@ed33435 pg_schema.py:597 — 0.95^(1/24) per-hour decay
    expect(EFFECTIVE_HEAT_FN).toContain("0.99787");
  });
  it("defines alpha per consolidation stage (Kandel 2001)", () => {
    expect(EFFECTIVE_HEAT_FN).toContain("WHEN 'labile'");
    expect(EFFECTIVE_HEAT_FN).toContain("THEN 2.0");
    expect(EFFECTIVE_HEAT_FN).toContain("WHEN 'consolidated'");
    expect(EFFECTIVE_HEAT_FN).toContain("THEN 0.5");
  });
  it("applies emotional damping from named constant (Yonelinas & Ritchey 2015)", () => {
    // PG_EMOTIONAL_DAMPING = 0.30 but JS toString() produces "0.3"
    expect(EFFECTIVE_HEAT_FN).toContain("0.3 * ABS(COALESCE(m.emotional_valence");
  });
  it("clamps EXP arg at 80", () => {
    expect(EFFECTIVE_HEAT_FN).toContain("LEAST(stage_hours / 1.0, 80.0)");
  });
  it("uses 1e-38 hard floor against REAL underflow", () => {
    expect(EFFECTIVE_HEAT_FN).toContain("1e-38");
  });
  it("includes permastore floors from named constants (Bahrick 1984; Benna & Fusi 2016)", () => {
    // PERMASTORE_FLOOR_CONSOLIDATED = 0.10 → "0.1"; PERMASTORE_FLOOR_LATE = 0.05 → "0.05"
    expect(EFFECTIVE_HEAT_FN).toContain("THEN 0.1");
    expect(EFFECTIVE_HEAT_FN).toContain("THEN 0.05");
  });
});

describe("EFFECTIVE_HEAT_FROZEN_FN", () => {
  it("is IMMUTABLE", () => {
    expect(EFFECTIVE_HEAT_FROZEN_FN).toContain("IMMUTABLE PARALLEL SAFE");
  });
  it("pre-A3 p_factor default 0.95", () => {
    expect(EFFECTIVE_HEAT_FROZEN_FN).toContain("DEFAULT 0.95");
  });
});

describe("RECALL_MEMORIES_LAZY_FN", () => {
  it("drops old signature before CREATE", () => {
    expect(RECALL_MEMORIES_LAZY_FN).toContain("DROP FUNCTION IF EXISTS recall_memories");
  });
  it("has p_wrrf_k INT DEFAULT 60", () => {
    expect(RECALL_MEMORIES_LAZY_FN).toContain("p_wrrf_k        INT DEFAULT 60");
  });
  it("has 5 signal CTEs", () => {
    for (const s of ["vec AS", "fts AS", "ngram AS", "hot AS", "recency AS"]) {
      expect(RECALL_MEMORIES_LAZY_FN).toContain(s);
    }
  });
  it("applies 0.3 agent_topic boost", () => {
    expect(RECALL_MEMORIES_LAZY_FN).toContain("0.3 * (p_w_vector / p_wrrf_k)");
  });
  it("interpolates p_min_heat from named constant", () => {
    // PG_MIN_HEAT_DEFAULT = 0.05 — stringified as "0.05"
    expect(RECALL_MEMORIES_LAZY_FN).toContain("p_min_heat      REAL DEFAULT 0.05");
  });
});

describe("SPREAD_ACTIVATION_FN", () => {
  it("uses WITH RECURSIVE", () => {
    expect(SPREAD_ACTIVATION_FN).toContain("WITH RECURSIVE spread AS");
  });
  it("interpolates p_decay 0.65 and p_threshold 0.1 from named constants", () => {
    // PG_SPREAD_DECAY_DEFAULT = 0.65; PG_SPREAD_THRESHOLD_DEFAULT = 0.10 → "0.1"
    expect(SPREAD_ACTIVATION_FN).toContain("0.65");
    expect(SPREAD_ACTIVATION_FN).toContain("0.1");
  });
});

describe("SPREAD_ACTIVATION_MEMORIES_FN", () => {
  it("multiplies weight by confidence", () => {
    expect(SPREAD_ACTIVATION_MEMORIES_FN).toContain("r.weight * r.confidence");
  });
});

describe("splitStatements", () => {
  it("returns PL/pgSQL blocks as single element", () => {
    const fn = "CREATE OR REPLACE FUNCTION foo() AS $$ BEGIN END; $$ LANGUAGE plpgsql;";
    expect(splitStatements(fn)).toHaveLength(1);
  });
  it("splits plain DDL on semicolons", () => {
    expect(splitStatements("CREATE TABLE a (id SERIAL); CREATE TABLE b (id SERIAL);")).toHaveLength(2);
  });
  it("skips empty segments", () => {
    expect(splitStatements("  ;  ;  ")).toHaveLength(0);
  });
});

describe("getAllDdl", () => {
  it("returns non-empty string array", () => {
    const ddl = getAllDdl();
    expect(Array.isArray(ddl)).toBe(true);
    expect(ddl.length).toBeGreaterThan(0);
  });
  it("contains CREATE TABLE IF NOT EXISTS memories", () => {
    expect(getAllDdl().join("\n")).toContain("CREATE TABLE IF NOT EXISTS memories");
  });
  it("contains effective_heat function", () => {
    expect(getAllDdl().join("\n")).toContain("CREATE OR REPLACE FUNCTION effective_heat");
  });
});
