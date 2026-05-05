/**
 * Fractal clustering primitives — Union-Find, agglomerative clustering, centroids.
 * Port of: mcp_server/core/fractal_clustering.py
 * Pure business logic — no I/O.
 */
export class UnionFind {
  private parent: number[];
  private rank: number[];
  constructor(n: number) { this.parent=Array.from({length:n},(_,i)=>i); this.rank=new Array<number>(n).fill(0); }
  find(x: number): number {
    while(this.parent[x]!==x){const g=this.parent[this.parent[x]??x]??x;this.parent[x]=g;x=g;}
    return x;
  }
  union(x: number, y: number): void {
    let rx=this.find(x),ry=this.find(y);
    if(rx===ry) return;
    if((this.rank[rx]??0)<(this.rank[ry]??0)){[rx,ry]=[ry,rx];}
    this.parent[ry]=rx;
    if((this.rank[rx]??0)===(this.rank[ry]??0)){this.rank[rx]=(this.rank[rx]??0)+1;}
  }
}
type SimFn=(a:Uint8Array|null,b:Uint8Array|null)=>number;
export function agglomerativeCluster(memories:readonly Record<string,unknown>[],similarityFn:SimFn,threshold=0.6):Array<Array<Record<string,unknown>>> {
  const n=memories.length;
  if(n===0) return [];
  if(n===1) return [[...memories] as Array<Record<string,unknown>>];
  const uf=new UnionFind(n);
  for(let i=0;i<n;i++){const eI=memories[i]?.["embedding"] as Uint8Array|null|undefined;if(!eI)continue;for(let j=i+1;j<n;j++){const eJ=memories[j]?.["embedding"] as Uint8Array|null|undefined;if(!eJ)continue;if(similarityFn(eI,eJ)>=threshold)uf.union(i,j);}}
  const groups=new Map<number,Array<Record<string,unknown>>>();
  for(let i=0;i<n;i++){const r=uf.find(i);if(!groups.has(r))groups.set(r,[]);const m=memories[i];if(m)groups.get(r)!.push(m);}
  return [...groups.values()];
}
export function computeCentroid(embeddings:ReadonlyArray<Uint8Array|null|undefined>,dim:number):Uint8Array|null {
  const valid:number[][]=[];
  for(const emb of embeddings){if(!emb||emb.length<dim*4)continue;const view=new DataView(emb.buffer,emb.byteOffset,dim*4);const values:number[]=[];for(let d=0;d<dim;d++)values.push(view.getFloat32(d*4,true));valid.push(values);}
  if(valid.length===0) return null;
  const n=valid.length;
  const centroid=new Array<number>(dim).fill(0);
  for(const v of valid)for(let d=0;d<dim;d++)centroid[d]=(centroid[d]??0)+(v[d]??0)/n;
  let mag=0;for(const c of centroid)mag+=(c??0)*(c??0);mag=Math.sqrt(mag);
  if(mag>0)for(let d=0;d<dim;d++)centroid[d]=(centroid[d]??0)/mag;
  const out=new Uint8Array(dim*4);const view=new DataView(out.buffer);for(let d=0;d<dim;d++)view.setFloat32(d*4,centroid[d]??0,true);
  return out;
}
export interface L1Cluster {cluster_id:string;level:1;memory_ids:number[];centroid:Uint8Array|null;size:number;avg_heat:number;}
export interface L2Cluster {cluster_id:string;level:2;directory:string;child_clusters:string[];total_memories:number;centroid:Uint8Array|null;}
export function buildL1Clusters(l1Raw:ReadonlyArray<ReadonlyArray<Record<string,unknown>>>,embeddingDim:number):[L1Cluster[],Map<string,L1Cluster>] {
  const level1:L1Cluster[]=[],clusterMap=new Map<string,L1Cluster>();
  for(let i=0;i<l1Raw.length;i++){const cluster=l1Raw[i]??[];const clusterId=`L1-${i}`;const centroid=computeCentroid(cluster.map(m=>m["embedding"] as Uint8Array|null|undefined),embeddingDim);const clusterData:L1Cluster={cluster_id:clusterId,level:1,memory_ids:cluster.map(m=>m["id"] as number|undefined).filter((id):id is number=>id!==undefined),centroid,size:cluster.length,avg_heat:cluster.length>0?cluster.reduce((s,m)=>s+((m["heat"] as number|undefined)??0.5),0)/cluster.length:0};level1.push(clusterData);clusterMap.set(clusterId,clusterData);}
  return [level1,clusterMap];
}
function findDominantDir(cd:L1Cluster,memories:readonly Record<string,unknown>[]):string {
  const dirs=new Map<string,number>();
  for(const mid of cd.memory_ids){const mem=memories.find(m=>m["id"]===mid);if(mem){const d=(mem["directory_context"] as string|undefined)??(mem["domain"] as string|undefined)??"global";dirs.set(d,(dirs.get(d)??0)+1);}}
  if(dirs.size===0) return "global";
  let best="global",bc=-1;for(const [d,c]of dirs)if(c>bc){bc=c;best=d;}
  return best;
}
export function buildL2Clusters(level1:readonly L1Cluster[],memories:readonly Record<string,unknown>[],embeddingDim:number):[L2Cluster[],Map<string,L2Cluster>] {
  const dg=new Map<string,L1Cluster[]>();
  for(const c of level1){const d=findDominantDir(c,memories);if(!dg.has(d))dg.set(d,[]);dg.get(d)!.push(c);}
  const level2:L2Cluster[]=[],clusterMap=new Map<string,L2Cluster>();
  let j=0;
  for(const [dirKey,l1g] of dg){const cId=`L2-${j}`;const l1c=l1g.map(c=>c.centroid).filter((c):c is Uint8Array=>c!==null);const centroid=l1c.length>0?computeCentroid(l1c,embeddingDim):null;const cd:L2Cluster={cluster_id:cId,level:2,directory:dirKey,child_clusters:l1g.map(c=>c.cluster_id),total_memories:l1g.reduce((s,c)=>s+c.size,0),centroid};level2.push(cd);clusterMap.set(cId,cd);j++;}
  return [level2,clusterMap];
}
