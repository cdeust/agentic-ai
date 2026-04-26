/**
 * Composition root for the workflow graph.
 *
 * Wires WorkflowGraphSource (infrastructure) to WorkflowGraphBuilder
 * (core) and validates via validateGraph. Returns a JSON-serializable
 * payload shaped for the D3 renderer in ui/unified/js/workflow_graph.js.
 *
 * Progressive-reveal stages:
 *   skeleton — domains, skills, hooks, agents, tool hubs, MCPs,
 *              memories, discussions, commands. No file nodes, no AST.
 *   files    — skeleton plus the file nodes.
 *   full     — everything including AST symbols + edges.
 *
 * source: Cortex mcp_server/handlers/workflow_graph.py
 */

import { WorkflowGraphBuilder } from "../builder.js";
import { emptyInputs, type WorkflowBuildInputs } from "../inputs.js";
import { GraphValidationError, validateGraph } from "../schema.js";
import { WorkflowGraphSource } from "../sources/source.js";
import { WorkflowGraphASTSource } from "../sources/source-ast.js";
import { WorkflowGraphNativeASTSource } from "../sources/source-native-ast.js";

export type { GraphValidationError };

const _GLOBAL_DOMAIN_TOKEN = "__global__";

// Snake_case → camelCase aliases for UI compatibility. The card renderers
// (knowledge.js, timeline.js) predate the v1 schema and read camelCase
// field names; the schema itself stays snake_case.
// source: Cortex handlers/workflow_graph.py _CAMEL_ALIASES
const _CAMEL_ALIASES: Record<string, string> = {
  consolidation_stage: "consolidationStage",
  heat_base: "heatBase",
  hours_in_stage: "hoursInStage",
  stage_entered_at: "stageEnteredAt",
  access_count: "accessCount",
  useful_count: "usefulCount",
  replay_count: "replayCount",
  reconsolidation_count: "reconsolidationCount",
  surprise_score: "surpriseScore",
  emotional_valence: "emotionalValence",
  dominant_emotion: "dominantEmotion",
  hippocampal_dependency: "hippocampalDependency",
  schema_match_score: "schemaMatchScore",
  schema_id: "schemaId",
  separation_index: "separationIndex",
  interference_score: "interferenceScore",
  encoding_strength: "encodingStrength",
  compression_level: "compressionLevel",
  store_type: "storeType",
  is_protected: "isProtected",
  is_stale: "isStale",
  is_benchmark: "isBenchmark",
  is_global: "isGlobal",
  no_decay: "noDecay",
  last_accessed: "lastAccessed",
  created_at: "createdAt",
  subagent_type: "subagentType",
  session_id: "sessionId",
};

function plainDomain(domainId: string | undefined): string {
  if (!domainId) return "";
  if (domainId.startsWith("domain:")) return domainId.slice(7);
  return domainId;
}

function nodeToDict(n: Record<string, unknown>): Record<string, unknown> {
  const d = { ...n };
  // D3 convention
  d["type"] = d["kind"];
  const domainId = String(d["domain_id"] ?? "");
  const plain = plainDomain(domainId);
  if (plain && plain !== _GLOBAL_DOMAIN_TOKEN) {
    d["domain"] = plain;
    if (!("isGlobal" in d)) d["isGlobal"] = false;
  } else {
    d["domain"] = "global";
    d["isGlobal"] = true;
  }
  for (const [snake, camel] of Object.entries(_CAMEL_ALIASES)) {
    if (snake in d && !(camel in d)) {
      d[camel] = d[snake];
    }
  }
  return d;
}

function edgeToDict(e: Record<string, unknown>): Record<string, unknown> {
  const d = { ...e };
  d["type"] = d["kind"];
  return d;
}

export interface WorkflowGraphPayload {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  links: Record<string, unknown>[];
  meta: Record<string, unknown>;
}

export interface BuildWorkflowGraphOptions {
  domainFilter?: string | null;
  minMemoryHeat?: number;
  memoryLimit?: number;
  stage?: "skeleton" | "files" | "full";
}

export function buildWorkflowGraph(
  store: unknown,
  source: WorkflowGraphSource,
  options: BuildWorkflowGraphOptions = {},
): WorkflowGraphPayload {
  /**
   * Load sources, build the graph, validate, and return JSON payload.
   *
   * The output shape mirrors the legacy /api/graph response
   * ({nodes, edges, meta}) so the existing bridge in
   * workflow_graph_bridge.js can auto-detect it and route to the new renderer.
   */
  const {
    domainFilter = null,
    minMemoryHeat = 0.0,
    memoryLimit = 0,
    stage = "full",
  } = options;

  const inputs: WorkflowBuildInputs = emptyInputs();

  if (stage === "skeleton") {
    inputs.skill_paths = source.loadSkills();
    inputs.hook_defs = source.loadHooks();
  } else {
    inputs.skill_paths = source.loadSkills();
    inputs.hook_defs = source.loadHooks();
    inputs.agent_events = source.loadAgentEvents();
    inputs.command_events = source.loadCommandEvents(store);
    inputs.memories = source.loadMemories(store, minMemoryHeat, memoryLimit);
    inputs.discussions = source.loadDiscussions();
    inputs.skill_usage_events = source.loadSkillUsage();
    inputs.mcp_usage_events = source.loadMcpUsage();
    inputs.discussion_tool_events = source.loadDiscussionToolUses();
    inputs.discussion_agent_events = source.loadDiscussionAgents();
    inputs.discussion_command_events = source.loadDiscussionCommands();
    inputs.entities = source.loadEntities(store);
    inputs.memory_entity_edges = source.loadMemoryEntityEdges(store);
  }

  if (stage === "files" || stage === "full") {
    inputs.tool_events = source.loadToolEvents(store);
    inputs.discussion_file_events = source.loadDiscussionFiles();
  }

  const knownPaths = new Set(
    inputs.tool_events
      .map((e) => e["file_path"] as string | undefined)
      .filter((p): p is string => Boolean(p)),
  );

  if (stage === "files" || stage === "full") {
    inputs.command_file_events = source.loadCommandFiles(store, knownPaths);
  }

  // AST enrichment — both sources are stubbed until cortex-codebase-analysis
  // (#5) lands. When AP is enabled (source-ast.ts un-stubbed), AP symbols
  // load first; native-AST symbols load second. ingestSymbol is idempotent
  // by symbol id so AP's richer symbols win the de-dup.
  if (stage === "full") {
    const astSource = new WorkflowGraphASTSource();
    if (astSource.enabled()) {
      inputs.ast_symbols = astSource.loadSymbols([]);
      inputs.ast_edges = astSource.loadAstEdges([]);
    }
    const nativeSource = new WorkflowGraphNativeASTSource();
    if (nativeSource.enabled() && knownPaths.size > 0) {
      const nativeSymbols = nativeSource.loadSymbols(knownPaths);
      const nativeEdges = nativeSource.loadAstEdges(knownPaths);
      inputs.ast_symbols = [...inputs.ast_symbols, ...nativeSymbols];
      inputs.ast_edges = [...inputs.ast_edges, ...nativeEdges];
    }
  }

  if (domainFilter) {
    const matches = (ev: Record<string, unknown>) =>
      (ev["domain"] ?? "") === domainFilter;
    inputs.tool_events = inputs.tool_events.filter(matches);
    inputs.agent_events = inputs.agent_events.filter(matches);
    inputs.command_events = inputs.command_events.filter(matches);
    inputs.memories = inputs.memories.filter(
      (m) => (m["domain"] ?? "") === domainFilter,
    );
    inputs.discussions = inputs.discussions.filter(matches);
    inputs.skill_usage_events = inputs.skill_usage_events.filter(matches);
    inputs.mcp_usage_events = inputs.mcp_usage_events.filter(matches);
    inputs.discussion_tool_events =
      inputs.discussion_tool_events.filter(matches);
    inputs.discussion_agent_events =
      inputs.discussion_agent_events.filter(matches);
    inputs.entities = inputs.entities.filter(matches);
  }

  const builder = new WorkflowGraphBuilder();
  const [nodes, edges] = builder.build(inputs);

  validateGraph(nodes, edges);

  const domainCount = nodes.filter((n) => n.kind === "domain").length;
  const memoryCount = nodes.filter((n) => n.kind === "memory").length;
  const fileCount = nodes.filter((n) => n.kind === "file").length;
  const discussionCount = nodes.filter((n) => n.kind === "discussion").length;
  const symbolCount = nodes.filter((n) => n.kind === "symbol").length;
  const entityNodeCount = nodes.filter((n) => n.kind === "entity").length;

  const nodeDicts = nodes.map((n) =>
    nodeToDict(n as unknown as Record<string, unknown>),
  );
  const edgeDicts = edges.map((e) =>
    edgeToDict(e as unknown as Record<string, unknown>),
  );

  return {
    nodes: nodeDicts,
    edges: edgeDicts,
    links: edgeDicts,
    meta: {
      schema: "workflow_graph.v1",
      domain_filter: domainFilter,
      // Legacy stat-panel keys (polling.js.updateStats reads these).
      node_count: nodes.length,
      edge_count: edges.length,
      domain_count: domainCount,
      memory_count: memoryCount,
      entity_count: fileCount,
      discussion_count: discussionCount,
      counts: {
        nodes: nodes.length,
        edges: edges.length,
        tool_events: inputs.tool_events.length,
        skills: inputs.skill_paths.length,
        hooks: inputs.hook_defs.length,
        agents: inputs.agent_events.length,
        commands: inputs.command_events.length,
        memories: inputs.memories.length,
        discussions: inputs.discussions.length,
        files: fileCount,
        symbols: symbolCount,
        ast_edges: inputs.ast_edges.length,
        entities: entityNodeCount,
        memory_entity_edges: inputs.memory_entity_edges.length,
      },
      ast_enabled: new WorkflowGraphASTSource().enabled(),
    },
  };
}
