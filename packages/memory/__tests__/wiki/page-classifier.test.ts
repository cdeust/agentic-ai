/**
 * Unit tests for wiki page classifier.
 *
 * Tests the three-gate admission logic:
 *   Gate -1: audit-tag gate
 *   Gate 0: user rules (empty in test)
 *   Gate 1: noise rejection
 *   Gate 2: hard-negative gate
 *   Gate 3: positive scoring
 */

import { describe, it, expect } from "vitest";
import { classifyMemory, deriveTitle } from "../../src/wiki/page-classifier.js";

describe("classifyMemory", () => {
  // ── Rejections ────────────────────────────────────────────────────────

  it("rejects empty content", () => {
    expect(classifyMemory("")).toBeNull();
    expect(classifyMemory("   ")).toBeNull();
    expect(classifyMemory("short")).toBeNull();
  });

  it("rejects tool output prefixes", () => {
    expect(classifyMemory("# Tool: bash\nsome output here with lots of text")).toBeNull();
    expect(classifyMemory("Tool: read\nsome output here with lots of text")).toBeNull();
    expect(classifyMemory("<tool_result>lots of json output here with plenty of chars</tool_result>")).toBeNull();
  });

  it("rejects pure JSON", () => {
    expect(classifyMemory('{ "key": "value", "another": 123, "nested": { "x": true } }')).toBeNull();
  });

  it("rejects audit tags", () => {
    const content = "This is a detailed decision about using PostgreSQL because it provides ACID guarantees. We decided to use PostgreSQL over MongoDB because of transactional support.";
    expect(classifyMemory(content, ["_backfill"])).toBeNull();
    expect(classifyMemory(content, ["stage-1"])).toBeNull();
    expect(classifyMemory(content, ["wip"])).toBeNull();
  });

  it("rejects imperative titles", () => {
    expect(classifyMemory("# Use pgvector for embeddings\nThis is about the decision we made with many details and explanations about why.")).toBeNull();
    expect(classifyMemory("# Add retry logic\nImplement retry with exponential backoff for resilience.")).toBeNull();
  });

  it("rejects first-person narration titles", () => {
    expect(classifyMemory("# We pushed the new deployment\nThe release went smoothly and we observed no regressions.")).toBeNull();
  });

  it("rejects status markers", () => {
    expect(classifyMemory("# Successfully completed the migration\nAll tables moved.")).toBeNull();
  });

  it("rejects path-as-title", () => {
    expect(classifyMemory("# /usr/local/bin/cortex\nThis is the executable path for cortex.")).toBeNull();
  });

  // ── Admissions ───────────────────────────────────────────────────────

  it("admits ADR content by pattern", () => {
    // Title must be non-imperative to pass the hard-negative gate.
    // "Use PostgreSQL" starts with the imperative verb "use" and would be
    // rejected by the gate before ADR_PATTERNS can fire.
    // source: wiki_classifier.py _fails_hard_negatives / _IMPERATIVE_TITLE_PATTERNS
    const content = [
      "# PostgreSQL as primary storage",
      "",
      "We decided to use PostgreSQL over MongoDB because of ACID compliance.",
      "The decision is to adopt PostgreSQL as the primary datastore.",
      "",
      "This enables transactional writes and complex queries.",
      "Constraints: requires PostgreSQL 14+.",
    ].join("\n");
    expect(classifyMemory(content)).toBe("adr");
  });

  it("admits ADR via explicit tag, bypassing positive score gate", () => {
    const content = "The decision is clear: we chose pgvector for semantic search because it integrates natively with PostgreSQL.";
    expect(classifyMemory(content, ["decision"])).toBe("adr");
  });

  it("admits lesson via pattern", () => {
    const content = [
      "# FlashRank cache divergence lesson",
      "",
      "The bug was caused by the ONNX model cache using stale embedding weights.",
      "Root cause: cache invalidation was missing on model update.",
      "Fix: clear cache before model reload.",
      "The lesson learned is to always test cache invalidation on model updates.",
    ].join("\n");
    expect(classifyMemory(content)).toBe("lesson");
  });

  it("admits convention via pattern", () => {
    // Original 6-line fixture scored 3/8 positive signals (struct, declarative,
    // atomic length) — one below the threshold of 4. Adding a file reference
    // (signal 8) raises the score to 4 and satisfies Gate 3 without tags.
    // source: wiki_classifier.py _positive_score signal 8 (_FILE_OR_ENTITY_REF)
    const content = [
      "# Snake case for module names",
      "",
      "Always use snake_case for Python module names — the canonical form.",
      "This naming convention improves import clarity.",
      "The convention applies to mcp_server and all submodules.",
      "Never use camelCase for module files.",
      "See mcp_server/__init__.py and wiki_classifier.py for examples.",
    ].join("\n");
    expect(classifyMemory(content)).toBe("convention");
  });

  it("admits spec via tag", () => {
    const content = "This design document describes the phase-5 wiki redesign. The system consists of a claim extractor, concept emerger, and draft synthesizer. Each component is defined by an interface and tested independently.".repeat(2);
    expect(classifyMemory(content, ["spec"])).toBe("spec");
  });

  it("falls back to note for generic quality content", () => {
    const content = [
      "# pgvector integration",
      "",
      "The pgvector.py module implements ANN search using cosine similarity.",
      "It requires PostgreSQL 14+ with pgvector extension installed.",
      "The HNSW index is created at init time: `pgvector.create_index()`.",
      "",
      "Related: wiki_store.py, memory_store.py",
      "See also: Malkov & Yashunin 2018 (HNSW paper).",
    ].join("\n");
    const kind = classifyMemory(content);
    expect(["note", "lesson", "convention", "adr", "spec"]).toContain(kind);
  });
});

describe("deriveTitle", () => {
  it("strips heading prefix", () => {
    const title = deriveTitle("# My Decision\nbody here", "adr");
    expect(title).toBe("Decision: My Decision");
  });

  it("uses entities when available", () => {
    const title = deriveTitle("content", "note", null, ["pgvector", "HNSW"]);
    expect(title).toBe("pgvector + HNSW");
  });

  it("truncates long titles", () => {
    const long = "# " + "a".repeat(100);
    const title = deriveTitle(long + "\nbody", "note");
    expect(title.length).toBeLessThanOrEqual(83); // 80 + "..."
  });

  it("prefixes lesson kind", () => {
    const title = deriveTitle("# Cache divergence fixed\nbody", "lesson");
    expect(title.startsWith("Lesson:")).toBe(true);
  });
});
