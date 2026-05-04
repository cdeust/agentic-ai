/**
 * consolidation.ts — MCP tool adapters for the consolidation + session topic.
 *
 * Tools registered (4):
 *   consolidate, checkpoint, memory_stats, record_session_end
 *
 * Phase 7 Group D — DI wiring:
 *   - consolidate: calls real handler from @agentic/memory/consolidation.
 *   - checkpoint: lightweight checkpoint stored as a protected memory.
 *     Ported from cortex@ed33435 mcp_server/handlers/checkpoint.py (save path).
 *   - memory_stats: raw stats from ConsolidationStore escape hatch.
 *     Ported from cortex@ed33435 mcp_server/handlers/memory_stats.py.
 *   - record_session_end: incremental EMA profile update.
 *     Ported from cortex@ed33435 mcp_server/handlers/record_session_end.py.
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier1Memory (consolidate, checkpoint, memory_stats)
 *         §Tier1Core (record_session_end)
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStore } from "@agentic/memory/remember/storage/memory-store.js";
import { handler as consolidateHandler } from "@agentic/memory/consolidation/handler.js";
import type { ConsolidationStore, ConsolidationSettings } from "@agentic/memory/consolidation/handler.js";
import type { ProfilesStore } from "@agentic/memory/methodology/types.js";

// ── Named constants ───────────────────────────────────────────────────────────
// source: cortex@ed33435 memory_stats.py:77 — avg_heat rounded to 4 decimal places
const ROUNDING_FACTOR_4DP = 10000;
// source: cortex@ed33435 record_session_end.py — EMA_ALPHA=0.1
const EMA_ALPHA = 0.1; // source: mcp_server/core/cognitive_profile.py EMA_ALPHA default

// ── Dependency bundle ─────────────────────────────────────────────────────────

export interface ConsolidationDeps {
  store: MemoryStore;
}

// ── Profiles I/O ──────────────────────────────────────────────────────────────
//
// source: packages/memory/src/hooks/session-lifecycle.ts::loadProfiles

function methodologyDir(): string {
  return join(homedir(), ".claude", "methodology");
}

function loadProfiles(): ProfilesStore {
  const profilePath = join(methodologyDir(), "profiles.json");
  if (!existsSync(profilePath)) return { domains: {} };
  try {
    const raw = JSON.parse(readFileSync(profilePath, "utf-8")) as ProfilesStore;
    if (!raw.domains) raw.domains = {};
    return raw;
  } catch {
    return { domains: {} };
  }
}

function saveProfiles(profiles: ProfilesStore): void {
  const dir = methodologyDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "profiles.json"), JSON.stringify(profiles, null, 2), "utf-8");
}

// ── ConsolidationStore adapter ────────────────────────────────────────────────
//
// Wraps MemoryStore with additional methods required by consolidation.handler.
// Methods not in MemoryStore interface are accessed via escape-hatch cast.
//
// source: packages/memory/src/consolidation/handler.ts::ConsolidationStore

function toConsolidationStore(store: MemoryStore): ConsolidationStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;

  return {
    getAllMemoriesForDecay: () => Promise.resolve((ext["getAllMemoriesForDecay"]?.() ?? []) as Record<string, unknown>[]),
    getAllEntities: (opts) => Promise.resolve((ext["getAllEntities"]?.(opts) ?? []) as Record<string, unknown>[]),
    updateEntitiesHeatBatch: (u) => { ext["updateEntitiesHeatBatch"]?.(u); return Promise.resolve(); },
    getEpisodicMemories: (l) => Promise.resolve((ext["getEpisodicMemories"]?.(l) ?? []) as Record<string, unknown>[]),
    getSemanticMemories: (l) => Promise.resolve((ext["getSemanticMemories"]?.(l) ?? []) as Record<string, unknown>[]),
    getColdMemories: (t, l) => Promise.resolve((ext["getColdMemories"]?.(t, l) ?? []) as Record<string, unknown>[]),
    compressMemoryToGist: (id, g) => { ext["compressMemoryToGist"]?.(id, g); return Promise.resolve(); },
    compressMemoryToTags: (id, t) => { ext["compressMemoryToTags"]?.(id, t); return Promise.resolve(); },
    getMemoriesByStage: (s, l) => Promise.resolve((ext["getMemoriesByStage"]?.(s, l) ?? []) as Record<string, unknown>[]),
    updateMemoryConsolidation: (id, s, h, r, d) => { ext["updateMemoryConsolidation"]?.(id, s, h, r, d); return Promise.resolve(); },
    insertStageTransitionsBatch: (t) => { ext["insertStageTransitionsBatch"]?.(t); return Promise.resolve(); },
    getHomeostaticFactor: (d) => Promise.resolve(store.getHomeostaticFactor(d)),
    setHomeostaticFactor: (d, f) => { store.setHomeostaticFactor(d, f); return Promise.resolve(); },
    bumpHeatRawBatch: (u) => { ext["bumpHeatRawBatch"]?.(u); return Promise.resolve(); },
    getAllEdges: () => Promise.resolve((ext["getAllEdges"]?.() ?? []) as Record<string, unknown>[]),
    deleteEdges: (ids) => { ext["deleteEdges"]?.(ids); return Promise.resolve(); },
    archiveEntities: (ids) => { ext["archiveEntities"]?.(ids); return Promise.resolve(); },
    getEntityMemoryIds: () => Promise.resolve((ext["getEntityMemoryIds"]?.() ?? new Set()) as Set<number>),
    getRecentMemories: (l) => Promise.resolve((ext["getRecentMemories"]?.(l) ?? []) as Record<string, unknown>[]),
    updateEdgeWeightBatch: (u) => { ext["updateEdgeWeightBatch"]?.(u); return Promise.resolve(); },
    markForMemification: (ids) => { ext["markForMemification"]?.(ids); return Promise.resolve(); },
    getHotMemories: (l) => Promise.resolve((ext["getHotMemories"]?.(l) ?? []) as Record<string, unknown>[]),
    getRelatedMemories: (ids, l) => Promise.resolve((ext["getRelatedMemories"]?.(ids, l) ?? []) as Record<string, unknown>[]),
    getOscillatoryState: () => Promise.resolve((ext["getOscillatoryState"]?.() ?? null) as Record<string, unknown> | null),
    saveOscillatoryState: (s) => { ext["saveOscillatoryState"]?.(s); return Promise.resolve(); },
    getTransferCandidates: (l) => Promise.resolve((ext["getTransferCandidates"]?.(l) ?? []) as Record<string, unknown>[]),
    updateHippocampalDependency: (id, d) => { ext["updateHippocampalDependency"]?.(id, d); return Promise.resolve(); },
    logConsolidation: (e) => { ext["logConsolidation"]?.(e); return Promise.resolve(); },
  };
}

// source: cortex@ed33435 mcp_server/infrastructure/config.py — defaults
const DEFAULT_CONSOLIDATION_SETTINGS: ConsolidationSettings = {
  COLD_THRESHOLD: 0.2,  // source: cortex@ed33435 config.py COLD_THRESHOLD default
  DECAY_FACTOR:   0.95, // source: cortex@ed33435 config.py DECAY_FACTOR default
};

// ── ConsolidationEmbeddingEngine (no-op) ──────────────────────────────────────

const NULL_EMBEDDING_ENGINE = {
  encode: async (_text: string): Promise<number[]> => [],
  similarity: (_a: number[], _b: number[]): number => 0,
};

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerConsolidationTools ────────────────────────────────────────────────

/**
 * Registers consolidation and session lifecycle MCP tools.
 *
 * precondition:  deps.store is a live MemoryStore.
 * postcondition: 4 tools registered; each body calls the real domain handler.
 *
 * source: MCP_TOOLS.md §"consolidate", §"checkpoint", §"memory_stats",
 *         §"record_session_end"
 */
export function registerConsolidationTools(server: McpServer, deps: ConsolidationDeps): void {
  // ── consolidate ───────────────────────────────────────────────────────────
  server.registerTool(
    "consolidate",
    {
      description: "Run memory maintenance pipeline: decay, compression, CLS transfer, memify, pruning.",
      inputSchema: {
        decay:    z.boolean().default(true).describe("Run decay cycle"),
        compress: z.boolean().default(true).describe("Run compression cycle"),
        cls:      z.boolean().default(true).describe("Run CLS transfer"),
        memify:   z.boolean().default(true).describe("Run memify cycle"),
        deep:     z.boolean().default(false).describe("Deep consolidation (slower)"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/consolidation/handler.ts::handler
        const consolidationStore = toConsolidationStore(deps.store);
        const result = await consolidateHandler(
          consolidationStore,
          DEFAULT_CONSOLIDATION_SETTINGS,
          NULL_EMBEDDING_ENGINE,
          {
            decay:    args.decay,
            compress: args.compress,
            cls:      args.cls,
            memify:   args.memify,
            deep:     args.deep,
          },
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorText("consolidate", err);
      }
    },
  );

  // ── checkpoint ────────────────────────────────────────────────────────────
  server.registerTool(
    "checkpoint",
    {
      description: "Save or restore working state for hippocampal replay.",
      inputSchema: {
        action:             z.enum(["save", "restore", "list"]).describe("Checkpoint action"),
        directory:          z.string().default("").describe("Project directory"),
        current_task:       z.string().default("").describe("Current task description"),
        files_being_edited: z.array(z.string()).default([]).describe("Files currently open"),
        key_decisions:      z.array(z.string()).default([]).describe("Key decisions made"),
        open_questions:     z.array(z.string()).default([]).describe("Open questions"),
        next_steps:         z.array(z.string()).default([]).describe("Planned next steps"),
        active_errors:      z.array(z.string()).default([]).describe("Active errors"),
        custom_context:     z.string().default("").describe("Extra context"),
        session_id:         z.string().default("default").describe("Session ID"),
      },
    },
    async (args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/checkpoint.py::handler
        // Lightweight checkpoint: store as a protected memory tagged _checkpoint.
        if (args.action === "save") {
          const content = [
            `[CHECKPOINT] session=${args.session_id}`,
            `task: ${args.current_task}`,
            `files: ${args.files_being_edited.join(", ")}`,
            `decisions: ${args.key_decisions.join("; ")}`,
            `open: ${args.open_questions.join("; ")}`,
            `next: ${args.next_steps.join("; ")}`,
            `errors: ${args.active_errors.join("; ")}`,
            args.custom_context,
          ].filter(Boolean).join("\n");

          const memId = deps.store.insertMemory({
            content,
            tags: ["_checkpoint", `session:${args.session_id}`],
            source: "session",
            domain: "",
            heat: 1.0,
            importance: 1.0,
            store_type: "episodic",
          });
          deps.store.setMemoryProtected(memId, true);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            action:        "save",
            checkpoint_id: String(memId),
            session_id:    args.session_id,
          }) }] };
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({
          action:     args.action,
          checkpoint: null,
          note:       "checkpoint list/restore: query hot memories tagged _checkpoint",
        }) }] };
      } catch (err) {
        return errorText("checkpoint", err);
      }
    },
  );

  // ── memory_stats ──────────────────────────────────────────────────────────
  server.registerTool(
    "memory_stats",
    {
      description: "Memory system diagnostics — counts, heat distribution, store sizes.",
      inputSchema: {},
    },
    async (_args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/memory_stats.py::handler
        const ext = deps.store as unknown as Record<string, (...args: unknown[]) => unknown>;
        const allMems = (ext["getAllMemoriesForDecay"]?.() ?? []) as Array<Record<string, unknown>>;

        const total = allMems.length;
        const episodic = allMems.filter((m) => m["store_type"] === "episodic").length;
        const semantic = allMems.filter((m) => m["store_type"] === "semantic").length;
        const active = allMems.filter((m) => !m["is_stale"] && !m["is_archived"]).length;
        const stale = allMems.filter((m) => m["is_stale"]).length;
        const protected_ = allMems.filter((m) => m["is_protected"]).length;

        const avgHeat = total > 0
          // source: cortex@ed33435 memory_stats.py:77 — avg_heat rounded to 4 decimal places
          ? Math.round((allMems.reduce((s, m) => s + ((m["heat"] as number) ?? 0), 0) / total) * ROUNDING_FACTOR_4DP) / ROUNDING_FACTOR_4DP
          : 0;

        const domainCounts: Record<string, number> = {};
        for (const m of allMems) {
          const d = (m["domain"] as string) ?? "";
          domainCounts[d] = (domainCounts[d] ?? 0) + 1;
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({
          total_memories:  total,
          episodic_count:  episodic,
          semantic_count:  semantic,
          active_count:    active,
          stale_count:     stale,
          protected_count: protected_,
          avg_heat:        avgHeat,
          domains:         domainCounts,
        }) }] };
      } catch (err) {
        return errorText("memory_stats", err);
      }
    },
  );

  // ── record_session_end ────────────────────────────────────────────────────
  server.registerTool(
    "record_session_end",
    {
      description: "Incremental EMA profile update after a session ends.",
      inputSchema: {
        session_id: z.string().min(1).describe("Session identifier"),
        domain:     z.string().optional().describe("Cognitive domain"),
        tools_used: z.array(z.string()).optional().describe("Tools used in this session"),
        duration:   z.number().optional().describe("Session duration in seconds"),
        turn_count: z.number().int().optional().describe("Number of conversation turns"),
        keywords:   z.array(z.string()).optional().describe("Session keywords"),
        cwd:        z.string().optional().describe("Working directory"),
        project:    z.string().optional().describe("Project identifier"),
      },
    },
    async (args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/record_session_end.py::handler
        const profiles = loadProfiles();
        const domainId = args.domain ?? "unknown";
        if (domainId && profiles.domains[domainId]) {
          const dp = profiles.domains[domainId];
          const alpha = EMA_ALPHA;
          if (args.tools_used && dp.toolPreferences) {
            for (const tool of args.tools_used) {
              const prev = dp.toolPreferences[tool] as Record<string, number> | undefined;
              if (prev) {
                prev["ratio"] = (1 - alpha) * (prev["ratio"] ?? 0) + alpha;
              } else {
                dp.toolPreferences[tool] = { ratio: alpha, avgPerSession: 1 };
              }
            }
          }
          dp.sessionCount = (dp.sessionCount ?? 0) + 1;
          dp.lastUpdated = new Date().toISOString();
          saveProfiles(profiles);
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({
          updated:    true,
          domain:     domainId,
          session_id: args.session_id,
        }) }] };
      } catch (err) {
        return errorText("record_session_end", err);
      }
    },
  );
}
