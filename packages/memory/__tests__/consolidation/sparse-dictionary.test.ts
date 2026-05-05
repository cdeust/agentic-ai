import { describe, it, expect } from "vitest";
import { omp, initializeAtoms, extractSessionActivation, learnDictionary, buildSeedDictionary, encodeSession, D, SIGNAL_NAMES } from "../../src/consolidation/sparse-dictionary.js";

describe("SIGNAL_NAMES / D", () => {
  it("D = 27", () => { expect(D).toBe(27); });
  it("has exactly D entries", () => { expect(SIGNAL_NAMES).toHaveLength(27); });
  it("contains expected prefixes", () => { for (const p of ["tool:", "kw:", "tmp:", "drv:", "cat:"]) expect(SIGNAL_NAMES.some(s => s.startsWith(p))).toBe(true); });
});

const makeAtoms = (k: number, d: number): number[][] => Array.from({length:k}, (_, i) => { const v = new Array<number>(d).fill(0); v[i % d] = 1.0; return v; });

describe("omp", () => {
  it("returns <= sparsity indices", () => { const r = omp([0.1, 0.2, 0.3, 0.1, 0.05], makeAtoms(5, 5), 3); expect(r.indices.length).toBeLessThanOrEqual(3); });
  it("indices and coefficients same length", () => { const r = omp([0.5, 0.3, 0.0, 0.1], makeAtoms(4, 4), 2); expect(r.indices.length).toBe(r.coefficients.length); });
  it("residual has correct length", () => { expect(omp(new Array<number>(D).fill(0.1), makeAtoms(5, D), 3).residual).toHaveLength(D); });
  it("perfect match: atom selected and residual near zero", () => { const atoms = makeAtoms(5, 5); const r = omp([...atoms[2]!], atoms, 3); expect(r.indices).toContain(2); expect(Math.sqrt(r.residual.reduce((s, v) => s + v * v, 0))).toBeLessThan(1e-6); });
});

describe("initializeAtoms", () => {
  it("returns <= K atoms", () => { const data = Array.from({length:10}, () => Array.from({length:D}, () => Math.random())); expect(initializeAtoms(data, 5).length).toBeLessThanOrEqual(5); });
  it("empty input -> empty", () => { expect(initializeAtoms([], 5)).toHaveLength(0); });
  it("atoms approximately unit-normalized", () => { const data = Array.from({length:5}, () => Array.from({length:4}, () => Math.random() + 0.1)); for (const a of initializeAtoms(data, 3)) { expect(Math.sqrt(a.reduce((s,v) => s+v*v, 0))).toBeCloseTo(1.0, 4); } });
});

describe("extractSessionActivation", () => {
  it("length D=27", () => { expect(extractSessionActivation({toolsUsed:["Read","Edit"],turnCount:10,duration:120000})).toHaveLength(27); });
  it("tool ratios in [0, 1]", () => { const act = extractSessionActivation({toolsUsed:["Read","Read","Edit","Bash"]}); for (let i = 0; i < 7; i++) { expect(act[i]).toBeGreaterThanOrEqual(0); expect(act[i]).toBeLessThanOrEqual(1); } });
  it("empty -> 27 zeros (except maybe category)", () => { const act = extractSessionActivation({}); expect(act).toHaveLength(27); for (let i = 0; i < 7; i++) expect(act[i]).toBe(0); });
});

describe("buildSeedDictionary", () => {
  it("K=8, D=27", () => { const d = buildSeedDictionary(); expect(d.K).toBe(8); expect(d.D).toBe(27); });
  it("each feature has label and direction of length D", () => { for (const f of buildSeedDictionary().features) { expect(typeof f.label).toBe("string"); expect(f.direction).toHaveLength(27); } });
});

describe("learnDictionary", () => {
  it("seed for < 10 sessions", () => { expect(learnDictionary([]).learnedFromSessions).toBe(0); });
  it("learns from >= 10 sessions", () => { const cs = Array.from({length:15}, (_,i) => ({toolsUsed:i%2===0?["Read","Grep"]:["Edit","Bash"],allText:i%2===0?"read review":"fix bug",turnCount:10+i,duration:300000+i*1000})); const d = learnDictionary(cs, {K:5,sparsity:2,iterations:2}); expect(d.learnedFromSessions).toBe(15); expect(d.K).toBe(5); });
});

describe("encodeSession", () => {
  it("weights has <= sparsity entries", () => { const d = buildSeedDictionary(); const r = encodeSession({toolsUsed:["Edit","Bash"],allText:"fix bug"}, d); expect(Object.keys(r.weights).length).toBeLessThanOrEqual(d.sparsity); });
  it("reconstructionError >= 0", () => { expect(encodeSession({toolsUsed:["Read"],allText:"read code"}, buildSeedDictionary()).reconstructionError).toBeGreaterThanOrEqual(0); });
});
