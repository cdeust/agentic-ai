/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Post-WRRF recall pipeline stages.
 * Port of: mcp_server/core/recall_pipeline.py | Source SHA: cortex@ed33435
 * source: Cormack, Clarke & Buettcher (SIGIR 2009) RRF
 * source: Ramsauer et al. (ICLR 2021) Hopfield
 * source: Kanerva (2009) HDC
 * source: Collins & Loftus (1975) SA
 * source: Poirazi, Brannon & Mel (2003) Neuron 37:989-999 Dendritic
 * source: Bower (1981) Am. Psychologist 36(2) Emotional/Mood
 * source: Nader, Schafe & LeDoux (2000) Nature 406(6797) Reconsolidation
 * source: Jaccard (1912); Kastellakis et al. (2015); Hutto & Gilbert (ICWSM 2014)
 */

function parseEnvFloat(name: string, d: number): number {
  const r = process.env[name]; if (!r) return d;
  const v = parseFloat(r); return isNaN(v) ? d : v;
}

// source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 36 (Cormack 2009)
export const RRF_K = 60;
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 82
export const HOPFIELD_BETA = parseEnvFloat("CORTEX_HOPFIELD_BETA", 0.30);
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 85
export const HDC_BETA = parseEnvFloat("CORTEX_HDC_BETA", 0.20);
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 88
export const SA_BETA = parseEnvFloat("CORTEX_SA_BETA", 0.25);
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 96 Poirazi (2003)
export const DENDRITIC_DELTA = parseEnvFloat("CORTEX_DENDRITIC_DELTA", 0.10);
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 119
export const EMOTIONAL_RETRIEVAL_BETA = parseEnvFloat("CORTEX_EMOTIONAL_RETRIEVAL_BETA", 0.20);
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 122
export const MOOD_CONGRUENT_BETA = parseEnvFloat("CORTEX_MOOD_CONGRUENT_BETA", 0.15);
// source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 130; Hutto & Gilbert ICWSM 2014
export const EMOTIONAL_QUERY_VALENCE_FLOOR = 0.10;

export interface Candidate {
  memory_id: number; content: string; score: number; heat?: number; domain?: string;
  tags?: string[] | string; created_at?: string; emotional_valence?: number;
  _sa_injected?: boolean; [key: string]: unknown;
}
export interface HopfieldEngine {
  buildPatternMatrix(p: Array<[number, number[]]>, d: number): { matrix: number[][]; ids: number[] };
  retrieve(q: number[], m: number[][], ids: number[], beta: number, k: number): Array<[number, number]>;
}
export interface RecallStore {
  getEmbeddingsForMemories?(ids: number[]): Promise<Map<number, number[]>>;
  getMemory?(id: number): Promise<Record<string, unknown> | null>;
  spreadActivationMemories?(p: { queryTerms: string[]; decay: number; threshold: number;
    maxDepth: number; maxResults: number; minHeat: number; }): Promise<Array<[number, number]>>;
  getEntityByName?(n: string): Promise<{ id: number } | null>;
  getEntityIdsForMemories?(ids: number[]): Promise<Map<number, Set<number>>>;
  getUserMood?(): Promise<number | null>;
  bumpHeatRaw?(id: number, h: number): Promise<void>;
  updateMemoryAccess?(id: number): Promise<void>;
  updateMemoryEmotionalValence?(id: number, v: number): Promise<void>;
}
export interface HdcEngine {
  computeHdcScores(q: string, p: Array<[number, string]>, t: number): Array<[number, number]>;
}
export type ExtractQueryEntities = (q: string) => string[];
export type VaderCompoundFn = (t: string) => number;
export interface ReconsolidationAction { action: string; heat_delta: number; update_last_accessed: boolean; valence_delta: number; }
export type ComputeReconsolidationFn = (c: Candidate, q: string, o: { queryValence: number; contextTokens: Set<string> }) => ReconsolidationAction;

type MK = "HOPFIELD"|"HDC"|"SPREADING_ACTIVATION"|"DENDRITIC_CLUSTERS"|"EMOTIONAL_RETRIEVAL"|"MOOD_CONGRUENT_RERANK"|"RECONSOLIDATION";
const abl = (m: MK): boolean => process.env[`CORTEX_ABLATE_${m}`] === "1";

function jacc<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 0; let n = 0; for (const v of a) if (b.has(v)) n++;
  const u = a.size + b.size - n; return u ? n / u : 0;
}

/**
 * RRF blend: score=(1-beta)/(k+relRank)+beta/(k+mechRank)
 * source: cortex@ed33435 mcp_server/core/recall_pipeline.py lines 136-166
 */
function rrfBlend(cands: Candidate[], mr: Map<number,number>, beta: number, k = RRF_K): Candidate[] {
  if (!cands.length || beta <= 0) return cands;
  const n = cands.length;
  const s = cands.map((c,ri) => {
    const m = mr.get(c.memory_id) ?? n;
    const ns = (1-beta)/(k+ri)+beta/(k+m);
    return [ns, {...c, score: ns}] as [number, Candidate];
  });
  s.sort(([a],[b]) => b-a); return s.map(([,c]) => c);
}

/**
 * Reorder by Hopfield attention, RRF-blended.
 * source: cortex@ed33435 mcp_server/core/recall_pipeline.py lines 174-239
 * source: Ramsauer et al. (ICLR 2021)
 */
export async function hopfieldComplete(
  cands: Candidate[], qEmb: number[]|null, store: RecallStore|null, dim: number,
  opts?: { hopfieldBeta?: number; blendBeta?: number; engine?: HopfieldEngine },
): Promise<Candidate[]> {
  if (abl("HOPFIELD") || !cands.length || !qEmb || !store) return cands;
  const eng = opts?.engine; if (!eng) return cands;
  // source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 182 (hopfield_beta=8.0)
  const hb = opts?.hopfieldBeta ?? 8.0, bb = opts?.blendBeta ?? HOPFIELD_BETA;
  const ids = cands.map(c => c.memory_id);
  const pairs: Array<[number, number[]]> = [];
  if (store.getEmbeddingsForMemories) {
    const m = await store.getEmbeddingsForMemories(ids);
    for (const id of ids) { const e = m.get(id); if (e) pairs.push([id, e]); }
  } else if (store.getMemory) {
    for (const id of ids) { const m = await store.getMemory(id); if (m?.embedding) pairs.push([id, m.embedding as number[]]); }
  }
  if (!pairs.length) return cands;
  const { matrix, ids: hids } = eng.buildPatternMatrix(pairs, dim);
  if (!matrix.length) return cands;
  const hop = eng.retrieve(qEmb, matrix, hids, hb, hids.length);
  if (!hop.length) return cands;
  return rrfBlend(cands, new Map(hop.map(([id], r) => [id, r])), bb);
}

/**
 * Reorder by HDC similarity, RRF-blended.
 * source: cortex@ed33435 mcp_server/core/recall_pipeline.py lines 247-276
 * source: Kanerva (2009)
 */
export function hdcRerank(cands: Candidate[], q: string, opts?: { blendBeta?: number; engine?: HdcEngine }): Candidate[] {
  if (abl("HDC") || !cands.length || !opts?.engine) return cands;
  const hdc = opts.engine.computeHdcScores(q, cands.map(c => [c.memory_id, c.content??""]), -1);
  if (!hdc.length) return cands;
  return rrfBlend(cands, new Map(hdc.map(([id],r) => [id, r])), opts?.blendBeta ?? HDC_BETA);
}

/**
 * Expand via spreading activation, then RRF blend.
 * source: cortex@ed33435 mcp_server/core/recall_pipeline.py lines 285-365
 * source: Collins & Loftus (1975)
 */
export async function spreadingActivationExpand(
  cands: Candidate[], q: string, store: RecallStore|null,
  opts?: { decay?: number; threshold?: number; maxDepth?: number; maxResults?: number; minHeat?: number; blendBeta?: number; extractEntities?: ExtractQueryEntities },
): Promise<Candidate[]> {
  if (abl("SPREADING_ACTIVATION") || !cands.length || !store?.spreadActivationMemories) return cands;
  // source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 326 (SA_DECAY=0.65)
  const decay = opts?.decay ?? 0.65, threshold = opts?.threshold ?? 0.1;
  const maxDepth = opts?.maxDepth ?? 3, maxResults = opts?.maxResults ?? 50;
  // source: cortex@ed33435 mcp_server/core/recall_pipeline.py line 300 (SA min_heat=0.05)
  const minHeat = opts?.minHeat ?? 0.05, bb = opts?.blendBeta ?? SA_BETA;
  const ex = opts?.extractEntities ? opts.extractEntities(q) : [];
  const terms = [...new Set([...ex, ...q.split(/\s+/).filter((w: string) => w.length > 2)])];
  if (!terms.length) return cands;
  let sa: Array<[number,number]>;
  try { sa = await store.spreadActivationMemories({ queryTerms: terms, decay, threshold, maxDepth, maxResults, minHeat }); }
  catch { return cands; }
  if (!sa?.length) return cands;
  const seen = new Set(cands.map(c => c.memory_id));
  const exp = [...cands];
  if (store.getMemory) {
    for (const [id] of sa) {
      if (seen.has(id)) continue;
      let m: Record<string,unknown>|null = null;
      try { m = await store.getMemory(id); } catch { continue; }
      if (!m) continue;
      exp.push({ memory_id: id, content: (m.content as string)??"" , score: 0, heat: (m.heat as number)??0,
        domain: (m.domain as string)??"" , tags: (m.tags as string[])??[], created_at: (m.created_at as string)??"" , _sa_injected: true });
      seen.add(id);
    }
  }
  return rrfBlend(exp, new Map(sa.map(([id],r) => [id, r])), bb);
}

const PUNC = /[.,!?;:()[\]{}'"\`]/g;
function cEnt(c: Candidate): Set<string> {
  return new Set((c.content??"" ).toLowerCase().split(/\s+/).map((t:string) => t.replace(PUNC,"")).filter((t:string) => t.length > 2));
}
function cTag(c: Candidate): Set<string> {
  const t = c.tags; if (!t) return new Set();
  return typeof t==="string" ? new Set([t]) : new Set((t as string[]).map(String));
}

/**
 * Branch-affinity multiplicative modulation.
 * affinity=0.7*entSim+0.3*tagSim; factor=1+delta*(2*affinity-1)
 * source: cortex@ed33435 mcp_server/core/recall_pipeline.py lines 448-531
 * source: Poirazi, Brannon & Mel (2003); Jaccard (1912)
 */
export async function dendriticModulate(
  cands: Candidate[], q: string, store: RecallStore|null = null,
  opts?: { delta?: number; extractEntities?: ExtractQueryEntities },
): Promise<Candidate[]> {
  if (abl("DENDRITIC_CLUSTERS") || !cands.length) return cands;
  const delta = opts?.delta ?? DENDRITIC_DELTA; if (delta <= 0) return cands;
  const qTok = new Set(q.split(/\s+/).map((t:string) => t.replace(PUNC,"").toLowerCase()).filter((t:string) => t.length > 2));
  let qEids: Set<number> = new Set(), eim: Map<number,Set<number>> = new Map();
  if (store?.getEntityByName && opts?.extractEntities) {
    for (const name of opts.extractEntities(q)) {
      try { const r = await store.getEntityByName(name); if (r?.id != null) qEids.add(r.id); } catch {}
    }
    if (qEids.size > 0 && store.getEntityIdsForMemories) {
      try { eim = await store.getEntityIdsForMemories(cands.map(c => c.memory_id)); } catch { qEids = new Set(); }
    }
  }
  if (!qTok.size && !qEids.size) return cands;
  const mod = cands.map(c => {
    const es = qEids.size>0 ? jacc(qEids, eim.get(c.memory_id)??new Set<number>()) : (cEnt(c).size ? jacc(qTok, cEnt(c)) : 0);
    const ts = cTag(c).size && qTok.size ? jacc(qTok, cTag(c)) : 0;
    // source: cortex@ed33435 mcp_server/core/recall_pipeline.py lines 525-526
    const factor = 1 + delta * (2*(0.7*es+0.3*ts) - 1);
    return { ...c, score: (c.score??0) * factor };
  });
  return mod.sort((a,b) => (b.score??0)-(a.score??0));
}

/**
 * Rerank by query-valence congruence.
 * source: cortex@ed33435 mcp_server/core/recall_pipeline.py lines 542-591
 * source: Bower (1981) Am. Psychologist 36(2)
 */
export function emotionalRetrievalRerank(cands: Candidate[], q: string, opts?: { blendBeta?: number; valenceFl?: number; vaderCompound?: VaderCompoundFn }): Candidate[] {
  if (abl("EMOTIONAL_RETRIEVAL") || !cands.length || !opts?.vaderCompound) return cands;
  const vf = opts?.valenceFl ?? EMOTIONAL_QUERY_VALENCE_FLOOR;
  const beta = opts?.blendBeta ?? EMOTIONAL_RETRIEVAL_BETA;
  const qv = opts.vaderCompound(q);
  if (Math.abs(qv) < vf) return cands;
  const by = cands.map((c,i) => ({i, d: Math.abs((c.emotional_valence??0)-qv)})).sort((a,b) => a.d-b.d);
  return rrfBlend(cands, new Map(by.map(({i},r) => [cands[i]?.memory_id ?? 0, r])), beta);
}

/**
 * Apply Nader-2000 reconsolidation. MUST be the final post-WRRF stage.
 * source: cortex@ed33435 mcp_server/core/recall_pipeline.py lines 607-708
 * source: Nader, Schafe & LeDoux (2000) Nature 406(6797)
 */
export async function reconsolidationApply(
  cands: Candidate[], q: string, store: RecallStore|null,
  opts?: { topK?: number; computeReconsolidation?: ComputeReconsolidationFn; vaderCompound?: VaderCompoundFn },
): Promise<Candidate[]> {
  if (abl("RECONSOLIDATION") || !cands.length || !store || !opts?.computeReconsolidation) return cands;
  const qv = opts?.vaderCompound ? opts.vaderCompound(q) : 0;
  const qTok = new Set((q??"" ).split(/\s+/).map((t:string) => t.replace(PUNC,"").toLowerCase()).filter((t:string) => t.length > 2));
  const lim = opts?.topK != null ? Math.min(opts.topK, cands.length) : cands.length;
  for (let i = 0; i < lim; i++) {
    const c = cands[i]; if (!c) continue; let out: ReconsolidationAction;
    try { out = opts.computeReconsolidation(c, q, {queryValence: qv, contextTokens: qTok}); } catch { continue; }
    if (out.action==="none" && out.heat_delta===0) continue;
    if (store.bumpHeatRaw && out.heat_delta!==0) {
      try { const h=Math.max(0,Math.min(1,(c.heat??0.5)+out.heat_delta)); await store.bumpHeatRaw(c.memory_id,h); c.heat=h; } catch {}
    }
    if (store.updateMemoryAccess && out.update_last_accessed) { try { await store.updateMemoryAccess(c.memory_id); } catch {} }
    if (store.updateMemoryEmotionalValence && out.valence_delta!==0) {
      try { const v=Math.max(-1,Math.min(1,(c.emotional_valence??0)+out.valence_delta)); await store.updateMemoryEmotionalValence(c.memory_id,v); c.emotional_valence=v; } catch {}
    }
  }
  return cands;
}

/**
 * Rerank by user-mood congruence. No-ops when mood is null.
 * source: cortex@ed33435 mcp_server/core/recall_pipeline.py lines 718-759
 * source: Bower (1981) Am. Psychologist 36(2)
 */
export function moodCongruentRerank(cands: Candidate[], mood: number|null, opts?: { blendBeta?: number }): Candidate[] {
  if (abl("MOOD_CONGRUENT_RERANK") || mood===null || !cands.length) return cands;
  const beta = opts?.blendBeta ?? MOOD_CONGRUENT_BETA;
  const by = cands.map((c,i) => ({i, d: Math.abs((c.emotional_valence??0)-mood)})).sort((a,b) => a.d-b.d);
  return rrfBlend(cands, new Map(by.map(({i},r) => [cands[i]?.memory_id ?? 0, r])), beta);
}