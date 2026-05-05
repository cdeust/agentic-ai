/**
 * Synaptic Tagging & Capture (STC).
 * // source: Frey U, Morris RGM (1997) Nature 385:533-536.
 * // source: Clopath C et al. (2008) PLoS Comp Biol 4:e1000248.
 * // source: Luboeinski J, Tetzlaff C (2021) Frontiers Comp Neurosci. Bistable ODE: dz/dt=z*(1-z)*(z-0.5).
 * Tag window adapted: 90min bio -> 48h. Proximity proxy: Szymkiewicz-Simpson overlap.
 * Port of: mcp_server/core/synaptic_tagging.py  Pure business logic — no I/O.
 */
const DTI=0.7,DMW=0.5,DMO=0.3,DIB=0.25,DHB=1.5,DTW=48.0,DMP=5;
// // source: Luboeinski & Tetzlaff (2021): unstable fixed point at z=0.5.
const BISTABLE_THRESHOLD=0.5;
/** // source: Luboeinski (2021). postcondition: z in [0,1]; z>0.5->toward 1, z<0.5->toward 0. */
export function bistableConsolidation(z:number,dt=1.0):number{return Math.max(0.0,Math.min(1.0,z+z*(1.0-z)*(z-BISTABLE_THRESHOLD)*dt));}
/** postcondition: z<0.5 if !hasPrp; z>=0.5 if hasPrp. */
export function computeInitialZ(hasPrp:boolean,overlap:number):number{return hasPrp?BISTABLE_THRESHOLD+overlap*BISTABLE_THRESHOLD:overlap*0.4;}
interface MemRecord{id:number;importance?:number;age_hours?:number;entities?:Set<string>;heat?:number;}
export interface TaggingCandidate{memory_id:number;overlap:number;matched_entities:string[];consolidation_z:number;}
function scoreCandidate(mem:MemRecord,ne:ReadonlySet<string>,mw:number,tw:number,mo:number):[number,TaggingCandidate]|null{
  if((mem.importance??0)>mw)return null;if((mem.age_hours??999)>tw)return null;
  if(!mem.entities||mem.entities.size===0)return null;
  const inter:string[]=[];for(const e of ne)if(mem.entities.has(e))inter.push(e);
  if(!inter.length)return null;
  const ov=inter.length/Math.min(ne.size,mem.entities.size);if(ov<mo)return null;
  const zf=bistableConsolidation(computeInitialZ(true,ov));
  return[ov,{memory_id:mem.id,overlap:Math.round(ov*10000)/10000,matched_entities:inter.sort(),consolidation_z:Math.round(zf*10000)/10000}];
}
export function findTaggingCandidates(ne:ReadonlySet<string>,imp:number,mems:readonly MemRecord[],opts:{triggerImportance?:number;maxWeakImportance?:number;minOverlap?:number;tagWindowHours?:number;maxPromotions?:number}={}):TaggingCandidate[]{
  const{triggerImportance=DTI,maxWeakImportance=DMW,minOverlap=DMO,tagWindowHours=DTW,maxPromotions=DMP}=opts;
  if(imp<triggerImportance||ne.size===0)return[];
  const cands:[number,TaggingCandidate][]=[];
  for(const m of mems){const r=scoreCandidate(m,ne,maxWeakImportance,tagWindowHours,minOverlap);if(r)cands.push(r);}
  cands.sort((a,b)=>b[0]-a[0]);return cands.slice(0,maxPromotions).map(c=>c[1]);
}
export interface TagBoosts{new_importance:number;new_heat:number;importance_delta:number;heat_delta:number;consolidation_z:number;}
export function computeTagBoosts(ov:number,ci:number,ch:number,ib=DIB,hb=DHB):TagBoosts{
  const z=bistableConsolidation(computeInitialZ(true,ov));
  const ni=Math.min(1.0,ci+ib*ov*z),nh=Math.min(1.0,ch*(1.0+(hb-1.0)*ov*z));
  return{new_importance:Math.round(ni*10000)/10000,new_heat:Math.round(nh*10000)/10000,importance_delta:Math.round((ni-ci)*10000)/10000,heat_delta:Math.round((nh-ch)*10000)/10000,consolidation_z:Math.round(z*10000)/10000};
}
export function applySynapticTags(ne:ReadonlySet<string>,imp:number,mems:readonly MemRecord[],opts:{triggerImportance?:number;maxWeakImportance?:number;minOverlap?:number;tagWindowHours?:number;maxPromotions?:number;importanceBoost?:number;heatBoost?:number}={}):Array<TaggingCandidate&TagBoosts>{
  const{importanceBoost=DIB,heatBoost=DHB,...rest}=opts;
  const cands=findTaggingCandidates(ne,imp,mems,rest);const r:Array<TaggingCandidate&TagBoosts>=[];
  for(const c of cands){const m=mems.find(x=>x.id===c.memory_id);if(!m)continue;r.push({...c,...computeTagBoosts(c.overlap,m.importance??0.5,m.heat??0.1,importanceBoost,heatBoost)});}
  return r;
}
