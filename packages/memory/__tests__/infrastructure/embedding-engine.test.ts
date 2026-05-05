/**
 * Tests for embedding-engine.ts
 *
 * Tests EmbeddingEngine: cache-key discipline (ADR-0045 R5),
 * fallback encoding, similarity, toList/fromList round-trip,
 * singleton lifecycle.
 *
 * source: Cortex mcp_server/infrastructure/embedding_engine.py
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  EmbeddingEngine,
  getEmbeddingEngine,
  resetEmbeddingEngine,
} from "../../src/infrastructure/embedding-engine.js";

describe("EmbeddingEngine — cacheKey (ADR-0045 R5)", () => {
  it("returns 16-character lowercase hex string", () => {
    // source: embedding_engine.py:89-102
    const key = EmbeddingEngine.cacheKey("hello world");
    expect(key).toHaveLength(16);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic — same input always yields same key", () => {
    const key1 = EmbeddingEngine.cacheKey("test input");
    const key2 = EmbeddingEngine.cacheKey("test input");
    expect(key1).toBe(key2);
  });

  it("different inputs yield different keys (collision resistance)", () => {
    const key1 = EmbeddingEngine.cacheKey("hello");
    const key2 = EmbeddingEngine.cacheKey("world");
    expect(key1).not.toBe(key2);
  });

  it("key length is independent of input length", () => {
    const shortKey = EmbeddingEngine.cacheKey("a");
    const longKey = EmbeddingEngine.cacheKey("x".repeat(100_000));
    expect(shortKey).toHaveLength(16);
    expect(longKey).toHaveLength(16);
  });
});

describe("EmbeddingEngine — encode() with fallback", () => {
  let engine: EmbeddingEngine;

  beforeEach(() => {
    // Use a fresh engine in CPU mode (no ML model loaded)
    engine = new EmbeddingEngine("all-MiniLM-L6-v2", 384, "cpu");
    // Force unavailable so fallback encoding is used
    (engine as unknown as { _unavailable: boolean })._unavailable = true;
  });

  it("returns null for empty string", async () => {
    // source: embedding_engine.py:288-289
    const result = await engine.encode("");
    expect(result).toBeNull();
  });

  it("returns Uint8Array of correct byte length for non-empty input", async () => {
    // 384 dimensions * 4 bytes/float32 = 1536 bytes
    const result = await engine.encode("hello world");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result!.byteLength).toBe(384 * 4);
  });

  it("same text always encodes to same bytes (deterministic)", async () => {
    const r1 = await engine.encode("deterministic test");
    const r2 = await engine.encode("deterministic test");
    expect(Buffer.from(r1!).toString("hex")).toBe(Buffer.from(r2!).toString("hex"));
  });

  it("uses LRU cache — second call returns cached result", async () => {
    const text = "cached test string";
    const r1 = await engine.encode(text);
    const r2 = await engine.encode(text);
    // Same reference from cache
    expect(r1).toBe(r2);
  });
});

describe("EmbeddingEngine — similarity()", () => {
  let engine: EmbeddingEngine;

  beforeEach(() => {
    engine = new EmbeddingEngine("all-MiniLM-L6-v2", 384, "cpu");
    (engine as unknown as { _unavailable: boolean })._unavailable = true;
  });

  it("similarity with itself is close to 1.0", async () => {
    // source: embedding_engine.py:334-344
    const emb = (await engine.encode("hello world"))!;
    const sim = engine.similarity(emb, emb);
    expect(sim).toBeCloseTo(1.0, 5);
  });

  it("returns 0.0 for mismatched lengths", () => {
    const a = new Uint8Array(4 * 384);
    const b = new Uint8Array(4 * 128);
    expect(engine.similarity(a, b)).toBe(0.0);
  });

  it("similarity is between -1.0 and 1.0", async () => {
    const emb1 = (await engine.encode("cat"))!;
    const emb2 = (await engine.encode("dog"))!;
    const sim = engine.similarity(emb1, emb2);
    expect(sim).toBeGreaterThanOrEqual(-1.0);
    expect(sim).toBeLessThanOrEqual(1.0);
  });
});

describe("EmbeddingEngine — toList / fromList round-trip", () => {
  it("converts embedding blob to float list and back", async () => {
    const engine = new EmbeddingEngine("all-MiniLM-L6-v2", 384, "cpu");
    (engine as unknown as { _unavailable: boolean })._unavailable = true;

    const original = (await engine.encode("round trip test"))!;
    const list = EmbeddingEngine.toList(original);
    const back = EmbeddingEngine.fromList(list);

    // source: embedding_engine.py:346-356
    expect(list).toHaveLength(384);
    expect(list.every((v) => typeof v === "number")).toBe(true);
    // Round-trip should be close (float32 precision)
    const origView = new Float32Array(
      original.buffer,
      original.byteOffset,
      original.byteLength / 4,
    );
    const backView = new Float32Array(
      back.buffer,
      back.byteOffset,
      back.byteLength / 4,
    );
    for (let i = 0; i < origView.length; i++) {
      expect(origView[i]).toBeCloseTo(backView[i], 6);
    }
  });
});

describe("EmbeddingEngine — singleton lifecycle", () => {
  it("getEmbeddingEngine returns same instance on repeated calls", () => {
    resetEmbeddingEngine();
    const e1 = getEmbeddingEngine();
    const e2 = getEmbeddingEngine();
    expect(e1).toBe(e2);
  });

  it("resetEmbeddingEngine clears the singleton", () => {
    resetEmbeddingEngine();
    const e1 = getEmbeddingEngine();
    resetEmbeddingEngine();
    const e2 = getEmbeddingEngine();
    // Different instances after reset
    expect(e1).not.toBe(e2);
  });
});

describe("EmbeddingEngine — encodeBatch with fallback", () => {
  it("returns null for empty strings, Uint8Array for non-empty", async () => {
    const engine = new EmbeddingEngine("all-MiniLM-L6-v2", 384, "cpu");
    (engine as unknown as { _unavailable: boolean })._unavailable = true;

    const results = await engine.encodeBatch(["hello", "", "world"]);
    expect(results[0]).toBeInstanceOf(Uint8Array);
    expect(results[1]).toBeNull();
    expect(results[2]).toBeInstanceOf(Uint8Array);
  });
});
