/**
 * Titans test-time learning memory (Behrouz et al., NeurIPS 2025).
 *
 * Faithful implementation of the neural long-term memory module from
 * "Titans: Learning to Memorize at Test Time" (arXiv:2501.00663).
 *
 * Key equations from the paper:
 *   M_t = M_{t-1} - S_t                              (memory update)
 *   S_t = eta * S_{t-1} - theta * grad_l(M_{t-1}; x) (surprise momentum)
 *   l(M; x) = ||M * k_x - v_x||^2                    (associative memory loss)
 *
 * TS NOTE: The TS port uses plain float arrays instead of PyTorch tensors.
 * Matrix operations are implemented inline using linear algebra helpers.
 * The math is identical to the Python version; no external ML library required.
 *
 * Pure business logic — stateful (maintains M and S across calls).
 *
 * Port of: cortex@ed33435 mcp_server/core/titans_memory.py
 *
 * Reference:
 *   Behrouz, A. et al. (2025) "Titans: Learning to Memorize at Test Time."
 *   arXiv:2501.00663. NeurIPS 2025.
 */

import { isMechanismDisabled, Mechanism } from "../recall/ablation.js";

// ── Matrix operations ─────────────────────────────────────────────────────
// All operate on flat row-major float arrays of length dim*dim.

function matVec(M: Float32Array, v: Float32Array, dim: number): Float32Array {
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    let s = 0;
    for (let j = 0; j < dim; j++) s += M[i * dim + j]! * v[j]!;
    out[i] = s;
  }
  return out;
}

function frobeniusNorm(M: Float32Array): number {
  let s = 0;
  for (const v of M) s += v * v;
  return Math.sqrt(s);
}

/** Grad of l = ||M@k - v||^2 w.r.t. M: grad = 2 * (M@k - v) * k^T */
function lossGrad(
  M: Float32Array,
  k: Float32Array,
  v: Float32Array,
  dim: number,
): Float32Array {
  const Mk = matVec(M, k, dim);
  const diff = new Float32Array(dim);
  for (let i = 0; i < dim; i++) diff[i] = Mk[i]! - v[i]!;

  // grad[i*dim + j] = 2 * diff[i] * k[j]
  const grad = new Float32Array(dim * dim);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      grad[i * dim + j] = 2 * diff[i]! * k[j]!;
    }
  }
  return grad;
}

// ── Float32 embedding parser ──────────────────────────────────────────────

function bytesToFloat32(emb: Uint8Array | number[] | null | undefined, dim: number): Float32Array | null {
  if (!emb) return null;
  if (emb instanceof Uint8Array) {
    if (emb.byteLength < dim * 4) return null;
    const view = new DataView(emb.buffer, emb.byteOffset, dim * 4);
    const arr = new Float32Array(dim);
    for (let i = 0; i < dim; i++) arr[i] = view.getFloat32(i * 4, true);
    return arr;
  }
  if (Array.isArray(emb)) {
    if (emb.length < dim) return null;
    return Float32Array.from(emb.slice(0, dim) as number[]);
  }
  return null;
}

// ── TitansMemory class ────────────────────────────────────────────────────

/**
 * Neural associative memory with test-time learning.
 *
 * Maintains a weight matrix M (dim×dim) that maps query embeddings
 * to predicted memory embeddings. Updated via gradient descent after
 * each retrieval.
 *
 * source: cortex@ed33435 mcp_server/core/titans_memory.py:57-221
 *
 * IMPORTANT (from Python source): eta and theta are simplified to constants
 * here. In the paper, η_t and θ_t are data-dependent (learned). Using fixed
 * values (0.9, 0.01) is a simplification — standard SGD momentum defaults.
 */
export class TitansMemory {
  private readonly dim: number;
  private readonly eta: number;
  private readonly theta: number;
  private _M: Float32Array;
  private _S: Float32Array;

  /**
   * precondition:  dim > 0; eta ∈ (0, 1); theta > 0.
   * postcondition: M is identity matrix; S is zero matrix.
   *
   * source: cortex@ed33435 mcp_server/core/titans_memory.py:78-93
   *   eta default = 0.9 (standard SGD momentum, Sutskever et al. ICML 2013)
   *   theta default = 0.01 (simplified from paper's learned θ_t)
   */
  constructor(dim = 384, eta = 0.9, theta = 0.01) {
    this.dim = dim;
    this.eta = eta;
    this.theta = theta;

    // M: identity initialization — predicts input unchanged
    this._M = new Float32Array(dim * dim);
    for (let i = 0; i < dim; i++) this._M[i * dim + i] = 1.0;

    // S: zero momentum
    this._S = new Float32Array(dim * dim);
  }

  /**
   * Compute surprise as gradient magnitude of associative memory loss.
   *
   * l(M; x) = ||M @ k - v||^2
   * surprise = ||grad_l||_F (Frobenius norm of gradient)
   *
   * precondition:  queryEmb and resultEmbs may be null.
   * postcondition: result ∈ [0, 1]. Returns 0.5 if inputs unavailable.
   *
   * source: cortex@ed33435 mcp_server/core/titans_memory.py:95-151
   */
  computeSurprise(
    queryEmb: Uint8Array | number[] | null | undefined,
    resultEmbs: Array<Uint8Array | number[] | null | undefined>,
  ): number {
    const k = bytesToFloat32(queryEmb, this.dim);
    if (!k) return 0.5;

    const vArrays: Float32Array[] = [];
    for (const emb of resultEmbs) {
      const v = bytesToFloat32(emb, this.dim);
      if (v) vArrays.push(v);
    }
    if (vArrays.length === 0) return 0.5;

    // v = mean of result embeddings
    const v = new Float32Array(this.dim);
    for (const arr of vArrays) {
      for (let i = 0; i < this.dim; i++) v[i]! += arr[i]! / vArrays.length;
    }

    try {
      const grad = lossGrad(this._M, k, v, this.dim);
      const surpriseRaw = frobeniusNorm(grad);
      return Math.max(0.0, Math.min(1.0, Math.tanh(surpriseRaw)));
    } catch {
      return 0.5;
    }
  }

  /**
   * Update memory M and momentum S after retrieval.
   *
   * Implements the exact Titans equations:
   *   S_t = eta * S_{t-1} - theta * grad_l(M_{t-1}; x_t)
   *   M_t = M_{t-1} - S_t
   *
   * precondition:  queryEmb and resultEmbs may be null.
   * postcondition: _M and _S are updated in-place; returns surprise value.
   *   Returns 0.0 when SURPRISE_MOMENTUM is ablated; 0.5 on error.
   *
   * source: cortex@ed33435 mcp_server/core/titans_memory.py:153-211
   */
  update(
    queryEmb: Uint8Array | number[] | null | undefined,
    resultEmbs: Array<Uint8Array | number[] | null | undefined>,
  ): number {
    if (isMechanismDisabled(Mechanism.SURPRISE_MOMENTUM)) return 0.0;

    const k = bytesToFloat32(queryEmb, this.dim);
    if (!k) return 0.5;

    const vArrays: Float32Array[] = [];
    for (const emb of resultEmbs) {
      const v = bytesToFloat32(emb, this.dim);
      if (v) vArrays.push(v);
    }
    if (vArrays.length === 0) return 0.5;

    const v = new Float32Array(this.dim);
    for (const arr of vArrays) {
      for (let i = 0; i < this.dim; i++) v[i]! += arr[i]! / vArrays.length;
    }

    try {
      const grad = lossGrad(this._M, k, v, this.dim);
      const surpriseRaw = frobeniusNorm(grad);

      // S_t = eta * S_{t-1} - theta * grad
      for (let i = 0; i < this._S.length; i++) {
        this._S[i] = this.eta * this._S[i]! - this.theta * grad[i]!;
      }

      // M_t = M_{t-1} - S_t
      for (let i = 0; i < this._M.length; i++) {
        this._M[i] = this._M[i]! - this._S[i]!;
      }

      return Math.max(0.0, Math.min(1.0, Math.tanh(surpriseRaw)));
    } catch {
      return 0.5;
    }
  }

  /** Reset memory to initial state. */
  reset(): void {
    this._M = new Float32Array(this.dim * this.dim);
    for (let i = 0; i < this.dim; i++) this._M[i * this.dim + i] = 1.0;
    this._S = new Float32Array(this.dim * this.dim);
  }
}
