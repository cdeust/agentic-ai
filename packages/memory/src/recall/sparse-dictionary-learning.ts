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
      if (M[row]) M[row][col] = h_(h, row);
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
    Array.from({ length: n }, (__, j) => dot(atoms[selected[i]], atoms[selected[j]])),
  );
  const h = selected.map((i) => dot(atoms[i], b));

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
      const corr = Math.abs(dot(residual, atoms[k]));
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
      residual = subtract(residual, scale(atoms[selectedIndices[i]], coefficients[i]));
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
    for (let i = 0; i < data.length; i++) {
      if (selected.includes(i)) continue;
      const d = 1 - Math.abs(cosineSimilarity(data[i], data[lastIdx]));
      minDist[i] = Math.min(minDist[i], d);
    }

    let bestDist = -1.0;
    let bestIdx = 0;
    for (let i = 0; i < data.length; i++) {
      if (selected.includes(i)) continue;
      if (minDist[i] > bestDist) {
        bestDist = minDist[i];
        bestIdx = i;
      }
    }
    selected.push(bestIdx);
  }

  return selected.map((idx) => normalize(data[idx]));
}

// ── K-SVD dictionary update ───────────────────────────────────────────────────

function findAtomUsers(
  encodings: OMPResult[],
  atomIndex: number,
): Array<{ dataIdx: number; coeff: number }> {
  const users = [];
  for (let i = 0; i < encodings.length; i++) {
    const enc = encodings[i];
    const pos = enc.indices.indexOf(atomIndex);
    if (pos !== -1) {
      users.push({ dataIdx: i, coeff: enc.coefficients[pos] });
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

  let contribution = zeros(D);
  for (const user of users) {
    let partial = [...data[user.dataIdx]];
    const enc = encodings[user.dataIdx];
    for (let j = 0; j < enc.indices.length; j++) {
      const aidx = enc.indices[j];
      if (aidx === atomIndex) continue;
      partial = subtract(partial, scale(atoms[aidx], enc.coefficients[j]));
    }
    for (let dIdx = 0; dIdx < D; dIdx++) {
      contribution[dIdx] += partial[dIdx];
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
      if (norm(newAtom) > 0) {
        currentAtoms[k] = newAtom;
      }
    }
  }

  return currentAtoms;
}
