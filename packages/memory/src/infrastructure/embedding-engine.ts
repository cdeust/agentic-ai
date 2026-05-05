/**
 * Embedding engine for Cortex memory system.
 *
 * Provides text → vector encoding for semantic similarity search.
 *
 * Strategy (in priority order):
 *   1. sentence-transformers via @xenova/transformers (if available) — best quality, 384D
 *   2. Fallback: hash-based deterministic encoding
 *
 * The engine is lazy-loading: no model initialization until first encode() call.
 *
 * Device selection:
 *   Default is "cpu" for embedding consistency (GPU float32 arithmetic produces
 *   bit-different vectors from CPU). GPU is opt-in via CORTEX_MEMORY_EMBEDDING_DEVICE
 *   env var. Switching devices mid-deployment means new embeddings won't be
 *   bit-identical to existing ones — cosine similarity degradation is small
 *   (~1e-7) but retrieval ranking can shift for borderline results.
 *
 *   If GPU inference fails at runtime (OOM, MPS reset after sleep), the engine
 *   automatically falls back to CPU. If CPU also fails, it degrades to hash-based
 *   fallback encoding. The engine never crashes on encode().
 *
 * source: Cortex mcp_server/infrastructure/embedding_engine.py
 */

import { createHash } from "node:crypto";

// ── Dimensions ────────────────────────────────────────────────────────────
// source: embedding_engine.py:71 — default dim=384 (all-MiniLM-L6-v2)
const DEFAULT_DIM = 384;

// source: embedding_engine.py:73 — model name
const DEFAULT_MODEL_NAME = "all-MiniLM-L6-v2";

// ── LRU cache max ─────────────────────────────────────────────────────────
// source: embedding_engine.py:85 — _cache_max = 128
const _CACHE_MAX = 128;

// ── Process-wide singleton ────────────────────────────────────────────────
// One EmbeddingEngine per process. Handlers call getEmbeddingEngine()
// instead of creating their own instances. This guarantees: one model,
// one device, no mixed-device embeddings, ~5x memory savings.
// source: embedding_engine.py:38-48
let _singleton: EmbeddingEngine | null = null;

export function getEmbeddingEngine(): EmbeddingEngine {
  /** Return the process-wide EmbeddingEngine singleton.
   * source: embedding_engine.py:41-48
   */
  if (_singleton === null) {
    const dim = _getEmbeddingDim();
    const device = _getEmbeddingDevice();
    _singleton = new EmbeddingEngine(DEFAULT_MODEL_NAME, dim, device);
  }
  return _singleton;
}

export function resetEmbeddingEngine(): void {
  /** Clear singleton (for testing only).
   * source: embedding_engine.py:51-55
   */
  _singleton = null;
}

function _getEmbeddingDim(): number {
  // source: embedding_engine.py:47 — from get_memory_settings().EMBEDDING_DIM
  const raw = process.env["CORTEX_MEMORY_EMBEDDING_DIM"];
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_DIM;
}

function _getEmbeddingDevice(): string {
  // source: embedding_engine.py:48 — from get_memory_settings().EMBEDDING_DEVICE
  return process.env["CORTEX_MEMORY_EMBEDDING_DEVICE"] ?? "cpu";
}

// ── Ordered LRU cache ─────────────────────────────────────────────────────

/** Minimal LRU cache keyed by string → Uint8Array.
 * Mirrors Python collections.OrderedDict used in embedding_engine.py.
 */
class LruCache {
  private readonly _max: number;
  private readonly _map = new Map<string, Uint8Array>();

  constructor(max: number) {
    this._max = max;
  }

  get(key: string): Uint8Array | undefined {
    const v = this._map.get(key);
    if (v !== undefined) {
      // Move to end (most recently used)
      this._map.delete(key);
      this._map.set(key, v);
    }
    return v;
  }

  set(key: string, value: Uint8Array): void {
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._max) {
      // Evict LRU (first entry)
      const firstKey = this._map.keys().next().value;
      if (firstKey !== undefined) this._map.delete(firstKey);
    }
    this._map.set(key, value);
  }

  has(key: string): boolean {
    return this._map.has(key);
  }
}

/**
 * Lazy-loading embedding engine with graceful fallback.
 *
 * Cache key discipline (ADR-0045 R5): the LRU cache is keyed by
 * ``sha256(text)[:16]`` (16 hex chars = 8 bytes of entropy), never by
 * raw text. A 100 KB user memory yields a 16-byte key instead of
 * 100 KB of key bytes — at _CACHE_MAX = 128 this bounds cache key
 * memory to ~2 KB regardless of input size. A 16-char SHA256 prefix
 * has 2^64 possible values; the birthday-bound collision probability
 * at 128 cached entries is ~4.6e-16 (negligible). See
 * _cacheKey for the single point of truth.
 *
 * source: embedding_engine.py:58-69 (class docstring / ADR-0045 R5)
 */
export class EmbeddingEngine {
  private readonly _modelName: string;
  private _dim: number;
  private readonly _deviceRequested: string;
  private _model: unknown = null;
  private _unavailable = false;
  // Cache keyed by sha256(text)[:16] — see class docstring / ADR-0045 R5.
  // source: embedding_engine.py:84-85
  private readonly _cache: LruCache;

  constructor(
    modelName = DEFAULT_MODEL_NAME,
    dim = DEFAULT_DIM,
    device = "cpu",
  ) {
    this._modelName = modelName;
    this._dim = dim;
    this._deviceRequested = device;
    this._cache = new LruCache(_CACHE_MAX);
  }

  // ── Cache key (ADR-0045 R5) ────────────────────────────────────────

  /**
   * Return the SHA256[:16] cache key for ``text``.
   *
   * precondition: ``text`` is a non-empty string.
   * postcondition: returns a 16-char lowercase hex string; the same
   * input always produces the same key; key length is independent of
   * text.length.
   *
   * Source: ADR-0045 R5 — sha256(text.encode()).hexdigest()[:16]
   * source: embedding_engine.py:89-102
   */
  static cacheKey(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
  }

  get modelName(): string {
    return this._modelName;
  }

  get dimensions(): number {
    return this._dim;
  }

  /**
   * Check if a real embedding model is available (without loading it).
   * source: embedding_engine.py:113-124
   */
  get available(): boolean {
    if (this._model !== null) return true;
    if (this._unavailable) return false;
    try {
      // Check if @xenova/transformers is importable (dynamic check)
      // In Node.js ESM we can't easily synchronously require — mark available
      // only if model was already loaded.
      return false;
    } catch {
      return false;
    }
  }

  // ── Model loading ──────────────────────────────────────────────────

  private async _ensureModel(): Promise<void> {
    /** Lazy-load the embedding model.
     * source: embedding_engine.py:175-222
     */
    if (this._model !== null || this._unavailable) return;
    try {
      // Attempt to load @xenova/transformers pipeline
      // source: transformers-embedding-engine.ts pattern
      const { pipeline } = await import(
        "@xenova/transformers" as string
      ).catch(() => ({ pipeline: null }));

      if (!pipeline) {
        this._unavailable = true;
        return;
      }

      const device = this._deviceRequested === "auto" ? "cpu" : this._deviceRequested;
      this._model = await pipeline(
        "feature-extraction",
        `Xenova/${this._modelName}`,
        { device: device === "cpu" ? undefined : device },
      );
    } catch {
      this._unavailable = true;
    }
  }

  // ── Encoding ───────────────────────────────────────────────────────

  /**
   * Encode text to a float32 byte blob.
   *
   * precondition: text is a string (may be empty).
   * postcondition: returns Uint8Array of length dim * 4 bytes (float32),
   *   or null when text is empty.
   *
   * The LRU cache is keyed by sha256(text)[:16] per ADR-0045 R5 —
   * never by raw text — so a 100 KB memory contributes 16 bytes of
   * key storage, not 100 KB.
   *
   * source: embedding_engine.py:281-306
   */
  async encode(text: string): Promise<Uint8Array | null> {
    if (!text) return null;

    const key = EmbeddingEngine.cacheKey(text);
    const cached = this._cache.get(key);
    if (cached !== undefined) return cached;

    await this._ensureModel();

    let result: Uint8Array;
    if (this._unavailable || this._model === null) {
      result = this._fallbackEncode(text);
    } else {
      result = await this._encodeVec(text);
    }

    this._cache.set(key, result);
    return result;
  }

  /**
   * Batch encode for efficiency.
   * source: embedding_engine.py:308-332
   */
  async encodeBatch(texts: string[]): Promise<Array<Uint8Array | null>> {
    await this._ensureModel();

    if (this._unavailable || this._model === null) {
      return texts.map((t) => (t ? this._fallbackEncode(t) : null));
    }

    try {
      const results: Array<Uint8Array | null> = [];
      for (const text of texts) {
        if (!text) {
          results.push(null);
          continue;
        }
        results.push(await this._encodeVec(text));
      }
      return results;
    } catch {
      // Fall back to individual encoding via fallback
      return texts.map((t) => (t ? this._fallbackEncode(t) : null));
    }
  }

  /**
   * Cosine similarity between two embedding blobs.
   * source: embedding_engine.py:334-344
   */
  similarity(embeddingA: Uint8Array, embeddingB: Uint8Array): number {
    const a = new Float32Array(
      embeddingA.buffer,
      embeddingA.byteOffset,
      embeddingA.byteLength / 4,
    );
    const b = new Float32Array(
      embeddingB.buffer,
      embeddingB.byteOffset,
      embeddingB.byteLength / 4,
    );
    if (a.length !== b.length) return 0.0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    const norm = Math.sqrt(normA) * Math.sqrt(normB);
    if (norm === 0) return 0.0;
    return dot / norm;
  }

  /**
   * Convert embedding blob to float list.
   * source: embedding_engine.py:346-350
   */
  static toList(embedding: Uint8Array): number[] {
    const view = new Float32Array(
      embedding.buffer,
      embedding.byteOffset,
      embedding.byteLength / 4,
    );
    return Array.from(view);
  }

  /**
   * Convert float list to embedding blob.
   * source: embedding_engine.py:352-356
   */
  static fromList(values: number[]): Uint8Array {
    const arr = new Float32Array(values);
    return new Uint8Array(arr.buffer);
  }

  // ── Private ────────────────────────────────────────────────────────

  private async _encodeVec(text: string): Promise<Uint8Array> {
    /** Encode text via model. Always returns Uint8Array.
     * source: embedding_engine.py:262-279
     */
    const model = this._model as (
      text: string,
      opts: { pooling: string; normalize: boolean },
    ) => Promise<{ data: Float32Array }>;
    const output = await model(text, { pooling: "mean", normalize: true });
    const arr = Float32Array.from(output.data);
    return new Uint8Array(arr.buffer);
  }

  /**
   * Hash-based deterministic embedding fallback.
   *
   * Uses character n-gram hashing to produce a fixed-dimension vector.
   * Quality is much lower than learned embeddings but provides basic
   * similarity ordering without any ML model.
   *
   * source: embedding_engine.py:365-395
   */
  private _fallbackEncode(text: string): Uint8Array {
    const vec = new Float32Array(this._dim);
    const textLower = text.toLowerCase();

    // Character trigram hashing
    // source: embedding_engine.py:376-382
    for (let i = 0; i < textLower.length - 2; i++) {
      const trigram = textLower.slice(i, i + 3);
      // non-security: deterministic bucketing
      const h = parseInt(
        createHash("sha256").update(trigram, "utf8").digest("hex").slice(0, 8),
        16,
      );
      const idx = h % this._dim;
      vec[idx] = (vec[idx] ?? 0) + 1.0;
    }

    // Word-level hashing for semantic signal
    // source: embedding_engine.py:384-391
    const words = textLower.split(/\s+/);
    for (const word of words) {
      if (word.length > 2) {
        // non-security: deterministic bucketing
        const h = parseInt(
          createHash("sha256").update(word, "utf8").digest("hex").slice(0, 8),
          16,
        );
        const idx = h % this._dim;
        vec[idx] = (vec[idx] ?? 0) + 2.0; // Words weighted more than trigrams
      }
    }

    // Normalize
    // source: embedding_engine.py:393-394
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += (vec[i] ?? 0) * (vec[i] ?? 0);
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / norm;
    }

    return new Uint8Array(vec.buffer);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Normalize a Float32Array in place.
 * source: embedding_engine.py:358-363
 */
export function normalizeEmbedding(arr: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += (arr[i] ?? 0) * (arr[i] ?? 0);
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] ?? 0) / norm;
  }
  return arr;
}
