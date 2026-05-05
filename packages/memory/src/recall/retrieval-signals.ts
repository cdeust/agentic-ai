/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Retrieval signal computation: HDC, Hopfield, SR, Spreading Activation.
 * Port of: mcp_server/core/retrieval_signals.py | Source SHA: cortex@ed33435
 */
import type { HopfieldEngine, HdcEngine, ExtractQueryEntities } from "./recall-pipeline.js";

export interface SignalStore {
  getHotEmbeddings?(p:{minHeat:number;limit:number}):Promise<Array<[number,number[]|null,number]>>;
  getTemporalCoAccess?(p:{windowHours:number;minAccess:number;limit:number}):Promise<Array<[number,number,number]>>;
  spreadActivationMemories?(p:{queryTerms:string[];decay:number;threshold:number;maxDepth:number;maxResults:number;minHeat:number}):Promise<Array<[number,number]>>;
}

export interface RetrievalSettings {HOPFIELD_BETA:number;SA_DECAY:number;SA_THRESHOLD:number;SA_MAX_DEPTH:number;SA_MAX_NODES:number;}

function srScores(seeds:number[],g:Map<number,Map<number,number>>,k:number):Array<[number,number]> {
  const s=new Map<number,number>();
  for(const seed of seeds){const nb=g.get(seed);if(!nb)continue;for(const[n,w]of nb)s.set(n,(s.get(n)??0)+w);}
  return Array.from(s.entries()).sort(([,a],[,b])=>b-a).slice(0,k);
}

async function computeSr(store:SignalStore,vec:Array<[number,number]>,pool:number):Promise<Array<[number,number]>> {
  try {
    if(!vec.length||!store.getTemporalCoAccess) return [];
    // source: cortex@ed33435 mcp_server/core/retrieval_signals.py line 93 (windowHours=2.0, limit=100)
    const ps=await store.getTemporalCoAccess({windowHours:2.0,minAccess:1,limit:100});
    if(!ps.length) return [];
    const g=new Map<number,Map<number,number>>();
    for(const[a,b,p]of ps){
      if(!g.has(a))g.set(a,new Map());if(!g.has(b))g.set(b,new Map());
      const na = g.get(a) ?? new Map<number,number>(); g.set(a, na); na.set(b, p);
      // source: cortex@ed33435 mcp_server/core/retrieval_signals.py line 100 (back-link 0.45)
      const nb = g.get(b) ?? new Map<number,number>(); g.set(b, nb); nb.set(a, p*0.45);
    }
    return srScores(vec.slice(0,3).map(([id])=>id),g,pool);
  } catch {return [];}
}

async function computeSa(q:string,store:SignalStore,mh:number,s:RetrievalSettings,ex:ExtractQueryEntities):Promise<Array<[number,number]>> {
  try {
    if(!store.spreadActivationMemories) return [];
    const terms=[...new Set([...ex(q),...q.split(/\s+/).filter(w=>w.length>2)])];
    if(!terms.length) return [];
    return await store.spreadActivationMemories({queryTerms:terms,decay:s.SA_DECAY,threshold:s.SA_THRESHOLD,maxDepth:s.SA_MAX_DEPTH,maxResults:s.SA_MAX_NODES,minHeat:mh});
  } catch {return [];}
}

/**
 * Hopfield + HDC signals.
 * HDC normalization (score+1)/2: source: cortex@ed33435 mcp_server/core/retrieval_signals.py line 59
 * Port of: mcp_server/core/retrieval_signals.py::compute_hopfield_hdc
 * source: cortex@ed33435 mcp_server/core/retrieval_signals.py lines 19-62
 */
export async function computeHopfieldHdc(
  q:string,qEmb:number[]|null,store:SignalStore,emb:{dimensions:number},
  hot:Array<{id:number;content?:string}>,s:RetrievalSettings,pool:number,mh:number,
  he?:HopfieldEngine,hdc?:HdcEngine,
):Promise<{hop:Array<[number,number]>;hdc:Array<[number,number]>}> {
  let hop:Array<[number,number]>=[],hd:Array<[number,number]>=[];
  if(qEmb&&he&&store.getHotEmbeddings){
    try{
      const ps=await store.getHotEmbeddings({minHeat:mh,limit:pool*2});
      const ep:Array<[number,number[]]>=ps.filter(([,e])=>e!==null).map(([id,e])=>[id,e as number[]]);
      if(ep.length){const{matrix,ids}=he.buildPatternMatrix(ep,emb.dimensions);if(matrix.length)hop=he.retrieve(qEmb,matrix,ids,s.HOPFIELD_BETA,pool);}
    }catch{}
  }
  if(hdc&&hot.length){
    try{
      // source: cortex@ed33435 mcp_server/core/retrieval_signals.py line 56 (threshold=0.05)
      const raw=hdc.computeHdcScores(q,hot.map(m=>[m.id,m.content??""]),0.05);
      hd=raw.map(([id,sc])=>[id,(sc+1)/2]);
    }catch{}
  }
  return{hop,hdc:hd};
}

/**
 * SR + SA graph signals.
 * Port of: mcp_server/core/retrieval_signals.py::compute_graph_signals
 * source: cortex@ed33435 mcp_server/core/retrieval_signals.py lines 65-80
 */
export async function computeGraphSignals(q:string,store:SignalStore,vec:Array<[number,number]>,mh:number,s:RetrievalSettings,pool:number,ex:ExtractQueryEntities):Promise<{sr:Array<[number,number]>;sa:Array<[number,number]>}> {
  const[sr,sa]=await Promise.all([computeSr(store,vec,pool),computeSa(q,store,mh,s,ex)]);
  return{sr,sa};
}
