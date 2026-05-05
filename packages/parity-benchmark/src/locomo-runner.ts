/**
 * LoCoMo benchmark runner — runs the dataset through the TS Cortex
 * (SqliteMemoryStore + recall port adapter + recallHandler) and emits
 * per-question hit ranks.
 *
 * Mirrors the Python benchmark's evaluate_conversation contract:
 *   - one in-memory store per conversation
 *   - sessions seeded as memories with source="session_<idx>"
 *   - each QA's `evidence` parsed into target session indices
 *   - hit_rank = first rank whose memory's session_idx is in target set
 *
 * source: cortex@1ef1376 benchmarks/locomo/run_benchmark.py:43-90 (evaluate_conversation)
 * source: cortex@1ef1376 benchmarks/locomo/run_benchmark.py:191-225 (per-conversation flow)
 * source: packages/mcp-servers/memory/src/index.ts:92-177 (recall port adapter pattern)
 */

import { recallHandler } from "@agentic/memory/recall/recall-handler.js";
import type { MemoryStore as RecallMemoryStore } from "@agentic/memory/recall/port.js";
import type { MemoryItem } from "@agentic/memory/recall/types.js";
import { SqliteMemoryStore } from "@agentic/memory/remember/storage/sqlite-store.js";
import {
  CATEGORY_NAMES,
  extractSessions,
  parseEvidenceRefs,
  type LocomoConversation,
} from "./locomo-loader.js";
import type { QuestionResult } from "./scoring.js";

// source: cortex@1ef1376 run_benchmark.py:73 — same top_k passed to recall.
const TOP_K = 10;

// Cap conversations seeded per run when --limit is given.
// Each conversation gets a fresh store, so this controls total runtime linearly.
const DEFAULT_LIMIT: number | null = null;

interface SeededState {
  /** Map of memory_id → originating session_idx, mirrors source_map in Python. */
  readonly midToSidx: Map<number, number>;
}

/**
 * Adapt a SqliteMemoryStore to the recall-side MemoryStore port.
 *
 * source: packages/mcp-servers/memory/src/index.ts:103-177 — same adapter pattern.
 *   Centralised here so the bench runner doesn't depend on the MCP server package.
 */
function makeRecallStore(memoryStore: SqliteMemoryStore): RecallMemoryStore {
  const ext = memoryStore as unknown as Record<string, (...a: unknown[]) => unknown>;
  return {
    searchByVector: async (embedding, topK, minHeat) => {
      const buf = Buffer.from(new Float32Array(embedding).buffer);
      const hits = memoryStore.searchVectors(buf, topK, minHeat);
      return hits.map(([memory_id, distance]) => ({ memory_id, distance }));
    },
    searchByFts: async (query, limit) => {
      const raw = (ext["searchFts"]?.(query, limit) ?? ext["ftsSearch"]?.(query, limit) ?? []) as Array<Record<string, unknown>>;
      return raw.map((r) => ({
        memory_id: r["id"] as number,
        score: ((r["rank"] as number) ?? (r["score"] as number)) ?? 0,
      }));
    },
    getMemory: async (id) => memoryStore.getMemory(id) as MemoryItem | null,
    getByIds: async (ids) => {
      const raw = (ext["getByIds"]?.(ids) ?? ids.map((id) => memoryStore.getMemory(id)).filter(Boolean)) as MemoryItem[];
      return raw.filter(Boolean);
    },
    getMemoriesForDomain: async (domain, minHeat, limit) =>
      (ext["getMemoriesForDomain"]?.(domain, minHeat, limit) ?? []) as MemoryItem[],
    getMemoriesForDirectory: async (directory, minHeat) =>
      (ext["getMemoriesForDirectory"]?.(directory, minHeat) ?? []) as MemoryItem[],
    getHotMemories: async (minHeat, limit) =>
      (ext["getHotMemories"]?.(minHeat, limit) ?? []) as MemoryItem[],
    getAllActiveRules: async () => (ext["getAllActiveRules"]?.() ?? []) as unknown[],
    getActiveProspectiveMemories: async () =>
      (ext["getActiveProspectiveMemories"]?.() ?? []) as unknown[],
    updateMemoryAccess: async (id) => {
      memoryStore.updateMemoryAccess(id);
    },
    incrementReplayCount: async (id) => {
      ext["incrementReplayCount"]?.(id);
    },
    reinforceOrCreateRelationship: async (a, b, lr) => {
      ext["reinforceOrCreateRelationship"]?.(a, b, lr);
    },
  };
}

function seedConversation(
  store: SqliteMemoryStore,
  conv: LocomoConversation,
): SeededState {
  const sessions = extractSessions(conv.conversation);
  const midToSidx = new Map<number, number>();
  for (const s of sessions) {
    const id = store.insertMemory({
      content: s.content,
      tags: ["locomo"],
      domain: "locomo",
      source: `session_${s.session_idx}`,
      created_at: s.date,
    });
    if (id > 0) midToSidx.set(id, s.session_idx);
  }
  return { midToSidx };
}

async function evaluateQuestion(
  recallStore: RecallMemoryStore,
  state: SeededState,
  qa: LocomoConversation["qa"][number],
): Promise<QuestionResult | null> {
  const refs = parseEvidenceRefs(qa.evidence);
  const targetSessions = new Set(refs.map(([sidx]) => sidx));
  if (targetSessions.size === 0) return null;
  const category = CATEGORY_NAMES[qa.category ?? 0] ?? `unknown_${qa.category ?? 0}`;
  // source: cortex@1ef1376 run_benchmark.py:73 — recall(question, top_k=10, domain="locomo").
  // min_heat=0 keeps every seeded session in the candidate pool; the Python
  // benchmark does not filter by heat (sessions are loaded immediately before
  // querying so all rows have heat ≈ initial).
  const response = await recallHandler(
    { query: qa.question, max_results: TOP_K, domain: "locomo", min_heat: 0 },
    recallStore,
  );
  let hitRank: number | null = null;
  for (let i = 0; i < response.results.length; i++) {
    const result = response.results[i];
    if (!result) continue;
    const sidx = state.midToSidx.get(result.memory_id);
    if (sidx !== undefined && targetSessions.has(sidx)) {
      hitRank = i + 1;
      break;
    }
  }
  return { category, hit_rank: hitRank };
}

async function evaluateConversation(
  conv: LocomoConversation,
): Promise<QuestionResult[]> {
  const store = new SqliteMemoryStore(":memory:");
  const recallStore = makeRecallStore(store);
  try {
    const state = seedConversation(store, conv);
    const results: QuestionResult[] = [];
    for (const qa of conv.qa) {
      const r = await evaluateQuestion(recallStore, state, qa);
      if (r) results.push(r);
    }
    return results;
  } finally {
    store.close();
  }
}

export interface RunOptions {
  readonly limit?: number | null;
  readonly onProgress?: (current: number, total: number) => void;
}

/**
 * Run LoCoMo over an array of conversations and return per-question results.
 *
 * precondition: conversations is the loaded locomo10.json array.
 * postcondition: returned array contains one QuestionResult per question with
 *   evidence; questions without evidence are skipped (matches Python behavior).
 */
export async function runLocomo(
  conversations: readonly LocomoConversation[],
  options: RunOptions = {},
): Promise<QuestionResult[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const slice = limit !== null && limit > 0 ? conversations.slice(0, limit) : conversations;
  const all: QuestionResult[] = [];
  for (let i = 0; i < slice.length; i++) {
    const conv = slice[i];
    if (!conv) continue;
    const convResults = await evaluateConversation(conv);
    all.push(...convResults);
    options.onProgress?.(i + 1, slice.length);
  }
  return all;
}
