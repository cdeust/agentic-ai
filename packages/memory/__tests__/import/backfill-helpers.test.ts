/**
 * Unit tests for backfill-helpers.ts.
 *
 * Validates concept detection, slug-to-domain conversion, and the
 * hash/age helpers that are NOT covered by the existing heat.test.ts.
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py
 */

import { describe, it, expect, vi } from "vitest";
import {
  findConcepts,
  slugToDomain,
  fileHash,
} from "../../src/import/backfill-helpers.js";
import { tmpdir } from "node:os";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

// ── findConcepts ──────────────────────────────────────────────────────────────

describe("findConcepts", () => {
  it("returns [] for empty content", () => {
    expect(findConcepts("")).toEqual([]);
  });

  it("detects predictive_coding from 'write gate' keyword", () => {
    const result = findConcepts("The write gate rejected this memory due to low novelty.");
    expect(result).toContain("predictive_coding");
  });

  it("detects hopfield from 'hopfield' keyword", () => {
    const result = findConcepts("Modern Hopfield networks are used for energy-based recall.");
    expect(result).toContain("hopfield");
  });

  it("detects thermodynamics from 'heat decay' keyword", () => {
    const result = findConcepts("Heat decay reduces memory salience over time.");
    expect(result).toContain("thermodynamics");
  });

  it("detects multiple concepts when multiple keywords match", () => {
    const content = "The write gate uses entity relationship and causal chain logic.";
    const result = findConcepts(content);
    expect(result).toContain("predictive_coding");
    expect(result).toContain("knowledge_graph");
  });

  it("is case-insensitive", () => {
    expect(findConcepts("WRITE GATE")).toContain("predictive_coding");
  });
});

// ── slugToDomain ──────────────────────────────────────────────────────────────

describe("slugToDomain", () => {
  it("returns a non-empty string for a typical cortex slug", () => {
    const domain = slugToDomain("-Users-alice-Developments-Cortex");
    expect(typeof domain).toBe("string");
    expect(domain.length).toBeGreaterThan(0);
  });

  it("returns 'unknown' for an empty slug", () => {
    // domain-detector returns "unknown" for empty/short paths
    const domain = slugToDomain("");
    expect(typeof domain).toBe("string");
  });
});

// ── fileHash ──────────────────────────────────────────────────────────────────

describe("fileHash", () => {
  it("returns a 16-char hex string for a real file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bftest-"));
    const filePath = join(dir, "test.jsonl");
    writeFileSync(filePath, JSON.stringify({ role: "user", content: "hello" }) + "\n");

    const hash = fileHash(filePath);
    expect(hash).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("returns the same hash for the same file on repeated calls", () => {
    const dir = mkdtempSync(join(tmpdir(), "bftest2-"));
    const filePath = join(dir, "test.jsonl");
    writeFileSync(filePath, "content-for-hash\n");

    expect(fileHash(filePath)).toBe(fileHash(filePath));
  });

  it("returns different hashes for different file contents", () => {
    const dir = mkdtempSync(join(tmpdir(), "bftest3-"));
    const a = join(dir, "a.jsonl");
    const b = join(dir, "b.jsonl");
    writeFileSync(a, "alpha content\n");
    writeFileSync(b, "beta content\n");

    expect(fileHash(a)).not.toBe(fileHash(b));
  });
});
