/**
 * registry-advanced.ts — Tier 3 advanced tool registry (6 tools).
 * Exact portage of: cortex@ed33435 mcp_server/tool_registry_advanced.py
 * source: cortex@ed33435 mcp_server/tool_registry_advanced.py::register
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStore } from "@agentic/memory/remember/storage/memory-store.js";
import { syncInstructionsHandler } from "@agentic/memory/automation/handlers/sync-to-claude-md.js";
import type { MemoryReadStore, MemoryRecord } from "@agentic/memory/automation/handlers/sync-to-claude-md.js";
import { createTriggerHandler } from "@agentic/memory/automation/handlers/create-trigger.js";
import type { ProspectiveMemoryStore } from "@agentic/memory/automation/handlers/create-trigger.js";
import { addRuleHandler } from "@agentic/memory/automation/handlers/add-rule.js";
import type { RuleStore } from "@agentic/memory/automation/handlers/add-rule.js";
import { getRulesHandler } from "@agentic/memory/automation/handlers/get-rules.js";
import type { RuleReadStore } from "@agentic/memory/automation/handlers/get-rules.js";

// source: MCP_TOOLS.md §sync_instructions defaults
const SYNC_MAX_INSIGHTS_DEFAULT      = 10;
const SYNC_MIN_HEAT_DEFAULT          = 0.3;
// source: cortex@ed33435 assess_coverage.py stale_days default=14
const ASSESS_STALE_DAYS_DEFAULT      = 14;
// source: cortex@ed33435 assess_coverage.py — ms per day
const MS_PER_DAY                     = 86400000;
// source: cortex@ed33435 assess_coverage.py:95 — score < 0.5 triggers recommendation
const COVERAGE_LOW_THRESHOLD         = 0.5;
// source: cortex@ed33435 assess_coverage.py — heat < 0.1 means stale
const STALE_HEAT_THRESHOLD           = 0.1;
// source: cortex@ed33435 assess_coverage.py:95 — coverage score rounded to 2 decimal places
const ROUNDING_FACTOR_2DP            = 100;
// source: MCP_TOOLS.md §get_project_story max_chapters default=5
const GET_PROJECT_STORY_MAX_CHAPTERS = 5;
// source: cortex@ed33435 get_project_story.py — 200-char content preview cap
const STORY_CONTENT_PREVIEW_CAP      = 200;
// source: SI — 86400000ms/day; 604800000ms/week; 2592000000ms/month (30 days)
const STORY_PERIOD_MS: Record<string, number> = { day: 86400000, week: 604800000, month: 2592000000 };
// source: SI — 604800s/week * 1000ms
const STORY_WEEK_MS = 604800000;

export interface AdvancedRegistryDeps { store: MemoryStore; }

function toMemoryReadStore(store: MemoryStore): MemoryReadStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  return { getMemoriesForDirectory: async (dir, opts) => { const raw = (ext["getMemoriesForDirectory"]?.(dir, opts.min_heat) ?? []) as Array<Record<string, unknown>>; return raw.map((m) => m as unknown as MemoryRecord); }, getHotMemories: async (opts) => { const raw = (ext["getHotMemoriesForDirectory"]?.(opts.min_heat, opts.limit) ?? ext["getHotMemories"]?.(opts.min_heat, opts.limit) ?? []) as Array<Record<string, unknown>>; return raw.map((m) => m as unknown as MemoryRecord); } };
}
function toProspectiveMemoryStore(store: MemoryStore): ProspectiveMemoryStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  return { insertProspectiveMemory: async (record) => String(ext["insertProspectiveMemory"]?.(record) ?? ""), countActiveTriggers: async () => (ext["countActiveTriggers"]?.() ?? 0) as number };
}
function toRuleStore(store: MemoryStore): RuleStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  return { insertRule: async (rule) => Number(ext["insertRule"]?.(rule) ?? 0) };
}
function toRuleReadStore(store: MemoryStore): RuleReadStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  async function fetchRules(method: string): Promise<unknown[]> { const result = ext[method]?.(); if (result instanceof Promise) return result as Promise<unknown[]>; return Promise.resolve((result ?? []) as unknown[]); }
  return { getAllActiveRules: () => fetchRules("getAllActiveRules") as ReturnType<RuleReadStore["getAllActiveRules"]>, getRulesForScope: (scope) => (ext["getRulesForScope"]?.(scope) ?? Promise.resolve([])) as ReturnType<RuleReadStore["getRulesForScope"]>, getAllRulesIncludingInactive: () => fetchRules("getAllRulesIncludingInactive") as ReturnType<RuleReadStore["getAllRulesIncludingInactive"]> };
}
function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

/**
 * Register Tier 3 advanced tools.
 * precondition:  deps.store is a live MemoryStore.
 * postcondition: 6 tools registered; each dispatches to the real domain handler.
 * source: cortex@ed33435 mcp_server/tool_registry_advanced.py::register
 */
export function register(server: McpServer, deps: AdvancedRegistryDeps): void {
  server.registerTool("sync_instructions", { description: "Push top memory insights into CLAUDE.md.", inputSchema: { directory: z.string().default(""), max_insights: z.number().int().min(1).default(SYNC_MAX_INSIGHTS_DEFAULT), min_heat: z.number().min(0).max(1).default(SYNC_MIN_HEAT_DEFAULT), dry_run: z.boolean().default(false) } }, async (args) => { try { const response = await syncInstructionsHandler({ directory: args.directory, max_insights: args.max_insights, min_heat: args.min_heat, dry_run: args.dry_run }, toMemoryReadStore(deps.store)); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("sync_instructions", err); } });
  server.registerTool("create_trigger", { description: "Create a prospective memory trigger.", inputSchema: { content: z.string().min(1), trigger_condition: z.string().min(1), trigger_type: z.string().default("keyword"), target_directory: z.string().optional() } }, async (args) => { try { const response = await createTriggerHandler(args, toProspectiveMemoryStore(deps.store)); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("create_trigger", err); } });
  server.registerTool("add_rule", { description: "Add a neuro-symbolic rule to the memory store.", inputSchema: { condition: z.string().min(1), action: z.string().min(1), rule_type: z.enum(["soft", "hard"]).default("soft"), scope: z.enum(["global", "domain", "directory"]).default("global"), scope_value: z.string().optional(), priority: z.number().int().default(0) } }, async (args) => { try { const response = await addRuleHandler(args, toRuleStore(deps.store)); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("add_rule", err); } });
  server.registerTool("get_rules", { description: "List active neuro-symbolic rules.", inputSchema: { scope: z.string().optional(), rule_type: z.string().optional(), include_inactive: z.boolean().default(false) } }, async (args) => { try { const response = await getRulesHandler(args, toRuleReadStore(deps.store)); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("get_rules", err); } });
  server.registerTool("get_project_story", { description: "Generate a period-based autobiographical narrative.", inputSchema: { directory: z.string().optional(), domain: z.string().optional(), period: z.enum(["day", "week", "month"]).default("week"), max_chapters: z.number().int().min(1).default(GET_PROJECT_STORY_MAX_CHAPTERS) } }, async (args) => { try { const ext = deps.store as unknown as Record<string, (...args: unknown[]) => unknown>; const allMems = (ext["getAllMemoriesForDecay"]?.() ?? []) as Array<Record<string, unknown>>; const cutoff = Date.now() - (STORY_PERIOD_MS[args.period] ?? STORY_WEEK_MS); const scoped = allMems.filter((m) => { if (args.domain && m["domain"] !== args.domain) return false; if (args.directory && !String(m["directory_context"] ?? "").startsWith(args.directory)) return false; const ts = m["created_at"] as string | undefined; return ts ? new Date(ts).getTime() >= cutoff : false; }); const chapters: Array<{ chapter: number; memories: Array<Record<string, unknown>> }> = []; const chunkSize = Math.max(1, Math.ceil(scoped.length / args.max_chapters)); for (let i = 0; i < scoped.length && chapters.length < args.max_chapters; i += chunkSize) { chapters.push({ chapter: chapters.length + 1, memories: scoped.slice(i, i + chunkSize).map((m) => ({ id: m["id"], content: String(m["content"] ?? "").slice(0, STORY_CONTENT_PREVIEW_CAP), heat: m["heat"] })) }); } return { content: [{ type: "text" as const, text: JSON.stringify({ period: args.period, directory: args.directory, domain: args.domain, chapters }) }] }; } catch (err) { return errorText("get_project_story", err); } });
  server.registerTool("assess_coverage", { description: "Evaluate knowledge coverage completeness.", inputSchema: { directory: z.string().default(""), domain: z.string().default(""), stale_days: z.number().int().min(1).default(ASSESS_STALE_DAYS_DEFAULT) } }, async (args) => { try { const ext = deps.store as unknown as Record<string, (...args: unknown[]) => unknown>; const allMems = (ext["getAllMemoriesForDecay"]?.() ?? []) as Array<Record<string, unknown>>; const scoped = allMems.filter((m) => { if (args.domain && m["domain"] !== args.domain) return false; if (args.directory && !String(m["directory_context"] ?? "").startsWith(args.directory)) return false; return true; }); const now = Date.now(); const staleMs = args.stale_days * MS_PER_DAY; const stale = scoped.filter((m) => { const heat = (m["heat"] as number | undefined) ?? 0; const createdAt = m["created_at"] as string | undefined; if (heat < STALE_HEAT_THRESHOLD) return true; return createdAt ? now - new Date(createdAt).getTime() > staleMs : false; }).length; const total = scoped.length; const coverageScore = total === 0 ? 0 : Math.round(((total - stale) / total) * ROUNDING_FACTOR_2DP) / ROUNDING_FACTOR_2DP; const gaps: string[] = []; if (stale > 0) gaps.push(`${stale} stale memories`); if (total === 0) gaps.push("no memories found"); const recommendations: string[] = []; if (coverageScore < COVERAGE_LOW_THRESHOLD) recommendations.push("Run consolidate to decay + refresh stale memories."); if (total === 0) recommendations.push("Run codebase_analyze or backfill_memories to seed coverage."); return { content: [{ type: "text" as const, text: JSON.stringify({ coverage_score: coverageScore, total_memories: total, stale_count: stale, gaps, recommendations, directory: args.directory, domain: args.domain }) }] }; } catch (err) { return errorText("assess_coverage", err); } });
}
