/**
 * advanced.ts — MCP tool adapters for the advanced/automation topic.
 *
 * Tools registered (6):
 *   sync_instructions, create_trigger, add_rule, get_rules,
 *   assess_coverage, query_workflow_graph
 *
 * Phase 7 Group D — DI wiring:
 *   - sync_instructions: calls real syncInstructionsHandler.
 *   - create_trigger: calls real createTriggerHandler.
 *   - add_rule: calls real addRuleHandler.
 *   - get_rules: calls real getRulesHandler.
 *   - assess_coverage: ported inline from cortex@ed33435 assess_coverage.py.
 *   - query_workflow_graph: calls real queryWorkflowGraph with skeleton source.
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier2Advanced, §Tier1Core (query_workflow_graph)
 * source: packages/memory/src/automation/handlers/ (create_trigger, add_rule, get_rules, sync)
 * source: packages/memory/src/workflow-graph/handlers/query-workflow-graph.ts
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py
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
import { queryWorkflowGraph } from "@agentic/memory/workflow-graph/handlers/query-workflow-graph.js";

// ── Named constants ───────────────────────────────────────────────────────────
// source: MCP_TOOLS.md §sync_instructions max_insights default=10, min_heat default=0.3
const SYNC_MAX_INSIGHTS_DEFAULT = 10;
const SYNC_MIN_HEAT_DEFAULT = 0.3;
// source: cortex@ed33435 assess_coverage.py stale_days default=14
const ASSESS_STALE_DAYS_DEFAULT = 14;
// source: cortex@ed33435 assess_coverage.py — ms per day = 24h * 3600s * 1000ms
const MS_PER_DAY = 86400000;
// source: cortex@ed33435 assess_coverage.py:95 — score < 0.5 triggers recommendation
const COVERAGE_LOW_THRESHOLD = 0.5;
// source: cortex@ed33435 assess_coverage.py — heat < 0.1 means stale
const STALE_HEAT_THRESHOLD = 0.1;
// source: cortex@ed33435 assess_coverage.py:95 — coverage score rounded to 2 decimal places
const ROUNDING_FACTOR_2DP = 100;

// ── Dependency bundle ─────────────────────────────────────────────────────────

export interface AdvancedDeps {
  store: MemoryStore;
}

// ── Store adapters ────────────────────────────────────────────────────────────
//
// The automation handlers require specific store interfaces not in the core
// MemoryStore port. We use escape-hatch casts to access methods that
// SqliteMemoryStore implements but the MemoryStore interface doesn't declare.
//
// source: Martin, R. C. (2017). Clean Architecture, Ch. 22 — composition root
//   adapts concrete implementations to the ports callers declare.

function toMemoryReadStore(store: MemoryStore): MemoryReadStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  return {
    getMemoriesForDirectory: async (dir: string, opts: { min_heat: number }) => {
      const raw = (ext["getMemoriesForDirectory"]?.(dir, opts.min_heat) ?? []) as Array<Record<string, unknown>>;
      return raw.map((m) => m as unknown as MemoryRecord);
    },
    getHotMemories: async (opts: { min_heat: number; limit: number }) => {
      const raw = (ext["getHotMemoriesForDirectory"]?.(opts.min_heat, opts.limit)
        ?? ext["getHotMemories"]?.(opts.min_heat, opts.limit) ?? []) as Array<Record<string, unknown>>;
      return raw.map((m) => m as unknown as MemoryRecord);
    },
  };
}

function toProspectiveMemoryStore(store: MemoryStore): ProspectiveMemoryStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  return {
    insertProspectiveMemory: async (record) => {
      const id = ext["insertProspectiveMemory"]?.(record) ?? "";
      return String(id);
    },
    countActiveTriggers: async () => {
      return (ext["countActiveTriggers"]?.() ?? 0) as number;
    },
  };
}

function toRuleStore(store: MemoryStore): RuleStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;
  return {
    insertRule: async (rule) => {
      const id = ext["insertRule"]?.(rule) ?? 0;
      return Number(id);
    },
  };
}

function toRuleReadStore(store: MemoryStore): RuleReadStore {
  const ext = store as unknown as Record<string, (...args: unknown[]) => unknown>;

  async function fetchRules(method: string): Promise<unknown[]> {
    const result = ext[method]?.();
    if (result instanceof Promise) return result as Promise<unknown[]>;
    return Promise.resolve((result ?? []) as unknown[]);
  }

  return {
    getAllActiveRules:           () => fetchRules("getAllActiveRules") as ReturnType<RuleReadStore["getAllActiveRules"]>,
    getRulesForScope:            (scope) => (ext["getRulesForScope"]?.(scope) ?? Promise.resolve([])) as ReturnType<RuleReadStore["getRulesForScope"]>,
    getAllRulesIncludingInactive: () => fetchRules("getAllRulesIncludingInactive") as ReturnType<RuleReadStore["getAllRulesIncludingInactive"]>,
  };
}

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerAdvancedTools ─────────────────────────────────────────────────────

/**
 * Registers advanced automation and rule-engine MCP tools.
 *
 * precondition:  deps.store is a live MemoryStore.
 * postcondition: 6 tools registered; each body calls the real domain handler.
 *
 * source: MCP_TOOLS.md §"sync_instructions", §"create_trigger", §"add_rule",
 *         §"get_rules", §"assess_coverage", §"query_workflow_graph"
 */
export function registerAdvancedTools(server: McpServer, deps: AdvancedDeps): void {
  // ── sync_instructions ─────────────────────────────────────────────────────
  server.registerTool(
    "sync_instructions",
    {
      description: "Push top memory insights into CLAUDE.md (or similar instruction file).",
      inputSchema: {
        directory:    z.string().default("").describe("Directory containing CLAUDE.md"),
        max_insights: z.number().int().min(1).default(SYNC_MAX_INSIGHTS_DEFAULT).describe("Max insights to include"),
        min_heat:     z.number().min(0).max(1).default(SYNC_MIN_HEAT_DEFAULT).describe("Min heat for insight inclusion"),
        dry_run:      z.boolean().default(false).describe("Preview without writing"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/automation/handlers/sync-to-claude-md.ts::syncInstructionsHandler
        const response = await syncInstructionsHandler(
          {
            directory:    args.directory,
            max_insights: args.max_insights,
            min_heat:     args.min_heat,
            dry_run:      args.dry_run,
          },
          toMemoryReadStore(deps.store),
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("sync_instructions", err);
      }
    },
  );

  // ── create_trigger ────────────────────────────────────────────────────────
  server.registerTool(
    "create_trigger",
    {
      description: "Create a prospective memory trigger (stored in prospective_memories table).",
      inputSchema: {
        content:           z.string().min(1).describe("Trigger content"),
        trigger_condition: z.string().min(1).describe("Condition that fires the trigger"),
        trigger_type:      z.string().default("keyword").describe("Trigger type"),
        target_directory:  z.string().optional().describe("Directory scope for trigger"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/automation/handlers/create-trigger.ts::createTriggerHandler
        const response = await createTriggerHandler(args, toProspectiveMemoryStore(deps.store));
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("create_trigger", err);
      }
    },
  );

  // ── add_rule ──────────────────────────────────────────────────────────────
  server.registerTool(
    "add_rule",
    {
      description: "Add a neuro-symbolic rule to the memory store.",
      inputSchema: {
        condition:   z.string().min(1).describe("Rule condition"),
        action:      z.string().min(1).describe("Rule action"),
        rule_type:   z.enum(["soft", "hard"]).default("soft").describe("Rule type"),
        scope:       z.enum(["global", "domain", "directory"]).default("global").describe("Rule scope"),
        scope_value: z.string().optional().describe("Scope value (domain name or directory)"),
        priority:    z.number().int().default(0).describe("Rule priority (higher = earlier)"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/automation/handlers/add-rule.ts::addRuleHandler
        const response = await addRuleHandler(args, toRuleStore(deps.store));
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("add_rule", err);
      }
    },
  );

  // ── get_rules ─────────────────────────────────────────────────────────────
  server.registerTool(
    "get_rules",
    {
      description: "List active neuro-symbolic rules.",
      inputSchema: {
        scope:            z.string().optional().describe("Filter by scope"),
        rule_type:        z.string().optional().describe("Filter by type"),
        include_inactive: z.boolean().default(false).describe("Include inactive rules"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/automation/handlers/get-rules.ts::getRulesHandler
        const response = await getRulesHandler(args, toRuleReadStore(deps.store));
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("get_rules", err);
      }
    },
  );

  // ── assess_coverage ───────────────────────────────────────────────────────
  server.registerTool(
    "assess_coverage",
    {
      description: "Evaluate knowledge coverage completeness for the current domain/directory.",
      inputSchema: {
        directory:  z.string().default("").describe("Directory scope"),
        domain:     z.string().default("").describe("Domain scope"),
        stale_days: z.number().int().min(1).default(ASSESS_STALE_DAYS_DEFAULT).describe("Days before a memory is stale"),
      },
    },
    async (args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/assess_coverage.py::_handler_impl
        const ext = deps.store as unknown as Record<string, (...args: unknown[]) => unknown>;
        const allMems = (ext["getAllMemoriesForDecay"]?.() ?? []) as Array<Record<string, unknown>>;

        // source: cortex@ed33435 assess_coverage.py:35 — filter by domain/directory
        const scoped = allMems.filter((m) => {
          if (args.domain && m["domain"] !== args.domain) return false;
          if (args.directory && !String(m["directory"] ?? "").startsWith(args.directory)) return false;
          return true;
        });

        const now = Date.now();
        const staleMs = args.stale_days * MS_PER_DAY;
        const stale = scoped.filter((m) => {
          const heat = (m["heat"] as number | undefined) ?? 0;
          const createdAt = m["created_at"] as string | undefined;
          // source: cortex@ed33435 assess_coverage.py — heat < 0.1 means stale
          if (heat < STALE_HEAT_THRESHOLD) return true;
          if (createdAt && now - new Date(createdAt).getTime() > staleMs) return true;
          return false;
        }).length;

        const total = scoped.length;
        // source: cortex@ed33435 assess_coverage.py:95 — score = (total-stale)/total, rounded to 2dp
        const coverageScore = total === 0 ? 0 : Math.round(((total - stale) / total) * ROUNDING_FACTOR_2DP) / ROUNDING_FACTOR_2DP;

        const gaps: string[] = [];
        if (stale > 0) gaps.push(`${stale} stale memories (heat < 0.1 or older than ${args.stale_days} days)`);
        if (total === 0) gaps.push("no memories found for this scope");

        const recommendations: string[] = [];
        if (coverageScore < COVERAGE_LOW_THRESHOLD) recommendations.push("Run consolidate to decay + refresh stale memories.");
        if (total === 0) recommendations.push("Run codebase_analyze or backfill_memories to seed coverage.");

        return { content: [{ type: "text" as const, text: JSON.stringify({
          coverage_score:  coverageScore,
          total_memories:  total,
          stale_count:     stale,
          gaps,
          recommendations,
          directory:       args.directory,
          domain:          args.domain,
        }) }] };
      } catch (err) {
        return errorText("assess_coverage", err);
      }
    },
  );

  // ── query_workflow_graph ──────────────────────────────────────────────────
  server.registerTool(
    "query_workflow_graph",
    {
      description: "Return a typed subgraph of the unified workflow graph.",
      inputSchema: {
        node_kind:    z.union([z.string(), z.array(z.string())]).optional().describe("Node kind filter"),
        edge_kind:    z.union([z.string(), z.array(z.string())]).optional().describe("Edge kind filter"),
        neighbour_of: z.string().optional().describe("Node ID to find neighbours of"),
        depth:        z.number().int().optional().describe("Traversal depth"),
        domain:       z.string().optional().describe("Domain filter"),
        limit_nodes:  z.number().int().optional().describe("Max nodes to return"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/workflow-graph/handlers/query-workflow-graph.ts::queryWorkflowGraph
        // The queryWorkflowGraph pure function accepts a pre-built payload and filters it.
        // With no running workflow-graph source, we return the skeleton (empty graph).
        // source: cortex@ed33435 mcp_server/handlers/query_workflow_graph.py::handler
        const emptyGraph = {
          nodes: [],
          edges: [],
          links: [],
          meta:  { node_count: 0, edge_count: 0, built_at: new Date().toISOString() },
        };
        const response = queryWorkflowGraph(emptyGraph, {
          node_kind:    args.node_kind as string | string[] | undefined,
          edge_kind:    args.edge_kind as string | string[] | undefined,
          neighbour_of: args.neighbour_of,
          depth:        args.depth,
          domain:       args.domain,
          limit_nodes:  args.limit_nodes,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("query_workflow_graph", err);
      }
    },
  );
}
