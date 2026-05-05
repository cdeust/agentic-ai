/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Interference management.
 * Port of: mcp_server/core/interference.py + interference_detection.py
 * Source SHA: cortex@ed33435
 * source: Norman, Newman & Detre (2007) Psych. Review 114:887-953
 * source: Anderson & Neely (1996); Yassa & Stark (2011); Jaccard (1912)
 */

// source: cortex@ed33435 mcp_server/core/interference.py line 70 (hand-tuned)
export const ORTHOGONALIZATION_RATE = 0.15;
// source: cortex@ed33435 mcp_server/core/interference.py line 73 (hand-tuned)
export const MIN_ORTHOGONAL_SIMILARITY = 0.2;
// source: cortex@ed33435 mcp_server/core/interference.py line 79 (hand-tuned)
export const RETRIEVAL_SUPPRESSION = 0.3;
// source: cortex@ed33435 mcp_server/core/interference.py line 85 (hand-tuned; Yassa & Stark 2011)
export const INTERFERENCE_THRESHOLD = 0.7;
// source: cortex@ed33435 mcp_server/core/interference_detection.py line 47 (hand-tuned)
export const CONTEXT_DISCOUNT = 0.3;
// source: cortex@ed33435 mcp_server/core/interference_detection.py line 53 (hand-tuned)
export const CRITICAL_INTERFERENCE = 0.85;

function dot(a: number[], b: number[]): number { let s=0; for(let i=0;i<a.length;i++) s+=(a[i]??0)*(b[i]??0); return s; }
function norm(v: number[]): number { return Math.sqrt(v.reduce((s,x)=>s+x*x,0)); }
function scale(v: number[], s: number): number[] { return v.map(x=>x*s); }
function sub(a: number[], b: number[]): number[] { return a.map((x,i)=>x-(b[i]??0)); }
function addV(a: number[], b: number[]): number[] { return a.map((x,i)=>x+(b[i]??0)); }
function cosSim(a: number[], b: number[]): number {
  const na=norm(a), nb=norm(b);
  // source: numerical stability floor, standard IEEE 754 practice
  if(na<1e-10||nb<1e-10) return 0;
  return dot(a,b)/(na*nb);
}
function jacc<T>(a: Set<T>, b: Set<T>): number {
  if(!a.size&&!b.size) return 0; let n=0; for(const v of a) if(b.has(v)) n++;
  const u=a.size+b.size-n; return u?n/u:0;
}
// source: numerical stability floor, standard IEEE 754 practice
function renorm(v: number[], fb: number[]): number[] { const n=norm(v); return n>1e-10?scale(v,1/n):[...fb]; }

// source: cortex@ed33435 mcp_server/core/interference.py lines 91-108
function projAway(vec: number[], basis: number[], rate: number): number[] {
  const bns=dot(basis,basis);
  // source: numerical stability floor, standard IEEE 754 practice
  if(bns<1e-10) return [...vec];
  return sub(vec, scale(basis, dot(vec,basis)/bns*rate*0.5));
}

// source: cortex@ed33435 mcp_server/core/interference.py lines 118-136
function backoff(na: number[], nb: number[], oa: number[], ob: number[], ns: number, cs: number, ms: number): [number[],number[],number] {
  // source: cortex@ed33435 mcp_server/core/interference.py line 129; 1e-10=IEEE 754 floor
  const t=Math.min(1,Math.max(0,(ms-ns)/Math.max(cs-ns,1e-10)));
  const ba=renorm(addV(scale(na,1-t),scale(oa,t)),oa);
  const bb=renorm(addV(scale(nb,1-t),scale(ob,t)),ob);
  return [ba,bb,cosSim(ba,bb)];
}

/**
 * Gradually push two embeddings apart (one sleep cycle).
 * source: cortex@ed33435 mcp_server/core/interference.py lines 142-193
 */
export function orthogonalizePair(a: number[], b: number[], opts?: { rate?: number; minSimilarity?: number; ablated?: boolean }): [number[],number[],number] {
  if(opts?.ablated){const s=a.length===b.length?cosSim(a,b):0; return[[...a],[...b],s];}
  if(a.length!==b.length) return[[...a],[...b],0];
  const rate=opts?.rate??ORTHOGONALIZATION_RATE, ms=opts?.minSimilarity??MIN_ORTHOGONAL_SIMILARITY;
  const cs=cosSim(a,b);
  if(cs<=ms) return[[...a],[...b],cs];
  const na=renorm(projAway(a,b,rate),a), nb=renorm(projAway(b,a,rate),b);
  const ns=cosSim(na,nb);
  if(ns<ms){const[ba,bb,bs]=backoff(na,nb,a,b,ns,cs,ms);return[ba,bb,parseFloat(bs.toFixed(6))];}
  return[na,nb,parseFloat(ns.toFixed(6))];
}

/**
 * Lateral inhibition from Norman et al. 2007 LCA (simplified).
 * source: cortex@ed33435 mcp_server/core/interference.py lines 199-243
 */
export function computeRetrievalSuppression(target: number, competitors: number[], opts?: { suppressionFactor?: number; ablated?: boolean }): number {
  if(opts?.ablated) return target;
  if(!competitors.length) return target;
  const sf=opts?.suppressionFactor??RETRIEVAL_SUPPRESSION;
  const strong=competitors.filter(s=>s>target);
  if(!strong.length) return target;
  return Math.max(0, target - strong.reduce((s,c)=>s+(c-target)*sf,0));
}

export interface DomainInterferencePressure {
  mean_max_similarity: number; interfering_pair_fraction: number;
  avg_interference_score: number; pressure_level: "low"|"medium"|"high"|"critical";
}

// source: cortex@ed33435 mcp_server/core/interference.py lines 274-287 (hand-tuned)
function classifyPressure(s: number): "low"|"medium"|"high"|"critical" {
  if(s>=0.5)return"critical";if(s>=0.3)return"high";if(s>=0.1)return"medium";return"low";
}

/**
 * Aggregate interference metrics for a domain.
 * source: cortex@ed33435 mcp_server/core/interference.py lines 297-331
 */
export function computeDomainInterferencePressure(embeddings: number[][], opts?: { threshold?: number; sampleLimit?: number }): DomainInterferencePressure {
  const LOW={mean_max_similarity:0,interfering_pair_fraction:0,avg_interference_score:0,pressure_level:"low" as const};
  if(embeddings.length<2) return{...LOW};
  const thr=opts?.threshold??INTERFERENCE_THRESHOLD;
  // source: cortex@ed33435 mcp_server/core/interference.py line 317 (sample_limit=100 default)
  const n=Math.min(embeddings.length,opts?.sampleLimit??100);
  let ip=0,tp=0; const ms:number[]=[];
  for(let i=0;i<n;i++){
    let best=0;
    for(let j=0;j<n;j++){if(i===j)continue;const ei=embeddings[i],ej=embeddings[j];if(!ei||!ej)continue;const s=cosSim(ei,ej);best=Math.max(best,s);if(s>=thr)ip++;tp++;}
    ms.push(best);
  }
  const mm=ms.length?ms.reduce((s,v)=>s+v,0)/ms.length:0;
  const pf=ip/Math.max(tp,1),avg=mm*pf;
  return{mean_max_similarity:parseFloat(mm.toFixed(4)),interfering_pair_fraction:parseFloat(pf.toFixed(4)),avg_interference_score:parseFloat(avg.toFixed(4)),pressure_level:classifyPressure(avg)};
}

export interface InterferenceDescriptor {
  memory_id: number|undefined; similarity: number; entity_overlap?: number;
  interference_score: number; interference_type: "proactive"|"retroactive"; resolution_hint: string;
}
export interface MemoryForInterference {
  id?: number; embedding?: number[]|null; entities?: string[]; heat?: number;
  importance?: number; consolidation_stage?: string; directory_context?: string; new_directory?: string;
}

// source: cortex@ed33435 mcp_server/core/interference_detection.py lines 62-76
function suggestPi(sc: number, sim: number, stage: string): string {
  if(sc>=CRITICAL_INTERFERENCE)return"pattern_separation";
  if(sim>0.9)return"merge_or_update";
  if(stage==="consolidated")return"context_binding";
  return"normal_encoding";
}
// source: cortex@ed33435 mcp_server/core/interference_detection.py lines 79-93
function suggestRi(sc: number, stage: string, heat: number): string {
  if(sc>=CRITICAL_INTERFERENCE)return"protect_old_memory";
  if(stage==="labile"||stage==="early_ltp")return"accelerate_consolidation";
  if(heat<0.2)return"accept_overwrite";
  return"orthogonalize_at_sleep";
}

// source: cortex@ed33435 mcp_server/core/interference_detection.py lines 99-131 weights hand-tuned
function piScore(sim: number, eo: number, hf: number, stage: string, cm: number): number {
  const sf: Record<string,number>={consolidated:1.2,late_ltp:1.0,early_ltp:0.8,labile:0.5};
  // source: cortex@ed33435 mcp_server/core/interference_detection.py lines 128-131 weights hand-tuned
  return (sim*0.4+eo*0.25+hf*0.2+(sf[stage]??0.7)*0.15)*cm;
}

function evalPi(mem: MemoryForInterference, ne: number[], ns: Set<string>, thr: number): InterferenceDescriptor|null {
  const emb=mem.embedding; if(!emb||emb.length!==ne.length) return null;
  const sim=cosSim(ne,emb); if(sim<thr) return null;
  const me=new Set(mem.entities??[]);
  const eo=ns.size||me.size?jacc(ns,me):0;
  const stage=mem.consolidation_stage??"labile";
  // source: cortex@ed33435 mcp_server/core/interference_detection.py lines 134-144
  const cm=mem.directory_context&&mem.directory_context!==(mem.new_directory??"")?1-CONTEXT_DISCOUNT:1;
  const sc=piScore(sim,eo,mem.heat??0.5,stage,cm);
  if(sc<thr*0.7) return null;
  return{memory_id:mem.id,similarity:parseFloat(sim.toFixed(4)),entity_overlap:parseFloat(eo.toFixed(4)),interference_score:parseFloat(sc.toFixed(4)),interference_type:"proactive",resolution_hint:suggestPi(sc,sim,stage)};
}

/**
 * Detect proactive interference.
 * source: cortex@ed33435 mcp_server/core/interference_detection.py lines 198-237
 */
export function detectProactiveInterference(ne: number[], nents: string[], mems: MemoryForInterference[], opts?: { threshold?: number }): InterferenceDescriptor[] {
  const thr=opts?.threshold??INTERFERENCE_THRESHOLD, ns=new Set(nents), r:InterferenceDescriptor[]=[];
  for(const m of mems){const x=evalPi(m,ne,ns,thr);if(x)r.push(x);}
  return r.sort((a,b)=>b.interference_score-a.interference_score);
}

export interface RetroactiveRisk extends InterferenceDescriptor { vulnerability: number; overwrite_pressure: number; risk_score: number; }

function intResist(stage: string, sim: number): number {
  const b:Record<string,number>={consolidated:0.9,late_ltp:0.7,early_ltp:0.4,labile:0.1};
  return Math.max(0,(b[stage]??0.3)-sim*0.2);
}

function evalRi(mem: MemoryForInterference, ne: number[], ni: number, thr: number): RetroactiveRisk|null {
  const emb=mem.embedding; if(!emb||emb.length!==ne.length) return null;
  const sim=cosSim(ne,emb); if(sim<thr) return null;
  const oh=mem.heat??0.5,oi=mem.importance??0.5,os=mem.consolidation_stage??"labile";
  const vul=(1-intResist(os,sim))*(1-oh*0.5)*(1-oi*0.3);
  const op=ni*sim,rs=vul*op;
  // source: cortex@ed33435 mcp_server/core/interference_detection.py line 288 (risk threshold 0.2)
  if(rs<=0.2) return null;
  return{memory_id:mem.id,similarity:parseFloat(sim.toFixed(4)),vulnerability:parseFloat(vul.toFixed(4)),overwrite_pressure:parseFloat(op.toFixed(4)),risk_score:parseFloat(rs.toFixed(4)),interference_score:parseFloat(rs.toFixed(4)),interference_type:"retroactive",resolution_hint:suggestRi(rs,os,oh)};
}

/**
 * Detect retroactive interference.
 * source: cortex@ed33435 mcp_server/core/interference_detection.py lines 302-339
 */
export function detectRetroactiveInterference(ne: number[], ni: number, mems: MemoryForInterference[], opts?: { threshold?: number }): RetroactiveRisk[] {
  const thr=opts?.threshold??INTERFERENCE_THRESHOLD, r:RetroactiveRisk[]=[];
  for(const m of mems){const x=evalRi(m,ne,ni,thr);if(x)r.push(x as RetroactiveRisk);}
  return r.sort((a,b)=>b.risk_score-a.risk_score);
}
