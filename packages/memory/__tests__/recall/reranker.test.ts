import { describe, expect, it } from "vitest";
import { computeRetrievalConfidence, computeAdaptiveAlpha, blendScores, rerankResults } from "../../src/recall/reranker.js";
describe("reranker — computeRetrievalConfidence", () => {
  it("0.1 for empty", () => { expect(computeRetrievalConfidence([])).toBeCloseTo(0.1,5); });
  it("1.0 when max CE >= 0.15", () => { expect(computeRetrievalConfidence([0.2,0.1])).toBe(1.0); expect(computeRetrievalConfidence([0.15])).toBe(1.0); });
  it("suppression when max CE < 0.15", () => { expect(computeRetrievalConfidence([0.05,0.10])).toBeCloseTo(0.1,5); });
});
describe("reranker — computeAdaptiveAlpha", () => {
  it("base for single", () => { expect(computeAdaptiveAlpha([0.5],0.70)).toBeCloseTo(0.70,5); });
  it("base when spread<0.3", () => { expect(computeAdaptiveAlpha([0.5,0.6],0.70)).toBeCloseTo(0.70,5); });
  it("boost=0.15 at spread=1.0", () => { expect(computeAdaptiveAlpha([0.0,1.0],0.70)).toBeCloseTo(0.85,5); });
  it("linear at spread=0.65", () => { expect(computeAdaptiveAlpha([0.0,0.65],0.70)).toBeCloseTo(0.775,3); });
});
describe("reranker — blendScores", () => {
  it("deterministic", () => { const c:Array<[number,number]>=[[1,0.9],[2,0.5]]; const ce=new Map([[0,0.8],[1,0.2]]); expect(blendScores(c,ce,0.70,false)).toEqual(blendScores(c,ce,0.70,false)); });
  it("(1-a)*wrrf+a*ce*conf", () => { expect(blendScores([[42,0.6]],new Map([[0,0.8]]),0.70,false)[0]![1]).toBeCloseTo(0.74,5); });
  it("suppression 0.1 when max CE<0.15", () => { expect(blendScores([[1,0.5]],new Map([[0,0.05]]),0.70,false)[0]![1]).toBeCloseTo(0.0185,4); });
});
describe("reranker — rerankResults", () => {
  it("unchanged when adapter null", async () => { const c:Array<[number,number]>=[[1,0.9],[2,0.5]]; expect(await rerankResults("q",c,new Map([[1,"a"],[2,"b"]]),0.70,1200,false,null)).toEqual(c); });
});
