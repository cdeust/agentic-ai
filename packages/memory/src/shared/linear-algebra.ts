/**
 * Dense vector math utilities for behavioral activation spaces.
 *
 * Pure TypeScript — no external dependencies. All functions handle empty
 * arrays gracefully and return 0 for degenerate cases (empty vectors,
 * zero norms).
 *
 * Port of: mcp_server/shared/linear_algebra.py (numpy replaced with
 * plain JS arithmetic — same degenerate-case contract preserved).
 */

/** Dot product of two dense vectors. Uses the shorter length if unequal. */
export function dot(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0.0;
  let sum = 0.0;
  for (let i = 0; i < n; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

/** Euclidean norm (L2) of a dense vector. */
export function norm(v: readonly number[]): number {
  if (v.length === 0) return 0.0;
  let sum = 0.0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

/** Return a unit vector in the same direction. Zero vector if norm is 0. */
export function normalize(v: readonly number[]): number[] {
  const n = norm(v);
  if (n === 0) return v.map(() => 0.0);
  return v.map((x) => x / n);
}

/** Cosine similarity. Returns 0 if either has zero norm. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0.0;
  return dot(a, b) / (na * nb);
}

function padToSameLength(
  a: readonly number[],
  b: readonly number[],
): [number[], number[]] {
  if (a.length === b.length) return [Array.from(a), Array.from(b)];
  const n = Math.max(a.length, b.length);
  const pa = Array.from({ length: n }, (_, i) => a[i] ?? 0.0);
  const pb = Array.from({ length: n }, (_, i) => b[i] ?? 0.0);
  return [pa, pb];
}

/** Element-wise addition, padding shorter vector with zeros. */
export function add(a: readonly number[], b: readonly number[]): number[] {
  const [pa, pb] = padToSameLength(a, b);
  return pa.map((x, i) => x + (pb[i] ?? 0.0));
}

/** Element-wise subtraction: a - b, padding shorter vector with zeros. */
export function subtract(a: readonly number[], b: readonly number[]): number[] {
  const [pa, pb] = padToSameLength(a, b);
  return pa.map((x, i) => x - (pb[i] ?? 0.0));
}

/** Scalar multiplication. */
export function scale(v: readonly number[], s: number): number[] {
  return v.map((x) => x * s);
}

/** Project vector a onto vector b. Returns zero vector if b has zero norm. */
export function project(a: readonly number[], b: readonly number[]): number[] {
  const nb2 = dot(b, b);
  if (nb2 === 0) return b.map(() => 0.0);
  const scalar = dot(a, b) / nb2;
  return scale(b, scalar);
}

/** Clamp each element to [lo, hi]. */
export function clamp(v: readonly number[], lo: number, hi: number): number[] {
  return v.map((x) => Math.max(lo, Math.min(hi, x)));
}

/** Create a zero vector of given dimension. */
export function zeros(dim: number): number[] {
  return Array.from({ length: dim }, () => 0.0);
}
