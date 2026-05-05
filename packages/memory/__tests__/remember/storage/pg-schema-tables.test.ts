/**
 * pg-schema-tables.test.ts — DDL string shape verification.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_schema.py
 */
import { describe, it, expect } from "vitest";
import {
  EXTENSIONS_DDL, MEMORIES_DDL, ENTITIES_DDL, HOMEOSTATIC_STATE_DDL,
  RELATIONSHIPS_DDL, MEMORY_ENTITIES_DDL, WIKI_SCHEMA_DDL,
  WIKI_TRIGGERS_DDL, WIKI_LINK_TRIGGER_DDL, SUPPORT_TABLES_DDL,
} from "../../../src/remember/storage/pg-schema-tables.js";

describe("EXTENSIONS_DDL", () => {
  it("includes vector and pg_trgm", () => {
    expect(EXTENSIONS_DDL).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(EXTENSIONS_DDL).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  });
});

describe("MEMORIES_DDL", () => {
  it("creates memories table with heat_base CHECK", () => {
    expect(MEMORIES_DDL).toContain("CREATE TABLE IF NOT EXISTS memories");
    expect(MEMORIES_DDL).toContain("CHECK (heat_base >= 0.0 AND heat_base <= 1.0)");
  });
  it("has vector(384) embedding column", () => {
    expect(MEMORIES_DDL).toContain("embedding       vector(384)");
  });
  it("has GENERATED ALWAYS content_tsv", () => {
    expect(MEMORIES_DDL).toContain("GENERATED ALWAYS AS");
    expect(MEMORIES_DDL).toContain("to_tsvector");
  });
  it("has neuroscience columns", () => {
    for (const col of ["consolidation_stage", "theta_phase_at_encoding", "hippocampal_dependency", "separation_index"]) {
      expect(MEMORIES_DDL).toContain(col);
    }
  });
  it("has agent_context and is_global", () => {
    expect(MEMORIES_DDL).toContain("agent_context");
    expect(MEMORIES_DDL).toContain("is_global");
  });
});

describe("HOMEOSTATIC_STATE_DDL", () => {
  it("has domain TEXT PRIMARY KEY with factor CHECK", () => {
    expect(HOMEOSTATIC_STATE_DDL).toContain("domain     TEXT PRIMARY KEY");
    expect(HOMEOSTATIC_STATE_DDL).toContain("CHECK (factor > 0.0 AND factor < 10.0)");
  });
});

describe("RELATIONSHIPS_DDL", () => {
  it("has facilitation and depression columns", () => {
    expect(RELATIONSHIPS_DDL).toContain("facilitation");
    expect(RELATIONSHIPS_DDL).toContain("depression");
  });
});

describe("MEMORY_ENTITIES_DDL", () => {
  it("has composite PRIMARY KEY", () => {
    expect(MEMORY_ENTITIES_DDL).toContain("PRIMARY KEY (memory_id, entity_id)");
  });
});

describe("WIKI_SCHEMA_DDL", () => {
  it("creates 7 wiki tables", () => {
    for (const t of ["wiki.claim_events", "wiki.concepts", "wiki.drafts", "wiki.pages", "wiki.links", "wiki.citations", "wiki.memos"]) {
      expect(WIKI_SCHEMA_DDL).toContain(t);
    }
  });
  it("includes HNSW m=16, ef_construction=64", () => {
    expect(WIKI_SCHEMA_DDL).toContain("m = 16, ef_construction = 64");
  });
  it("wiki.pages has thermodynamic columns", () => {
    expect(WIKI_SCHEMA_DDL).toContain("citation_count");
    expect(WIKI_SCHEMA_DDL).toContain("backlink_count");
    expect(WIKI_SCHEMA_DDL).toContain("is_stale");
  });
});

describe("WIKI_TRIGGERS_DDL", () => {
  it("has on_citation_insert trigger", () => {
    expect(WIKI_TRIGGERS_DDL).toContain("wiki.on_citation_insert");
    expect(WIKI_TRIGGERS_DDL).toContain("trg_wiki_citation_bump");
  });
});

describe("WIKI_LINK_TRIGGER_DDL", () => {
  it("handles INSERT, DELETE, UPDATE", () => {
    expect(WIKI_LINK_TRIGGER_DDL).toContain("TG_OP = 'INSERT'");
    expect(WIKI_LINK_TRIGGER_DDL).toContain("TG_OP = 'DELETE'");
    expect(WIKI_LINK_TRIGGER_DDL).toContain("TG_OP = 'UPDATE'");
  });
});

describe("SUPPORT_TABLES_DDL", () => {
  it("oscillatory_state has CHECK (id = 1)", () => {
    expect(SUPPORT_TABLES_DDL).toContain("CHECK (id = 1)");
  });
  it("has workflow_graph_layout with topology_fingerprint", () => {
    expect(SUPPORT_TABLES_DDL).toContain("topology_fingerprint");
  });
  it("seeds user_mood with default row", () => {
    expect(SUPPORT_TABLES_DDL).toContain("INSERT INTO user_mood");
    expect(SUPPORT_TABLES_DDL).toContain("ON CONFLICT (user_id) DO NOTHING");
  });
});
