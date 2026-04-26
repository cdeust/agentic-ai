/**
 * Workflow graph schema: nodes and edges for the Claude-workflow rewrite.
 *
 * Each project/domain becomes a brain-region cloud; nodes inside a cloud
 * cluster by the Claude Code surface that produced them (skills, hooks,
 * agents, tools, files, memories, discussions, entities).
 *
 * Generative invariants (enforced by validateGraph):
 *   * Node IDs are deterministic (NodeIdFactory) and prefixed by NodeKind.
 *   * Every non-domain node has exactly one in_domain edge, except
 *     file nodes, which may span multiple domains (>=1 in_domain edge).
 *     SYMBOL nodes are exempt — anchored via DEFINED_IN to a FILE node.
 *   * tool_hub nodes exist at exactly one per (domain, tool) pair.
 *   * File colors follow the primary-tool meta-rule
 *     (Edit/Write > Read > Grep/Glob > Bash) — the single rule that
 *     resolves a file touched by several tools.
 *
 * Pure core logic. Imports zod + the workflow-graph enum/palette modules only.
 * No I/O.
 *
 * source: Cortex mcp_server/core/workflow_graph_schema.py
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  EdgeKind,
  NodeKind,
  PrimaryToolCluster,
  ToolKind,
} from "./schema-enums.js";

// Re-export so callers can import from one place.
export { EdgeKind, NodeKind, PrimaryToolCluster, ToolKind } from "./schema-enums.js";

export const GLOBAL_DOMAIN_ID = "domain:__global__";

// ── Zod schemas ──────────────────────────────────────────────────────────

/**
 * A node in the workflow graph, ready for D3 rendering.
 *
 * passthrough() mirrors Pydantic's extra="allow": callers may attach
 * scientific measurement fields (heat_base, surprise_score, importance, …)
 * that the Knowledge and Board card renderers surface verbatim.
 */
export const WorkflowNodeSchema = z
  .object({
    id: z.string(),
    kind: z.string(), // NodeKind value
    label: z.string().default(""),
    color: z.string().default("#999999"),
    domain_id: z.string().default(""),
    size: z.number().default(1.0),
    tool: z.string().nullable().optional(),
    primary_cluster: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
    stage: z.string().nullable().optional(),
    extra_domain_ids: z.array(z.string()).default([]),
    body: z.string().nullable().optional(),
    session_id: z.string().nullable().optional(),
    heat: z.number().nullable().optional(),
    tags: z.array(z.string()).default([]),
    count: z.number().int().nullable().optional(),
    event: z.string().nullable().optional(),
    subagent_type: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    // AST-derived fields (ADR-0046)
    symbol_type: z.string().nullable().optional(),
    signature: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    line: z.number().int().nullable().optional(),
  })
  .passthrough();

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

/**
 * A directed edge in the workflow graph.
 *
 * confidence (0.0–1.0) signals trustworthiness: 1.0 for direct AST facts,
 * <=0.9 for heuristic resolution, lower for inferred or cross-file edges.
 * reason is a short free-form tag describing WHY the edge was emitted.
 *
 * source: Cortex workflow_graph_schema.py WorkflowEdge
 */
export const WorkflowEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  kind: z.string(), // EdgeKind value
  weight: z.number().default(1.0),
  label: z.string().nullable().optional(),
  // ge=0.0, le=1.0 is a contract the renderer relies on.
  confidence: z.number().min(0.0).max(1.0).nullable().optional(),
  reason: z.string().nullable().optional(),
});

export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

// ── Deterministic ID factory ─────────────────────────────────────────────

function shortHash(value: string, width = 10): string {
  /** Stable, non-cryptographic short hash for ID stability across runs. */
  return createHash("sha1").update(value, "utf8").digest("hex").slice(0, width);
}

export const NodeIdFactory = {
  domainId(project: string | null | undefined): string {
    return project ? `domain:${project}` : GLOBAL_DOMAIN_ID;
  },

  toolHubId(domainId: string, tool: ToolKind): string {
    return `tool_hub:${domainId}:${tool}`;
  },

  fileId(absPath: string): string {
    return `file:${shortHash(absPath)}`;
  },

  skillId(name: string): string {
    const clean = name.replace(/^\/+/, "").trim() || "unknown";
    return `skill:${clean}`;
  },

  hookId(eventName: string, scriptPath: string): string {
    return `hook:${eventName}:${shortHash(scriptPath)}`;
  },

  agentId(domainId: string, agentType: string): string {
    return `agent:${domainId}:${agentType}`;
  },

  commandId(cmdHash: string): string {
    return `command:${cmdHash}`;
  },

  memoryId(pgId: string | number): string {
    return `memory:${pgId}`;
  },

  mcpId(serverName: string): string {
    return `mcp:${serverName}`;
  },

  symbolId(fileAbsPath: string, qualifiedName: string): string {
    /**
     * Stable id across indexing runs: hash of "<file>::<qualified>".
     * Including the file disambiguates identical names across modules.
     */
    const key = `${fileAbsPath}::${qualifiedName}`;
    return `symbol:${shortHash(key, 12)}`;
  },

  entityId(pgId: string | number): string {
    /**
     * Deterministic id for a knowledge-graph entity, keyed on the
     * entities-table primary key.
     */
    return `entity:${pgId}`;
  },
} as const;

// ── Edge provenance defaults (Gap 6) ────────────────────────────────────

// Convention — NOT measured constants. Structural AST facts are
// ground-truth by definition. about_entity links are materialised from
// the persisted memory_entities join table so they are equally definitive.
// Heuristic edges (calls/imports) carry the resolver's actual confidence
// score or null when AP didn't emit one.
const _STRUCTURAL_DEFAULTS: Record<string, [number, string]> = {
  defined_in: [1.0, "direct-ast"],
  member_of: [1.0, "direct-ast"],
  about_entity: [1.0, "memory-entities-link"],
};

export function edgeProvenanceDefaults(
  edgeKind: string,
  apConfidence?: number | null,
  apReason?: string | null,
): [number | null, string | null] {
  /**
   * Return the (confidence, reason) pair for an edge of edgeKind.
   *
   * Producer-supplied AP values win. Empty-string reason is normalised
   * to null so builder and standalone paths never disagree on shape.
   */
  const [defaultConf = null, defaultReason = null] =
    _STRUCTURAL_DEFAULTS[edgeKind] ?? [];
  const confidence = apConfidence != null ? apConfidence : defaultConf;
  const reason = apReason != null && apReason !== "" ? apReason : (defaultReason ?? null);
  return [confidence, reason];
}

// ── Validation ────────────────────────────────────────────────────────────

export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphValidationError";
  }
}

const _MULTI_DOMAIN_KINDS = new Set<string>([
  NodeKind.FILE,
  NodeKind.MCP,
  NodeKind.SKILL,
]);

function checkUniqueIdsAndPrefix(
  nodeList: WorkflowNode[],
): Map<string, WorkflowNode> {
  /** Invariant 1+5: unique ids, and id prefix matches node kind. */
  const seen = new Map<string, WorkflowNode>();
  for (const node of nodeList) {
    if (seen.has(node.id)) {
      throw new GraphValidationError(`duplicate node id: ${node.id}`);
    }
    seen.set(node.id, node);
    const kind = node.kind as NodeKind;
    if (!node.id.startsWith(`${kind}:`)) {
      throw new GraphValidationError(
        `node id ${JSON.stringify(node.id)} does not match kind ${kind}`,
      );
    }
  }
  return seen;
}

function checkEdgeEndpoints(
  edgeList: WorkflowEdge[],
  seen: Map<string, WorkflowNode>,
): void {
  /** Invariant 2: every edge source and target resolves to a node. */
  for (const edge of edgeList) {
    if (!seen.has(edge.source)) {
      throw new GraphValidationError(`edge source missing: ${edge.source}`);
    }
    if (!seen.has(edge.target)) {
      throw new GraphValidationError(`edge target missing: ${edge.target}`);
    }
  }
}

function countInDomain(edgeList: WorkflowEdge[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edgeList) {
    if (edge.kind === EdgeKind.IN_DOMAIN) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    }
  }
  return counts;
}

function checkInDomainCounts(
  nodeList: WorkflowNode[],
  inDomainCounts: Map<string, number>,
): void {
  /**
   * Invariant 3: exactly one in_domain edge per non-domain node
   * (>=1 for file/mcp/skill). SYMBOL nodes are exempt — anchored to
   * their parent FILE via a DEFINED_IN edge instead.
   */
  for (const node of nodeList) {
    const kind = node.kind as NodeKind;
    if (kind === NodeKind.DOMAIN || kind === NodeKind.SYMBOL) {
      continue;
    }
    const count = inDomainCounts.get(node.id) ?? 0;
    if (_MULTI_DOMAIN_KINDS.has(kind)) {
      if (count < 1) {
        throw new GraphValidationError(
          `${kind} node ${node.id} has no in_domain edge`,
        );
      }
    } else if (count !== 1) {
      throw new GraphValidationError(
        `node ${node.id} (${kind}) must have exactly one in_domain edge, got ${count}`,
      );
    }
  }
}

function checkSymbolAnchor(
  nodeList: WorkflowNode[],
  edgeList: WorkflowEdge[],
): void {
  /**
   * Invariant 6 (AST): every SYMBOL node must have at least one
   * DEFINED_IN edge pointing to a FILE node.
   */
  const fileIds = new Set(
    nodeList.filter((n) => n.kind === NodeKind.FILE).map((n) => n.id),
  );
  const anchors = new Map<string, number>();
  for (const edge of edgeList) {
    if (edge.kind === EdgeKind.DEFINED_IN && fileIds.has(edge.target)) {
      anchors.set(edge.source, (anchors.get(edge.source) ?? 0) + 1);
    }
  }
  for (const node of nodeList) {
    if (node.kind !== NodeKind.SYMBOL) continue;
    if ((anchors.get(node.id) ?? 0) < 1) {
      throw new GraphValidationError(
        `symbol node ${node.id} has no defined_in edge to a file`,
      );
    }
  }
}

function checkToolHubPairs(nodeList: WorkflowNode[]): void {
  /** Invariant 4: tool_hub ids reference known domain + tool, unique per pair. */
  const domainIds = new Set(
    nodeList.filter((n) => n.kind === NodeKind.DOMAIN).map((n) => n.id),
  );
  const knownTools = new Set(Object.values(ToolKind));
  const pairCounts = new Map<string, number>();
  for (const node of nodeList) {
    if (node.kind !== NodeKind.TOOL_HUB) continue;
    const parts = node.id.split(":");
    if (parts.length < 3 || parts[0] !== "tool_hub") {
      throw new GraphValidationError(`malformed tool_hub id: ${node.id}`);
    }
    // id format: tool_hub:<domain_id>:<tool>
    // domain_id itself may contain colons (domain:cortex), so split from end
    const toolValue = parts[parts.length - 1] as string;
    const innerDomain = parts.slice(1, -1).join(":");
    if (!domainIds.has(innerDomain)) {
      throw new GraphValidationError(
        `tool_hub ${node.id} references unknown domain ${innerDomain}`,
      );
    }
    if (!knownTools.has(toolValue as ToolKind)) {
      throw new GraphValidationError(
        `tool_hub ${node.id} has unknown tool ${toolValue}`,
      );
    }
    const pair = `${innerDomain}:${toolValue}`;
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  }
  for (const [pair, count] of pairCounts) {
    if (count > 1) {
      throw new GraphValidationError(
        `duplicate tool_hub for ${pair}: ${count}`,
      );
    }
  }
}

export function validateGraph(
  nodes: Iterable<WorkflowNode>,
  edges: Iterable<WorkflowEdge>,
): void {
  /**
   * Enforce generative invariants. Throws GraphValidationError.
   *
   * Invariants:
   *   1. Unique node ids            → checkUniqueIdsAndPrefix
   *   2. Edge endpoints resolve     → checkEdgeEndpoints
   *   3. in_domain counts           → checkInDomainCounts
   *   4. tool_hub well-formedness   → checkToolHubPairs
   *   5. id prefix matches kind     → checkUniqueIdsAndPrefix
   *   6. symbol has >=1 defined_in  → checkSymbolAnchor (ADR-0046)
   */
  const nodeList = Array.from(nodes);
  const edgeList = Array.from(edges);
  const seen = checkUniqueIdsAndPrefix(nodeList);
  checkEdgeEndpoints(edgeList, seen);
  checkInDomainCounts(nodeList, countInDomain(edgeList));
  checkToolHubPairs(nodeList);
  checkSymbolAnchor(nodeList, edgeList);
}
