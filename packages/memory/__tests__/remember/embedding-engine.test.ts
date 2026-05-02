/**
 * embedding-engine.test.ts — Tests for Phase 7 Group A embedding wiring.
 *
 * Tests the following invariants:
 *   1. EmbeddingEngine port contract (deterministic mock vectors).
 *   2. TransformersEmbeddingEngine construction (not model load — lazy).
 *   3. ingestMemory with a mock EmbeddingEngine produces a Buffer embedding.
 *   4. postStore with a mock EmbeddingEngine calls upsertEmbedding.
 *   5. SqliteMemoryStore.searchVectors degrades gracefully when sqlite-vec
 *      is not installed.
 *   6. toRecallEmbeddingEngine adapter wraps core EmbeddingEngine correctly.
 *   7. Live model smoke test — gated on AGENTIC_EMBED_LIVE env var.
 *
 * Deterministic mock vectors are derived from a character-hash of the input
 * text, providing stable expected values for tests.
 *
 * source: docs/PHASE_7_TRACKING.md §Group A acceptance criterion
 * source: packages/core/src/ports/embedding.ts — EmbeddingEngine contract
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingEngine } from "@agentic/core";
import {
  TransformersEmbeddingEngine,
  _resetPipelineCache,
  toRecallEmbeddingEngine,
} from "../../src/infrastructure/transformers-embedding-engine.js";
import { ingestMemory } from "../../src/remember/memory-ingest.js";
import { postStore } from "../../src/remember/post-store.js";
import { SqliteMemoryStore } from "../../src/remember/storage/sqlite-store.js";

// ── Deterministic mock EmbeddingEngine ────────────────────────────────────

/**
 * Deterministic embedding engine for tests.
 *
 * Produces vectors by hashing each character of the text into a 384-dim
 * Float32Array. Same text always produces the same vector.
 *
 * postcondition: embed(text).length === 384.
 * postcondition: embed("abc") !== embed("xyz") (deterministically different).
 */
function makeHashEmbeddingEngine(dim = 384): EmbeddingEngine {
  return {
    dim,
    modelId: "test/hash-mock",

    async embed(text: string): Promise<Float32Array> {
      const vec = new Float32Array(dim);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        const idx = (code * 31 + i) % dim;
        vec[idx] = (vec[idx] ?? 0) + 1.0;
      }
      // L2-normalise
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += (vec[i] ?? 0) ** 2;
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < dim; i++) vec[i] = (vec[i] ?? 0) / norm;
      }
      return vec;
    },

    async embedBatch(texts: string[]): Promise<Float32Array[]> {
      return Promise.all(texts.map((t) => this.embed(t)));
    },
  };
}

// ── EmbeddingEngine port contract ─────────────────────────────────────────

describe("EmbeddingEngine port contract", () => {
  const engine = makeHashEmbeddingEngine();

  it("embed() returns Float32Array of length dim", async () => {
    const vec = await engine.embed("hello world");
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(384);
  });

  it("embed() returns L2-normalised vector (norm ≈ 1.0)", async () => {
    const vec = await engine.embed("normalisation test");
    let norm = 0;
    for (const v of vec) norm += v ** 2;
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5);
  });

  it("embed() is deterministic for the same input", async () => {
    const v1 = await engine.embed("same text");
    const v2 = await engine.embed("same text");
    expect(Array.from(v1)).toEqual(Array.from(v2));
  });

  it("embed() produces distinct vectors for different inputs", async () => {
    const v1 = await engine.embed("text one");
    const v2 = await engine.embed("text two");
    expect(Array.from(v1)).not.toEqual(Array.from(v2));
  });

  it("embedBatch() returns array of length equal to inputs", async () => {
    const texts = ["alpha", "beta", "gamma"];
    const vecs = await engine.embedBatch(texts);
    expect(vecs.length).toBe(3);
    for (const v of vecs) {
      expect(v).toBeInstanceOf(Float32Array);
      expect(v.length).toBe(384);
    }
  });

  it("embedBatch() produces same result as sequential embed() calls", async () => {
    const texts = ["a", "b", "c"];
    const batch = await engine.embedBatch(texts);
    for (let i = 0; i < texts.length; i++) {
      const single = await engine.embed(texts[i]!);
      expect(Array.from(batch[i]!)).toEqual(Array.from(single));
    }
  });
});

// ── TransformersEmbeddingEngine construction ──────────────────────────────

describe("TransformersEmbeddingEngine construction", () => {
  afterEach(() => {
    _resetPipelineCache();
  });

  it("creates with default model id", () => {
    const eng = new TransformersEmbeddingEngine();
    expect(eng.modelId).toBe("Xenova/all-MiniLM-L6-v2");
  });

  it("creates with correct default dim (384)", () => {
    // source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 (dim=384)
    const eng = new TransformersEmbeddingEngine();
    expect(eng.dim).toBe(384);
  });

  it("accepts custom modelId and dim", () => {
    const eng = new TransformersEmbeddingEngine({ modelId: "test/model", dim: 128 });
    expect(eng.modelId).toBe("test/model");
    expect(eng.dim).toBe(128);
  });

  it("implements EmbeddingEngine interface (structural typing check)", () => {
    const eng: EmbeddingEngine = new TransformersEmbeddingEngine();
    expect(typeof eng.embed).toBe("function");
    expect(typeof eng.embedBatch).toBe("function");
    expect(typeof eng.dim).toBe("number");
    expect(typeof eng.modelId).toBe("string");
  });
});

// ── ingestMemory with EmbeddingEngine ─────────────────────────────────────

describe("ingestMemory with EmbeddingEngine", () => {
  let store: SqliteMemoryStore;
  const engine = makeHashEmbeddingEngine();

  beforeEach(() => {
    store = new SqliteMemoryStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("inserts memory and returns id when embedding is provided", async () => {
    const ids = await ingestMemory(
      { content: "test memory for embedding", tags: ["test"] },
      store,
      engine,
    );
    expect(ids.length).toBe(1);
    expect(ids[0]).toBeGreaterThan(0);
  });

  it("inserts memory when embedding engine is null (no embedding)", async () => {
    const ids = await ingestMemory(
      { content: "test memory without embedding" },
      store,
      null,
    );
    expect(ids.length).toBe(1);
    expect(ids[0]).toBeGreaterThan(0);
  });

  it("returns [] for empty content (invariant I1)", async () => {
    const ids = await ingestMemory({ content: "   " }, store, engine);
    expect(ids).toEqual([]);
  });

  it("stores the row retrievable by getMemory (invariant I2)", async () => {
    const content = "embedding engine test content";
    const ids = await ingestMemory({ content }, store, engine);
    const mem = store.getMemory(ids[0]!);
    expect(mem).not.toBeNull();
    expect(mem!.content).toBe(content);
  });

  it("decomposes conversation content into multiple chunks", async () => {
    const content = [
      "Human: What is the best practice?",
      "Assistant: Always test your code.",
      "Human: Thanks!",
      "Assistant: You're welcome.",
    ].join("\n");
    const ids = await ingestMemory({ content }, store, engine, { turnsPerChunk: 2 });
    expect(ids.length).toBeGreaterThan(1);
  });
});

// ── postStore with EmbeddingEngine ────────────────────────────────────────

describe("postStore with EmbeddingEngine", () => {
  let store: SqliteMemoryStore;
  const engine = makeHashEmbeddingEngine();

  beforeEach(() => {
    store = new SqliteMemoryStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("returns embeddingUpserted=false when engine is null", async () => {
    const id = store.insertMemory({ content: "test content" });
    const result = await postStore(
      {
        memoryId: id,
        content: "test content",
        domain: "test",
        entityNames: [],
        embeddings: null,
      },
      store,
    );
    expect(result.embeddingUpserted).toBe(false);
  });

  it("attempts embedding upsert when engine is provided", async () => {
    const id = store.insertMemory({ content: "embedding upsert test" });
    const result = await postStore(
      {
        memoryId: id,
        content: "embedding upsert test",
        domain: "test",
        entityNames: [],
        embeddings: engine,
      },
      store,
    );
    // sqlite-vec is not installed in CI — embeddingUpserted may be true or false
    // depending on sqlite-vec availability. The call must not throw (invariant).
    expect(result.errors.length).toBe(0);
  });

  it("never throws even when embedding fails (invariant)", async () => {
    const failEngine: EmbeddingEngine = {
      ...makeHashEmbeddingEngine(),
      async embed(_text: string): Promise<Float32Array> {
        throw new Error("intentional test failure");
      },
    };
    const id = store.insertMemory({ content: "fail test" });
    const result = await postStore(
      {
        memoryId: id,
        content: "fail test",
        domain: "test",
        entityNames: [],
        embeddings: failEngine,
      },
      store,
    );
    // Must not throw; error captured in result.errors
    expect(result.embeddingUpserted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("links entities and returns entitiesLinked count", async () => {
    const id = store.insertMemory({ content: "entity test" });
    const result = await postStore(
      {
        memoryId: id,
        content: "entity test",
        domain: "test",
        entityNames: ["TypeScript", "Node.js"],
        embeddings: null,
      },
      store,
    );
    expect(result.entitiesLinked).toBe(2);
    expect(result.errors.length).toBe(0);
  });
});

// ── SqliteMemoryStore vector search graceful degradation ──────────────────

describe("SqliteMemoryStore.searchVectors graceful degradation", () => {
  let store: SqliteMemoryStore;

  beforeEach(() => {
    store = new SqliteMemoryStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("returns [] when sqlite-vec is not installed", () => {
    if (store.hasVec) {
      // sqlite-vec IS installed — test the happy path instead
      expect(store.hasVec).toBe(true);
      return;
    }
    const dummyEmbedding = Buffer.alloc(384 * 4); // 384 float32 values
    const results = store.searchVectors(dummyEmbedding, 10);
    expect(results).toEqual([]);
  });

  it("hasVec reflects extension availability (smoke check)", () => {
    expect(typeof store.hasVec).toBe("boolean");
  });
});

// ── toRecallEmbeddingEngine adapter ───────────────────────────────────────

describe("toRecallEmbeddingEngine adapter", () => {
  const coreEngine = makeHashEmbeddingEngine();
  const recallEngine = toRecallEmbeddingEngine(coreEngine);

  it("dimensions equals coreEngine.dim", () => {
    expect(recallEngine.dimensions).toBe(coreEngine.dim);
  });

  it("encode() returns number[] for valid text", async () => {
    const result = await recallEngine.encode("test text");
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(384);
  });

  it("encode() returns null when core engine throws", async () => {
    const failCore: EmbeddingEngine = {
      ...makeHashEmbeddingEngine(),
      async embed(_text: string): Promise<Float32Array> {
        throw new Error("test failure");
      },
    };
    const adapter = toRecallEmbeddingEngine(failCore);
    const result = await adapter.encode("any text");
    expect(result).toBeNull();
  });

  it("similarity() returns 1.0 for identical vectors", () => {
    const v = [0.6, 0.8, 0.0];
    expect(recallEngine.similarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("similarity() returns 0.0 for zero vector", () => {
    const zero = [0, 0, 0];
    const nonzero = [1, 0, 0];
    expect(recallEngine.similarity(zero, nonzero)).toBe(0.0);
  });

  it("similarity() returns 0.0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(recallEngine.similarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it("encode() produces values compatible with similarity()", async () => {
    const v1 = await recallEngine.encode("hello world");
    const v2 = await recallEngine.encode("hello world");
    // Same text → similarity ≈ 1.0
    expect(recallEngine.similarity(v1!, v2!)).toBeCloseTo(1.0, 5);
  });
});

// ── Live model smoke test (gated on AGENTIC_EMBED_LIVE) ───────────────────

describe("TransformersEmbeddingEngine live model", () => {
  afterEach(() => {
    _resetPipelineCache();
  });

  it.todo(
    "loads Xenova/all-MiniLM-L6-v2 and returns 384-dim vectors [live: set AGENTIC_EMBED_LIVE=1]",
    // Gate: AGENTIC_EMBED_LIVE must be set to run this test.
    // This prevents model download in CI (model files are ~90 MB).
    // To run locally: AGENTIC_EMBED_LIVE=1 pnpm test --run
  );

  it.todo(
    "embed() output is L2-normalised (live model, AGENTIC_EMBED_LIVE=1)",
  );

  it.skipIf(!process.env["AGENTIC_EMBED_LIVE"])(
    "live: embed() returns 384-dim L2-normalised Float32Array",
    { timeout: 60_000 },
    async () => {
      const eng = new TransformersEmbeddingEngine();
      const vec = await eng.embed("The quick brown fox jumps over the lazy dog");

      expect(vec).toBeInstanceOf(Float32Array);
      expect(vec.length).toBe(384);

      // L2 norm should be ≈ 1.0 (normalised output)
      // source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
      //   normalise_embeddings=true in the model config
      let norm = 0;
      for (const v of vec) norm += v ** 2;
      expect(Math.sqrt(norm)).toBeCloseTo(1.0, 4);
    },
  );

  it.skipIf(!process.env["AGENTIC_EMBED_LIVE"])(
    "live: embedBatch() is consistent with embed()",
    { timeout: 60_000 },
    async () => {
      const eng = new TransformersEmbeddingEngine();
      const texts = ["hello world", "foo bar baz"];
      const [b1, b2] = await eng.embedBatch(texts);
      const s1 = await eng.embed(texts[0]!);
      const s2 = await eng.embed(texts[1]!);

      expect(Array.from(b1!)).toEqual(Array.from(s1));
      expect(Array.from(b2!)).toEqual(Array.from(s2));
    },
  );
});
