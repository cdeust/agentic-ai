/**
 * Dendritic computation — two-layer neuron model after Poirazi, Brannon & Mel (2003).
 * Layer 1: s(n) = 1/(1+exp((3.6-n)/2)) + 0.30*n + 0.0114*n^2
 * Layer 2: g(x) = 0.96*x / (1 + 1509*exp(-0.26*x))
 * // source: Poirazi P, Brannon T, Mel BW (2003) Neuron 37:989-999, Figure 3.
 * Port of: mcp_server/core/dendritic_computation.py
 * Pure business logic — no I/O.
 */

const SUBUNIT_HALF_ACTIVATION = 3.6; // source: Poirazi 2003, Fig 3
const SUBUNIT_SLOPE = 2.0;           // source: Poirazi 2003, Fig 3
const SUBUNIT_LINEAR_COEFF = 0.30;   // source: Poirazi 2003, Fig 3
const SUBUNIT_QUADRATIC_COEFF = 0.0114; // source: Poirazi 2003, Fig 3
const SOMA_SCALE = 0.96;             // source: Poirazi 2003, Fig 3
const SOMA_STEEPNESS = 0.26;         // source: Poirazi 2003, Fig 3
const SOMA_OFFSET = 1509;            // source: Poirazi 2003, Fig 3
export const BRANCH_ADMISSION_THRESHOLD = 0.3;
export const MAX_BRANCH_SIZE = 15;
const PRIMING_STRENGTH = 0.3;

export interface DendriticBranch {
  readonly branchId: string; readonly domain: string;
  readonly memoryIds: readonly number[];
  readonly entitySignature: ReadonlySet<string>; readonly tagSignature: ReadonlySet<string>;
  readonly avgHeat: number; readonly plasticity: number; readonly spikeCount: number;
}
export function makeDendriticBranch(o: Partial<{branchId:string;domain:string;memoryIds:number[];entitySignature:Set<string>;tagSignature:Set<string>;avgHeat:number;plasticity:number;spikeCount:number}>={}): DendriticBranch {
  return {branchId:o.branchId??"",domain:o.domain??"",memoryIds:o.memoryIds??[],entitySignature:o.entitySignature??new Set(),tagSignature:o.tagSignature??new Set(),avgHeat:o.avgHeat??0.5,plasticity:o.plasticity??1.0,spikeCount:o.spikeCount??0};
}
/** Poirazi (2003) branch subunit. // source: Neuron 37:989-999, Fig 3. */
export function branchSubunit(n: number, opts:{halfActivation?:number;slope?:number;linearCoeff?:number;quadraticCoeff?:number}={}): number {
  const {halfActivation=SUBUNIT_HALF_ACTIVATION,slope=SUBUNIT_SLOPE,linearCoeff=SUBUNIT_LINEAR_COEFF,quadraticCoeff=SUBUNIT_QUADRATIC_COEFF}=opts;
  if(n<=0.0) return 0.0;
  return 1.0/(1.0+Math.exp((halfActivation-n)/slope)) + linearCoeff*n + quadraticCoeff*n*n;
}
/** Poirazi (2003) soma output. // source: Neuron 37:989-999, Fig 3. */
export function somaOutput(x: number, opts:{scale?:number;steepness?:number;offset?:number}={}): number {
  const {scale=SOMA_SCALE,steepness=SOMA_STEEPNESS,offset=SOMA_OFFSET}=opts;
  if(x<=0.0) return 0.0;
  const exponent=-steepness*x;
  if(exponent<-500.0) return scale*x;
  return (scale*x)/(1.0+offset*Math.exp(exponent));
}
/** Two-layer dendritic integration. // source: Poirazi et al. (2003). */
export function computeDendriticIntegration(activeCount:number,_totalCount:number,individualScores:readonly number[]):[number,boolean] {
  if(individualScores.length===0) return [0.0,false];
  const n=activeCount;
  const meanScore=individualScores.reduce((s,v)=>s+v,0)/individualScores.length;
  const output=somaOutput(branchSubunit(n)*meanScore);
  const spiked=1.0/(1.0+Math.exp((SUBUNIT_HALF_ACTIVATION-n)/SUBUNIT_SLOPE))>0.5;
  return [output,spiked];
}
export function computeClusterPriming(retrievedMemoryId:number,branch:DendriticBranch,primingStrength=PRIMING_STRENGTH):Map<number,number> {
  const ids=branch.memoryIds as number[];
  const idx=ids.indexOf(retrievedMemoryId);
  if(idx===-1) return new Map();
  const primes=new Map<number,number>();
  for(let i=0;i<ids.length;i++){const mid=ids[i];if(mid===undefined||mid===retrievedMemoryId)continue;primes.set(mid,Math.round(primingStrength*Math.exp(-0.5*Math.abs(i-idx))*10000)/10000);}
  return primes;
}
export function updateBranchPlasticity(branch:DendriticBranch,ltpOccurred:boolean,ltdOccurred:boolean,opts:{ltpBoost?:number;ltdReduction?:number;decayRate?:number}={}):DendriticBranch {
  const {ltpBoost=0.05,ltdReduction=0.03,decayRate=0.01}=opts;
  let p=branch.plasticity;
  if(ltpOccurred) p=Math.min(1.0,p+ltpBoost);
  if(ltdOccurred) p=Math.max(0.0,p-ltdReduction);
  p+=decayRate*(0.5-p);
  return {...branch,plasticity:Math.round(p*10000)/10000,spikeCount:branch.spikeCount+(ltpOccurred?1:0)};
}
export interface BranchStatistics {total_branches:number;avg_branch_size:number;max_branch_size:number;avg_plasticity:number;total_spikes:number;orphan_branches:number;}
export function computeBranchStatistics(branches:readonly DendriticBranch[]):BranchStatistics {
  if(branches.length===0) return {total_branches:0,avg_branch_size:0.0,max_branch_size:0,avg_plasticity:0.0,total_spikes:0,orphan_branches:0};
  const sizes=branches.map(b=>b.memoryIds.length);
  const plasticities=branches.map(b=>b.plasticity);
  return {total_branches:branches.length,avg_branch_size:Math.round(sizes.reduce((s,v)=>s+v,0)/sizes.length*100)/100,max_branch_size:Math.max(...sizes),avg_plasticity:Math.round(plasticities.reduce((s,v)=>s+v,0)/plasticities.length*10000)/10000,total_spikes:branches.reduce((s,b)=>s+b.spikeCount,0),orphan_branches:sizes.filter(s=>s<=1).length};
}
export function branchToDict(branch:DendriticBranch):Record<string,unknown> {
  return {branch_id:branch.branchId,domain:branch.domain,memory_ids:[...branch.memoryIds],entity_signature:[...branch.entitySignature].sort(),tag_signature:[...branch.tagSignature].sort(),avg_heat:branch.avgHeat,plasticity:branch.plasticity,spike_count:branch.spikeCount};
}
export function branchFromDict(data:Record<string,unknown>):DendriticBranch {
  return {branchId:(data["branch_id"] as string|undefined)??"",domain:(data["domain"] as string|undefined)??"",memoryIds:(data["memory_ids"] as number[]|undefined)??[],entitySignature:new Set((data["entity_signature"] as string[]|undefined)??[]),tagSignature:new Set((data["tag_signature"] as string[]|undefined)??[]),avgHeat:(data["avg_heat"] as number|undefined)??0.5,plasticity:(data["plasticity"] as number|undefined)??1.0,spikeCount:(data["spike_count"] as number|undefined)??0};
}
