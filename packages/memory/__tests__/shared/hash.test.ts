import { describe, it, expect } from "vitest";
import { simpleHash } from "../../src/shared/hash.js";

describe("simpleHash (DJB2)", () => {
  it("returns a hex string for non-empty input", () => {
    const h = simpleHash("hello");
    expect(typeof h).toBe("string");
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("returns a deterministic result", () => {
    expect(simpleHash("hello")).toBe(simpleHash("hello"));
  });

  it("returns different hashes for different inputs", () => {
    expect(simpleHash("hello")).not.toBe(simpleHash("world"));
  });

  it("handles null input", () => {
    expect(simpleHash(null)).toBe(simpleHash(""));
  });

  it("handles undefined input", () => {
    expect(simpleHash(undefined)).toBe(simpleHash(""));
  });

  it("only hashes first 500 characters", () => {
    const base = "x".repeat(600);
    const base500 = "x".repeat(500);
    // Appending past 500 chars must not change the hash
    expect(simpleHash(base)).toBe(simpleHash(base500));
  });

  it("parity: known Python DJB2 hash of 'hello world'", () => {
    // Python: simple_hash("hello world") = ...
    // The DJB2 algorithm is deterministic; we compute it from first principles.
    // Verified by running the Python source:
    //   simple_hash("hello world") → "3551c8c1"
    // Python uses & 0xFFFFFFFF; JS uses >>> 0 — same 32-bit unsigned result.
    expect(simpleHash("hello world")).toBe("3551c8c1");
  });
});
