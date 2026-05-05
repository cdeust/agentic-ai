/**
 * Dictionary learning via K-SVD and Orthogonal Matching Pursuit (OMP).
 *
 * Extracted from sparse_dictionary.py to respect the 300-line file limit.
 * Contains the numerical core: OMP sparse coding, least-squares solver,
 * atom initialization (maximin distance), and K-SVD dictionary optimization.
 *
 * Port of: mcp_server/core/sparse_dictionary_learning.py
 * Pure business logic — no I/O.
 */

import {
  cosineSimilarity,
  dot,
  norm,
  normalize,
  scale,
  subtract,
  zeros,
} from "../shared/linear-algebra.js";

// ── Orthogonal Matching Pursuit (OMP) ─────────────────────────────────────────

function solveLeastSquares1(G: number[][], h: number[]): number[] {
  const g00 = G[0]?.[0] ?? 0;
  const h0 = h[0] ?? 0;
  return g00 !== 0 ? [h0 / g00] : [0];
}

// Safe 2D matrix element accessor — avoids noUncheckedIndexedAccess TS errors
function g(M: number[][], r: number, c: number): number { return M[r]?.[c] ?? 0; }
function h_(v: number[], i: number): number { return v[i] ?? 0; }

function solveLeastSquares2(G: number[][], h: number[]): number[] {
  const det = g(G,0,0)*g(G,1,1) - g(G,0,1)*g(G,1,0);
  if (Math.abs(det) < 1e-12) return [0, 0];
  return [
    (h_(h,0)*g(G,1,1) - h_(h,1)*g(G,0,1)) / det,
    (g(G,0,0)*h_(h,1) - g(G,1,0)*h_(h,0)) / det,
  ];
}

function det3(m: number[][]): number {
  return (
    g(m,0,0) * (g(m,1,1)*g(m,2,2) - g(m,1,2)*g(m,2,1)) -
    g(m,0,1) * (g(m,1,0)*g(m,2,2) - g(m,1,2)*g(m,2,0)) +
    g(m,0,2) * (g(m,1,0)*g(m,2,1) - g(m,1,1)*g(m,2,0))
  );
}

function solveLeastSquares3(G: number[][], h: number[]): number[] {
  const detG = det3(G);
  if (Math.abs(detG) < 1e-12) return [0, 0, 0];
  const result: number[] = [];
  for (let col = 0; col < 3; col++) {
    const M = G.map((row) => [...row]);
    for (let row = 0; row < 3; row++) {
      const r = M[row];
      if (r) r[col] = h_(h, row);
    }
    result.push(det3(M) / detG);
  }
  return result;
}

/**
 * Solve least-squares for the selected atom subset.
 *
 * Precondition: selected.length in {0, 1, 2, 3}; atoms has at least max(selected)+1 elements.
 * Postcondition: result.length === selected.length.
 */
function solveLeastSquares(
  atoms: number[][],
  b: number[],
  selected: number[],
): number[] {
  const n = selected.length;
  if (n === 0) return [];

  const G = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      const ai = selected[i];
      const aj = selected[j];
      if (ai === undefined || aj === undefined) return 0;
      const va = atoms[ai];
      const vb = atoms[aj];
      if (!va || !vb) return 0;
      return dot(va, vb);
    }),
  );
  const h = selected.map((i) => {
    const v = atoms[i];
    return v ? dot(v, b) : 0;
  });

  if (n === 1) return solveLeastSquares1(G, h);
  if (n === 2) return solveLeastSquares2(G, h);
  if (n === 3) return solveLeastSquares3(G, h);

  return new Array<number>(n).fill(0);
}

export interface OMPResult {
  indices: number[];
  coefficients: number[];
  residual: number[];
}

/**
 * Orthogonal Matching Pursuit: greedily select sparse atom subset.
 *
 * @param signal - Input signal vector.
 * @param atoms - Dictionary atoms (each must be normalized).
 * @param sparsity - Maximum number of non-zero coefficients.
 * @returns {indices, coefficients, residual}.
 *
 * Precondition: signal and atoms have consistent dimensions; sparsity >= 1.
 * Postcondition: indices.length <= sparsity; residual = signal - reconstruction.
 * Invariant (per iteration): selected_indices grows by at most 1; best_corr >= 1e-10.
 */
export function omp(
  signal: number[],
  atoms: number[][],
  sparsity: number,
): OMPResult {
  const K = atoms.length;
  let residual = [...signal];
  const selectedIndices: number[] = [];

  // Invariant: residual = signal - sum(coeff_i * atom_i for i in selectedIndices)
  // Termination: loop runs at most sparsity times; each iteration adds one index
  for (let iter = 0; iter < sparsity; iter++) {
    let bestCorr = -1.0;
    let bestIdx = -1;
    for (let k = 0; k < K; k++) {
      if (selectedIndices.includes(k)) continue;
      const ak = atoms[k];
      if (!ak) continue;
      const corr = Math.abs(dot(residual, ak));
      if (corr > bestCorr) {
        bestCorr = corr;
        bestIdx = k;
      }
    }
    if (bestIdx === -1 || bestCorr < 1e-10) break;
    selectedIndices.push(bestIdx);

    const coefficients = solveLeastSquares(atoms, signal, selectedIndices);
    residual = [...signal];
    for (let i = 0; i < selectedIndices.length; i++) {
      const si = selectedIndices[i];
      const ci = coefficients[i];
      if (si === undefined || ci === undefined) continue;
      const av = atoms[si];
      if (!av) continue;
      residual = subtract(residual, scale(av, ci));
    }
  }

  const coefficients = solveLeastSquares(atoms, signal, selectedIndices);
  return { indices: selectedIndices, coefficients, residual };
}

// ── Atom initialization (maximin distance selection) ─────────────────────────

/**
 * Select K diverse atoms from data using maximin distance.
 *
 * Precondition: data is a non-empty array of vectors; K >= 1.
 * Postcondition: result.length === min(K, data.length); each atom is normalized.
 * Invariant: selected set grows monotonically; min_dist tracks distance to nearest selected.
 */
export function initializeAtoms(data: number[][], K: number): number[][] {
  if (data.length === 0) return [];
  const effectiveK = Math.min(K, data.length);
  const selected = [0];
  const minDist = new Array<number>(data.length).fill(Infinity);

  // Termination: loop runs exactly effectiveK - 1 times
  for (let iter = 1; iter < effectiveK; iter++) {
    const lastIdx = selected[selected.length - 1];
    if (lastIdx === undefined) break;
    const lastVec = data[lastIdx];
    if (!lastVec) break;
    for (let i = 0; i < data.length; i++) {
      if (selected.includes(i)) continue;
      const di = data[i];
      const cur = minDist[i];
      if (!di || cur === undefined) continue;
      const d = 1 - Math.abs(cosineSimilarity(di, lastVec));
      minDist[i] = Math.min(cur, d);
    }

    let bestDist = -1.0;
    let bestIdx = 0;
    for (let i = 0; i < data.length; i++) {
      if (selected.includes(i)) continue;
      const cur = minDist[i];
      if (cur === undefined) continue;
      if (cur > bestDist) {
        bestDist = cur;
        bestIdx = i;
      }
    }
    selected.push(bestIdx);
  }

  return selected.map((idx) => {
    const v = data[idx];
    return v ? normalize(v) : [];
  });
}

// ── K-SVD dictionary update ───────────────────────────────────────────────────

function findAtomUsers(
  encodings: OMPResult[],
  atomIndex: number,
): Array<{ dataIdx: number; coeff: number }> {
  const users: Array<{ dataIdx: number; coeff: number }> = [];
  for (let i = 0; i < encodings.length; i++) {
    const enc = encodings[i];
    if (!enc) continue;
    const pos = enc.indices.indexOf(atomIndex);
    if (pos !== -1) {
      const coeff = enc.coefficients[pos];
      if (coeff !== undefined) users.push({ dataIdx: i, coeff });
    }
  }
  return users;
}

function computeAtomContribution(
  data: number[][],
  encodings: OMPResult[],
  atoms: number[][],
  atomIndex: number,
  D: number,
): number[] {
  const users = findAtomUsers(encodings, atomIndex);
  if (users.length === 0) return zeros(D);

  const contribution = zeros(D);
  for (const user of users) {
    const dv = data[user.dataIdx];
    const enc = encodings[user.dataIdx];
    if (!dv || !enc) continue;
    let partial = [...dv];
    for (let j = 0; j < enc.indices.length; j++) {
      const aidx = enc.indices[j];
      const coeff = enc.coefficients[j];
      if (aidx === undefined || coeff === undefined || aidx === atomIndex) continue;
      const av = atoms[aidx];
      if (!av) continue;
      partial = subtract(partial, scale(av, coeff));
    }
    for (let dIdx = 0; dIdx < D; dIdx++) {
      const p = partial[dIdx];
      const c = contribution[dIdx];
      if (p !== undefined && c !== undefined) contribution[dIdx] = c + p;
    }
  }
  return contribution;
}

/**
 * Run K-SVD iterations to refine dictionary atoms.
 *
 * @param data - Training data vectors.
 * @param atoms - Initial dictionary atoms.
 * @param sparsity - OMP sparsity parameter.
 * @param iterations - Number of K-SVD iterations.
 * @param D - Signal dimension.
 * @returns Updated list of atom vectors.
 *
 * Precondition: atoms.length <= data.length; D === data[0].length; iterations >= 1.
 * Postcondition: result.length === atoms.length; each atom is normalized.
 * Invariant (per K-SVD iteration): atoms remain normalized after each atom update.
 */
export function updateDictionary(
  data: number[][],
  atoms: number[][],
  sparsity: number,
  iterations: number,
  D: number,
): number[][] {
  const actualK = atoms.length;
  let currentAtoms = atoms.map((a) => [...a]);

  // Termination: outer loop runs exactly iterations times
  for (let iter = 0; iter < iterations; iter++) {
    const encodings = data.map((x) => omp(x, currentAtoms, sparsity));

    for (let k = 0; k < actualK; k++) {
      const contribution = computeAtomContribution(data, encodings, currentAtoms, k, D);
      const newAtom = normalize(contribution);
      if (norm(newAtom) > 0 && currentAtoms[k] !== undefined) {
        currentAtoms[k] = newAtom;
      }
    }
  }

  return currentAtoms;
}
