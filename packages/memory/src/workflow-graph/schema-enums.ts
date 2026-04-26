/**
 * Enum vocabulary for the workflow graph — factored out so the palette
 * module can key dicts by these types without pulling the pydantic model
 * definitions in.
 *
 * Pure stdlib. No imports from the rest of the workflow-graph stack.
 *
 * source: Cortex mcp_server/core/workflow_graph_schema_enums.py
 */

export const NodeKind = {
  DOMAIN: "domain",
  SKILL: "skill",
  COMMAND: "command",
  HOOK: "hook",
  AGENT: "agent",
  TOOL_HUB: "tool_hub",
  FILE: "file",
  MEMORY: "memory",
  DISCUSSION: "discussion",
  // ENTITY — projects a knowledge-graph entity (entities table row)
  // into the workflow graph. Linked to memories via the about_entity edge.
  ENTITY: "entity",
  MCP: "mcp",
  // SYMBOL — function / class / module / import extracted from the
  // AST by the automatised-pipeline sibling plugin (ADR-0046).
  // symbol_type on the node body carries the sub-kind.
  SYMBOL: "symbol",
} as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export const EdgeKind = {
  IN_DOMAIN: "in_domain",
  TOOL_USED_FILE: "tool_used_file",
  // Bash hub → command node containment edge. Distinct from
  // TOOL_USED_FILE so that the panel's "Files touched" counter does
  // not mistakenly include commands.
  COMMAND_IN_HUB: "command_in_hub",
  INVOKED_SKILL: "invoked_skill",
  TRIGGERED_HOOK: "triggered_hook",
  SPAWNED_AGENT: "spawned_agent",
  // ABOUT_ENTITY — MEMORY → ENTITY link. Styled in
  // ui/unified/workflow_graph.css (.wfg-link--about_entity).
  ABOUT_ENTITY: "about_entity",
  DISCUSSION_TOUCHED_FILE: "discussion_touched_file",
  DISCUSSION_USED_TOOL: "discussion_used_tool",
  DISCUSSION_SPAWNED_AGENT: "discussion_spawned_agent",
  DISCUSSION_RAN_COMMAND: "discussion_ran_command",
  COMMAND_TOUCHED_FILE: "command_touched_file",
  INVOKED_MCP: "invoked_mcp",
  // AST edges produced by the automatised-pipeline bridge (ADR-0046).
  DEFINED_IN: "defined_in", // symbol → file
  CALLS: "calls", // caller symbol → callee symbol
  IMPORTS: "imports", // file → imported symbol or file
  MEMBER_OF: "member_of", // function → class / class → module
} as const;
export type EdgeKind = (typeof EdgeKind)[keyof typeof EdgeKind];

export const ToolKind = {
  EDIT: "Edit",
  READ: "Read",
  GREP: "Grep",
  BASH: "Bash",
  GLOB: "Glob",
  WRITE: "Write",
  TASK: "Task",
} as const;
export type ToolKind = (typeof ToolKind)[keyof typeof ToolKind];

export const PrimaryToolCluster = {
  EDIT_WRITE: "edit_write",
  READ: "read",
  GREP_GLOB: "grep_glob",
  BASH: "bash",
} as const;
export type PrimaryToolCluster = (typeof PrimaryToolCluster)[keyof typeof PrimaryToolCluster];
