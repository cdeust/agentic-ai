/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * 3-tier retrieval dispatch.
 * Port of: mcp_server/core/retrieval_dispatch.py | Source SHA: cortex@ed33435
 */
import { QueryIntent } from "./types.js";
import type { QueryIntentValue } from "./types.js";
export { QueryIntent };

// source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py lines 21-29
// source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py lines 21-29
// Simple intents (for documentation; tier falls through to 'simple' by default)
// const SIMPLE_INTENTS = [GENERAL,SEMANTIC,TEMPORAL,CAUSAL,KNOWLEDGE_UPDATE]
const MI=new Set<QueryIntentValue>([QueryIntent.MULTI_HOP]);
const DI=new Set<QueryIntentValue>([QueryIntent.ENTITY,QueryIntent.INSTRUCTION]);

/** source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py lines 32-38 */
export function classifyTier(i: QueryIntentValue): "simple"|"mixed"|"deep" {
  return MI.has(i) ? "mixed" : DI.has(i) ? "deep" : "simple";
}

/**
 * Weighted Reciprocal Rank Fusion.
 * source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py lines 44-56
 * source: Cormack, Clarke & Buettcher (SIGIR 2009)
 */
export function wrrfFuse(sr: Array<Array<[number,number]>>, sw: number[], k=60): Array<[number,number]> {
  const s=new Map<number,number>();
  for(let i=0;i<sr.length;i++){const w=sw[i]??0;if(w<=0)continue;const rs=sr[i];if(!rs)continue;for(let r=0;r<rs.length;r++){const pair=rs[r];if(!pair)continue;const[mid]=pair;s.set(mid,(s.get(mid)??0)+w/(k+r+1));}}
  return Array.from(s.entries()).sort(([,a],[,b])=>b-a);
}

const SN=["vector","fts","heat","hopfield","hdc","sr","sa","bm25","ngram"] as const;
type SN=(typeof SN)[number];
type WM=Record<SN,number>;

// source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py lines 74-136
const bw=(v:number,f:number,h:number,sa:number):WM=>({vector:v,fts:f,heat:h,hopfield:v*0.5,hdc:v*0.4,sr:h*0.6,sa,bm25:f*0.8,ngram:f*0.6});
const dw=(v:number,f:number,h:number,sa:number):WM=>({vector:v*0.7,fts:f*1.2,heat:h*0.5,hopfield:v*0.3,hdc:v*0.2,sr:h*0.3,sa:sa*1.5,bm25:f*1.5,ngram:f*1.0});
const mw=(v:number,f:number,h:number,sa:number):WM=>({vector:v,fts:f,heat:h,hopfield:v*0.5,hdc:v*0.4,sr:h*0.6,sa:sa*1.2,bm25:f*0.8,ngram:f*0.6});
const iw=(v:number,f:number,h:number,sa:number):WM=>({vector:v*0.5,fts:f*1.5,heat:h*0.5,hopfield:v*0.2,hdc:v*0.2,sr:h*0.3,sa:sa*0.5,bm25:f*2.0,ngram:f*1.2});

/** source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py lines 139-158 */
export function computeSignalWeights(tier:string,iw2:Partial<Record<string,number>>,bv=1.0,bf=0.5,bh=0.3,intent?:QueryIntentValue):WM {
  const v=bv*(iw2["vector"]??1),f=bf*(iw2["fts"]??1),h=bh*(iw2["heat"]??1),sa=f*0.5*(iw2["spreading"]??1);
  if(intent===QueryIntent.INSTRUCTION)return iw(v,f,h,sa);
  if(tier==="deep")return dw(v,f,h,sa);
  if(tier==="mixed")return mw(v,f,h,sa);
  return bw(v,f,h,sa);
}

/** hop_weight=0.3 source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py line 167 */
export function mergeMultihopResults(p:Array<[number,number]>,s2:Array<[number,number]>,hw=0.3):Array<[number,number]> {
  const m=new Map<number,number>(p);
  for(const[id,sc]of s2){ if(m.has(id)){m.set(id,(m.get(id)??0)+sc*hw);}else{m.set(id,sc*hw);} }
  return Array.from(m.entries()).sort(([,a],[,b])=>b-a);
}

export interface DispatchRetrievalOpts {
  wrrf_k?:number;base_vector_w?:number;base_fts_w?:number;base_heat_w?:number;max_results?:number;
  hop_fn?:(s:string)=>Promise<Array<[number,number]>>;
  decompose?:(q:string)=>{sub_queries:string[]};
}

/** source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py lines 196-235 */
export async function dispatchRetrieval(q:string,sigs:Partial<Record<SN,Array<[number,number]>>>,ii:{intent:QueryIntentValue;weights?:Record<string,number>},opts:DispatchRetrievalOpts={}):Promise<[Array<[number,number]>,string]> {
  const tier=classifyTier(ii.intent);
  const w=computeSignalWeights(tier,ii.weights??{},opts.base_vector_w??1,opts.base_fts_w??0.5,opts.base_heat_w??0.3,ii.intent);
  let f=wrrfFuse(SN.map(n=>sigs[n]??[]),SN.map(n=>w[n]),opts.wrrf_k??60);
  if(tier==="mixed"&&opts.hop_fn&&opts.decompose){
    try{const d=opts.decompose(q);for(const sq of(d.sub_queries??[]).slice(0,3)){const h=await opts.hop_fn(sq);if(h.length)f=mergeMultihopResults(f,h);}}catch{}
  }
  return [f.slice(0,(opts.max_results??10)*3),tier];
}
