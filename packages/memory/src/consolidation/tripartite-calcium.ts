/**
 * Tripartite synapse calcium dynamics via De Pitta et al. (2009) G-ChI model.
 * // source: De Pitta M et al. (2009) J Biol Phys 35:383-411. Table 1 (AM mode).
 * ODE: dC/dt = J_chan + J_leak - J_pump; h_inf and m_inf from Eq.5-8.
 * At hours timescale we use steady-state equilibrium Ca2+ = f(IP3).
 * Port of: mcp_server/core/tripartite_calcium.py  Pure business logic — no I/O.
 */
const R_C=6.0,R_L=0.11,C_0=2.0,C_1=0.185,V_ER=0.9,K_ER=0.1,D_1=0.13,D_2=1.049,D_3=0.9434,D_5=0.08234; // source: De Pitta 2009, Table 1
const IP3_PER_EVENT=0.15,IP3_MAX=2.0,CA_RESTING_UM=0.54,CA_RANGE_UM=1.0;
export const CA_LOW_THRESHOLD=0.3,CA_MEDIUM_THRESHOLD=0.6;
export const DSERINE_LTP_BOOST=0.2,GLUT_LTD_STRENGTH=0.15; // source: Henneberger C et al. (2010) Nature 463:232-236 (qualitative).
export const METABOLIC_BASELINE=1.0,METABOLIC_BOOST=1.5,METABOLIC_STARVATION=0.6; // source: Pellerin & Magistretti (1994) PNAS 91:10625 (concept).
function hInf(ip3:number,ca:number):number{const d=(ip3+D_3)*(ca+D_2);return d<1e-15?1.0:D_2*(ip3+D_1)/d;}
function mInf(ip3:number,ca:number):number{return(ip3+D_1>1e-15?ip3/(ip3+D_1):0)*(ca+D_5>1e-15?ca/(ca+D_5):0);}
function jPump(ca:number):number{return V_ER*ca*ca/(K_ER*K_ER+ca*ca);}
function jLeak(ca:number):number{return R_L*(C_0-ca)/C_1;}
function jChan(ip3:number,ca:number,h:number):number{const m=mInf(ip3,ca),i2=ip3+D_1>1e-15?ip3/(ip3+D_1):0;return R_C*m*m*m*h*i2*(C_0-ca)/C_1;}
function ssCa(ip3:number):number{
  let ca=0.05;const dt=0.05;
  for(let _=0;_<200;_++){const h=hInf(ip3,ca),fl=jChan(ip3,ca,h)+jLeak(ca)-jPump(ca),cn=Math.max(0.001,Math.min(C_0*0.95,ca+fl*dt));if(Math.abs(cn-ca)<1e-6)return cn;ca=cn;}
  return ca;
}
function ip3(ev:number):number{const r=IP3_PER_EVENT*ev;return r>0?IP3_MAX*r/(IP3_MAX+r):0;}
function normCa(c:number):number{return Math.min(1.0,Math.max(0.0,(c-CA_RESTING_UM)/CA_RANGE_UM));}
/** // source: De Pitta 2009 G-ChI model. postcondition: [0,1] */
export function computeCalciumRise(cc:number,events:number):number{if(events<=0)return cc;const eq=normCa(ssCa(ip3(events))),rate=1.0-Math.exp(-0.3*events);return Math.min(1.0,Math.max(0.0,cc+rate*(eq-cc)));}
/** postcondition: [0,1], monotone decreasing toward resting */
export function computeCalciumDecay(cc:number,hours:number):number{if(hours<=0)return cc;const rest=normCa(ssCa(0)),a=1.0-Math.exp(-0.1*hours);return Math.max(0.0,cc+a*(rest-cc));}
export function propagateCalciumWave(sc:number,nc:readonly number[],sf=0.3):number[]{if(sc<CA_LOW_THRESHOLD)return[...nc];const w=sc*sf;return nc.map(c=>Math.min(1.0,c+w*(1.0-c)));}
export function classifyCalciumRegime(ca:number):"quiescent"|"facilitation"|"depression"{if(ca<CA_LOW_THRESHOLD)return"quiescent";if(ca<CA_MEDIUM_THRESHOLD)return"facilitation";return"depression";}
export function computeLtpModulation(ca:number,ds=DSERINE_LTP_BOOST):number{
  const r=classifyCalciumRegime(ca);if(r==="quiescent")return 1.0;
  if(r==="facilitation"){const t=(ca-CA_LOW_THRESHOLD)/(CA_MEDIUM_THRESHOLD-CA_LOW_THRESHOLD);return 1.0+ds*t;}
  return Math.max(0.5,1.0-GLUT_LTD_STRENGTH*(ca-CA_MEDIUM_THRESHOLD)/(1.0-CA_MEDIUM_THRESHOLD));
}
export function computeHeterosynapticDepression(ca:number,heats:readonly number[],ds=GLUT_LTD_STRENGTH):number[]{
  if(ca<CA_MEDIUM_THRESHOLD||!heats.length)return new Array<number>(heats.length).fill(1.0);
  const df=(ca-CA_MEDIUM_THRESHOLD)/(1.0-CA_MEDIUM_THRESHOLD),avg=heats.reduce((s,v)=>s+v,0)/heats.length;
  return heats.map(h=>Math.max(0.5,h>=avg?1.0-ds*df*0.2:1.0-ds*df*(1.0-h)));
}
export function computeMetabolicRate(act:number,t:number,opts:{baseline?:number;maxBoost?:number;minRate?:number}={}):number{
  const{baseline=METABOLIC_BASELINE,maxBoost=METABOLIC_BOOST,minRate=METABOLIC_STARVATION}=opts;
  if(t<=0)return baseline;const d=act/t;
  const r=d>1.0?baseline+(maxBoost-baseline)*(1.0-Math.exp(-(d-1.0)/3.0)):minRate+(baseline-minRate)*d;
  return Math.max(minRate,Math.min(maxBoost,r));
}
export function applyMetabolicModulation(bdf:number,mr:number):number{return Math.max(0.0,Math.min(1.0,1.0-(1.0-bdf)/Math.max(mr,0.1)));}
