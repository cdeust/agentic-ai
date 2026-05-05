/**
 * Coupled neuromodulation — 4-channel (DA,NE,ACh,5-HT) cascade.
 * // source: Rescorla & Wagner (1972) Classical Conditioning II, pp.64-99. RPE.
 * // source: Schultz W (1997) Science 275:1593. DA [0,3].
 * // source: Aston-Jones & Cohen (2005) Annu Rev Neurosci 28:403. NE tonic/phasic.
 * // source: Hasselmo ME (2005) Hippocampus 15:936. ACh theta.
 * // source: Dayan & Huys (2009) Annu Rev Neurosci 32:95. 5-HT exploration.
 * // source: Dawes RM (1979) Am Psychologist 34(7):571. Equal weights composite.
 * Port of: mcp_server/core/coupled_neuromodulation.py + neuromodulation_channels.py
 * Pure business logic — no I/O.
 */
export const DA_ALPHA=0.3,NE_ALPHA=0.2,ACH_ALPHA=0.4,SER_ALPHA=0.15; // Ordered by biological speed
const DA_NE=-0.15,NE_ACH=0.2,SER_DA=-0.1,ACH_SER=-0.15; // Cross-coupling (engineering heuristic)
const NE_HAB_RATE=0.05,NE_HAB_DECAY=0.02;
export interface NeuromodulatoryState{readonly dopamine:number;readonly norepinephrine:number;readonly acetylcholine:number;readonly serotonin:number;readonly daBaseline:number;readonly neAdaptation:number;}
export function makeNeuromodulatoryState(o:Partial<NeuromodulatoryState>={}):NeuromodulatoryState{return{dopamine:o.dopamine??1.0,norepinephrine:o.norepinephrine??1.0,acetylcholine:o.acetylcholine??1.0,serotonin:o.serotonin??1.0,daBaseline:o.daBaseline??0.5,neAdaptation:o.neAdaptation??0.0};}
export interface OperationSignals{readonly errorEncountered:boolean;readonly errorResolved:boolean;readonly testPassed:boolean;readonly testFailed:boolean;readonly novelEntities:number;readonly totalEntities:number;readonly thetaPhase:number;readonly achFromTheta:number;readonly schemaMatch:number;readonly memoryImportance:number;}
export function makeOperationSignals(o:Partial<OperationSignals>={}):OperationSignals{return{errorEncountered:o.errorEncountered??false,errorResolved:o.errorResolved??false,testPassed:o.testPassed??false,testFailed:o.testFailed??false,novelEntities:o.novelEntities??0,totalEntities:o.totalEntities??0,thetaPhase:o.thetaPhase??0.0,achFromTheta:o.achFromTheta??0.5,schemaMatch:o.schemaMatch??0.0,memoryImportance:o.memoryImportance??0.5};}
/** // source: Rescorla-Wagner (1972); Schultz (1997). postcondition: da in [0,3], newBaseline in [0.1,0.9]. */
export function computeDopamineRpe(op:boolean,on:boolean,mi:number,dab:number):[number,number]{
  const actual=op?0.7+mi*0.3:on?0.2-mi*0.1:0.5,delta=actual-dab;
  return[Math.max(0.0,Math.min(3.0,1.0+delta)),Math.max(0.1,Math.min(0.9,dab+0.1*(actual-dab)))];
}
/** // source: Aston-Jones (2005). postcondition: ne in [0.3,2.0]. */
export function computeNorepinephrineArousal(err:boolean,cne:number,nad:number):[number,number]{
  let ne:number,na:number;
  if(err){ne=Math.min(2.0,cne+0.5*(1.0-nad));na=Math.min(0.8,nad+NE_HAB_RATE);}
  else{ne=cne+0.1*(1.0-cne);na=Math.max(0.0,nad-NE_HAB_DECAY);}
  return[Math.max(0.3,Math.min(2.0,ne)),na];
}
/** // source: Dayan & Huys (2009). */
export function computeSerotoninExploration(sm:number,ne:number,te:number,cs:number):number{
  const nov=te>0?ne/Math.max(te,1):0.5,target=Math.max(0.3,Math.min(1.8,0.5+nov*0.8-sm*0.5));
  return cs+SER_ALPHA*(target-cs);
}
/** Cross-coupling (engineering heuristic). postcondition: DA[0,3], NE/ACh/5-HT[0.3,2.0]. */
export function applyCrossCoupling(da:number,ne:number,ach:number,ser:number):[number,number,number,number]{
  return[Math.max(0.0,Math.min(3.0,da+SER_DA*(ser-1.0))),Math.max(0.3,Math.min(2.0,ne+DA_NE*(da-1.0))),Math.max(0.3,Math.min(2.0,ach+NE_ACH*(ne-1.0))),Math.max(0.3,Math.min(2.0,ser+ACH_SER*(ach-1.0)))];
}
function computeAch(s:OperationSignals):number{return s.achFromTheta+(s.totalEntities>0?s.novelEntities/Math.max(s.totalEntities,1)*0.3:0.0);}
export function updateState(cur:NeuromodulatoryState,signals:OperationSignals):NeuromodulatoryState{
  const[daR,nb]=computeDopamineRpe(signals.errorResolved||signals.testPassed,signals.errorEncountered||signals.testFailed,signals.memoryImportance,cur.daBaseline);
  const[neR,na]=computeNorepinephrineArousal(signals.errorEncountered,cur.norepinephrine,cur.neAdaptation);
  const achR=computeAch(signals),serR=computeSerotoninExploration(signals.schemaMatch,signals.novelEntities,signals.totalEntities,cur.serotonin);
  const daB=cur.dopamine+DA_ALPHA*(daR-cur.dopamine),neB=cur.norepinephrine+NE_ALPHA*(neR-cur.norepinephrine),achB=cur.acetylcholine+ACH_ALPHA*(achR-cur.acetylcholine);
  const[da,ne,ach,ser]=applyCrossCoupling(daB,neB,achB,serR);
  return{dopamine:Math.round(da*10000)/10000,norepinephrine:Math.round(ne*10000)/10000,acetylcholine:Math.round(ach*10000)/10000,serotonin:Math.round(ser*10000)/10000,daBaseline:Math.round(nb*10000)/10000,neAdaptation:Math.round(na*10000)/10000};
}
export function modulateLtpRate(b:number,da:number):number{return b*da;}
export function modulatePrecisionGain(b:number,ne:number):number{return b*ne;}
export function modulateWriteGateThreshold(b:number,ne:number):number{return b/Math.max(ne,0.01);}
export function modulateSpreadingBreadth(b:number,ser:number):number{return Math.max(1,Math.round(b*ser));}
export function modulateRetrievalTemperature(b:number,ser:number):number{return b*ser;}
export function computeCascadeGate(da:number,imp:number):boolean{return da*imp>0.7;}
/** // source: Dawes (1979): equal weights match optimized regression when k<10. */
export function computeCompositeModulation(s:NeuromodulatoryState):Record<string,unknown>{
  const{dopamine:da,norepinephrine:ne,acetylcholine:ach,serotonin:ser}=s;
  const c=(da+ne+ach+ser)/4;
  return{dopamine:da,norepinephrine:ne,acetylcholine:ach,serotonin:ser,heat_modulation:Math.round(c*10000)/10000,importance_modulation:Math.round(c*10000)/10000,decay_modulation:Math.round(c*10000)/10000,cascade_gate:computeCascadeGate(da,0.5)};
}
export function stateToDict(s:NeuromodulatoryState):Record<string,unknown>{return{dopamine:s.dopamine,norepinephrine:s.norepinephrine,acetylcholine:s.acetylcholine,serotonin:s.serotonin,da_baseline:s.daBaseline,ne_adaptation:s.neAdaptation};}
export function stateFromDict(d:Record<string,unknown>):NeuromodulatoryState{return{dopamine:(d["dopamine"] as number|undefined)??1.0,norepinephrine:(d["norepinephrine"] as number|undefined)??1.0,acetylcholine:(d["acetylcholine"] as number|undefined)??1.0,serotonin:(d["serotonin"] as number|undefined)??1.0,daBaseline:(d["da_baseline"] as number|undefined)??0.5,neAdaptation:(d["ne_adaptation"] as number|undefined)??0.0};}
