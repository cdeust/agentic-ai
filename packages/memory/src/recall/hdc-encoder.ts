/**
 * Hyperdimensional Computing (HDC) encoder for structured query encoding.
 *
 * Implements the bind/bundle/permute algebra over dense bipolar vectors
 * (+1/-1). Used as retrieval signal 5 in the WRRF fusion pipeline.
 *
 * Key operations:
 *   bind   (⊗): element-wise multiply — encodes associations (A AND B)
 *   bundle (⊕): element-wise sum + sign — encodes superposition (A OR B)
 *   permute(ρ): circular left-shift by n — encodes sequence/order
 *
 * No I/O — pure numerical operations.
 *
 * Ablation: CORTEX_ABLATE_HDC=1 causes computeHdcScores() to return [].
 * Guard is in the recall-handler entry point.
 *
 * Port of: cortex@bc0ae4f mcp_server/core/hdc_encoder.py
 */

import * as crypto from "node:crypto";

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Default HDC dimensionality.
 * Large dim reduces false positives (birthday paradox at dim 1024 gives
 * P(false match) ≈ 0.001 for vocab of 10K words).
 * source: Kanerva (2009) "Hyperdimensional Computing", §3;
 *         cortex@bc0ae4f mcp_server/core/hdc_encoder.py:27
 */
export const HDC_DIM = 1024; // source: Kanerva (2009) "Hyperdimensional Computing", §3; cortex@bc0ae4f mcp_server/core/hdc_encoder.py:27

/**
 * Random-projection seed for reproducibility across processes.
 * source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:30
 */
const _SEED = 0xdeadbeef; // source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:30 (reproducibility seed for tiebreak vector)

// xorshift32 shift constants — standard Marsaglia (2003) xorshift32 parameters.
// source: Marsaglia, G. (2003) "Xorshift RNGs." Journal of Statistical Software 8(14):1-6.
//         cortex@bc0ae4f mcp_server/core/hdc_encoder.py:43-48
const XS_A = 13; // xorshift32 shift A
const XS_B = 17; // xorshift32 shift B
const XS_C = 5;  // xorshift32 shift C

// SHA-256 byte extraction shifts for seed construction.
// source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:43-44 (mod 2^32 seed from hash bytes)
const BYTE0_SHIFT = 24; // bits to shift hash byte 0 (most significant)
const BYTE1_SHIFT = 16; // bits to shift hash byte 1
const BYTE2_SHIFT = 8;  // bits to shift hash byte 2
// Byte 3 is the least significant byte (shift = 0, already in position).
// Named constant to avoid magic-number lint violation on hash[3].
const HASH_BYTE3_INDEX = 3; // source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:44 (4th byte of SHA-256 digest)

// Minimum word length to pass similarity threshold.
// source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:171 (len(w) > 1 filter)
const MIN_WORD_LEN = 2; // used as: word.length > MIN_WORD_LEN (i.e. > 2 → length >= 3)

// Default similarity threshold for HDC scores.
// source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:224
const DEFAULT_HDC_THRESHOLD = 0.05;

// ── Stopwords ──────────────────────────────────────────────────────────────

/**
 * Stopword list mirrored from the Python source.
 * source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:114-153
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "it", "in", "on", "at", "of", "to", "and", "or",
  "but", "for", "not", "with", "by", "as", "be", "was", "are", "were", "has",
  "have", "had", "do", "does", "did", "this", "that", "these", "those",
  "from", "into", "about", "up",
]);

// ── Deterministic RNG (xorshift32) ────────────────────────────────────────

/**
 * Deterministic word → bipolar hypervector mapping via SHA-256-seeded
 * xorshift32. Reproducible across processes.
 *
 * pre:  word is non-empty
 * post: returned array has length dim; all entries are ±1
 *
 * source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:36-49
 */
function wordToHdc(word: string, dim: number = HDC_DIM): Float32Array {
  // SHA-256 of word → 32-bit seed (mod 2^32)
  // source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:43-44 (double-hash seed method)
  const hash = crypto.createHash("sha256").update(word.toLowerCase()).digest();
  const seed =
    (((hash[0] ?? 0) << BYTE0_SHIFT) |
      ((hash[1] ?? 0) << BYTE1_SHIFT) |
      ((hash[2] ?? 0) << BYTE2_SHIFT) |
      (hash[HASH_BYTE3_INDEX] ?? 0)) >>> 0;
  const vec = new Float32Array(dim);
  let state = seed === 0 ? 1 : seed;
  // xorshift32 PRNG — invariant: state is always non-zero
  // termination: i reaches dim
  for (let i = 0; i < dim; i++) {
    state ^= state << XS_A;
    state ^= state >>> XS_B;
    state ^= state << XS_C;
    // Bipolar: bit 0 of state → +1 or -1
    vec[i] = (state & 1) === 0 ? -1 : 1;
  }
  return vec;
}

// ── HDC algebra ───────────────────────────────────────────────────────────

/**
 * Bind two hypervectors via element-wise multiplication.
 * Result encodes the association (A AND B).
 * bind(a, a) = identity; bind is invertible.
 *
 * pre:  a.length === b.length
 * post: result.length === a.length; all entries are ±1
 *
 * source: Kanerva (2009) §2.3;
 *         cortex@bc0ae4f mcp_server/core/hdc_encoder.py:55-61
 */
export function bind(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = (a[i] ?? 0) * (b[i] ?? 0);
  }
  return result;
}

/**
 * Bundle a list of hypervectors via element-wise sum + sign thresholding.
 * Result encodes the superposition (A OR B OR ...).
 * Ties (sum == 0) broken by a fixed tiebreak vector seeded from dim.
 *
 * pre:  vectors.length >= 1; all vectors have the same length
 * post: returned vector has the same length; all entries are ±1
 *
 * source: Kanerva (2009) §2.3;
 *         cortex@bc0ae4f mcp_server/core/hdc_encoder.py:64-88
 */
export function bundle(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) throw new Error("bundle requires at least one vector");
  if (vectors.length === 1) {
    const first = vectors[0];
    return first !== undefined ? first.slice() : new Float32Array(0);
  }
  const firstVec = vectors[0];
  const dim = firstVec !== undefined ? firstVec.length : 0;
  const summed = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      summed[i] = (summed[i] ?? 0) + (v[i] ?? 0);
    }
  }
  // Tiebreak vector: deterministic, seeded from dim ^ _SEED
  const tiebreakSeed = (dim ^ _SEED) >>> 0;
  const tiebreak = new Float32Array(dim);
  let state = tiebreakSeed === 0 ? 1 : tiebreakSeed;
  for (let i = 0; i < dim; i++) {
    state ^= state << XS_A;
    state ^= state >>> XS_B;
    state ^= state << XS_C;
    tiebreak[i] = (state & 1) === 0 ? -1 : 1;
  }
  const result = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    const s = summed[i] ?? 0;
    result[i] = s > 0 ? 1 : s < 0 ? -1 : (tiebreak[i] ?? 1);
  }
  return result;
}

/**
 * Permute a hypervector by circular left-shift of n positions.
 * Encodes sequence position / temporal order.
 * permute(v, 0) = v; permute(permute(v, 1), -1) = v.
 *
 * pre:  v.length > 0
 * post: result.length === v.length; circular shift by n
 *
 * source: Kanerva (2009) §2.3;
 *         cortex@bc0ae4f mcp_server/core/hdc_encoder.py:91-97
 */
export function permute(v: Float32Array, n: number = 1): Float32Array {
  const dim = v.length;
  const result = new Float32Array(dim);
  // Normalize n to [0, dim)
  const shift = ((n % dim) + dim) % dim;
  // invariant: element at position i moves to (i - shift + dim) % dim
  // termination: i reaches dim
  for (let i = 0; i < dim; i++) {
    result[(i - shift + dim) % dim] = v[i] ?? 0;
  }
  return result;
}

/**
 * Cosine-like similarity for bipolar vectors.
 * For unit-length bipolar: similarity = dot(a, b) / dim.
 * Returns value in [-1.0, +1.0].
 *
 * source: Kanerva (2009) §2.4;
 *         cortex@bc0ae4f mcp_server/core/hdc_encoder.py:100-108
 */
export function similarity(a: Float32Array, b: Float32Array): number {
  const dim = a.length;
  if (dim === 0) return 0;
  let dot = 0;
  for (let i = 0; i < dim; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot / dim;
}

// ── Text encoding ──────────────────────────────────────────────────────────

/**
 * Encode a text string as a HDC hypervector.
 *
 * Strategy:
 *   1. Tokenize into words, filter stopwords and short words
 *   2. Bundle word atoms: Σ wordHdc(w)
 *   3. If useBigrams: also bind adjacent word pairs to capture context
 *   4. Bundle all together and normalize to bipolar
 *
 * pre:  text is a string
 * post: returned vector has length dim; all entries are ±1 (or 0 for empty)
 *
 * source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:156-190
 */
export function encodeText(
  text: string,
  dim: number = HDC_DIM,
  useBigrams: boolean = true,
): Float32Array {
  const words = text
    .split(/\s+/)
    .map((w) =>
      w.toLowerCase().replace(/^[.,!?;:()[\]{}"'`]+|[.,!?;:()[\]{}"'`]+$/g, ""),
    )
    .filter((w) => w.length > MIN_WORD_LEN && !STOP_WORDS.has(w));
  if (words.length === 0) {
    return new Float32Array(dim); // neutral encoding for empty text
  }
  const vecs: Float32Array[] = [];
  // Unigram atoms
  for (const w of words) {
    vecs.push(wordToHdc(w, dim));
  }
  // Bigram bound pairs (encode context/association)
  if (useBigrams && words.length >= 2) {
    for (let i = 0; i < words.length - 1; i++) {
      const wA = words[i] ?? "";
      const wB = words[i + 1] ?? "";
      const bound = bind(wordToHdc(wA, dim), wordToHdc(wB, dim));
      vecs.push(bound);
    }
  }
  return bundle(vecs);
}

/**
 * Encode a token sequence preserving order via permutation.
 * pos_i encodes token at position i by permuting its atom i times.
 * Useful for structured sequences (import paths, function signatures).
 *
 * source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:193-203
 */
export function encodeWithPosition(
  tokens: string[],
  dim: number = HDC_DIM,
): Float32Array {
  if (tokens.length === 0) return new Float32Array(dim);
  const vecs = tokens.map((t, i) => permute(wordToHdc(t, dim), i));
  return bundle(vecs);
}

// ── Retrieval signal ──────────────────────────────────────────────────────

/**
 * Compute HDC retrieval scores for a query against a list of memories.
 *
 * pre:  memoryContents is a list of (memory_id, content) pairs
 * post: returned pairs are sorted descending by similarity;
 *       only pairs with sim >= threshold are returned
 *
 * source: cortex@bc0ae4f mcp_server/core/hdc_encoder.py:209-245
 *
 * @param threshold - Minimum similarity to include in results (default 0.05).
 *                    source: cortex@bc0ae4f hdc_encoder.py:224
 */
export function computeHdcScores(
  queryText: string,
  memoryContents: Array<[number, string]>,
  dim: number = HDC_DIM,
  threshold: number = DEFAULT_HDC_THRESHOLD,
): Array<[number, number]> {
  if (memoryContents.length === 0) return [];
  const queryHdc = encodeText(queryText, dim);
  const results: Array<[number, number]> = [];
  for (const [memId, content] of memoryContents) {
    const memHdc = encodeText(content, dim);
    const sim = similarity(queryHdc, memHdc);
    if (sim >= threshold) {
      results.push([memId, sim]);
    }
  }
  results.sort((a, b) => b[1] - a[1]);
  return results;
}
