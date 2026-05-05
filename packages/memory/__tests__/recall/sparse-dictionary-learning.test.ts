/**
 * Tests for sparse-dictionary-learning.ts
 *
 * Verifies: OMP sparse coding; least-squares correctness; atom initialization;
 * K-SVD update (atoms remain normalized after update).
 */

import { describe, it, expect } from "vitest";
import {
  omp,
  initializeAtoms,
  updateDictionary,
} from "../../src/recall/sparse-dictionary-learning.js";

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

const ATOMS: number[][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

describe("omp", () => {
  it("recovers signal exactly from 1-sparse data", () => {
    const signal = [0.8, 0, 0];
    const result = omp(signal, ATOMS, 1);
    expect(result.indices).toContain(0);
    expect(result.coefficients[0]).toBeCloseTo(0.8, 3);
  });

  it("returns empty for empty atoms", () => {
    const result = omp([1, 0, 0], [], 3);
    expect(result.indices).toHaveLength(0);
  });

  it("respects sparsity constraint", () => {
    const signal = [0.5, 0.5, 0.5];
    const result = omp(signal, ATOMS, 2);
    expect(result.indices.length).toBeLessThanOrEqual(2);
  });

  it("residual is orthogonal to selected atoms (OMP postcondition)", () => {
    const signal = [0.6, 0.3, 0.0];
    const result = omp(signal, ATOMS, 3);
    // Residual should have near-zero dot product with selected atoms
    for (let i = 0; i < result.indices.length; i++) {
      const dotProd = ATOMS[result.indices[i]].reduce(
        (s, v, k) => s + v * result.residual[k],
        0,
      );
      expect(Math.abs(dotProd)).toBeLessThan(1e-8);
    }
  });
});

describe("initializeAtoms", () => {
  it("returns K atoms for K <= data.length", () => {
    const data = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]];
    const atoms = initializeAtoms(data, 3);
    expect(atoms).toHaveLength(3);
  });

  it("returns at most data.length atoms when K > data.length", () => {
    const data = [[1, 0], [0, 1]];
    const atoms = initializeAtoms(data, 5);
    expect(atoms.length).toBeLessThanOrEqual(2);
  });

  it("returns empty for empty data", () => {
    expect(initializeAtoms([], 3)).toHaveLength(0);
  });

  it("atoms are normalized (unit norm)", () => {
    const data = [[2, 0, 0], [0, 3, 0], [1, 1, 0]];
    const atoms = initializeAtoms(data, 2);
    for (const atom of atoms) {
      expect(norm(atom)).toBeCloseTo(1.0, 5);
    }
  });
});

describe("updateDictionary", () => {
  it("preserves atom count", () => {
    const data = [[1, 0, 0], [0, 1, 0], [0.7, 0.7, 0]];
    const atoms = initializeAtoms(data, 2);
    const updated = updateDictionary(data, atoms, 1, 2, 3);
    expect(updated).toHaveLength(atoms.length);
  });

  it("updated atoms are normalized", () => {
    const data = [[1, 0, 0], [0, 1, 0], [1, 1, 0]];
    const atoms = initializeAtoms(data, 2);
    const updated = updateDictionary(data, atoms, 1, 3, 3);
    for (const atom of updated) {
      const n = norm(atom);
      // Atoms with non-zero contribution must be normalized
      if (n > 0) expect(n).toBeCloseTo(1.0, 4);
    }
  });
});
