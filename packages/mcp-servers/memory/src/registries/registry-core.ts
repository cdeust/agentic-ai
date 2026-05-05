/**
 * registry-core.ts — Tier 1 core profiling tool registry (9 tools).
 * Exact portage of: cortex@ed33435 mcp_server/tool_registry_core.py
 * source: cortex@ed33435 mcp_server/tool_registry_core.py::register
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProfilesStore } from "@agentic/memory/methodology/types.js";
import { queryMethodology } from "@agentic/memory/methodology/handlers/query-methodology.js";
import { detectDomainHandler } from "@agentic/memory/methodology/handlers/detect-domain.js";
import { rebuildProfiles, checkSkip } from "@agentic/memory/methodology/handlers/rebuild-profiles.js";
import { exploreFeatures } from "@agentic/memory/methodology/handlers/explore-features.js";
import { queryWorkflowGraph } from "@agentic/memory/workflow-graph/handlers/query-workflow-graph.js";

// source: cortex@ed33435 mcp_server/core/cognitive_profile.py EMA_ALPHA default
const EMA_ALPHA = 0.1;

// source: docs/ADR/0014-cortex-http-server-restored.md — optional peer dep
async function launchDashboard(opts: { openBrowser: boolean }): Promise<string> {
  const mod = await import("@agentic/memory-dashboard/launcher" as string);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).launchDashboard(opts) as Promise<string>;
}

function methodologyDir(): string { return join(homedir(), ".claude", "methodology"); }
function loadProfiles(): ProfilesStore {
  const p = join(methodologyDir(), "profiles.json");
  if (!existsSync(p)) return { domains: {} };
  try { const raw = JSON.parse(readFileSync(p, "utf-8")) as ProfilesStore; if (!raw.domains) raw.domains = {}; return raw; }
  catch { return { domains: {} }; }
}
function saveProfiles(profiles: ProfilesStore): void {
  const dir = methodologyDir(); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "profiles.json"), JSON.stringify(profiles, null, 2), "utf-8");
}
function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

/**
 * Register all Tier 1 core profiling tools.
 * precondition:  server is a live McpServer.
 * postcondition: 9 tools registered; each dispatches to the real domain handler.
 * source: cortex@ed33435 mcp_server/tool_registry_core.py::register
 */
export function register(server: McpServer): void {
  server.registerTool("query_methodology", { description: "Returns cognitive profile for the current domain.", inputSchema: { cwd: z.string().optional(), project: z.string().optional(), first_message: z.string().optional() } }, async (args) => { try { const profiles = loadProfiles(); return { content: [{ type: "text" as const, text: JSON.stringify(queryMethodology({ cwd: args.cwd, project: args.project, firstMessage: args.first_message }, profiles)) }] }; } catch (err) { return errorText("query_methodology", err); } });
  server.registerTool("detect_domain", { description: "Lightweight domain classification from cwd/project.", inputSchema: { cwd: z.string().optional(), project: z.string().optional(), first_message: z.string().optional() } }, async (args) => { try { const profiles = loadProfiles(); return { content: [{ type: "text" as const, text: JSON.stringify(detectDomainHandler({ cwd: args.cwd, project: args.project, firstMessage: args.first_message }, profiles)) }] }; } catch (err) { return errorText("detect_domain", err); } });
  server.registerTool("rebuild_profiles", { description: "Full rescan of all session data to rebuild methodology profiles from scratch.", inputSchema: { domain: z.string().optional(), force: z.boolean().default(false) } }, async (args) => { try { const existingProfiles = loadProfiles(); const skipCheck = checkSkip(existingProfiles, args.force); if (skipCheck.skip) { return { content: [{ type: "text" as const, text: JSON.stringify({ rebuilt: skipCheck.domains ?? [], duration_ms: 0, skipped: true, reason: skipCheck.reason }) }] }; } const result = rebuildProfiles({ byProject: {}, existingProfiles, targetDomain: args.domain }); return { content: [{ type: "text" as const, text: JSON.stringify({ rebuilt: result.domains, total_sessions: result.totalSessions, duration_ms: 0 }) }] }; } catch (err) { return errorText("rebuild_profiles", err); } });
  server.registerTool("list_domains", { description: "Overview of all detected cognitive domains.", inputSchema: {} }, async (_args) => { try { const profiles = loadProfiles(); const domains = Object.entries(profiles.domains).map(([id, domain]) => ({ id, label: domain.label ?? id, session_count: domain.sessionCount ?? 0, last_active: domain.lastUpdated ?? null, confidence: domain.confidence ?? 0, projects: domain.projects ?? [] })); return { content: [{ type: "text" as const, text: JSON.stringify({ domains }) }] }; } catch (err) { return errorText("list_domains", err); } });
  server.registerTool("record_session_end", { description: "Incremental EMA profile update after a session ends.", inputSchema: { session_id: z.string().min(1), domain: z.string().optional(), tools_used: z.array(z.string()).optional(), duration: z.number().min(0).optional(), turn_count: z.number().int().min(0).optional(), keywords: z.array(z.string()).optional(), cwd: z.string().optional(), project: z.string().optional() } }, async (args) => { try { const profiles = loadProfiles(); const domainId = args.domain ?? "unknown"; if (domainId !== "unknown" && profiles.domains[domainId]) { const dp = profiles.domains[domainId]; if (args.tools_used && dp.toolPreferences) { for (const tool of args.tools_used) { const prev = dp.toolPreferences[tool] as Record<string, number> | undefined; if (prev) { prev["ratio"] = (1 - EMA_ALPHA) * (prev["ratio"] ?? 0) + EMA_ALPHA; } else { dp.toolPreferences[tool] = { ratio: EMA_ALPHA, avgPerSession: 1 }; } } } dp.sessionCount = (dp.sessionCount ?? 0) + 1; dp.lastUpdated = new Date().toISOString(); saveProfiles(profiles); } return { content: [{ type: "text" as const, text: JSON.stringify({ domain: domainId, updated: true, session_id: args.session_id, triggers_created: 0, critique: "" }) }] }; } catch (err) { return errorText("record_session_end", err); } });
  server.registerTool("get_methodology_graph", { description: "Returns methodology map as graph data for 3D visualisation.", inputSchema: { domain: z.string().optional() } }, async (args) => { try { const profiles = loadProfiles(); const domains = (profiles.domains ?? {}) as unknown as Record<string, Record<string, unknown>>; const nodes: Array<Record<string, unknown>> = []; const edges: Array<Record<string, unknown>> = []; let edgeId = 0; for (const [id, domain] of Object.entries(domains)) { if (args.domain && id !== args.domain) continue; nodes.push({ id, label: domain["label"] ?? id, session_count: domain["sessionCount"] ?? 0, confidence: domain["confidence"] ?? 0 }); const bridges = (domain["connectionBridges"] ?? []) as Array<Record<string, unknown>>; for (const bridge of bridges) { const target = bridge["targetDomain"] as string | undefined; if (!target) continue; edges.push({ id: edgeId++, source: id, target, bridge_type: bridge["bridgeType"] ?? "unknown", strength: bridge["strength"] ?? 0 }); } } return { content: [{ type: "text" as const, text: JSON.stringify({ nodes, edges }) }] }; } catch (err) { return errorText("get_methodology_graph", err); } });
  server.registerTool("query_workflow_graph", { description: "Return a typed subgraph of the unified workflow graph.", inputSchema: { node_kind: z.union([z.string(), z.array(z.string())]).optional(), edge_kind: z.union([z.string(), z.array(z.string())]).optional(), neighbour_of: z.string().optional(), depth: z.number().int().optional(), domain: z.string().optional(), limit_nodes: z.number().int().optional() } }, async (args) => { try { const emptyGraph = { nodes: [], edges: [], links: [], meta: { node_count: 0, edge_count: 0, built_at: new Date().toISOString() } }; const response = queryWorkflowGraph(emptyGraph, { node_kind: args.node_kind as string | string[] | undefined, edge_kind: args.edge_kind as string | string[] | undefined, neighbour_of: args.neighbour_of, depth: args.depth, domain: args.domain, limit_nodes: args.limit_nodes }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("query_workflow_graph", err); } });
  server.registerTool("open_visualization", { description: "Launch the 3D methodology constellation map in the browser.", inputSchema: { domain: z.string().optional() } }, async (args) => { try { const url = await launchDashboard({ openBrowser: true }); const finalUrl = args.domain ? `${url}?domain=${encodeURIComponent(args.domain)}` : url; return { content: [{ type: "text" as const, text: JSON.stringify({ url: finalUrl, message: `Dashboard launched at ${finalUrl}` }) }] }; } catch (err) { return errorText("open_visualization", err); } });
  server.registerTool("explore_features", { description: "Explore interpretability features.", inputSchema: { mode: z.enum(["features", "persona", "attribution", "crosscoder"]), domain: z.string().optional(), compare_domain: z.string().optional() } }, async (args) => { try { const profiles = loadProfiles(); return { content: [{ type: "text" as const, text: JSON.stringify(exploreFeatures({ mode: args.mode, domain: args.domain, compareDomain: args.compare_domain }, profiles)) }] }; } catch (err) { return errorText("explore_features", err); } });
}
