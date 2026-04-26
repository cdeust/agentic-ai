/**
 * Dense vector math utilities — pure TS port of shared/linear_algebra.py.
 *
 * No external dependencies. All functions handle empty arrays gracefully and
 * return 0 / zero-vectors for degenerate cases.
 *
 * source: mcp_server/shared/linear_algebra.py
 */

export function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

export function norm(v: number[]): number {
  if (v.length === 0) return 0;
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

export function normalize(v: number[]): number[] {
  const n = norm(v);
  if (n === 0) return v.map(() => 0);
  return v.map((x) => x / n);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export function add(a: number[], b: number[]): number[] {
  const n = Math.max(a.length, b.length);
  const result: number[] = new Array(n).fill(0) as number[];
  for (let i = 0; i < a.length; i++) result[i] = (result[i] ?? 0) + (a[i] ?? 0);
  for (let i = 0; i < b.length; i++) result[i] = (result[i] ?? 0) + (b[i] ?? 0);
  return result;
}

export function subtract(a: number[], b: number[]): number[] {
  const n = Math.max(a.length, b.length);
  const result: number[] = new Array(n).fill(0) as number[];
  for (let i = 0; i < a.length; i++) result[i] = (result[i] ?? 0) + (a[i] ?? 0);
  for (let i = 0; i < b.length; i++) result[i] = (result[i] ?? 0) - (b[i] ?? 0);
  return result;
}

export function scale(v: number[], s: number): number[] {
  return v.map((x) => x * s);
}

export function zeros(dim: number): number[] {
  return new Array(dim).fill(0) as number[];
}

export function project(a: number[], b: number[]): number[] {
  const nb2 = dot(b, b);
  if (nb2 === 0) return b.map(() => 0);
  return scale(b, dot(a, b) / nb2);
}

export function clampVec(v: number[], lo: number, hi: number): number[] {
  return v.map((x) => Math.max(lo, Math.min(hi, x)));
}
