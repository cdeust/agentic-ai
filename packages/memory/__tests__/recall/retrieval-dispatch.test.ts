import { describe, expect, it } from "vitest";
import { classifyTier, wrrfFuse, computeSignalWeights, mergeMultihopResults, QueryIntent } from "../../src/recall/retrieval-dispatch.js";

describe("retrieval-dispatch — classifyTier", () => {
  it("MULTI_HOP→mixed", ()=>{expect(classifyTier(QueryIntent.MULTI_HOP)).toBe("mixed");});
  it("ENTITY→deep", ()=>{expect(classifyTier(QueryIntent.ENTITY)).toBe("deep");});
  it("INSTRUCTION→deep", ()=>{expect(classifyTier(QueryIntent.INSTRUCTION)).toBe("deep");});
  it("GENERAL→simple", ()=>{expect(classifyTier(QueryIntent.GENERAL)).toBe("simple");});
  it("SEMANTIC→simple", ()=>{expect(classifyTier(QueryIntent.SEMANTIC)).toBe("simple");});
  it("TEMPORAL→simple", ()=>{expect(classifyTier(QueryIntent.TEMPORAL)).toBe("simple");});
});

describe("retrieval-dispatch — wrrfFuse", () => {
  it("empty for empty", ()=>{expect(wrrfFuse([],[])).toEqual([]);});
  it("single signal rank order", ()=>{const r=wrrfFuse([[[1,0.9],[2,0.5]]],[1.0]);expect(r[0]![0]).toBe(1);expect(r[1]![0]).toBe(2);});
  it("deterministic", ()=>{const s1:Array<[number,number]>=[[1,0.9],[2,0.5],[3,0.3]];const s2:Array<[number,number]>=[[3,0.9],[1,0.3]];expect(wrrfFuse([s1,s2],[0.7,0.3])).toEqual(wrrfFuse([s1,s2],[0.7,0.3]));});
  it("zero-weight skipped", ()=>{expect(wrrfFuse([[[1,1.0]],[[2,1.0]]],[1.0,0.0]).some(([id])=>id===2)).toBe(false);});
});

describe("retrieval-dispatch — computeSignalWeights", () => {
  it("simple: hopfield=v*0.5,hdc=v*0.4,sr=h*0.6", ()=>{
    const w=computeSignalWeights("simple",{},1.0,0.5,0.3);
    expect(w.hopfield).toBeCloseTo(0.5,5); expect(w.hdc).toBeCloseTo(0.4,5);
    expect(w.sr).toBeCloseTo(0.18,5); expect(w.bm25).toBeCloseTo(0.4,5);
  });
  it("deep: bm25=f*1.5,vector=v*0.7", ()=>{
    const w=computeSignalWeights("deep",{},1.0,0.5,0.3);
    expect(w.bm25).toBeCloseTo(0.75,5); expect(w.vector).toBeCloseTo(0.7,5);
  });
  it("INSTRUCTION: bm25=f*2.0,vector=v*0.5", ()=>{
    const w=computeSignalWeights("deep",{},1.0,0.5,0.3,QueryIntent.INSTRUCTION);
    expect(w.bm25).toBeCloseTo(1.0,5); expect(w.vector).toBeCloseTo(0.5,5);
  });
  it("deterministic", ()=>{expect(computeSignalWeights("simple",{fts:1.2,heat:0.8})).toEqual(computeSignalWeights("simple",{fts:1.2,heat:0.8}));});
});

describe("retrieval-dispatch — mergeMultihopResults", () => {
  it("reinforces overlapping: id=1→0.92", ()=>{
    const s=Object.fromEntries(mergeMultihopResults([[1,0.8],[2,0.5]],[[1,0.4]],0.3));
    expect(s[1]).toBeCloseTo(0.92,5); expect(s[2]).toBeCloseTo(0.5,5);
  });
  it("adds new at reduced weight", ()=>{expect(Object.fromEntries(mergeMultihopResults([[1,0.8]],[[2,0.6]],0.3))[2]).toBeCloseTo(0.18,5);});
  it("sorted descending", ()=>{const r=mergeMultihopResults([[1,0.5],[2,0.3]],[[2,1.0]],0.5);expect(r[0]![1]).toBeGreaterThanOrEqual(r[1]![1]);});
});
