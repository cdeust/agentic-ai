import { describe, expect, it } from "vitest";
import { computeBm25Scores, computeNgramScore, computeKeywordOverlap, tokenize, tokenizeRaw } from "../../src/recall/scoring.js";
describe("scoring — tokenize", () => {
  it("filters stopwords", () => { expect(tokenize("The cat sat on the mat")).toEqual(["cat","sat","mat"]); });
  it("tokenize_raw keeps all", () => { expect(tokenizeRaw("The cat sat")).toEqual(["the","cat","sat"]); });
});
describe("scoring — computeBm25Scores", () => {
  it("zeros for empty query", () => { expect(computeBm25Scores("",["a","b"])).toEqual([0,0]); });
  it("empty for empty docs", () => { expect(computeBm25Scores("hello",[])).toEqual([]); });
  it("deterministic", () => { const d=["rust memory","python async","rust async"]; expect(computeBm25Scores("rust",d)).toEqual(computeBm25Scores("rust",d)); });
  it("[0,1]", () => { for(const s of computeBm25Scores("hello",["hello world","foo","hello"])){expect(s).toBeGreaterThanOrEqual(0);expect(s).toBeLessThanOrEqual(1);} });
  it("exact match ranks highest", () => { const s=computeBm25Scores("cat sat",["the cat sat on mat","dogs great","cats dogs"]); expect(s[0]).toBeGreaterThan(s[1]!); });
  it("single-doc = 1.0", () => { expect(computeBm25Scores("hello",["hello"])[0]).toBeCloseTo(1.0,5); });
});
describe("scoring — computeNgramScore", () => {
  it("zeros for empty", () => { expect(computeNgramScore("","a")).toBe(0); expect(computeNgramScore("a","")).toBe(0); });
  it("deterministic", () => { expect(computeNgramScore("rust async","rust async tasks")).toEqual(computeNgramScore("rust async","rust async tasks")); });
  it("perfect=1.0 (tri=0.4,bi=0.35,cw=0.25)", () => { expect(computeNgramScore("hello world test","hello world test")).toBeCloseTo(1.0,5); });
  it("partial<perfect", () => { const f=computeNgramScore("foo bar baz","foo bar baz"); const p=computeNgramScore("foo bar baz","foo bar"); expect(p).toBeLessThan(f); });
});
describe("scoring — computeKeywordOverlap", () => {
  it("0 for empty query", () => { expect(computeKeywordOverlap("","hello")).toBe(0); });
  it("|Q∩D|/|Q|", () => { expect(computeKeywordOverlap("hello world","hello there")).toBeCloseTo(0.5,5); });
  it("1.0 when all in doc", () => { expect(computeKeywordOverlap("foo bar","foo bar baz")).toBeCloseTo(1.0,5); });
});
