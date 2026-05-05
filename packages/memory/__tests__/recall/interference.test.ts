import { describe, expect, it } from "vitest";
import { orthogonalizePair, computeRetrievalSuppression, computeDomainInterferencePressure, detectProactiveInterference, detectRetroactiveInterference, ORTHOGONALIZATION_RATE, MIN_ORTHOGONAL_SIMILARITY, RETRIEVAL_SUPPRESSION, INTERFERENCE_THRESHOLD, CONTEXT_DISCOUNT, CRITICAL_INTERFERENCE } from "../../src/recall/interference.js";

describe("interference — constant parity", () => {
  it("ORTHOGONALIZATION_RATE=0.15", ()=>{expect(ORTHOGONALIZATION_RATE).toBeCloseTo(0.15,5);});
  it("MIN_ORTHOGONAL_SIMILARITY=0.2", ()=>{expect(MIN_ORTHOGONAL_SIMILARITY).toBeCloseTo(0.2,5);});
  it("RETRIEVAL_SUPPRESSION=0.3", ()=>{expect(RETRIEVAL_SUPPRESSION).toBeCloseTo(0.3,5);});
  it("INTERFERENCE_THRESHOLD=0.7", ()=>{expect(INTERFERENCE_THRESHOLD).toBeCloseTo(0.7,5);});
  it("CONTEXT_DISCOUNT=0.3", ()=>{expect(CONTEXT_DISCOUNT).toBeCloseTo(0.3,5);});
  it("CRITICAL_INTERFERENCE=0.85", ()=>{expect(CRITICAL_INTERFERENCE).toBeCloseTo(0.85,5);});
});

describe("interference — orthogonalizePair", () => {
  it("mismatched dims → 0", ()=>{const[,,s]=orthogonalizePair([1,0],[1,0,0]);expect(s).toBe(0);});
  it("orthogonal unchanged", ()=>{const[a,,s]=orthogonalizePair([1,0,0],[0,1,0]);expect(a).toEqual([1,0,0]);expect(s).toBeCloseTo(0,5);});
  it("identical: sim in [MIN_SIM,1]", ()=>{const[,,s]=orthogonalizePair([1,0,0],[1,0,0]);expect(s).toBeGreaterThanOrEqual(MIN_ORTHOGONAL_SIMILARITY);expect(s).toBeLessThanOrEqual(1.0);});
  it("deterministic", ()=>{const a=[0.8,0.6,0],b=[0.6,0.8,0];const[,,s1]=orthogonalizePair([...a],[...b]);const[,,s2]=orthogonalizePair([...a],[...b]);expect(s1).toBeCloseTo(s2,10);});
  it("ablated=identity", ()=>{const[,,s]=orthogonalizePair([1,0,0],[1,0,0],{ablated:true});expect(s).toBeCloseTo(1.0,5);});
});

describe("interference — computeRetrievalSuppression", () => {
  it("identity for no competitors", ()=>{expect(computeRetrievalSuppression(0.8,[])).toBeCloseTo(0.8,5);});
  it("identity for weaker", ()=>{expect(computeRetrievalSuppression(0.8,[0.3,0.5])).toBeCloseTo(0.8,5);});
  it("target-(comp-target)*0.3", ()=>{expect(computeRetrievalSuppression(0.5,[0.8])).toBeCloseTo(0.41,5);});
  it("clamps at 0", ()=>{expect(computeRetrievalSuppression(0.1,[1,1,1])).toBeGreaterThanOrEqual(0);});
  it("ablated=identity", ()=>{expect(computeRetrievalSuppression(0.5,[0.9],{ablated:true})).toBeCloseTo(0.5,5);});
});

describe("interference — computeDomainInterferencePressure", () => {
  it("low for single", ()=>{expect(computeDomainInterferencePressure([[1,0,0]]).pressure_level).toBe("low");});
  it("critical for identical", ()=>{const e=[1,0,0];expect(computeDomainInterferencePressure([e,e,e]).pressure_level).toBe("critical");});
  it("low for orthogonal", ()=>{expect(computeDomainInterferencePressure([[1,0,0],[0,1,0],[0,0,1]]).pressure_level).toBe("low");});
  it("deterministic", ()=>{const e=[[0.8,0.6,0],[0.7,0.7,0],[0,0,1]];expect(computeDomainInterferencePressure(e)).toEqual(computeDomainInterferencePressure(e));});
});

describe("interference — detectProactiveInterference", () => {
  it("empty for dissimilar", ()=>{expect(detectProactiveInterference([1,0,0],[],[{id:1,embedding:[0,1,0]}])).toHaveLength(0);});
  it("detects high-sim", ()=>{const r=detectProactiveInterference([1,0,0],[],[{id:99,embedding:[0.99,0.14,0],heat:0.8,consolidation_stage:"consolidated"}]);expect(r.length).toBeGreaterThan(0);expect(r[0]!.interference_type).toBe("proactive");});
  it("deterministic", ()=>{const m=[{id:1,embedding:[0.95,0.31,0],heat:0.7}];expect(detectProactiveInterference([1,0,0],[],m)).toEqual(detectProactiveInterference([1,0,0],[],m));});
});

describe("interference — detectRetroactiveInterference", () => {
  it("empty when risk<=0.2", ()=>{expect(detectRetroactiveInterference([1,0,0],0.1,[{id:5,embedding:[0.99,0.14,0],consolidation_stage:"consolidated",heat:0.9}])).toHaveLength(0);});
  it("detects labile under high-importance", ()=>{const r=detectRetroactiveInterference([1,0,0],0.9,[{id:7,embedding:[0.99,0.14,0],consolidation_stage:"labile",heat:0.1,importance:0.1}]);expect(r.length).toBeGreaterThan(0);expect(r[0]!.interference_type).toBe("retroactive");});
});
