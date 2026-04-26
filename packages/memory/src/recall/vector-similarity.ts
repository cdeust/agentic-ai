/**
 * Dense vector math utilities for recall signal computation.
 *
 * Port of: mcp_server/shared/linear_algebra.py
 *
 * Pure functions — no I/O. Handles empty / mismatched length vectors
 * gracefully by returning 0 for all degenerate cases.
 */

// ── Norm ───────────────────────────────────────────────────────────────────

/**
 * Euclidean (L2) norm of a dense vector.
 * Returns 0 for empty vector.
 */
export function norm(v: number[]): number {
  if (v.length === 0) return 0;
  let sum = 0;
  for (const x of v) {
    sum += x * x;
  }
  return Math.sqrt(sum);
}

// ── Dot product ────────────────────────────────────────────────────────────

/**
 * Dot product of two dense vectors.
 * Uses the shorter length when vectors differ in size (mirrors Python port).
 */
export function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let result = 0;
  for (let i = 0; i < n; i++) {
    // biome-ignore lint: noUncheckedIndexedAccess — n is bounded by Math.min
    result += (a[i] as number) * (b[i] as number);
  }
  return result;
}

// ── Normalize ──────────────────────────────────────────────────────────────

/**
 * Return a unit vector in the same direction.
 * Returns a zero vector if the input norm is 0.
 */
export function normalize(v: number[]): number[] {
  const n = norm(v);
  if (n === 0) return new Array(v.length).fill(0) as number[];
  return v.map((x) => x / n);
}

// ── Cosine similarity ──────────────────────────────────────────────────────

/**
 * Cosine similarity in [-1, 1].
 * Returns 0 if either vector has zero norm.
 *
 * Port of: mcp_server/shared/linear_algebra.py::cosine_similarity
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}
