/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * PG recall: intent-adaptive retrieval via recall_memories() + reranking.
 * Port of: mcp_server/core/pg_recall.py | Source SHA: cortex@ed33435
 */
import { QueryIntent } from "./types.js";
import type { QueryIntentValue } from "./types.js";
import { computePgWeights } from "./pg-recall-weights.js";
import { hopfieldComplete, hdcRerank, spreadingActivationExpand, dendriticModulate, emotionalRetrievalRerank, moodCongruentRerank, reconsolidationApply } from "./recall-pipeline.js";
import type { Candidate, RecallStore, HopfieldEngine, HdcEngine, ExtractQueryEntities, VaderCompoundFn, ComputeReconsolidationFn } from "./recall-pipeline.js";
import { rerankResults } from "./reranker.js";
import type { FlashRankAdapter } from "./reranker.js";

export { computePgWeights };
export type { Candidate, RecallStore };

/**
 * Blend relevance + chronological rank via RRF.
 * source: cortex@ed33435 mcp_server/core/pg_recall.py lines 69-104
 * source: Chen et al. (2025) arxiv 2508.18748 ChronoRAG
 * source: Cormack, Clarke & Buettcher (SIGIR 2009) RRF
 * beta=0.5, k=60: source: cortex@ed33435 mcp_server/core/pg_recall.py line 384
 */
export function chronologicalRerank(cands: Candidate[], beta=0.5, k=60): Candidate[] {
  const wr=cands.map((c,i)=>({...c,_rr:i}));
  const chrono=[...wr].sort((a,b)=>(a.created_at??"").localeCompare(b.created_at??""));
  const cm=new Map<number,number>(chrono.map((c,i)=>[c.memory_id,i]));
  return wr.map(c=>{
    const sc=(1-beta)/(k+c._rr)+beta/(k+(cm.get(c.memory_id)??0));
    const o={...c,score:sc};delete(o as Record<string,unknown>)["_rr"];return o;
  }).sort((a,b)=>b.score-a.score);
}

async function getUserMood(store: RecallStore): Promise<number|null> {
  if(!store.getUserMood) return null;
  try{const v=await store.getUserMood();if(v==null)return null;return Math.max(-1,Math.min(1,Number(v)));}catch{return null;}
}

export interface PgRecallStore extends RecallStore {
  recallMemories(p:{queryText:string;queryEmbedding:number[]|null;intent:string;domain?:string;directory?:string;agentTopic?:string;minHeat:number;maxResults:number;wrrfK:number;weights:Record<string,number>;includeGlobals:boolean}):Promise<Candidate[]>;
  searchByTagVector?(qEmb:number[],tag:string,p:{domain?:string;limit:number}):Promise<Array<{id?:number;memory_id?:number;[k:string]:unknown}>>;
}
export interface EmbeddingsEngine{encode(t:string):Promise<number[]>;dimensions:number;}
export interface IntentInfo{intent:QueryIntentValue;weights?:Record<string,number>;}
export interface RecallDependencies{
  store:PgRecallStore;embeddings:EmbeddingsEngine;
  hopfieldEngine?:HopfieldEngine;hdcEngine?:HdcEngine;
  extractEntities?:ExtractQueryEntities;vaderCompound?:VaderCompoundFn;
  computeReconsolidation?:ComputeReconsolidationFn;rerankAdapter?:FlashRankAdapter;
  classifyIntent?:(q:string)=>IntentInfo;
}
export interface RecallOptions{
  topK?:number;domain?:string;directory?:string;agentTopic?:string;
  minHeat?:number;rerank?:boolean;rerankAlpha?:number;wrrfK?:number;includeGlobals?:boolean;
}

// source: cortex@ed33435 mcp_server/core/pg_recall.py lines 341-344 (ENGRAM arxiv 2511.12960)
const TYPE_INTENTS: Partial<Record<QueryIntentValue,string>>={[QueryIntent.INSTRUCTION]:"instruction",[QueryIntent.PREFERENCE]:"preference"};

/**
 * Full PG-path retrieval.
 * source: cortex@ed33435 mcp_server/core/pg_recall.py lines 210-401
 */
export async function recall(q:string,deps:RecallDependencies,opts:RecallOptions={}):Promise<Candidate[]> {
  const{store,embeddings,hopfieldEngine,hdcEngine,extractEntities,vaderCompound,computeReconsolidation,rerankAdapter=null,classifyIntent}=deps;
  const topK=opts.topK??10;
  // source: cortex@ed33435 mcp_server/core/pg_recall.py line 219 (min_heat=0.01)
  const minHeat=opts.minHeat??0.01;
  const wrrfK=opts.wrrfK??60,shouldRerank=opts.rerank??true;
  // source: cortex@ed33435 mcp_server/core/pg_recall.py line 222 (rerank_alpha=0.70)
  const rerankAlpha=opts.rerankAlpha??0.70;
  const includeGlobals=opts.includeGlobals??true;
  const ii=classifyIntent?classifyIntent(q):{intent:QueryIntent.GENERAL,weights:{}};
  const intent=ii.intent;
  const weights=computePgWeights(intent,ii.weights??{});
  const qEmb=embeddings?await embeddings.encode(q):null;
  let cands=await store.recallMemories({queryText:q,queryEmbedding:qEmb,intent,domain:opts.domain,directory:opts.directory,agentTopic:opts.agentTopic,minHeat,maxResults:topK,wrrfK,weights,includeGlobals});
  if(!cands.length)return[];
  cands=await hopfieldComplete(cands,qEmb,store,embeddings.dimensions,{engine:hopfieldEngine});
  cands=hdcRerank(cands,q,{engine:hdcEngine});
  cands=await spreadingActivationExpand(cands,q,store,{extractEntities});
  cands=await dendriticModulate(cands,q,store,{extractEntities});
  cands=emotionalRetrievalRerank(cands,q,{vaderCompound});
  cands=moodCongruentRerank(cands,await getUserMood(store));
  cands=await reconsolidationApply(cands,q,store,{computeReconsolidation,vaderCompound});
  if(shouldRerank&&cands.length>1){
    const pairs:Array<[number,number]>=cands.map(c=>[c.memory_id,c.score??0]);
    const cm=new Map<number,string>(cands.map(c=>[c.memory_id,c.content]));
    // source: cortex@ed33435 mcp_server/core/pg_recall.py line 327 (max_content_len=1200)
    const re=await rerankResults(q,pairs,cm,rerankAlpha,1200,false,rerankAdapter);
    const cdm=new Map<number,Candidate>(cands.map(c=>[c.memory_id,c]));
    cands=re.reduce<Candidate[]>((a,[id,sc])=>{const c=cdm.get(id);if(c)a.push({...c,score:sc});return a;},[]);
  }
  const tag=TYPE_INTENTS[intent];
  if(tag&&qEmb&&store.searchByTagVector){
    const seen=new Set(cands.map(c=>c.memory_id));
    try{
      const typed=await store.searchByTagVector(qEmb,tag,{domain:opts.domain,limit:2});
      for(const t of typed){const id=(t.id??t.memory_id) as number|undefined;if(id!=null&&!seen.has(id)){cands.unshift({...(t as Candidate),memory_id:id});seen.add(id);}}
    }catch{}
  }
  if(intent===QueryIntent.EVENT_ORDER&&cands.length>1) cands=chronologicalRerank(cands,0.5,60);
  return cands.slice(0,topK);
}
