/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Cross-encoder reranking via FlashRank ONNX.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py
 *
 * FlashRank (ms-marco-MiniLM-L-12-v2) provides fast cross-encoder reranking.
 * Validated through LongMemEval and LoCoMo where it improves MRR by 5-15%.
 *
 * CE reranking with alpha blending of first-stage and CE scores is standard
 * IR practice — linear interpolation of retrieval and CE scores is the common
 * approach in multi-stage retrieval (Nogueira & Cho, 2019).
 *
 * Adaptive alpha (EXPERIMENTAL — disabled by default):
 *   Attempted per-query alpha based on CE score spread (QPP, Shtok et al.,
 *   TOIS 2012). Results: BEAM -0.002, LME +0.003, LoCoMo -3.8pp MRR.
 *   Kept as opt-in (adaptive=true) for future experimentation.
 *
 * Sufficient Context gate (Joren et al., ICLR 2025):
 *   Binary threshold gate: if max CE score falls below gate_threshold,
 *   all scores are suppressed by a fixed multiplier.
 *
 * ENGINEERING DEFAULTS (not paper-prescribed):
 *   - alpha=0.70: BEAM ablation (0.30→0.511, 0.50→0.529, 0.55→0.535, 0.70→0.542)
 *     source: cortex@ed33435 mcp_server/core/reranker.py:43-46
 *   - gate_threshold=0.15: source: cortex@ed33435 mcp_server/core/reranker.py:47
 *   - suppression=0.1: source: cortex@ed33435 mcp_server/core/reranker.py:48
 *
 * Implementation note — onnxruntime version:
 *   @xenova/transformers@2.17.2 bundles onnxruntime-node@1.14.0, which produces
 *   wrong logits for the FlashRank INT8 quantized ONNX model (verified 2026-05-06:
 *   diff ~0.14 on pair 4 vs Python). onnxruntime-node@1.25.1 produces identical
 *   results to Python ort@1.24.4 (diff < 1e-7 on 5 pairs). The reranker
 *   therefore loads onnxruntime-node DIRECTLY (not via @xenova/transformers),
 *   and uses @xenova/transformers ONLY for tokenization (tokenizer is correct in
 *   both versions — same token IDs verified). The FlashRank model file is loaded
 *   from its standard cache dir (same path Python uses).
 *   source: benchmark 2026-05-06 /tmp/ts_ort125_test.mjs — all 5 pairs < 1e-7 diff
 *
 * Pure business logic -- lazy-loaded singleton, no persistent I/O.
 */

import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Platt calibration interface ───────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/platt_calibration.py

interface PlattParams {
  A: number;
  B: number;
  nSamples: number;
}

/**
 * Apply Platt sigmoid calibration to a raw CE score.
 * P(useful | raw_score) = 1 / (1 + exp(A * raw_score + B))
 * source: cortex@ed33435 mcp_server/core/platt_calibration.py
 */
function calibrateScore(
  rawScore: number,
  params: PlattParams | null,
): number {
  if (params === null) return rawScore;
  const x = params.A * rawScore + params.B;
  // Numerically stable sigmoid
  if (x >= 0) {
    const ex = Math.exp(-x);
    return 1.0 / (1.0 + ex);
  }
  const ex = Math.exp(x);
  return ex / (1.0 + ex);
}

// ── Retrieval confidence gate ─────────────────────────────────────────────

/**
 * Compute confidence that retrieval found relevant results.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:66-87
 *
 * Binary threshold gate: if max CE score >= threshold, results are
 * considered sufficient (confidence=1.0). Otherwise, all scores are
 * suppressed by a fixed multiplier.
 *
 * Constants — source: cortex@ed33435 mcp_server/core/reranker.py:83-86
 *   gate_threshold = 0.15
 *   suppression    = 0.1
 */
function computeRetrievalConfidence(
  ceScores: number[],
  gateThreshold = 0.15, // source: cortex@ed33435 mcp_server/core/reranker.py:83
  suppression = 0.1,    // source: cortex@ed33435 mcp_server/core/reranker.py:84
): number {
  if (ceScores.length === 0) return suppression;
  const maxCe = Math.max(...ceScores);
  if (maxCe >= gateThreshold) return 1.0;
  return suppression;
}

// ── Adaptive alpha ────────────────────────────────────────────────────────

/**
 * Compute per-query alpha from CE score distribution.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:90-129
 *
 * Constants — source: cortex@ed33435 mcp_server/core/reranker.py:124-127
 *   max_boost  = 0.15
 *   spread_low = 0.3   (below this → keep base_alpha)
 *   spread_denom = 0.7 (for linear normalization above 0.3)
 */
function computeAdaptiveAlpha(
  ceScores: number[],
  baseAlpha: number,
): number {
  if (ceScores.length < 2) return baseAlpha;

  const spread = Math.max(...ceScores) - Math.min(...ceScores);
  // source: cortex@ed33435 mcp_server/core/reranker.py:123
  const MAX_BOOST = 0.15;
  if (spread < 0.3) return baseAlpha; // source: cortex@ed33435 mcp_server/core/reranker.py:124
  // Linear boost above spread=0.3, capped at max_boost
  // source: cortex@ed33435 mcp_server/core/reranker.py:126-128
  const normalized = Math.min((spread - 0.3) / 0.7, 1.0);
  return Math.min(baseAlpha + MAX_BOOST * normalized, 1.0);
}

// ── Score blending ────────────────────────────────────────────────────────

/**
 * Blend WRRF scores with cross-encoder scores, scaled by confidence.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:132-160
 *
 * precondition: candidates and ceScores are aligned by index
 * postcondition: result is sorted descending by blended score;
 *   confidence (1.0 or suppression) is applied uniformly
 */
function blendScores(
  candidates: Array<[number, number]>,
  ceScores: Map<number, number>,
  alpha: number,
  adaptive = true,
  applyPlatt = false,
  plattParams: PlattParams | null = null,
): Array<[number, number]> {
  const rawCeList = Array.from({ length: candidates.length }, (_, i) =>
    ceScores.get(i) ?? 0.0,
  );
  const confidence = computeRetrievalConfidence(rawCeList);

  // Per-query adaptive alpha based on CE score distribution
  // source: cortex@ed33435 mcp_server/core/reranker.py:148
  const effectiveAlpha = adaptive
    ? computeAdaptiveAlpha(rawCeList, alpha)
    : alpha;

  const params = applyPlatt ? plattParams : null;

  const reranked: Array<[number, number]> = candidates.map(
    ([memId, wrrfScore], i) => {
      const ce = ceScores.get(i) ?? 0.0;
      const ceForBlend = calibrateScore(ce, params);
      const blended =
        (1 - effectiveAlpha) * wrrfScore + effectiveAlpha * ceForBlend;
      return [memId, blended * confidence];
    },
  );
  reranked.sort(([, a], [, b]) => b - a);
  return reranked;
}

// ── FlashRank ONNX via onnxruntime-node (direct) ──────────────────────────
//
// Root cause of previous null-return bug (2026-05-06):
//
//   The previous implementation used @xenova/transformers text-classification
//   pipeline with { text, text_pair } object inputs. This failed for two
//   independent reasons:
//
//   (1) PIPELINE-DIFF: The TextClassificationPipeline in @xenova/transformers
//   v2 passes its inputs argument directly to this.tokenizer(inputs), which
//   expects strings, not { text, text_pair } objects. This caused
//   "text.split is not a function" error → silent null return.
//
//   (2) MODEL-DIFF: @xenova/transformers@2.17.2 bundles onnxruntime-node@1.14.0,
//   which produces wrong logits for the FlashRank INT8 quantized ONNX model.
//   Verified 2026-05-06: pair 4 gives 0.259 (Node 1.14.0) vs 0.399 (Python
//   ort@1.24.4). onnxruntime-node@1.25.1 gives 0.399 (diff < 1e-7).
//   source: benchmark /tmp/ts_ort125_test.mjs, 2026-05-06
//
// Fix: Load onnxruntime-node directly. Use @xenova/transformers for tokenization
// only (tokenizer produces identical token IDs to Python's flashrank Tokenizer —
// verified 2026-05-06 for all 5 pairs). Load the FlashRank model file from the
// standard flashrank cache dir (same path Python's flashrank.Ranker uses).
//
// source: cortex@ed33435 mcp_server/core/reranker.py:50-63 — flashrank.Ranker singleton
// source: flashrank.Config.default_cache_dir = /tmp (flashrank.Config module)
// source: Nogueira & Cho (2019) "Passage Re-ranking with BERT" — CE rerank pattern

/**
 * FlashRank model cache directory.
 *
 * Resolution order (Lamport invariant: the directory returned is always an
 * absolute, platform-legal path writable by the current user):
 *   1. FLASHRANK_CACHE_DIR env var — explicit override for CI / non-default installs.
 *   2. os.tmpdir() — the OS-provided temporary directory; resolves to
 *      %TEMP% on Windows, /tmp on POSIX. This mirrors Python flashrank's
 *      behaviour: flashrank.Config.default_cache_dir = tempfile.gettempdir().
 *
 * source: flashrank.Config module — default_cache_dir = tempfile.gettempdir()
 * source: Python docs — tempfile.gettempdir() → os.tmpdir() equivalent
 */
const FLASHRANK_CACHE_DIR = process.env["FLASHRANK_CACHE_DIR"] ?? tmpdir();
/** FlashRank model name. Mirrors Python: Ranker(model_name="ms-marco-MiniLM-L-12-v2") */
const FLASHRANK_MODEL_NAME = "ms-marco-MiniLM-L-12-v2";
/** ONNX quantized model file inside the model dir. source: flashrank.Config.model_file_map */
const FLASHRANK_ONNX_FILE = "flashrank-MiniLM-L-12-v2_Q.onnx";
/** Xenova model ID for tokenizer (same vocab as FlashRank model). */
const XENOVA_TOKENIZER_MODEL_ID = "Xenova/ms-marco-MiniLM-L-12-v2";

// Typed stubs for onnxruntime-node (no @types/onnxruntime-node in devDeps)
interface OrtTensor {
  data: Float32Array | Int32Array | BigInt64Array;
}
interface OrtSession {
  run(feeds: Record<string, OrtTensorInstance>): Promise<Record<string, OrtTensor>>;
  inputNames: string[];
}
interface OrtTensorConstructor {
  new (type: string, data: BigInt64Array, dims: number[]): OrtTensorInstance;
}
interface OrtTensorInstance {
  data: BigInt64Array;
}
interface OrtModule {
  InferenceSession: { create(path: string): Promise<OrtSession> };
  Tensor: OrtTensorConstructor;
}

// Tokenizer interface from @xenova/transformers
interface XenovaTokenizerOutput {
  input_ids: number[] | ArrayLike<number>;
  attention_mask: number[] | ArrayLike<number>;
  token_type_ids?: number[] | ArrayLike<number>;
}
interface XenovaTokenizer {
  (text: string, opts: {
    text_pair: string;
    padding: boolean;
    truncation: boolean;
    return_tensor: boolean;
  }): XenovaTokenizerOutput;
}

// Cached singletons
let _ortSession: OrtSession | null = null;
let _ortModule: OrtModule | null = null;
let _tokenizer: XenovaTokenizer | null = null;
let _rerankerFailed = false;

async function ensureReranker(): Promise<{ session: OrtSession; tokenizer: XenovaTokenizer; ort: OrtModule } | null> {
  if (_ortSession !== null && _tokenizer !== null && _ortModule !== null) {
    return { session: _ortSession, tokenizer: _tokenizer, ort: _ortModule };
  }
  if (_rerankerFailed) return null;
  try {
    const modelPath = join(FLASHRANK_CACHE_DIR, FLASHRANK_MODEL_NAME, FLASHRANK_ONNX_FILE);
    if (!existsSync(modelPath)) {
      // Model not downloaded — mirror Python's flashrank graceful fallback.
      // source: cortex@ed33435 mcp_server/core/reranker.py:60-63
      _rerankerFailed = true;
      return null;
    }

    // Dynamic import of onnxruntime-node (heavy binary).
    // Must be ≥1.21 to correctly run INT8 quantized FlashRank model.
    // source: benchmark 2026-05-06 showing ort@1.14.0 produces wrong logits.
    const ortMod = (await import("onnxruntime-node")) as unknown as { default: OrtModule };
    const ort = ortMod.default;

    const session = await ort.InferenceSession.create(modelPath);

    // Tokenizer from @xenova/transformers — tokenizer.json is identical to
    // FlashRank's bundled tokenizer.json (same HuggingFace checkpoint).
    const transformersMod = (await import("@xenova/transformers")) as unknown as {
      AutoTokenizer: { from_pretrained(id: string): Promise<XenovaTokenizer> };
    };
    const tokenizer = await transformersMod.AutoTokenizer.from_pretrained(XENOVA_TOKENIZER_MODEL_ID);

    _ortSession = session;
    _tokenizer = tokenizer;
    _ortModule = ort;
    return { session, tokenizer, ort };
  } catch {
    _rerankerFailed = true;
    return null;
  }
}

/** Test/bench hook: clear the cached pipeline. */
export function _resetRerankerCache(): void {
  _ortSession = null;
  _tokenizer = null;
  _ortModule = null;
  _rerankerFailed = false;
}

/**
 * Score a batch of (query, passage) pairs using the FlashRank ONNX model.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:219-243 (encode_batch path)
 *
 * Tokenization: Xenova tokenizer with text_pair option (equivalent to
 * FlashRank's tokenizer.encode_batch([[query, passage], ...]) invocation).
 * Logit→score: sigmoid (1 / (1 + exp(-logit))).
 * source: flashrank.Ranker._call — logits.shape[1] == 1 → sigmoid branch
 */
async function scorePairs(
  { session, tokenizer, ort }: { session: OrtSession; tokenizer: XenovaTokenizer; ort: OrtModule },
  query: string,
  passages: string[],
): Promise<number[]> {
  const scores: number[] = [];
  for (const passage of passages) {
    // Tokenize without padding (variable-length sequences, one at a time).
    // FlashRank uses encode_batch without forced padding to max_length —
    // it lets the ONNX runtime handle variable-length inputs.
    const enc = tokenizer(query, {
      text_pair: passage,
      padding: false,
      truncation: true,
      return_tensor: false,
    });

    const rawIds = Array.isArray(enc.input_ids) ? enc.input_ids : Array.from(enc.input_ids as ArrayLike<number>);
    const rawMask = Array.isArray(enc.attention_mask) ? enc.attention_mask : Array.from(enc.attention_mask as ArrayLike<number>);
    const rawTypeIds = enc.token_type_ids
      ? (Array.isArray(enc.token_type_ids) ? enc.token_type_ids : Array.from(enc.token_type_ids as ArrayLike<number>))
      : new Array(rawIds.length).fill(0);

    const seqLen = rawIds.length;

    const feeds: Record<string, OrtTensorInstance> = {
      // source: flashrank.Ranker.rerank — onnx_input keys: input_ids, attention_mask, token_type_ids
      input_ids: new ort.Tensor("int64", BigInt64Array.from(rawIds.map((x: number) => BigInt(x))), [1, seqLen]),
      attention_mask: new ort.Tensor("int64", BigInt64Array.from(rawMask.map((x: number) => BigInt(x))), [1, seqLen]),
      token_type_ids: new ort.Tensor("int64", BigInt64Array.from(rawTypeIds.map((x: number) => BigInt(x))), [1, seqLen]),
    };

    const result = await session.run(feeds);
    const logit = Number(result["logits"]?.data[0] ?? 0);
    // source: flashrank.Ranker.rerank — sigmoid for single-logit output
    scores.push(1 / (1 + Math.exp(-logit)));
  }
  return scores;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Rerank candidates using FlashRank cross-encoder.
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:164-207
 *
 * precondition: candidates is a ranked list of (memory_id, wrrf_score)
 * postcondition: returns list of same or fewer length, sorted by blended score;
 *   returns input unchanged when the cross-encoder is unavailable (graceful degradation)
 *
 * Constants — source: cortex@ed33435 mcp_server/core/reranker.py:167-172
 *   alpha         = 0.70 (BEAM ablation optimum)
 *   max_content_len = 1200
 *   adaptive      = false (disabled by default pending ablation validation)
 *   apply_platt   = false (disabled by default until benchmark re-validation)
 */
export async function rerankResults(
  query: string,
  candidates: Array<[number, number]>,
  contentLookup: Record<number, string>,
  alpha = 0.70,           // source: cortex@ed33435 mcp_server/core/reranker.py:168
  maxContentLen = 1200,   // source: cortex@ed33435 mcp_server/core/reranker.py:169 — max_content_len
  adaptive = false,       // source: cortex@ed33435 mcp_server/core/reranker.py:170
  applyPlatt = false,     // source: cortex@ed33435 mcp_server/core/reranker.py:171
): Promise<Array<[number, number]>> {
  if (candidates.length === 0) return candidates;
  const ctx = await ensureReranker();
  if (ctx === null) return candidates; // Python's flashrank-unavailable fallback
  try {
    const passages = candidates.map(
      ([mid]) => (contentLookup[mid] ?? "").slice(0, maxContentLen),
    );
    const ceScores = await scorePairs(ctx, query, passages);
    const ceMap = new Map<number, number>();
    ceScores.forEach((s, i) => ceMap.set(i, s));
    return blendScores(candidates, ceMap, alpha, adaptive, applyPlatt, null);
  } catch {
    // Per-call failure (ONNX runtime error, OOM, etc.) — mirror Python's
    // try/except fallback to first-stage ranking.
    // source: cortex@ed33435 mcp_server/core/reranker.py:201-202
    return candidates;
  }
}

/**
 * Return a single raw FlashRank CE score for (query, content).
 *
 * Port of: cortex@ed33435 mcp_server/core/reranker.py:209-226
 *
 * Returns null if the cross-encoder is unavailable or encoding fails.
 */
export async function getRawCeScore(
  query: string,
  content: string,
  maxContentLen = 1200, // source: cortex@ed33435 mcp_server/core/reranker.py:221
): Promise<number | null> {
  if (!query || !content) return null;
  const ctx = await ensureReranker();
  if (ctx === null) return null;
  try {
    const scores = await scorePairs(ctx, query, [content.slice(0, maxContentLen)]);
    return scores.length > 0 ? (scores[0] ?? null) : null;
  } catch {
    return null;
  }
}

export type { PlattParams };
