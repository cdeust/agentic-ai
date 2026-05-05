/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Discussion node construction for the unified graph builder.
 *
 * Builds discussion nodes from conversation metadata and links them
 * to domain hubs via has-discussion edges.
 *
 * Pure business logic — no I/O.
 *
 * source: Cortex mcp_server/core/graph_builder_discussions.py
 */

import type { Edge, Node } from "./graph-builder-nodes.js";
import { DISCUSSION_COLOR, EDGE_COLORS } from "./graph-builder-nodes.js";

function slugLower(slug: string): string {
  return slug.toLowerCase().replace(/-/g, " ").trim();
}

/**
 * Build a single discussion node from conversation metadata.
 *
 * conv keys: sessionId, project, firstMessage, startedAt, endedAt,
 *            duration, turnCount, messageCount, toolsUsed, keywords,
 *            fileSize, filePath
 */
export function buildDiscussionNode(
  conv: Record<string, unknown>,
  nodeId: string,
): Node {
  const firstMsg = String(conv["firstMessage"] ?? "");
  const label = firstMsg.length > 50 ? `${firstMsg.slice(0, 50)}...` : firstMsg;
  const project = String(conv["project"] ?? "");
  const domain = project;
  const turnCount = Number(conv["turnCount"] ?? 0);
  const size = parseFloat(Math.max(2, Math.min(8, Math.pow(turnCount, 0.4) * 1.5)).toFixed(2));

  return {
    id: nodeId,
    type: "discussion",
    label,
    domain,
    color: DISCUSSION_COLOR,
    size,
    group: domain,
    sessionId: conv["sessionId"],
    project,
    firstMessage: firstMsg,
    startedAt: conv["startedAt"],
    endedAt: conv["endedAt"],
    duration: conv["duration"],
    turnCount,
    messageCount: Number(conv["messageCount"] ?? 0),
    toolsUsed: (conv["toolsUsed"] as unknown[]) ?? [],
    keywords: (conv["keywords"] as unknown[]) ?? [],
    fileSize: conv["fileSize"],
    content: firstMsg.slice(0, 200), // source: Cortex graph_builder_discussions.py::build_discussion_node content truncation
  };
}

/**
 * Build all discussion nodes and has-discussion edges.
 *
 * domainHubIds maps domain_key -> node_id of the domain hub.
 * Returns [nodes, edges]. Skips discussions whose domain has no hub.
 */
export function buildDiscussionNodes(
  conversations: Record<string, unknown>[],
  domainHubIds: Record<string, string>,
): [Node[], Edge[]] {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let counter = 0;

  for (const conv of conversations) {
    const project = String(conv["project"] ?? "");

    const hubId = findDomainHub(project, domainHubIds);
    if (hubId === null) continue;

    counter++;
    const nodeId = `disc_${counter}`;
    nodes.push(buildDiscussionNode(conv, nodeId));

    edges.push({
      source: hubId,
      target: nodeId,
      type: "has-discussion",
      weight: 0.4,
      color: EDGE_COLORS["has-discussion"] ?? "#E8943A60", // source: Cortex graph_builder_discussions.py::build_discussion_nodes fallback color
    });
  }

  return [nodes, edges];
}

/**
 * Find the best domain hub for a project slug.
 *
 * Scores each hub by how many of its key words appear in the slug.
 * Returns the hub with the highest score, or the first hub as fallback.
 */
export function findDomainHub(
  projectSlug: string,
  domainHubIds: Record<string, string>,
): string | null {
  if (!projectSlug || Object.keys(domainHubIds).length === 0) return null;
  const slug = slugLower(projectSlug);

  let bestId: string | null = null;
  let bestScore = 0;
  for (const [key, hubId] of Object.entries(domainHubIds)) {
    const words = key.toLowerCase().split(" ").filter((w) => w.length > 2);
    if (words.length === 0) continue;
    const score = words.filter((w) => slug.includes(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestId = hubId;
    }
  }

  // Fallback: assign to first hub rather than dropping
  if (bestId === null) {
    bestId = Object.values(domainHubIds)[0] ?? null;
  }
  return bestId;
}
