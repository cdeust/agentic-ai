/**
 * @agentic/core — ports/embedding.ts
 *
 * EmbeddingEngine port: the interface that encodes text into dense float32
 * vectors for semantic similarity search.
 *
 * Layer: CORE. Must not import from infrastructure, handlers, or any package
 * that imports from infrastructure. Dependencies: standard library only.
 *
 * Design contract:
 *   - The interface is intentionally minimal: encode one text, encode a batch,
 *     report dimensionality, report model identity.
 *   - Implementations (adapters) live in infrastructure layers and are wired
 *     at the composition root — never imported by core or domain code.
 *   - All outputs are L2-normalised Float32Arrays so cosine-similarity reduces
 *     to a dot product (postcondition on every implementation).
 *
 * Source: Martin, R. C. (2017). Clean Architecture, Ch. 22 —
 *   core declares what it needs via interface types; infrastructure implements.
 * Source: ADR-0013 — Embedding runtime selection (Xenova/all-MiniLM-L6-v2).
 * Source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
 *   (original model — 384D L2-normalised float32 vectors)
 */

/**
 * EmbeddingEngine — port for text-to-vector encoding.
 *
 * Precondition (embed):      text is a non-empty string.
 * Postcondition (embed):     result is a Float32Array of length `dim`,
 *   L2-normalised (‖result‖₂ ≈ 1.0).
 *
 * Precondition (embedBatch):  texts is a non-empty array of non-empty strings.
 * Postcondition (embedBatch): result[i] is the embedding for texts[i];
 *   result.length === texts.length; each element is L2-normalised.
 *
 * Invariant: dim and modelId are immutable for a given instance.
 *
 * Error cases: embed() and embedBatch() reject with a descriptive Error on
 *   model-load failure. They never silently return zero vectors — callers
 *   that need graceful degradation must handle the rejection explicitly.
 *
 * source: ADR-0013 — Embedding runtime selection
 * source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
 */
export interface EmbeddingEngine {
  /**
   * Encode a single text string into a dense L2-normalised float32 vector.
   *
   * @param text - Non-empty input string. Strings longer than the model's
   *               token limit (typically 512 tokens for all-MiniLM-L6-v2)
   *               are silently truncated by the tokeniser.
   *               source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
   *               (max_seq_length = 256 tokens for this model variant)
   */
  embed(text: string): Promise<Float32Array>;

  /**
   * Encode a batch of texts.  Significantly faster than calling embed() in a
   * loop because the underlying ONNX runtime can process the batch as a single
   * matrix operation.
   *
   * @param texts - Array of non-empty strings. Must not be empty.
   */
  embedBatch(texts: string[]): Promise<Float32Array[]>;

  /**
   * Embedding dimension (number of float32 values per vector).
   * source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
   *   hidden_size = 384 for all-MiniLM-L6-v2
   */
  readonly dim: number;

  /**
   * Model identifier string.  Used for logging and cache-path construction.
   * Example: "Xenova/all-MiniLM-L6-v2"
   * source: https://huggingface.co/Xenova/all-MiniLM-L6-v2
   */
  readonly modelId: string;
}
