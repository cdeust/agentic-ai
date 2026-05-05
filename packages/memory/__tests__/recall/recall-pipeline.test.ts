import { describe, expect, it } from "vitest";
import { emotionalRetrievalRerank, moodCongruentRerank, hdcRerank, dendriticModulate, RRF_K, HOPFIELD_BETA, HDC_BETA, SA_BETA, DENDRITIC_DELTA, EMOTIONAL_RETRIEVAL_BETA, MOOD_CONGRUENT_BETA, EMOTIONAL_QUERY_VALENCE_FLOOR } from "../../src/recall/recall-pipeline.js";
import type { Candidate } from "../../src/recall/recall-pipeline.js";

function mc(id:number,content:string,score:number,o:Partial<Candidate>={}):Candidate {
  return{memory_id:id,content,score,heat:0.5,domain:"test",tags:[],created_at:"",...o};
}

describe("recall-pipeline — constant parity", () => {
  it("RRF_K=60", ()=>{expect(RRF_K).toBe(60);});
  it("HOPFIELD_BETA=0.30", ()=>{expect(HOPFIELD_BETA).toBeCloseTo(0.30,5);});
  it("HDC_BETA=0.20", ()=>{expect(HDC_BETA).toBeCloseTo(0.20,5);});
  it("SA_BETA=0.25", ()=>{expect(SA_BETA).toBeCloseTo(0.25,5);});
  it("DENDRITIC_DELTA=0.10", ()=>{expect(DENDRITIC_DELTA).toBeCloseTo(0.10,5);});
  it("EMOTIONAL_RETRIEVAL_BETA=0.20", ()=>{expect(EMOTIONAL_RETRIEVAL_BETA).toBeCloseTo(0.20,5);});
  it("MOOD_CONGRUENT_BETA=0.15", ()=>{expect(MOOD_CONGRUENT_BETA).toBeCloseTo(0.15,5);});
  it("EMOTIONAL_QUERY_VALENCE_FLOOR=0.10", ()=>{expect(EMOTIONAL_QUERY_VALENCE_FLOOR).toBeCloseTo(0.10,5);});
});

describe("recall-pipeline — emotionalRetrievalRerank", () => {
  const cands=[mc(1,"happy",0.9,{emotional_valence:0.8}),mc(2,"neutral",0.8,{emotional_valence:0.0}),mc(3,"sad",0.7,{emotional_valence:-0.8})];
  it("no-ops without vaderCompound", ()=>{expect(emotionalRetrievalRerank([...cands],"happy").map(c=>c.memory_id)).toEqual([1,2,3]);});
  it("no-ops on neutral (|v|<0.10)", ()=>{expect(emotionalRetrievalRerank([...cands],"neutral",{vaderCompound:():number=>0.05}).map(c=>c.memory_id)).toEqual([1,2,3]);});
  it("positive query promotes positive candidate", ()=>{{ const r=emotionalRetrievalRerank([...cands],"happy",{vaderCompound:():number=>0.7}); expect(r[0]?.memory_id).toBe(1); }});
  it("deterministic", ()=>{const vf = (): number => 0.6;expect(emotionalRetrievalRerank([...cands],"happy",{vaderCompound:vf}).map(c=>c.memory_id)).toEqual(emotionalRetrievalRerank([...cands],"happy",{vaderCompound:vf}).map(c=>c.memory_id));});
});

describe("recall-pipeline — moodCongruentRerank", () => {
  const cands=[mc(10,"upbeat",0.9,{emotional_valence:0.9}),mc(11,"neutral",0.8,{emotional_valence:0.0}),mc(12,"sad",0.7,{emotional_valence:-0.9})];
  it("no-ops when null", ()=>{expect(moodCongruentRerank([...cands],null).map(c=>c.memory_id)).toEqual([10,11,12]);});
  it("positive mood keeps highest-score candidate first", ()=>{expect(moodCongruentRerank([...cands],0.8)[0]!.memory_id).toBe(10);});
  it("mood changes scores vs null", ()=>{
    const wm=moodCongruentRerank([...cands],-0.8).map(c=>c.score);
    const wn=moodCongruentRerank([...cands],null).map(c=>c.score);
    expect(wm).not.toEqual(wn);
  });
  it("deterministic", ()=>{expect(moodCongruentRerank([...cands],0.5).map(c=>c.memory_id)).toEqual(moodCongruentRerank([...cands],0.5).map(c=>c.memory_id));});
});

describe("recall-pipeline — hdcRerank", () => {
  const cands=[mc(1,"rust memory",0.9),mc(2,"python web",0.8)];
  it("no-ops without engine", ()=>{expect(hdcRerank([...cands],"rust").map(c=>c.memory_id)).toEqual([1,2]);});
  it("deterministic with engine", ()=>{
    const e={computeHdcScores:(_q:string,p:Array<[number,string]>)=>p.map(([id])=>[id,0.5] as [number,number])};
    expect(hdcRerank([...cands],"rust",{engine:e}).map(c=>c.memory_id)).toEqual(hdcRerank([...cands],"rust",{engine:e}).map(c=>c.memory_id));
  });
});

describe("recall-pipeline — dendriticModulate", () => {
  it("no-ops for empty", async ()=>{expect(await dendriticModulate([],"q")).toEqual([]);});
  it("factor in [1-delta,1+delta]", async ()=>{
    const c=mc(1,"rust memory system",1.0);
    const r=await dendriticModulate([c],"rust memory");
    const factor=r[0]!.score/c.score;
    expect(factor).toBeGreaterThan(1.0-DENDRITIC_DELTA);
    expect(factor).toBeLessThanOrEqual(1.0+DENDRITIC_DELTA+0.001);
  });
  it("deterministic", async ()=>{
    const cs=[mc(1,"rust memory",0.9),mc(2,"python web",0.7)];
    const r1=(await dendriticModulate([...cs],"rust memory")).map(c=>c.score);
    const r2=(await dendriticModulate([...cs],"rust memory")).map(c=>c.score);
    expect(r1).toEqual(r2);
  });
});
