/**
 * Color palette for the workflow graph — tuned for maximum kind separation.
 *
 * Each semantic family sits in a distinct hue band so glance-to-legend
 * identifies which node to click:
 *
 *   YELLOW/GOLD → Cortex identity + shell (domain, command)
 *   ORANGE      → user-invoked slash commands (skill)
 *   PINK/RED    → human-actor interactions (agent, task, discussion)
 *   PURPLE      → integrations (hook, MCP)
 *   GREEN       → authorship (edit/write + memory lifecycle)
 *   CYAN        → information intake (read)
 *   FUCHSIA     → search (grep/glob)
 *
 * Pure data. No I/O.
 *
 * source: Cortex mcp_server/core/workflow_graph_palette.py
 */

import type { PrimaryToolCluster, ToolKind } from "./schema-enums.js";

export const DOMAIN_COLOR = "#FCD34D"; // gold — hub
export const SKILL_COLOR = "#FB923C"; // orange — slash commands / skills
export const COMMAND_COLOR = "#FACC15"; // yellow — distinct from Bash-tool orange
export const HOOK_COLOR = "#A855F7"; // purple — settings hooks
export const AGENT_COLOR = "#EC4899"; // bright pink — subagents
export const DISCUSSION_COLOR = "#EF4444"; // red — session anchors
export const ENTITY_COLOR = "#50B0C8"; // teal — extracted entities
export const MCP_COLOR = "#6366F1"; // indigo — MCP servers (distinct from hook)

// Symbol kinds produced by the automatised-pipeline AST bridge (ADR-0046).
export const SYMBOL_COLORS: Record<string, string> = {
  function: "#22D3EE", // sky — verbs
  // method gets a lighter sky so method vs free-function is visible
  // at a glance, matching the legend's dedicated entry for methods.
  method: "#38BDF8", // sky/blue — methods (receiver-bound functions)
  class: "#8B5CF6", // violet — types (also Rust struct/enum/trait)
  module: "#FBBF24", // amber — boxes / packages / namespaces
  // constant covers language-level consts, fields, typedefs, type
  // aliases — values rather than behaviour.
  constant: "#94A3B8", // slate — structural values
  import: "#94A3B8", // slate — structural, de-emphasised
};
export const SYMBOL_COLOR_DEFAULT = "#A1A1AA"; // zinc fallback

export const TOOL_HUB_COLORS: Record<ToolKind, string> = {
  Edit: "#10B981", // emerald
  Write: "#059669", // dark emerald — paired with Edit
  Read: "#06B6D4", // cyan — far from every green
  Grep: "#D946EF", // fuchsia
  Glob: "#C026D3", // deeper fuchsia — paired with Grep
  Bash: "#F97316", // orange — shell band
  Task: "#EC4899", // pink — paired with Agent
};

export const PRIMARY_TOOL_COLORS: Record<PrimaryToolCluster, string> = {
  edit_write: "#10B981", // emerald — files you author
  read: "#06B6D4", // cyan — files you only read
  grep_glob: "#D946EF", // fuchsia — files you only searched
  bash: "#F97316", // orange — files touched only by shell
};

export const MEMORY_STAGE_COLORS: Record<string, string> = {
  labile: "#86EFAC",
  early_ltp: "#4ADE80",
  late_ltp: "#16A34A",
  consolidated: "#166534",
  // episodic is the default PG stage before LTP promotion — paint it
  // with the same green as early_ltp so the legend's green band covers
  // every non-semantic memory and there's no "unexplained green".
  episodic: "#4ADE80",
  semantic: "#C070D0",
};

// source: Cortex graph_builder_nodes.py — ENTITY_COLORS legacy palette
export const ENTITY_COLORS: Record<string, string> = {
  person: "#F472B6",
  place: "#34D399",
  organization: "#60A5FA",
  event: "#FBBF24",
  concept: "#50B0C8",
  technology: "#818CF8",
  project: "#FB923C",
};

export function primaryToolColor(cluster: PrimaryToolCluster): string {
  return PRIMARY_TOOL_COLORS[cluster];
}

export function classifyPrimaryTool(
  toolCounts: Partial<Record<ToolKind, number>>,
): PrimaryToolCluster {
  /** Apply the primary-tool meta-rule: Edit/Write > Read > Grep/Glob > Bash. */
  if ((toolCounts["Edit"] ?? 0) > 0 || (toolCounts["Write"] ?? 0) > 0) {
    return "edit_write";
  }
  if ((toolCounts["Read"] ?? 0) > 0) {
    return "read";
  }
  if ((toolCounts["Grep"] ?? 0) > 0 || (toolCounts["Glob"] ?? 0) > 0) {
    return "grep_glob";
  }
  return "bash";
}
