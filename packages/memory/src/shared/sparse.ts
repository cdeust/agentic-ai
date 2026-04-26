/**
 * Sparse vector operations for behavioral feature activations.
 *
 * Sparse vectors represented as Record<string, number>.
 * Keys are dimension names, values are activation strengths.
 * All operations skip/remove zero entries.
 *
 * Port of: mcp_server/shared/sparse.py
 */

export type SparseVector = Readonly<Record<string, number>>;

/** Dot product of two sparse vectors. */
export function sparseDot(a: SparseVector, b: SparseVector): number {
  const [smaller, larger] =
    Object.keys(a).length <= Object.keys(b).length ? [a, b] : [b, a];
  let total = 0.0;
  for (const [key, val] of Object.entries(smaller)) {
    const bVal = larger[key];
    if (bVal !== undefined) {
      total += val * bVal;
    }
  }
  return total;
}

/** Euclidean norm of a sparse vector. */
export function sparseNorm(v: SparseVector): number {
  let sum = 0.0;
  for (const val of Object.values(v)) sum += val * val;
  return Math.sqrt(sum);
}

/** Add two sparse vectors. Removes entries that sum to zero. */
export function sparseAdd(a: SparseVector, b: SparseVector): Record<string, number> {
  const result: Record<string, number> = { ...a };
  for (const [key, val] of Object.entries(b)) {
    const s = (result[key] ?? 0.0) + val;
    if (s === 0) {
      delete result[key];
    } else {
      result[key] = s;
    }
  }
  return result;
}

/** Scale a sparse vector by a scalar. */
export function sparseScale(v: SparseVector, s: number): Record<string, number> {
  if (s === 0) return {};
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(v)) {
    result[key] = val * s;
  }
  return result;
}

/** Return the top-K entries by absolute value. */
export function sparseTopK(v: SparseVector, k: number): Record<string, number> {
  const entries = Object.entries(v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return Object.fromEntries(entries.slice(0, k));
}

/** Cosine similarity between two sparse vectors. */
export function sparseCosine(a: SparseVector, b: SparseVector): number {
  const na = sparseNorm(a);
  const nb = sparseNorm(b);
  if (na === 0 || nb === 0) return 0.0;
  return sparseDot(a, b) / (na * nb);
}

/** Convert a dense vector to sparse, dropping entries below threshold. */
export function denseToSparse(
  dense: readonly number[],
  labels: readonly string[],
  threshold = 1e-10,
): Record<string, number> {
  const result: Record<string, number> = {};
  const len = Math.min(dense.length, labels.length);
  for (let i = 0; i < len; i++) {
    const val = dense[i] ?? 0;
    if (Math.abs(val) > threshold) {
      result[labels[i] ?? String(i)] = val;
    }
  }
  return result;
}

/** Convert a sparse vector to dense using ordered dimension names. */
export function sparseToDense(sparse: SparseVector, labels: readonly string[]): number[] {
  return labels.map((label) => sparse[label] ?? 0.0);
}
