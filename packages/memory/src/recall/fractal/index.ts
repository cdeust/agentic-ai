/**
 * Fractal memory tree — 3-level hierarchical retrieval.
 * Port of: mcp_server/core/fractal.py + fractal_clustering.py
 * Pure business logic — no I/O.
 */
export {UnionFind,agglomerativeCluster,computeCentroid,buildL1Clusters,buildL2Clusters} from "./clustering.js";
import {agglomerativeCluster,buildL1Clusters,buildL2Clusters} from "./clustering.js";
import type {L1Cluster,L2Cluster} from "./clustering.js";
type SimFn=(a:Uint8Array|null,b:Uint8Array|null)=>number;
export interface FractalHierarchy {
  levels:{0:Record<string,unknown>[];1:L1Cluster[];2:L2Cluster[]};
  clusterMap:Map<string,L1Cluster|L2Cluster>;
  stats:{total_memories:number;l1_clusters:number;l2_clusters:number};
}
export function buildHierarchy(memories:readonly Record<string,unknown>[],similarityFn:SimFn,embeddingDim:number,l1Threshold=0.6):FractalHierarchy {
  if(memories.length===0) return {levels:{0:[],1:[],2:[]},clusterMap:new Map(),stats:{total_memories:0,l1_clusters:0,l2_clusters:0}};
  const l1Raw=agglomerativeCluster(memories,similarityFn,l1Threshold);
  const [level1,cm1]=buildL1Clusters(l1Raw,embeddingDim);
  const [level2,cm2]=buildL2Clusters(level1,memories,embeddingDim);
  const clusterMap: Map<string, L1Cluster | L2Cluster> = new Map([...cm1 as Map<string, L1Cluster | L2Cluster>, ...cm2 as Map<string, L1Cluster | L2Cluster>]);
  return {levels:{0:[...memories] as Record<string,unknown>[],1:level1,2:level2},clusterMap,stats:{total_memories:memories.length,l1_clusters:level1.length,l2_clusters:level2.length}};
}
export function computeLevelWeights(query:string):[number,number,number] {
  const wc=query.trim().split(/\s+/).length;
  if(wc<10) return [0.3,0.5,1.0];if(wc>30) return [1.0,0.5,0.3];return [0.7,0.7,0.7];
}
export interface HierarchyResult {memory_id:number;score:number;level_scores:Partial<{L0:number;L1:number;L2:number}>;matched_level:0|1|2;}
export function scoreAgainstHierarchy(queryEmbedding:Uint8Array,hierarchy:FractalHierarchy,similarityFn:SimFn,query="",maxResults=10):HierarchyResult[] {
  const [w0,w1,w2]=computeLevelWeights(query);
  const results=new Map<number,HierarchyResult>();
  for(const mem of hierarchy.levels[0]){const emb=mem["embedding"] as Uint8Array|null|undefined;if(!emb)continue;const mid=mem["id"] as number|undefined;if(mid===undefined)continue;const sim=similarityFn(queryEmbedding,emb);results.set(mid,{memory_id:mid,score:sim*w0,level_scores:{L0:sim},matched_level:0});}
  for(const cluster of hierarchy.levels[1]){if(!cluster.centroid)continue;const sim=similarityFn(queryEmbedding,cluster.centroid);for(const mid of cluster.memory_ids){const e=results.get(mid);if(e){e.score+=sim*w1;e.level_scores.L1=sim;}else results.set(mid,{memory_id:mid,score:sim*w1,level_scores:{L1:sim},matched_level:1});}}
  for(const root of hierarchy.levels[2]){if(!root.centroid)continue;const sim=similarityFn(queryEmbedding,root.centroid);for(const cId of root.child_clusters){const child=hierarchy.clusterMap.get(cId);if(!child||child.level!==1)continue;for(const mid of (child as L1Cluster).memory_ids){const e=results.get(mid);if(e){e.score+=sim*w2;e.level_scores.L2=sim;}else results.set(mid,{memory_id:mid,score:sim*w2,level_scores:{L2:sim},matched_level:2});}}}
  return [...results.values()].sort((a,b)=>b.score-a.score).slice(0,maxResults);
}
export function drillDown(clusterId:string,hierarchy:FractalHierarchy):Array<L1Cluster|L2Cluster|{memory_id:number}> {
  const cluster=hierarchy.clusterMap.get(clusterId);if(!cluster) return [];
  if(cluster.level===2){return (cluster as L2Cluster).child_clusters.map(id=>hierarchy.clusterMap.get(id)).filter((c):c is L1Cluster|L2Cluster=>c!==undefined);}
  if(cluster.level===1){return (cluster as L1Cluster).memory_ids.map(mid=>({memory_id:mid}));}
  return [];
}
export function rollUp(memoryId:number,hierarchy:FractalHierarchy):string[] {
  const path:string[]=[];
  for(const cluster of hierarchy.levels[1]){if(cluster.memory_ids.includes(memoryId)){path.push(cluster.cluster_id);for(const root of hierarchy.levels[2]){if(root.child_clusters.includes(cluster.cluster_id)){path.push(root.cluster_id);break;}}break;}}
  return path;
}
