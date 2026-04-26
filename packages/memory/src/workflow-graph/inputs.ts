/**
 * Input DTO for WorkflowGraphBuilder.build — single parameter object
 * holding every data stream the builder consumes.
 *
 * Introduced to replace an 18-keyword-argument build signature that grew
 * over time. Callers construct a WorkflowBuildInputs with whichever
 * streams they have loaded (every field defaults to an empty array) and
 * pass the single DTO in.
 *
 * Pure core logic. No I/O.
 *
 * source: Cortex mcp_server/core/workflow_graph_inputs.py
 */

export interface WorkflowBuildInputs {
  // Phase 1: node-producing streams
  tool_events: Record<string, unknown>[];
  skill_paths: Record<string, unknown>[];
  hook_defs: Record<string, unknown>[];
  agent_events: Record<string, unknown>[];
  command_events: Record<string, unknown>[];
  memories: Record<string, unknown>[];
  discussions: Record<string, unknown>[];
  entities: Record<string, unknown>[];

  // Phase 2: relational-edge streams (run after files finalise)
  discussion_file_events: Record<string, unknown>[];
  skill_usage_events: Record<string, unknown>[];
  command_file_events: Record<string, unknown>[];
  mcp_usage_events: Record<string, unknown>[];
  discussion_tool_events: Record<string, unknown>[];
  discussion_agent_events: Record<string, unknown>[];
  discussion_command_events: Record<string, unknown>[];
  memory_entity_edges: Record<string, unknown>[];

  // Phase 3: AST symbols + edges (ADR-0046)
  ast_symbols: Record<string, unknown>[];
  ast_edges: Record<string, unknown>[];
}

export function emptyInputs(): WorkflowBuildInputs {
  return {
    tool_events: [],
    skill_paths: [],
    hook_defs: [],
    agent_events: [],
    command_events: [],
    memories: [],
    discussions: [],
    entities: [],
    discussion_file_events: [],
    skill_usage_events: [],
    command_file_events: [],
    mcp_usage_events: [],
    discussion_tool_events: [],
    discussion_agent_events: [],
    discussion_command_events: [],
    memory_entity_edges: [],
    ast_symbols: [],
    ast_edges: [],
  };
}
