import { describe, it, expect } from "vitest";
import { UnionFind, agglomerativeCluster, computeCentroid, buildL1Clusters, buildL2Clusters } from "../../../src/recall/fractal/clustering.js";

function floatToBytes(values: number[]): Uint8Array { const buf = new ArrayBuffer(values.length * 4); const view = new DataView(buf); for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i]!, true); return new Uint8Array(buf); }
function bytesToFloats(bytes: Uint8Array, dim: number): number[] { const view = new DataView(bytes.buffer, bytes.byteOffset); return Array.from({ length: dim }, (_, i) => view.getFloat32(i * 4, true)); }

describe("UnionFind", () => {
  it("find idempotent", () => { const uf = new UnionFind(5); expect(uf.find(0)).toBe(uf.find(0)); });
  it("union makes find equal", () => { const uf = new UnionFind(5); uf.union(1, 2); expect(uf.find(1)).toBe(uf.find(2)); });
  it("transitive unions", () => { const uf = new UnionFind(4); uf.union(0,1); uf.union(2,3); uf.union(0,2); expect(uf.find(0)).toBe(uf.find(3)); });
});

describe("agglomerativeCluster", () => {
  it("empty input", () => { expect(agglomerativeCluster([], () => 0)).toHaveLength(0); });
  it("single memory", () => { const r = agglomerativeCluster([{ id: 1, embedding: floatToBytes([1, 0]) }], () => 1.0); expect(r).toHaveLength(1); });
  it("all memories appear exactly once", () => {
    const memories = [{ id: 1, embedding: floatToBytes([1, 0]) }, { id: 2, embedding: floatToBytes([0, 1]) }, { id: 3, embedding: floatToBytes([1, 0.1]) }];
    const simFn = (a: Uint8Array | null, b: Uint8Array | null): number => { if (!a || !b) return 0; const va = bytesToFloats(a, 2); const vb = bytesToFloats(b, 2); return (va[0]??0)*(vb[0]??0)+(va[1]??0)*(vb[1]??0); };
    const groups = agglomerativeCluster(memories, simFn, 0.9);
    expect(groups.flatMap(g => g.map(m => m["id"])).sort()).toEqual([1, 2, 3]);
  });
  it("identical embeddings merge", () => { const emb = floatToBytes([1, 0]); const g = agglomerativeCluster([{id:1,embedding:emb},{id:2,embedding:emb}], () => 1.0, 0.5); expect(g).toHaveLength(1); });
});

describe("computeCentroid", () => {
  it("null for empty", () => { expect(computeCentroid([], 2)).toBeNull(); });
  it("unit normalized", () => { const emb1 = floatToBytes([3, 0]); const emb2 = floatToBytes([0, 4]); const c = computeCentroid([emb1, emb2], 2); const vals = bytesToFloats(c!, 2); const n = Math.sqrt((vals[0]??0)**2+(vals[1]??0)**2); expect(n).toBeCloseTo(1.0, 4); });
  it("centroid of identical = that vector normalized", () => { const emb = floatToBytes([3, 4]); const c = computeCentroid([emb, emb], 2)!; const vals = bytesToFloats(c, 2); expect(vals[0]).toBeCloseTo(0.6, 4); expect(vals[1]).toBeCloseTo(0.8, 4); });
});

describe("buildL1Clusters", () => {
  it("unique L1 IDs", () => { const emb = floatToBytes([1, 0]); const [l1] = buildL1Clusters([[{id:1,embedding:emb}],[{id:2,embedding:emb}]], 2); expect(l1[0]!.cluster_id).toBe("L1-0"); expect(l1[1]!.cluster_id).toBe("L1-1"); });
});

describe("buildL2Clusters", () => {
  it("groups by domain", () => {
    const emb = floatToBytes([1, 0]);
    const memories = [{ id: 1, embedding: emb, domain: "A" }, { id: 2, embedding: emb, domain: "B" }];
    const [l1] = buildL1Clusters([[memories[0]!],[memories[1]!]], 2);
    const [l2] = buildL2Clusters(l1, memories, 2);
    expect(l2).toHaveLength(2);
  });
});
