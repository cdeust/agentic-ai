/**
 * TransformersEmbeddingEngine — adapter implementing EmbeddingEngine using
 * @xenova/transformers (TransformerJS).
 *
 * Layer: INFRASTRUCTURE.  Implements the EmbeddingEngine port declared in
 * @agentic/core.  Must not be imported by core or domain modules.
 *
 * Model: Xenova/all-MiniLM-L6-v2 — ONNX export of sentence-transformers/all-MiniLM-L6-v2.
 * Produces 384-dimensional L2-normalised float32 vectors, bit-compatible with
 * the Cortex Python EmbeddingEngine (embedding_engine.py).
 *
 * source: https://huggingface.co/Xenova/all-MiniLM-L6-v2
 *   (ONNX export of sentence-transformers/all-MiniLM-L6-v2;
 *    dim=384, max_seq_length=256, pooling=mean, normalise=true)
 * source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
 *   (original model card — same vector space, same normalisation convention)
 * source: ADR-0013 — Embedding runtime selection (Xenova/all-MiniLM-L6-v2)
 * source: Cortex mcp_server/infrastructure/embedding_engine.py
 *   (reference implementation — same model, same lazy-load + LRU-cache design)
 * source: Martin, R. C. (2017). Clean Architecture, Ch. 22 —
 *   infrastructure adapters implement core ports; composition root wires them.
 *
 * Cache design:
 *   The pipeline instance is cached as a module-level singleton (one instance
 *   per process). This mirrors the Cortex Python singleton pattern (get_embedding_engine).
 *   The cache is keyed by modelId so that tests that inject a different model
 *   ID do not share state.
 *
 * Model files:
 *   Downloaded once to ~/.cache/huggingface/hub (the @xenova/transformers default,
 *   which respects HF_HOME / TRANSFORMERS_CACHE env vars).
 *   Do NOT set cache_dir to a path inside the repository.
 */

import type { EmbeddingEngine } from "@agentic/core";

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Default model identifier.
 * source: Cortex mcp_server/infrastructure/embedding_engine.py:model_name default
 *   "all-MiniLM-L6-v2" (sentence-transformers name)
 * source: https://huggingface.co/Xenova/all-MiniLM-L6-v2
 *   (Xenova ONNX equivalent; same weight values)
 */
const DEFAULT_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 — hidden_size = 384
const EMBEDDING_DIM = 384;

// source: Cortex mcp_server/infrastructure/embedding_engine.py:encode() — text.slice(0, 2000) character cap
const MAX_CHARS = 2000;

// ── Pipeline cache ────────────────────────────────────────────────────────

// Map from modelId → resolved FeatureExtractionPipeline.
// One entry per model. Avoids reloading on every encode() call.
const _pipelineCache = new Map<string, unknown>();

// ── TransformersEmbeddingEngine ───────────────────────────────────────────

/**
 * EmbeddingEngine adapter backed by @xenova/transformers.
 *
 * Precondition (constructor): modelId is a valid HuggingFace model identifier
 *   for a sentence-similarity/feature-extraction model. Default is
 *   "Xenova/all-MiniLM-L6-v2".
 *
 * Postcondition (embed):     returns a Float32Array of length `dim`,
 *   L2-normalised (‖result‖₂ ≈ 1.0).
 * Postcondition (embedBatch): result[i] is the L2-normalised embedding for
 *   texts[i]; result.length === texts.length.
 *
 * Invariant: dim is 384 for the default model; modelId is immutable.
 *
 * Error cases:
 *   - embed()/embedBatch() reject if the model cannot be loaded (missing file,
 *     network unavailable without a cached copy).
 *   - The adapter never swallows errors silently; callers must handle rejection.
 */
export class TransformersEmbeddingEngine implements EmbeddingEngine {
  readonly dim: number;
  readonly modelId: string;

  constructor(opts: { modelId?: string; dim?: number } = {}) {
    this.modelId = opts.modelId ?? DEFAULT_MODEL_ID;
    // source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 — dim=384
    this.dim = opts.dim ?? EMBEDDING_DIM;
  }

  // ── Private: lazy pipeline load ──────────────────────────────────────

  /**
   * Lazy-load the @xenova/transformers pipeline.
   *
   * precondition:  this.modelId is a valid HF model identifier.
   * postcondition: cached pipeline for this.modelId is returned.
   *
   * The dynamic import is intentional: @xenova/transformers has a heavy
   * initialisation path (loads ONNX runtime, registers backends). Deferring
   * to first use means processes that never call embed() pay zero cost.
   */
  private async _getPipeline(): Promise<unknown> {
    const cached = _pipelineCache.get(this.modelId);
    if (cached !== undefined) return cached;

    // Dynamic import — deferred to first encode call.
    const { pipeline } = await import("@xenova/transformers");

    // pipeline('feature-extraction', model) constructs a FeatureExtractionPipeline.
    // source: @xenova/transformers API — https://huggingface.co/docs/transformers.js
    //   pipeline(task, model) is the canonical entry point.
    const pipe = await pipeline("feature-extraction", this.modelId, {
      // Respect HF_HOME / TRANSFORMERS_CACHE env vars for cache directory.
      // Do NOT override cache_dir here — let the library honour the user's
      // environment. Model files land in ~/.cache/huggingface/hub by default.
      quantized: false, // Use full fp32 precision for vector compatibility
    });

    _pipelineCache.set(this.modelId, pipe);
    return pipe;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Encode a single text string.
   *
   * precondition:  text is a non-empty string.
   * postcondition: returns Float32Array of length this.dim; L2-normalised.
   */
  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    // postcondition: embedBatch([text]) returns exactly 1 element
    // (texts.length = 1, result.length = 1 per embedBatch postcondition)
    const result = results[0];
    if (result === undefined) {
      throw new Error(`TransformersEmbeddingEngine.embed: embedBatch returned empty array for model ${this.modelId}`);
    }
    return result;
  }

  /**
   * Encode a batch of texts.
   *
   * precondition:  texts is non-empty; every element is a non-empty string.
   * postcondition: result[i] is Float32Array of length this.dim for texts[i];
   *   each element is L2-normalised; result.length === texts.length.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const pipe = await this._getPipeline();

    // Truncate inputs to MAX_CHARS before tokenisation.
    // source: Cortex mcp_server/infrastructure/embedding_engine.py — text.slice(0, 2000)
    const inputs = texts.map((t) => t.slice(0, MAX_CHARS));

    // Call the pipeline. The 'feature-extraction' pipeline with pooling='mean'
    // and normalize=true returns L2-normalised mean-pooled sentence vectors.
    // source: @xenova/transformers FeatureExtractionPipeline docs
    // source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
    //   (pooling_mode_mean_tokens=true, normalise_embeddings=true)
    // Cast: _getPipeline() returns Promise<unknown>; the runtime type is
    // FeatureExtractionPipeline which is callable and returns an object with
    // tolist(). We assert this contract here.
    const callablePipe = pipe as (
      inputs: string[],
      opts: { pooling: string; normalize: boolean },
    ) => Promise<{ tolist(): number[][] }>;
    const output = await callablePipe(inputs, {
      pooling: "mean",
      normalize: true,
    });

    // output.tolist() returns number[][] (one row per input).
    const nested: number[][] = output.tolist();

    // Convert each row to Float32Array.
    // postcondition: each result[i].length === this.dim
    return nested.map((row) => new Float32Array(row));
  }
}

// ── Module-level test hook ────────────────────────────────────────────────

/** Test hook: clear the pipeline cache. Call in afterEach to prevent leaks. */
export function _resetPipelineCache(): void {
  _pipelineCache.clear();
}

// ── Recall-subsystem compatibility adapter ────────────────────────────────
//
// The recall module (recall/port.ts) defines a STUB EmbeddingEngine that
// returns number[] | null (instead of Float32Array) and has `.encode()` and
// `.similarity()`. This adapter wraps a @agentic/core EmbeddingEngine
// (TransformersEmbeddingEngine or any other implementation) into the recall
// subsystem's expected interface.
//
// Use this at the MCP composition root when wiring the recall handler:
//
//   import { TransformersEmbeddingEngine, toRecallEmbeddingEngine } from
//     "@agentic/memory/infrastructure/transformers-embedding-engine.js";
//   const engine = new TransformersEmbeddingEngine();
//   const recallEngine = toRecallEmbeddingEngine(engine);
//   const result = await recallHandler(args, store, recallEngine);
//
// source: docs/PHASE_7_TRACKING.md §Group A — composition root adapter
// source: recall/port.ts — TODO(Group A) note

import type { EmbeddingEngine as CoreEmbeddingEngine } from "@agentic/core";

/**
 * Recall-subsystem EmbeddingEngine adapter.
 *
 * Wraps a @agentic/core EmbeddingEngine (Float32Array, embed()) into the
 * recall module's expected interface (number[] | null, encode(), similarity(),
 * dimensions).
 *
 * Precondition:  core is a valid @agentic/core EmbeddingEngine.
 * Postcondition: encode(text) returns number[] on success, null on error.
 * Postcondition: similarity(a, b) returns cosine similarity in [-1, 1].
 * Invariant:     dimensions === core.dim.
 *
 * source: recall/port.ts — interface definition
 * source: Cortex mcp_server/infrastructure/embedding_engine.py:similarity
 *   (dot product of L2-normalised vectors; equals cosine similarity)
 */
export function toRecallEmbeddingEngine(core: CoreEmbeddingEngine): {
  encode(text: string): Promise<number[] | null>;
  similarity(a: number[], b: number[]): number;
  readonly dimensions: number;
} {
  return {
    get dimensions(): number {
      return core.dim;
    },

    async encode(text: string): Promise<number[] | null> {
      try {
        const vec = await core.embed(text);
        return Array.from(vec);
      } catch {
        return null;
      }
    },

    /**
     * Cosine similarity between two vectors.
     * Precondition:  a.length === b.length > 0.
     * Postcondition: returns dot(a, b) / (‖a‖ · ‖b‖), or 0.0 if either norm is 0.
     * source: Cortex mcp_server/infrastructure/embedding_engine.py:similarity
     */
    similarity(a: number[], b: number[]): number {
      if (a.length !== b.length || a.length === 0) return 0.0;
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += (a[i] ?? 0) * (b[i] ?? 0);
        normA += (a[i] ?? 0) ** 2;
        normB += (b[i] ?? 0) ** 2;
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0.0 : dot / denom;
    },
  };
}
