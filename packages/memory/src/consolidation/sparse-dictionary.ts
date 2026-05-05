/**
 * Behavioral feature dictionary learning via OMP (sparse coding).
 * 27D activation space: tool ratios(7), keyword densities(4), temporal(5), derived(1), categories(10).
 * // source: Mallat SG, Zhang Z (1993) "Matching pursuits." IEEE Trans Signal Process 41:3397-3415 (OMP concept).
 * Port of: mcp_server/core/sparse_dictionary*.py  Pure business logic — no I/O.
 */

export const SIGNAL_NAMES: string[] = [
  "tool:Read","tool:Edit","tool:Write","tool:Grep","tool:Glob","tool:Bash","tool:Agent",
  "kw:abstract","kw:concrete","kw:planning","kw:trial",
  "tmp:duration","tmp:turnCount","tmp:burst","tmp:exploration","tmp:fileSpread",
  "drv:editReadRatio",
  "cat:bug-fix","cat:feature","cat:refactoring","cat:testing","cat:documentation",
  "cat:devops","cat:code-review","cat:debugging","cat:architecture","cat:general",
];
export const D = SIGNAL_NAMES.length; // 27

const AKW=["abstract","pattern","concept","theory","principle","architecture","design","framework","model","structure"];
const CKW=["implement","code","fix","create","build","write","run","execute","test","deploy"];
const PKW=["plan","todo","step","first","then","next","should","need","will","going"];
const TKW=["try","attempt","test","experiment","check","see","maybe","could","might","if"];
const CATKW:Record<string,string[]>={"bug-fix":["fix","bug","error","issue","crash","broken"],"feature":["add","implement","create","new","feature"],"refactoring":["refactor","clean","restructure","rename","move"],"testing":["test","spec","coverage","assert","expect"],"documentation":["doc","readme","comment","explain"],"devops":["deploy","ci","docker","build","pipeline"],"code-review":["review","check","audit","inspect"],"debugging":["debug","trace","log","inspect","breakpoint"],"architecture":["architecture","design","pattern","module","layer"],"general":[]};

function zeros(n:number):number[]{return new Array<number>(n).fill(0);}
function dot(a:readonly number[],b:readonly number[]):number{let s=0;for(let i=0;i<a.length;i++)s+=(a[i]??0)*(b[i]??0);return s;}
export function norm(v:readonly number[]):number{return Math.sqrt(dot(v,v));}
function normalize(v:readonly number[]):number[]{const n=norm(v);if(n<1e-10)return zeros(v.length);return v.map(x=>x/n);}
function scale(v:readonly number[],s:number):number[]{return v.map(x=>x*s);}
function subtract(a:readonly number[],b:readonly number[]):number[]{return a.map((x,i)=>x-(b[i]??0));}
function cosineSim(a:readonly number[],b:readonly number[]):number{const na=norm(a),nb=norm(b);if(na<1e-10||nb<1e-10)return 0;return dot(a,b)/(na*nb);}

function sls1(G:readonly(readonly number[])[],h:readonly number[]):number[]{const g=G[0]?.[0]??0,h0=h[0]??0;return g!==0?[h0/g]:[0];}
function sls2(G:readonly(readonly number[])[],h:readonly number[]):number[]{const g00=G[0]?.[0]??0,g01=G[0]?.[1]??0,g10=G[1]?.[0]??0,g11=G[1]?.[1]??0,h0=h[0]??0,h1=h[1]??0,det=g00*g11-g01*g10;if(Math.abs(det)<1e-12)return[0,0];return[(h0*g11-h1*g01)/det,(g00*h1-g10*h0)/det];}
function det3(m:readonly(readonly number[])[]):number{const m00=m[0]?.[0]??0,m01=m[0]?.[1]??0,m02=m[0]?.[2]??0,m10=m[1]?.[0]??0,m11=m[1]?.[1]??0,m12=m[1]?.[2]??0,m20=m[2]?.[0]??0,m21=m[2]?.[1]??0,m22=m[2]?.[2]??0;return m00*(m11*m22-m12*m21)-m01*(m10*m22-m12*m20)+m02*(m10*m21-m11*m20);}
function sls3(G:readonly(readonly number[])[],h:readonly number[]):number[]{const dg=det3(G);if(Math.abs(dg)<1e-12)return[0,0,0];const r=[];for(let c=0;c<3;c++){const M=G.map(row=>[...row]);for(let row=0;row<3;row++){const mRow=M[row];if(mRow)mRow[c]=h[row]??0;}r.push(det3(M)/dg);}return r;}
function solveLs(atoms:readonly(readonly number[])[],b:readonly number[],sel:readonly number[]):number[]{
  const n=sel.length;if(n===0)return[];
  const G=Array.from({length:n},(_,i)=>Array.from({length:n},(__,j)=>dot(atoms[sel[i]??0]??[],atoms[sel[j]??0]??[])));
  const h=sel.map(i=>dot(atoms[i]??[],b));
  if(n===1)return sls1(G,h);if(n===2)return sls2(G,h);if(n===3)return sls3(G,h);return zeros(n);
}

export interface OmpResult{indices:number[];coefficients:number[];residual:number[];}
export function omp(signal:readonly number[],atoms:readonly(readonly number[])[],sparsity:number):OmpResult {
  const K=atoms.length;let residual=[...signal];const sel:number[]=[];
  for(let _=0;_<sparsity;_++){
    let best=-1,bi=-1;
    for(let k=0;k<K;k++){if(sel.includes(k))continue;const c=Math.abs(dot(residual,atoms[k]??[]));if(c>best){best=c;bi=k;}}
    if(bi===-1||best<1e-10)break;
    sel.push(bi);
    const co=solveLs(atoms,signal,sel);residual=[...signal];
    for(let i=0;i<sel.length;i++)residual=subtract(residual,scale(atoms[sel[i]??0]??[],co[i]??0));
  }
  return{indices:sel,coefficients:solveLs(atoms,signal,sel),residual};
}
export function initializeAtoms(data:readonly(readonly number[])[],K:number):number[][]{
  if(data.length===0)return[];
  const ek=Math.min(K,data.length),sel=[0],minD=new Array<number>(data.length).fill(Infinity);
  for(let _=1;_<ek;_++){
    const last=sel[sel.length-1]??0;
    for(let i=0;i<data.length;i++){if(sel.includes(i))continue;const d=1-Math.abs(cosineSim(data[i]??[],data[last]??[]));if(d<(minD[i]??Infinity))minD[i]=d;}
    let bd=-1,bi=0;for(let i=0;i<data.length;i++){if(sel.includes(i))continue;if((minD[i]??-1)>bd){bd=minD[i]??0;bi=i;}}
    sel.push(bi);
  }
  return sel.map(idx=>normalize(data[idx]??[]));
}
export function updateDictionary(data:readonly(readonly number[])[],atoms:readonly(readonly number[])[],sparsity:number,iterations:number):number[][]{
  const ak=atoms.length;let cur=atoms.map(a=>[...a]);
  for(let _=0;_<iterations;_++){
    const encs=data.map(x=>omp(x,cur,sparsity));
    for(let k=0;k<ak;k++){
      const users:Array<{dataIdx:number;coeff:number}>=[];
      for(let i=0;i<encs.length;i++){const enc=encs[i];if(!enc)continue;const pos=enc.indices.indexOf(k);if(pos!==-1)users.push({dataIdx:i,coeff:enc.coefficients[pos]??0});}
      if(users.length===0)continue;
      const contrib=zeros(D);
      for(const u of users){
        const partial=[...(data[u.dataIdx]??[])];const enc=encs[u.dataIdx];if(!enc)continue;
        for(let j=0;j<enc.indices.length;j++){const ai=enc.indices[j];if(ai===k||ai===undefined)continue;const s=scale(cur[ai]??[],enc.coefficients[j]??0);for(let d=0;d<D;d++)partial[d]=(partial[d]??0)-(s[d]??0);}
        for(let d=0;d<D;d++)contrib[d]=(contrib[d]??0)+(partial[d]??0);
      }
      const na=normalize(contrib);if(norm(na)>0)cur[k]=na;
    }
  }
  return cur;
}

function kwDensity(text:string|null|undefined,kws:string[]):number{if(!text)return 0;const l=text.toLowerCase(),w=l.split(/\s+/).length||1;return kws.filter(k=>l.includes(k)).length/w;}
function cntTool(tools:unknown[],name:string):number{return tools.filter(t=>{if(typeof t==="string")return t===name;if(typeof t==="object"&&t!==null)return(t as Record<string,unknown>)["name"]===name;return false;}).length;}

export function extractSessionActivation(conv:Record<string,unknown>):number[]{
  const act=zeros(D),tools=(conv["toolsUsed"] as unknown[]|undefined)??[];
  const text=(conv["allText"] as string|undefined)??(conv["firstMessage"] as string|undefined)??"";
  const total=tools.length||1;
  const tns=["Read","Edit","Write","Grep","Glob","Bash","Agent"];
  for(let i=0;i<tns.length;i++)act[i]=cntTool(tools,tns[i]??"")/total;
  act[7]=kwDensity(text,AKW);act[8]=kwDensity(text,CKW);act[9]=kwDensity(text,PKW);act[10]=kwDensity(text,TKW);
  const dur=(conv["duration"] as number|undefined)??0;
  act[11]=Math.min(dur/3_600_000,1);act[12]=Math.min(((conv["turnCount"] as number|undefined)??0)/50,1);
  act[13]=dur>0&&dur<600_000?1:0;act[14]=((conv["turnCount"] as number|undefined)??0)>20?1:0;
  act[15]=Math.min((cntTool(tools,"Glob")+cntTool(tools,"Read"))/total,1);
  const ec=cntTool(tools,"Edit")+cntTool(tools,"Write"),rg=cntTool(tools,"Read")+cntTool(tools,"Grep");
  act[16]=rg>0?ec/rg:ec>0?1:0;
  const lt=text.toLowerCase();let ac=false;
  const ce=Object.entries(CATKW);
  for(let i=0;i<ce.length;i++){const ent=ce[i];if(!ent)continue;const [,kws]=ent;if(!kws||!kws.length)continue;const sc=kws.filter(k=>lt.includes(k)).length;act[17+i]=Math.min(sc/kws.length,1);if(sc>0)ac=true;}
  if(!ac)act[26]=0.5;
  return act;
}

const SLABS:Record<string,string>={"tool:Read":"reading","tool:Edit":"editing","tool:Write":"writing","tool:Grep":"searching","tool:Glob":"scanning","tool:Bash":"executing","tool:Agent":"delegating","kw:abstract":"abstract-thinking","kw:concrete":"concrete-thinking","kw:planning":"planning","kw:trial":"experimenting","tmp:duration":"long-session","tmp:turnCount":"high-interaction","tmp:burst":"burst-mode","tmp:exploration":"exploration-mode","tmp:fileSpread":"wide-exploration","drv:editReadRatio":"edit-heavy","cat:bug-fix":"bug-fixing","cat:feature":"feature-building","cat:refactoring":"refactoring","cat:testing":"testing","cat:documentation":"documenting","cat:devops":"devops","cat:code-review":"reviewing","cat:debugging":"debugging","cat:architecture":"architecting","cat:general":"general-work"};

export interface FeatureAtom{index:number;label:string;description:string;direction:number[];topSignals:Array<{signal:string;weight:number}>;}
export function labelFeature(direction:readonly number[],index:number):FeatureAtom{
  const w=SIGNAL_NAMES.map((sig,i)=>({signal:sig,weight:i<direction.length?(direction[i]??0):0})).filter(x=>Math.abs(x.weight)>0.05).sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight));
  const ts=w.slice(0,5),top=ts[0]??null;
  let label=`feature-${index}`,desc="Behavioral feature";
  if(top){label=SLABS[top.signal]??`feature-${index}`;const sec=ts[1]??null;desc=sec?`${label} with ${SLABS[sec.signal]??""} tendency`:`Dominant ${label} behavioral mode`;}
  return{index,label,description:desc,direction:[...direction],topSignals:ts};
}
export interface FeatureDictionary{K:number;D:number;sparsity:number;signalNames:string[];features:FeatureAtom[];learnedFromSessions:number;}

const SEED=[
  {label:"rapid-fix",description:"Quick bug fixes with minimal exploration",signals:{"tool:Edit":0.6,"tmp:burst":0.5,"cat:bug-fix":0.5,"tmp:duration":-0.3}},
  {label:"deep-research",description:"Extended reading and analysis sessions",signals:{"tool:Read":0.5,"tool:Grep":0.4,"tmp:exploration":0.5,"tmp:turnCount":0.3}},
  {label:"architecture-exploration",description:"Broad structural investigation",signals:{"kw:abstract":0.5,"tool:Glob":0.4,"tmp:fileSpread":0.4,"cat:architecture":0.4}},
  {label:"test-driven",description:"Test-first development workflow",signals:{"tool:Bash":0.5,"cat:testing":0.6,"kw:planning":0.3}},
  {label:"iterative-refinement",description:"Repeated edit-test cycles",signals:{"tool:Edit":0.4,"tool:Bash":0.3,"kw:trial":0.4,"tmp:turnCount":0.3}},
  {label:"documentation-focus",description:"Writing and reviewing docs",signals:{"tool:Write":0.5,"cat:documentation":0.6,"kw:concrete":0.3}},
  {label:"devops-automation",description:"Infrastructure and deployment work",signals:{"tool:Bash":0.5,"cat:devops":0.6,"tool:Agent":0.3}},
  {label:"code-review",description:"Reading and reviewing existing code",signals:{"tool:Read":0.5,"tool:Grep":0.3,"cat:code-review":0.5,"kw:concrete":0.3}},
];
export function buildSeedDictionary():FeatureDictionary{
  const features=SEED.map((s,idx)=>{
    const dir=zeros(D);
    for(const [sig,w] of Object.entries(s.signals)){const si=SIGNAL_NAMES.indexOf(sig);if(si!==-1)dir[si]=w;}
    const nd=normalize(dir);
    const ts=Object.entries(s.signals).map(([sig,w])=>({signal:sig,weight:w})).sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight));
    return{index:idx,label:s.label,description:s.description,direction:nd,topSignals:ts};
  });
  return{K:features.length,D,sparsity:3,signalNames:[...SIGNAL_NAMES],features,learnedFromSessions:0};
}
export function learnDictionary(conversations:Record<string,unknown>[]|null|undefined,options:{K?:number;sparsity?:number;iterations?:number}={}):FeatureDictionary{
  const K=options.K??15,sparsity=options.sparsity??3,iterations=options.iterations??5;
  if(!conversations||conversations.length<10)return buildSeedDictionary();
  const data=conversations.map(extractSessionActivation);
  let atoms=initializeAtoms(data,K);
  atoms=updateDictionary(data,atoms,sparsity,iterations);
  return{K:atoms.length,D,sparsity,signalNames:[...SIGNAL_NAMES],features:atoms.map((d,i)=>labelFeature(d,i)),learnedFromSessions:conversations.length};
}
export function encodeSession(conv:Record<string,unknown>,dict:FeatureDictionary):{weights:Record<string,number>;reconstructionError:number}{
  const act=extractSessionActivation(conv),atoms=dict.features.map(f=>f.direction);
  const res=omp(act,atoms,dict.sparsity);const weights:Record<string,number>={};
  for(let i=0;i<res.indices.length;i++){const idx=res.indices[i];const f=idx!==undefined?dict.features[idx]:undefined;const co=res.coefficients[i]??0;if(f&&Math.abs(co)>1e-10)weights[f.label]=co;}
  return{weights,reconstructionError:norm(res.residual)};
}
