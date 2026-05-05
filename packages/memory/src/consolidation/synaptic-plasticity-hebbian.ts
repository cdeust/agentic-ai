/**
 * Hebbian LTP/LTD and STDP.
 * // source: Bienenstock EL, Cooper LN, Munro PW (1982) J Neuroscience 2:32-48. BCM theory.
 * // source: Bi G, Poo M (1998) J Neuroscience 18:10464-10472. STDP (tau adapted ms->hours).
 * Port of: mcp_server/core/synaptic_plasticity_hebbian.py  Pure business logic — no I/O.
 */
export const MAX_WEIGHT = 5.0;
export const MIN_WEIGHT = 0.01;
const LTP_RATE=0.05,LTD_RATE=0.02,BCM_THETA_DECAY=0.95;
// // source: Bi & Poo (1998): A+ > A-. Time constants adapted from ms to hours.
const STDP_A_PLUS=0.03,STDP_A_MINUS=0.02,STDP_TAU_PLUS=24.0,STDP_TAU_MINUS=24.0;

/** BCM phi(c,theta_m)=c*(c-theta_m). // source: BCM 1982, Eq.3. */
export function computeBcmPhi(postActivity:number,theta:number):number{return postActivity*(postActivity-theta);}
/** BCM LTP. // source: BCM 1982, Eq.3. postcondition: weight in [current, MAX_WEIGHT] */
export function computeLtp(currentWeight:number,coActivation:number,preActivity=1.0,postActivity=1.0,theta=0.5,ltpRate=LTP_RATE,maxWeight=MAX_WEIGHT):number{
  const phi=computeBcmPhi(postActivity,theta);if(phi<=0)return currentWeight;return Math.min(maxWeight,currentWeight+ltpRate*phi*preActivity*coActivation);
}
/** BCM LTD + inactivity decay. postcondition: weight in [MIN_WEIGHT, current] */
export function computeLtd(currentWeight:number,timeSinceCoAccessHours:number,ltdRate=LTD_RATE,minWeight=MIN_WEIGHT,postActivity=0.0,theta=0.5):number{
  if(postActivity>0){const phi=computeBcmPhi(postActivity,theta);if(phi<0)return Math.max(minWeight,currentWeight-ltdRate*Math.abs(phi));return currentWeight;}
  if(timeSinceCoAccessHours<=0)return currentWeight;
  return Math.max(minWeight,currentWeight-ltdRate*Math.log1p(timeSinceCoAccessHours/24.0));
}
/** BCM sliding threshold: theta_m'=decay*theta+(1-decay)*c^2. // source: BCM 1982, Eq.5. */
export function updateBcmThreshold(currentTheta:number,entityActivity:number,decay=BCM_THETA_DECAY):number{return decay*currentTheta+(1.0-decay)*entityActivity*entityActivity;}
interface Edge{source_entity_id:number;target_entity_id:number;weight?:number;[key:string]:unknown;}
function hebbianSingle(edge:Edge,cop:ReadonlySet<string>,ea:Map<number,number>,et:Map<number,number>,hours:number,lr:number,ld:number):Edge&{weight:number;delta:number;action:string}{
  const src=edge.source_entity_id,tgt=edge.target_entity_id,w=edge.weight??1.0;
  const pk=`${Math.min(src,tgt)},${Math.max(src,tgt)}`;let nw:number,action:string;
  if(cop.has(pk)){nw=computeLtp(w,1.0,ea.get(src)??0.5,ea.get(tgt)??0.5,et.get(tgt)??0.5,lr);action=nw>w?"ltp":"none";}
  else{nw=computeLtd(w,hours,ld);action=nw<w?"ltd":"none";}
  return{...edge,weight:Math.round(nw*1_000_000)/1_000_000,delta:Math.round((nw-w)*1_000_000)/1_000_000,action};
}
/** Apply Hebbian LTP/LTD to edges. postcondition: every result has weight, delta, action. */
export function applyHebbianUpdate(edges:readonly Edge[],coAccessedPairs:ReadonlySet<string>,entityActivities:Map<number,number>,entityThresholds:Map<number,number>,hoursSinceLastUpdate=1.0,ltpRate=LTP_RATE,ltdRate=LTD_RATE):Array<Edge&{weight:number;delta:number;action:string}>{
  return edges.map(e=>hebbianSingle(e,coAccessedPairs,entityActivities,entityThresholds,hoursSinceLastUpdate,ltpRate,ltdRate));
}
/** STDP. // source: Bi & Poo (1998). dt>0->LTP, dt<0->LTD. postcondition: [MIN_WEIGHT, MAX_WEIGHT] */
export function computeStdpUpdate(cw:number,dt:number,ap=STDP_A_PLUS,am=STDP_A_MINUS,tp=STDP_TAU_PLUS,tm=STDP_TAU_MINUS,mn=MIN_WEIGHT,mx=MAX_WEIGHT):number{
  if(Math.abs(dt)<0.001)return cw;
  const dw=dt>0?ap*Math.exp(-dt/tp):-am*Math.exp(dt/tm);
  return Math.max(mn,Math.min(mx,Math.round((cw+dw)*1_000_000)/1_000_000));
}
interface TemporalPair{source_entity_id:number;target_entity_id:number;delta_t_hours?:number;current_weight?:number;}
export function applyStdpBatch(pairs:readonly TemporalPair[],ap=STDP_A_PLUS,am=STDP_A_MINUS,tp=STDP_TAU_PLUS,tm=STDP_TAU_MINUS):Array<{source_entity_id:number;target_entity_id:number;new_weight:number;delta:number;direction:string}>{
  return pairs.map(p=>{const dt=p.delta_t_hours??0,w=p.current_weight??1.0,nw=computeStdpUpdate(w,dt,ap,am,tp,tm);return{source_entity_id:p.source_entity_id,target_entity_id:p.target_entity_id,new_weight:nw,delta:Math.round((nw-w)*1_000_000)/1_000_000,direction:dt>0.001?"causal":dt<-0.001?"anti-causal":"none"};});
}
