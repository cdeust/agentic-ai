import { describe, it, expect } from "vitest";
import { vaderCompound, vaderScores } from "../../src/shared/vader.js";

describe("vaderCompound", () => {
  it("returns 0 for empty text", () => {
    expect(vaderCompound("")).toBe(0.0);
  });

  it("returns positive for positive text", () => {
    expect(vaderCompound("the build passed and we shipped it")).toBeGreaterThan(0);
  });

  it("returns negative for negative text", () => {
    expect(vaderCompound("the server crashed and failed")).toBeLessThan(0);
  });

  it("returns value in [-1, 1]", () => {
    const texts = [
      "excellent breakthrough amazing success deployed perfectly",
      "crash error bug failure broken terrible nightmare outage",
      "just a normal day",
    ];
    for (const text of texts) {
      const c = vaderCompound(text);
      expect(c).toBeGreaterThanOrEqual(-1.0);
      expect(c).toBeLessThanOrEqual(1.0);
    }
  });

  it("applies H4 negation: 'not fixed' is negative", () => {
    const pos = vaderCompound("fixed");
    const neg = vaderCompound("not fixed");
    expect(pos).toBeGreaterThan(0);
    expect(neg).toBeLessThan(pos);
  });

  it("applies H3 booster: 'very awesome' is more positive than 'awesome'", () => {
    expect(vaderCompound("very awesome")).toBeGreaterThan(vaderCompound("awesome"));
  });
});

describe("vaderScores", () => {
  it("returns 4-key object", () => {
    const s = vaderScores("hello world");
    expect(Object.keys(s)).toContain("pos");
    expect(Object.keys(s)).toContain("neg");
    expect(Object.keys(s)).toContain("neu");
    expect(Object.keys(s)).toContain("compound");
  });

  it("pos + neg + neu sums to 1.0 (within float rounding)", () => {
    const s = vaderScores("the build failed horribly but then succeeded beautifully");
    expect(s.pos + s.neg + s.neu).toBeCloseTo(1.0, 4);
  });

  it("all-neutral text: mostly neu", () => {
    const s = vaderScores("the file is located in the directory");
    expect(s.neu).toBeGreaterThan(0.5);
  });
});
