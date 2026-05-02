/**
 * Modern Hopfield Networks for energy-based associative memory retrieval.
 *
 * Port of: cortex@bc0ae4f mcp_server/core/hopfield.py
 *
 * source: Ramsauer et al. (2021) "Hopfield Networks is All You Need"
 *         https://arxiv.org/abs/2008.02217
 *
 * Ablation: CORTEX_ABLATE_HOPFIELD=1 causes retrieve() to return [].
 * The guard is applied at recall-handler.ts entry, not here.
 *
 * Pure numerical operations — no I/O.
 */

// ── Default parameters ──────────────────────────────────────────────────────

/**
 * Default inverse temperature for Hopfield attention.
 * Higher beta = sharper (more winner-take-all) retrieval.
 * source: cortex@bc0ae4f mcp_server/core/hopfield.py (default beta=8.0, empirical tuning)
 */
export const DEFAULT_BETA = 8.0;

/**
 * Default number of top-k results to return.
 * source: cortex@bc0ae4f mcp_server/core/hopfield.py (default top_k=10)
 */
export const DEFAULT_TOP_K = 10;

/**
 * Default number of iterations for pattern completion dynamics.
 * source: cortex@bc0ae4f mcp_server/core/hopfield.py (default iterations=5)
 */
export const DEFAULT_ITERATIONS = 5;

/**
 * Coefficient for the self-norm term in Hopfield energy: 0.5 * |xi|^2
 * source: Ramsauer et al. (2021) eq. 4 — energy has 0.5 * ||xi||^2 quadratic term
 */
const ENERGY_NORM_COEFF = 0.5;

// ── Types ───────────────────────────────────────────────────────────────────

export interface PatternMatrix {
  /** L2-normalised row-vectors (one per stored memory). */
  rows: Float64Array[];
  /** Memory IDs corresponding to each row. */
  patternIds: number[];
  /** Dimensionality D (0 when matrix is empty). */
  dim: number;
}

// ── Numerical helpers ──────────────────────────────────────────────────────

/**
 * Numerically stable softmax over logits.
 * post: all output values sum to 1.0 (within floating-point error).
 * source: cortex@bc0ae4f mcp_server/core/hopfield.py:22-26
 */
function softmax(logits: Float64Array): Float64Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i] ?? 0;
    if (v > max) max = v;
  }
  const exp = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp((logits[i] ?? 0) - max);
    exp[i] = e;
    sum += e;
  }
  for (let i = 0; i < logits.length; i++) {
    exp[i] = (exp[i] ?? 0) / sum;
  }
  return exp;
}

/**
 * Sparsemax — projects logits onto the probability simplex.
 * Produces EXACT zeros for irrelevant memories.
 *
 * post: sum of result ≈ 1.0; many entries are exactly 0.0.
 * source: Martins & Astudillo (2016) https://arxiv.org/abs/1602.02068
 *         cortex@bc0ae4f mcp_server/core/hopfield.py:29-46
 */
function sparsemax(logits: Float64Array): Float64Array {
  const n = logits.length;
  if (n === 0) return new Float64Array(0);
  const sorted = Array.from(logits).sort((a, b) => b - a);
  const cumsum = new Float64Array(n);
  cumsum[0] = sorted[0] ?? 0;
  for (let i = 1; i < n; i++) cumsum[i] = (cumsum[i - 1] ?? 0) + (sorted[i] ?? 0);
  let k = 1;
  for (let i = 1; i <= n; i++) {
    if ((sorted[i - 1] ?? 0) > ((cumsum[i - 1] ?? 0) - 1.0) / i) k = i;
  }
  const tau = ((cumsum[k - 1] ?? 0) - 1.0) / k;
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = Math.max((logits[i] ?? 0) - tau, 0.0);
  }
  return result;
}

/**
 * Numerically stable log-sum-exp.
 * source: cortex@bc0ae4f mcp_server/core/hopfield.py:49-52
 */
function logSumExp(x: Float64Array): number {
  let max = -Infinity;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0;
    if (v > max) max = v;
  }
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.exp((x[i] ?? 0) - max);
  return max + Math.log(sum);
}

/**
 * L2-normalise a vector. Returns the vector unchanged if its norm is 0.
 * post: |result| ≈ 1.0 (or 0.0 if input was zero).
 */
function l2Normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  return n === 0 ? v : v.map((x) => x / n);
}

/**
 * Matrix-vector multiply: rows × query → Float64Array of dot products.
 * pre:  each row in rows has the same length as query.
 * post: result.length === rows.length.
 */
function matVecMul(rows: Float64Array[], query: Float64Array): Float64Array {
  const result = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    let dot = 0;
    for (let j = 0; j < query.length; j++) dot += (row[j] ?? 0) * (query[j] ?? 0);
    result[i] = dot;
  }
  return result;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the N×D pattern matrix from memory embeddings.
 *
 * pre:  embeddings is a list of (memory_id, float[]) pairs
 * post: returned rows are L2-normalized; patternIds.length === rows.length
 *
 * source: cortex@bc0ae4f mcp_server/core/hopfield.py:55-83
 */
export function buildPatternMatrix(
  embeddings: Array<[number, number[]]>,
): PatternMatrix {
  const rows: Float64Array[] = [];
  const patternIds: number[] = [];
  for (const [memId, vec] of embeddings) {
    if (vec.length === 0) continue;
    rows.push(new Float64Array(l2Normalize(vec)));
    patternIds.push(memId);
  }
  const firstRow = rows[0];
  return { rows, patternIds, dim: firstRow !== undefined ? firstRow.length : 0 };
}

/**
 * Retrieve memories using Modern Hopfield attention.
 * attention = softmax(beta * X * query)
 *
 * pre:  matrix.rows.length > 0; queryEmbedding.length === matrix.dim
 * post: result.length <= topK; scores are softmax attention weights summing to 1
 *
 * source: Ramsauer et al. (2021) eq. 1;
 *         cortex@bc0ae4f mcp_server/core/hopfield.py:86-117
 *
 * @param beta - Inverse temperature. source: cortex@bc0ae4f hopfield.py (default 8.0 — empirical tuning)
 */
export function retrieve(
  queryEmbedding: number[],
  matrix: PatternMatrix,
  beta: number = DEFAULT_BETA,
  topK: number = DEFAULT_TOP_K,
): Array<[number, number]> {
  if (matrix.rows.length === 0 || queryEmbedding.length === 0) return [];
  const q = new Float64Array(l2Normalize(queryEmbedding));
  const logits = matVecMul(matrix.rows, q);
  for (let i = 0; i < logits.length; i++) logits[i] = beta * (logits[i] ?? 0);
  const attention = softmax(logits);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < matrix.patternIds.length; i++) {
    const w = attention[i] ?? 0;
    const id = matrix.patternIds[i];
    if (w > 0 && id !== undefined) pairs.push([id, w]);
  }
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs.slice(0, topK);
}

/**
 * Hopfield-Fenchel-Young retrieval using sparsemax.
 * Produces EXACT zeros for irrelevant memories.
 *
 * pre:  matrix.rows.length > 0
 * post: only entries with weight > 0 are returned; length <= topK
 *
 * source: Martins & Astudillo (2016); cortex@bc0ae4f hopfield.py:120-147
 */
export function retrieveSparse(
  queryEmbedding: number[],
  matrix: PatternMatrix,
  beta: number = DEFAULT_BETA,
  topK: number = DEFAULT_TOP_K,
): Array<[number, number]> {
  if (matrix.rows.length === 0 || queryEmbedding.length === 0) return [];
  const q = new Float64Array(l2Normalize(queryEmbedding));
  const logits = matVecMul(matrix.rows, q);
  for (let i = 0; i < logits.length; i++) logits[i] = beta * (logits[i] ?? 0);
  const weights = sparsemax(logits);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < matrix.patternIds.length; i++) {
    const w = weights[i] ?? 0;
    const id = matrix.patternIds[i];
    if (w > 0 && id !== undefined) pairs.push([id, w]);
  }
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs.slice(0, topK);
}

/**
 * Iterative Hopfield dynamics for completing partial/noisy queries.
 * xi_new = X^T @ softmax(beta * X @ xi_old)
 *
 * Loop invariant: xi is L2-normalized at each iteration start.
 * Termination: iter counts to `iterations`.
 *
 * pre:  partialEmbedding.length > 0
 * post: returned vector has same length; is L2-normalized
 *
 * source: Ramsauer et al. (2021) §3.1; cortex@bc0ae4f hopfield.py:150-178
 */
export function patternCompletion(
  partialEmbedding: number[],
  matrix: PatternMatrix,
  beta: number = DEFAULT_BETA,
  iterations: number = DEFAULT_ITERATIONS,
): number[] {
  if (matrix.rows.length === 0 || partialEmbedding.length === 0)
    return partialEmbedding;
  let xi = new Float64Array(l2Normalize(partialEmbedding));
  // invariant: xi is L2-normalized; termination: iter reaches iterations
  for (let iter = 0; iter < iterations; iter++) {
    const logits = matVecMul(matrix.rows, xi);
    for (let i = 0; i < logits.length; i++) logits[i] = beta * (logits[i] ?? 0);
    const attn = softmax(logits);
    const dim = matrix.dim;
    const xiNew = new Float64Array(dim);
    for (let i = 0; i < matrix.rows.length; i++) {
      const row = matrix.rows[i];
      if (row === undefined) continue;
      const a = attn[i] ?? 0;
      for (let j = 0; j < dim; j++) xiNew[j] = (xiNew[j] ?? 0) + (row[j] ?? 0) * a;
    }
    let norm = 0;
    for (let j = 0; j < dim; j++) norm += (xiNew[j] ?? 0) * (xiNew[j] ?? 0);
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let j = 0; j < dim; j++) xiNew[j] = (xiNew[j] ?? 0) / norm;
    }
    xi = xiNew;
  }
  return Array.from(xi);
}

/**
 * Compute Hopfield energy for a query.
 * E(xi, X) = -log(sum exp(beta * x_i^T * xi)) + 0.5 * |xi|^2
 *
 * Lower energy = well-represented in the pattern matrix.
 * Higher energy = novel/surprising.
 *
 * pre:  queryEmbedding is a non-empty float array
 * post: returned value is a real number (lower = more familiar to the network)
 *
 * source: Ramsauer et al. (2021) eq. 4;
 *         cortex@bc0ae4f mcp_server/core/hopfield.py:181-206
 */
export function computeEnergy(
  queryEmbedding: number[],
  matrix: PatternMatrix,
  beta: number = DEFAULT_BETA,
): number {
  let normSq = 0;
  for (const x of queryEmbedding) normSq += x * x;
  if (matrix.rows.length === 0) return ENERGY_NORM_COEFF * normSq;
  const q = new Float64Array(l2Normalize(queryEmbedding));
  const logits = matVecMul(matrix.rows, q);
  for (let i = 0; i < logits.length; i++) logits[i] = beta * (logits[i] ?? 0);
  return -logSumExp(logits) + ENERGY_NORM_COEFF * normSq;
}
