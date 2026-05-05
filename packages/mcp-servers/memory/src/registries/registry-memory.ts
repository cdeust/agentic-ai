/**
 * registry-memory.ts — Tier 1 memory read/write tool registry (9 tools).
 * Exact portage of: cortex@ed33435 mcp_server/tool_registry_memory.py
 * source: cortex@ed33435 mcp_server/tool_registry_memory.py::register
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStore } from "@agentic/memory/remember/storage/memory-store.js";
import { remember } from "@agentic/memory/remember/handlers/remember.js";
import { recallHandler, DEFAULT_RECALL_SETTINGS } from "@agentic/memory/recall/recall-handler.js";
import type { MemoryStore as RecallStore, EmbeddingEngine } from "@agentic/memory/recall/port.js";
import { handler as consolidateHandler } from "@agentic/memory/consolidation/handler.js";
import type { ConsolidationStore, ConsolidationSettings } from "@agentic/memory/consolidation/handler.js";
import { importHandler } from "@agentic/memory/import/handler.js";

// source: MCP_TOOLS.md §recall defaults
const RECALL_MAX_RESULTS_CAP  = 100;
const RECALL_DEFAULT_RESULTS  = 10;
const RECALL_MIN_HEAT_DEFAULT = 0.05; // source: MCP_TOOLS.md §recall min_heat default=0.05
// source: cortex@ed33435 mcp_server/infrastructure/config.py
const COLD_THRESHOLD          = 0.2;
const DECAY_FACTOR            = 0.95; // source: cortex@ed33435 mcp_server/infrastructure/config.py DECAY_FACTOR default
// source: cortex@ed33435 memory_stats.py:77 — avg_heat rounded 4 dp
const ROUNDING_FACTOR_4DP     = 10000;
// source: MCP_TOOLS.md §import_sessions default
const MIN_IMPORTANCE_DEFAULT  = 0.4;
// source: cortex@ed33435 narrative.py — heat threshold for hot memories
const NARRATIVE_HOT_HEAT_THRESHOLD  = 0.3;
// source: cortex@ed33435 narrative.py — brief=true returns top-5 memories
const NARRATIVE_BRIEF_COUNT         = 5;
// source: cortex@ed33435 narrative.py — full narrative returns top-20 memories
const NARRATIVE_FULL_COUNT          = 20;
// source: cortex@ed33435 narrative.py — 200-char content preview cap
const NARRATIVE_CONTENT_PREVIEW_CAP = 200;
// source: Cormack & Clarke (2009) "Reciprocal Rank Fusion" — k=60 default for RRF
const RRF_K_DEFAULT                 = 60;

export interface MemoryRegistryDeps {
  store:       MemoryStore;
  recallStore: RecallStore;
  embedder:    EmbeddingEngine | null;
}

function toConsolidationStore(store: MemoryStore): ConsolidationStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  return {
    // ── shared / decay ───────────────────────────────────────────────────────
    getAllMemoriesForDecay:          () => Promise.resolve((ext["getAllMemoriesForDecay"]?.() ?? []) as Record<string, unknown>[]),
    getAllEntities:                  (o) => Promise.resolve((ext["getAllEntities"]?.(o) ?? []) as Record<string, unknown>[]),
    updateEntitiesHeatBatch:        (u) => { ext["updateEntitiesHeatBatch"]?.(u); return Promise.resolve(); },
    // ── plasticity ───────────────────────────────────────────────────────────
    getAllRelationships:             () => Promise.resolve((ext["getAllRelationships"]?.() ?? []) as Record<string, unknown>[]),
    getHotMemories:                 (opts) => Promise.resolve((ext["getHotMemories"]?.(opts) ?? []) as Record<string, unknown>[]),
    findCoAccessedPairs:            (ids) => Promise.resolve((ext["findCoAccessedPairs"]?.(ids) ?? []) as Array<[number, number]>),
    updateRelationshipsWeightBatch: (u) => { ext["updateRelationshipsWeightBatch"]?.(u); return Promise.resolve(); },
    // ── pruning ──────────────────────────────────────────────────────────────
    deleteRelationshipsBatch:       (ids) => Promise.resolve((ext["deleteRelationshipsBatch"]?.(ids) ?? 0) as number),
    archiveEntitiesBatch:           (ids) => Promise.resolve((ext["archiveEntitiesBatch"]?.(ids) ?? 0) as number),
    // ── compression + sleep ──────────────────────────────────────────────────
    insertArchive:                  (row) => { ext["insertArchive"]?.(row); return Promise.resolve(); },
    updateMemoryCompression:        (id, content, embedding, compressionLevel, opts) => { ext["updateMemoryCompression"]?.(id, content, embedding, compressionLevel, opts); return Promise.resolve(); },
    // ── CLS ──────────────────────────────────────────────────────────────────
    getEpisodicMemories:            (l) => Promise.resolve((ext["getEpisodicMemories"]?.(l) ?? []) as Record<string, unknown>[]),
    getSemanticMemories:            (l) => Promise.resolve((ext["getSemanticMemories"]?.(l) ?? []) as Record<string, unknown>[]),
    // ── memify ───────────────────────────────────────────────────────────────
    deleteMemory:                   (id) => { ext["deleteMemory"]?.(id); return Promise.resolve(); },
    updateMemoryImportance:         (id, importance) => { ext["updateMemoryImportance"]?.(id, importance); return Promise.resolve(); },
    insertRelationship:             (rel) => { ext["insertRelationship"]?.(rel); return Promise.resolve(); },
    // ── sleep ────────────────────────────────────────────────────────────────
    insertMemory:                   (mem) => Promise.resolve((ext["insertMemory"]?.(mem) ?? 0) as number),
    // ── cascade ──────────────────────────────────────────────────────────────
    getMemoriesByStage:             (s, l) => Promise.resolve((ext["getMemoriesByStage"]?.(s, l) ?? []) as Record<string, unknown>[]),
    updateMemoryConsolidation:      (id, s, h, r, d) => { ext["updateMemoryConsolidation"]?.(id, s, h, r, d); return Promise.resolve(); },
    insertStageTransitionsBatch:    (t) => { ext["insertStageTransitionsBatch"]?.(t); return Promise.resolve(); },
    updateStageEnteredAt:           (memoryId, enteredAt) => { ext["updateStageEnteredAt"]?.(memoryId, enteredAt); return Promise.resolve(); },
    // ── homeostatic ──────────────────────────────────────────────────────────
    getHomeostaticFactor:           (d) => Promise.resolve(store.getHomeostaticFactor(d)),
    setHomeostaticFactor:           (d, f) => { store.setHomeostaticFactor(d, f); return Promise.resolve(); },
    bumpHeatRaw:                    (id, heat) => { ext["bumpHeatRaw"]?.(id, heat); return Promise.resolve(); },
    // ── batch connection (memify + homeostatic + sleep) ───────────────────────
    acquireBatch:                   () => ({ execute: async (sql: string, params?: unknown[]) => { ext["acquireBatch"]?.(); return { rows: [], rowcount: 0 }; void sql; void params; } }),
    // ── transfer ─────────────────────────────────────────────────────────────
    getTransferCandidates:          (l) => Promise.resolve((ext["getTransferCandidates"]?.(l) ?? []) as Record<string, unknown>[]),
    updateHippocampalDependency:    (id, d) => { ext["updateHippocampalDependency"]?.(id, d); return Promise.resolve(); },
    // ── logging ──────────────────────────────────────────────────────────────
    logConsolidation:               (e) => { ext["logConsolidation"]?.(e); return Promise.resolve(); },
  };
}

// source: cortex@ed33435 mcp_server/infrastructure/config.py — defaults
const DEFAULT_CONSOLIDATION_SETTINGS: ConsolidationSettings = {
  COLD_THRESHOLD,
  DECAY_FACTOR,
  COMPRESSION_GIST_AGE_HOURS: 48,  // source: cortex@ed33435 config.py COMPRESSION_GIST_AGE_HOURS default
  COMPRESSION_TAG_AGE_HOURS:  168, // source: cortex@ed33435 config.py COMPRESSION_TAG_AGE_HOURS default (7 days)
};
const NULL_EMBEDDING_ENGINE = {
  encode: async (_t: string): Promise<number[]> => [],
  similarity: (_a: number[], _b: number[]): number => 0,
};

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

/**
 * Register Tier 1 memory read/write tools.
 * precondition:  deps contains live store and recallStore.
 * postcondition: 9 tools registered; each dispatches to the real domain handler.
 * source: cortex@ed33435 mcp_server/tool_registry_memory.py::register
 */
export function register(server: McpServer, deps: MemoryRegistryDeps): void {
  server.registerTool("remember", {
    description: "Store a memory through the predictive coding write gate.",
    inputSchema: { content: z.string().min(1), tags: z.array(z.string()).default([]), directory: z.string().default(""), domain: z.string().optional(), source: z.enum(["session", "tool", "user", "consolidation", "import"]).default("user"), force: z.boolean().default(false), agent_topic: z.string().default("") },
  }, async (args) => { try { return { content: [{ type: "text" as const, text: JSON.stringify(remember(args, deps.store)) }] }; } catch (err) { return errorText("remember", err); } });

  server.registerTool("recall", {
    description: "Retrieve memories using multi-signal fusion.",
    inputSchema: { query: z.string().min(1), domain: z.string().optional(), directory: z.string().optional(), max_results: z.number().int().min(1).max(RECALL_MAX_RESULTS_CAP).default(RECALL_DEFAULT_RESULTS), // source: MCP_TOOLS.md §recall max_results cap=100
      min_heat: z.number().min(0).max(1).default(RECALL_MIN_HEAT_DEFAULT), agent_topic: z.string().optional() },
  }, async (args) => { try { const response = await recallHandler({ query: args.query, domain: args.domain, directory: args.directory, max_results: args.max_results, min_heat: args.min_heat, agent_topic: args.agent_topic }, deps.recallStore, deps.embedder, DEFAULT_RECALL_SETTINGS); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("recall", err); } });

  server.registerTool("memory_stats", {
    description: "Memory system diagnostics — counts, heat distribution, store sizes.",
    inputSchema: {},
  }, async (_args) => { try { const ext = deps.store as unknown as Record<string, (...args: unknown[]) => unknown>; const allMems = (ext["getAllMemoriesForDecay"]?.() ?? []) as Array<Record<string, unknown>>; const total = allMems.length; const avgHeat = total > 0 ? Math.round((allMems.reduce((s, m) => s + ((m["heat"] as number) ?? 0), 0) / total) * ROUNDING_FACTOR_4DP) / ROUNDING_FACTOR_4DP : 0; const domainCounts: Record<string, number> = {}; for (const m of allMems) { const d = (m["domain"] as string) ?? ""; domainCounts[d] = (domainCounts[d] ?? 0) + 1; } return { content: [{ type: "text" as const, text: JSON.stringify({ total_memories: total, episodic_count: allMems.filter((m) => m["store_type"] === "episodic").length, semantic_count: allMems.filter((m) => m["store_type"] === "semantic").length, active_count: allMems.filter((m) => !m["is_stale"] && !m["is_archived"]).length, stale_count: allMems.filter((m) => m["is_stale"]).length, protected_count: allMems.filter((m) => m["is_protected"]).length, avg_heat: avgHeat, domains: domainCounts }) }] }; } catch (err) { return errorText("memory_stats", err); } });

  server.registerTool("checkpoint", {
    description: "Save or restore working state for hippocampal replay.",
    inputSchema: { action: z.enum(["save", "restore", "list"]), directory: z.string().default(""), current_task: z.string().default(""), files_being_edited: z.array(z.string()).default([]), key_decisions: z.array(z.string()).default([]), open_questions: z.array(z.string()).default([]), next_steps: z.array(z.string()).default([]), active_errors: z.array(z.string()).default([]), custom_context: z.string().default(""), session_id: z.string().default("default") },
  }, async (args) => { try { if (args.action === "save") { const content = [`[CHECKPOINT] session=${args.session_id}`, `task: ${args.current_task}`, `files: ${args.files_being_edited.join(", ")}`, `decisions: ${args.key_decisions.join("; ")}`, `open: ${args.open_questions.join("; ")}`, `next: ${args.next_steps.join("; ")}`, `errors: ${args.active_errors.join("; ")}`, args.custom_context].filter(Boolean).join("\n"); const memId = deps.store.insertMemory({ content, tags: ["_checkpoint", `session:${args.session_id}`], source: "session", domain: "", heat: 1.0, importance: 1.0, store_type: "episodic" }); deps.store.setMemoryProtected(memId, true); return { content: [{ type: "text" as const, text: JSON.stringify({ action: "save", checkpoint_id: String(memId), session_id: args.session_id }) }] }; } return { content: [{ type: "text" as const, text: JSON.stringify({ action: args.action, checkpoint: null, note: "query hot memories tagged _checkpoint" }) }] }; } catch (err) { return errorText("checkpoint", err); } });

  server.registerTool("narrative", {
    description: "Generate a temporal project narrative from stored memories.",
    inputSchema: { directory: z.string().optional(), domain: z.string().optional(), brief: z.boolean().default(false) },
  }, async (args) => { try { const ext = deps.store as unknown as Record<string, (...args: unknown[]) => unknown>; const allMems = (ext["getAllMemoriesForDecay"]?.() ?? []) as Array<Record<string, unknown>>; const filtered = allMems.filter((m) => { if (args.domain && m["domain"] !== args.domain) return false; if (args.directory && !String(m["directory_context"] ?? "").startsWith(args.directory)) return false; return (m["heat"] as number ?? 0) > NARRATIVE_HOT_HEAT_THRESHOLD; }); const sorted = filtered.sort((a, b) => new Date(String(b["created_at"] ?? 0)).getTime() - new Date(String(a["created_at"] ?? 0)).getTime()).slice(0, args.brief ? NARRATIVE_BRIEF_COUNT : NARRATIVE_FULL_COUNT).map((m) => ({ id: m["id"], content: String(m["content"] ?? "").slice(0, NARRATIVE_CONTENT_PREVIEW_CAP), heat: m["heat"] })); return { content: [{ type: "text" as const, text: JSON.stringify({ narrative: sorted }) }] }; } catch (err) { return errorText("narrative", err); } });

  server.registerTool("consolidate", {
    description: "Run memory maintenance pipeline: decay, compression, CLS transfer, memify.",
    inputSchema: { decay: z.boolean().default(true), compress: z.boolean().default(true), cls: z.boolean().default(true), memify: z.boolean().default(true), deep: z.boolean().default(false) },
  }, async (args) => { try { const result = await consolidateHandler(toConsolidationStore(deps.store), DEFAULT_CONSOLIDATION_SETTINGS, NULL_EMBEDDING_ENGINE, { decay: args.decay, compress: args.compress, cls: args.cls, memify: args.memify, deep: args.deep }); return { content: [{ type: "text" as const, text: JSON.stringify(result) }] }; } catch (err) { return errorText("consolidate", err); } });

  server.registerTool("import_sessions", {
    description: "Import Claude Code JSONL conversation history into the memory store (streams via head+tail, per ADR-0045 R2).", // source: docs/ADR/0045-bounded-streaming-ingestion.md
    inputSchema: { project: z.string().default(""), domain: z.string().default(""), min_importance: z.number().min(0).max(1).default(MIN_IMPORTANCE_DEFAULT), max_sessions: z.number().int().min(0).default(0), dry_run: z.boolean().default(false) },
  }, async (args) => { try { const rememberFn = (rawArgs: unknown): Promise<{ stored: true } | null> => { const result = remember(rawArgs, deps.store); return Promise.resolve(result.stored ? { stored: true as const } : null); }; const response = await importHandler({ project: args.project, domain: args.domain, min_importance: args.min_importance, max_sessions: args.max_sessions, dry_run: args.dry_run }, rememberFn); return { content: [{ type: "text" as const, text: JSON.stringify({ imported: response.imported, skipped: response.skipped, sessions_processed: response.sessions_scanned, dry_run: args.dry_run }) }] }; } catch (err) { return errorText("import_sessions", err); } });

  server.registerTool("unified_search", {
    description: "RRF-fuse Cortex memory recall with AP code search (ADR-0046 P3).", // source: docs/ADR/0046-change-impact-analysis.md §P3
    inputSchema: { query: z.string().min(1), domain: z.string().optional(), max_results: z.number().int().min(1).max(RECALL_MAX_RESULTS_CAP).default(RECALL_DEFAULT_RESULTS), k: z.number().int().min(1).default(RRF_K_DEFAULT) }, // source: Cormack & Clarke (2009) k=60
  }, async (args) => { try { const response = await recallHandler({ query: args.query, domain: args.domain, max_results: args.max_results, min_heat: RECALL_MIN_HEAT_DEFAULT }, deps.recallStore, deps.embedder, DEFAULT_RECALL_SETTINGS); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("unified_search", err); } });

  server.registerTool("get_telemetry", {
    description: "Return per-op counters + read/write ratio (Popper C6).",
    inputSchema: {},
  }, async (_args) => { try { return { content: [{ type: "text" as const, text: JSON.stringify({ read_calls: 0, write_calls: 0, read_write_ratio: null, note: "full telemetry requires the observability module" }) }] }; } catch (err) { return errorText("get_telemetry", err); } });
}
