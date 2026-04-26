import { describe, it, expect } from "vitest";
import {
  dot,
  norm,
  normalize,
  cosineSimilarity,
  add,
  subtract,
  scale,
  clamp,
  zeros,
  project,
} from "../../src/shared/linear-algebra.js";

describe("dot", () => {
  it("computes basic dot product", () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBeCloseTo(32, 10);
  });

  it("uses shorter length for unequal vectors", () => {
    expect(dot([1, 2], [3, 4, 5])).toBeCloseTo(11, 10);
  });

  it("returns 0 for empty vectors", () => {
    expect(dot([], [])).toBe(0.0);
  });
});

describe("norm", () => {
  it("computes L2 norm", () => {
    expect(norm([3, 4])).toBeCloseTo(5, 10);
  });

  it("returns 0 for empty vector", () => {
    expect(norm([])).toBe(0.0);
  });
});

describe("normalize", () => {
  it("returns unit vector", () => {
    const v = normalize([3, 4]);
    expect(norm(v)).toBeCloseTo(1.0, 10);
  });

  it("returns zero vector for zero input", () => {
    expect(normalize([0, 0])).toEqual([0.0, 0.0]);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 10);
  });

  it("returns 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0.0);
  });

  it("returns -1 for anti-parallel vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 10);
  });
});

describe("add", () => {
  it("adds vectors of equal length", () => {
    expect(add([1, 2], [3, 4])).toEqual([4, 6]);
  });

  it("pads shorter vector", () => {
    expect(add([1, 2, 3], [4, 5])).toEqual([5, 7, 3]);
  });
});

describe("subtract", () => {
  it("subtracts vectors", () => {
    expect(subtract([5, 6], [3, 4])).toEqual([2, 2]);
  });
});

describe("scale", () => {
  it("scales all elements", () => {
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });
});

describe("clamp", () => {
  it("clamps values to range", () => {
    expect(clamp([0.5, 1.5, -0.5], 0, 1)).toEqual([0.5, 1.0, 0.0]);
  });
});

describe("zeros", () => {
  it("creates zero vector of given dimension", () => {
    expect(zeros(3)).toEqual([0.0, 0.0, 0.0]);
  });
});

describe("project", () => {
  it("projects onto a basis vector", () => {
    const result = project([1, 1], [1, 0]);
    expect(result[0]).toBeCloseTo(1, 10);
    expect(result[1]).toBeCloseTo(0, 10);
  });

  it("returns zero for zero target", () => {
    expect(project([1, 2], [0, 0])).toEqual([0.0, 0.0]);
  });
});
