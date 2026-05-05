/**
 * Predictive coding gate — precision management, neuromodulation, gate decisions.
 * // source: Feldman H, Friston K (2010) Front Hum Neurosci 4:215. Precision = inv variance.
 * // source: Yu AJ, Dayan P (2005) Neuron 46:681-692. NE/ACh modulate precision.
 * // source: Kanai R et al. (2015) Phil Trans R Soc B 370:20140169.
 * Port of: mcp_server/core/predictive_coding_gate.py  Pure business logic — no I/O.
 */
export interface PrecisionState{readonly domain:string;readonly levelPrecisions:readonly[number,number,number];readonly predictionHistory:number;readonly calibrationHits:number;readonly calibrationTotal:number;readonly precisionEmaAlpha:number;}
export function makePrecisionState(o:Partial<{domain:string;levelPrecisions:[number,number,number];predictionHistory:number;calibrationHits:number;calibrationTotal:number;precisionEmaAlpha:number}>={}):PrecisionState{return{domain:o.domain??"",levelPrecisions:o.levelPrecisions??[1.0,1.0,1.0],predictionHistory:o.predictionHistory??0,calibrationHits:o.calibrationHits??0,calibrationTotal:o.calibrationTotal??0,precisionEmaAlpha:o.precisionEmaAlpha??0.1};}
export function updatePrecision(cp:number,pe:number,opts:{learningRate?:number;minPrecision?:number;maxPrecision?:number}={}):number{
  const{learningRate=0.1,minPrecision=0.1,maxPrecision=5.0}=opts;
  const cv=1.0/Math.max(cp,minPrecision),nv=(1-learningRate)*cv+learningRate*pe*pe;
  return Math.max(minPrecision,Math.min(maxPrecision,1.0/Math.max(nv,1e-10)));
}
export function neuromodulatePrecisions(lp:readonly[number,number,number],ne=1.0,ach=0.5):[number,number,number]{
  const ng=0.5+0.5*ne,an=Math.max(0.0,Math.min(1.0,(ach-0.3)/0.7)),bu=0.7+0.6*an,td=1.3-0.6*an;
  return[Math.max(0.1,Math.min(10.0,lp[0]*ng*bu)),Math.max(0.1,Math.min(10.0,lp[1]*ng*bu)),Math.max(0.1,Math.min(10.0,lp[2]*ng*td))];
}
export function updatePrecisionState(s:PrecisionState,le:readonly[number,number,number]):PrecisionState{
  const a=s.precisionEmaAlpha;
  const np=s.levelPrecisions.map((cp,i)=>{const cv=1.0/Math.max(cp,0.1),nv=(1-a)*cv+a*(le[i]??0);return Math.max(0.1,Math.min(10.0,1.0/Math.max(nv,0.01)));}) as [number,number,number];
  return{domain:s.domain,levelPrecisions:np,predictionHistory:s.predictionHistory+1,calibrationHits:s.calibrationHits,calibrationTotal:s.calibrationTotal,precisionEmaAlpha:a};
}
export function precisionToConfidence(lp:readonly number[]):number{const avg=lp.length>0?lp.reduce((s,v)=>s+v,0)/lp.length:1.0;return 1.0/(1.0+Math.exp(-1.5*(avg-1.5)));}
export function checkCalibration(s:PrecisionState,pc:number,wu:boolean,threshold=0.6):PrecisionState{const nh=pc>=threshold&&wu?s.calibrationHits+1:s.calibrationHits;return{...s,calibrationHits:nh,calibrationTotal:s.calibrationTotal+1};}
export function calibrationScore(s:PrecisionState):number{if(s.calibrationTotal<5)return 0.5;return s.calibrationHits/s.calibrationTotal;}
const DEFAULT_THRESHOLD=0.15;
export function gateDecision(ns:number,threshold=0.4,bypass=false):[boolean,string]{if(bypass)return[true,"bypass"];if(ns>=threshold)return[true,"high_novelty"];return[false,`below_threshold (novelty=${ns.toFixed(3)}, threshold=${threshold})`];}
export interface HierarchicalLevelPrediction{free_energy:number;prediction_errors:Record<string,number>;}
export interface HierarchicalPrediction{total_free_energy:number;novelty_score:number;gate_open:boolean;gate_reason:string;levels:[HierarchicalLevelPrediction,HierarchicalLevelPrediction,HierarchicalLevelPrediction];}
export function hierarchicalGateDecision(p:HierarchicalPrediction,threshold=DEFAULT_THRESHOLD,bypass=false):[boolean,string]{
  if(bypass)return[true,"bypass"];const fe=p.total_free_energy;
  if(fe>=threshold){const di=p.levels.reduce((bi,l,i,a)=>l.free_energy>(a[bi]?.free_energy??0)?i:bi,0);const ln=["sensory","entity","schema"] as const;return[true,`high_free_energy (FE=${fe.toFixed(3)}, dominant=${ln[di]??"sensory"})`];}
  return[false,`low_free_energy (FE=${fe.toFixed(3)}, threshold=${threshold})`];
}
function topErr(e:Record<string,number>,n:number):Record<string,number>{return Object.entries(e).sort((a,b)=>Math.abs(b[1]??0)-Math.abs(a[1]??0)).slice(0,n).reduce<Record<string,number>>((a,[k,v])=>{a[k]=Math.round((v??0)*10000)/10000;return a},{});}
export function describeHierarchicalSignals(p:HierarchicalPrediction):Record<string,unknown>{
  return{total_free_energy:p.total_free_energy,novelty_score:p.novelty_score,gate_open:p.gate_open,gate_reason:p.gate_reason,level_0_sensory:{free_energy:Math.round((p.levels[0]?.free_energy??0)*10000)/10000,top_errors:topErr(p.levels[0]?.prediction_errors??{},3)},level_1_entity:{free_energy:Math.round((p.levels[1]?.free_energy??0)*10000)/10000,top_errors:topErr(p.levels[1]?.prediction_errors??{},3)},level_2_schema:{free_energy:Math.round((p.levels[2]?.free_energy??0)*10000)/10000,top_errors:topErr(p.levels[2]?.prediction_errors??{},3)}};
}
