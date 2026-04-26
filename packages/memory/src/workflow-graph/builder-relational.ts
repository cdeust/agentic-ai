/**
 * Relational-edge ingestion for WorkflowGraphBuilder.
 *
 * These helpers take a WorkflowGraphBuilder as their first argument
 * and mutate its internal nodes/edges. They only run AFTER
 * _finalizeFiles because every helper here assumes the file nodes
 * have been materialised.
 *
 * Split out of builder.ts to keep that file inside the 500-line project
 * ceiling while preserving all existing behaviour.
 *
 * source: Cortex mcp_server/core/workflow_graph_builder_relational.py
 */

import {
  AGENT_COLOR,
  COMMAND_COLOR,
  MCP_COLOR,
  SKILL_COLOR,
  SYMBOL_COLOR_DEFAULT,
  SYMBOL_COLORS,
  primaryToolColor,
} from "./palette.js";
import {
  EdgeKind,
  NodeIdFactory,
  NodeKind,
  edgeProvenanceDefaults,
  type WorkflowEdge,
  type WorkflowNode,
} from "./schema.js";
import { PrimaryToolCluster, ToolKind } from "./schema-enums.js";
import type { WorkflowGraphBuilder } from "./builder.js";

// ── Shared micro-helpers ────────────────────────────────────────────────

function require_<T>(
  rec: Record<string, unknown>,
  key: string,
  ctx: string,
): T {
  if (!(key in rec) || rec[key] == null) {
    throw new Error(`${ctx}: missing key ${JSON.stringify(key)}`);
  }
  return rec[key] as T;
}

function asTool(name: string): ToolKind {
  for (const t of Object.values(ToolKind)) {
    if (t === name || t.toLowerCase() === name.toLowerCase()) {
      return t as ToolKind;
    }
  }
  throw new Error(`unknown ToolKind: ${JSON.stringify(name)}`);
}

// ── Relational helpers ──────────────────────────────────────────────────

export function ingestDiscussionFile(
  b: WorkflowGraphBuilder,
  dfe: Record<string, unknown>,
): void {
  /** Link a discussion to a file (only if both nodes already exist). */
  const sid = String(require_(dfe, "session_id", "discussion_file"));
  const path = String(require_(dfe, "file_path", "discussion_file"));
  const fid = NodeIdFactory.fileId(path);
  if (!b.hasNode(fid)) return;
  const discId = `discussion:${sid}`;
  if (!b.hasNode(discId)) return;
  b.pushEdge({
    source: discId,
    target: fid,
    kind: EdgeKind.DISCUSSION_TOUCHED_FILE,
    weight: Number(dfe["count"] ?? 1),
  });
}

export function ingestCommandFile(
  b: WorkflowGraphBuilder,
  cfe: Record<string, unknown>,
): void {
  /** Link a command node to a file node (both must already exist). */
  const h = String(require_(cfe, "cmd_hash", "command_file"));
  const path = String(require_(cfe, "file_path", "command_file"));
  const cmdId = NodeIdFactory.commandId(h);
  const fid = NodeIdFactory.fileId(path);
  if (!b.hasNode(cmdId) || !b.hasNode(fid)) return;
  b.pushEdge({
    source: cmdId,
    target: fid,
    kind: EdgeKind.COMMAND_TOUCHED_FILE,
    weight: Number(cfe["count"] ?? 1),
  });
}

export function ingestDiscussionTool(
  b: WorkflowGraphBuilder,
  dte: Record<string, unknown>,
): void {
  /** Link a discussion to each tool_hub it used; create hub on demand. */
  const sid = String(require_(dte, "session_id", "discussion_tool"));
  const toolName = String(require_(dte, "tool", "discussion_tool"));
  const dom = b.assignDomain(dte["domain"] as string | undefined);
  const discId = `discussion:${sid}`;
  if (!b.hasNode(discId)) return;
  let tool: ToolKind;
  try {
    tool = asTool(toolName);
  } catch {
    return;
  }
  b.ensureDomain(dom);
  b.buildToolHubs(dom, [tool]);
  const hub = NodeIdFactory.toolHubId(dom, tool);
  const count = Number(dte["count"] ?? 1);
  b.pushEdge({
    source: discId,
    target: hub,
    kind: EdgeKind.DISCUSSION_USED_TOOL,
    weight: count,
  });
}

export function ingestDiscussionAgent(
  b: WorkflowGraphBuilder,
  dae: Record<string, unknown>,
): void {
  /** Link a discussion to each subagent it spawned; synthesize node if missing. */
  const sid = String(require_(dae, "session_id", "discussion_agent"));
  const sub = String(require_(dae, "subagent_type", "discussion_agent"));
  const dom = b.assignDomain(dae["domain"] as string | undefined);
  const discId = `discussion:${sid}`;
  if (!b.hasNode(discId)) return;
  b.ensureDomain(dom);
  const agentId = NodeIdFactory.agentId(dom, sub);
  if (!b.hasNode(agentId)) {
    b.buildToolHubs(dom, [ToolKind.TASK]);
    b.addChild(agentId, NodeKind.AGENT, sub, AGENT_COLOR, dom, 2.0, {
      subagent_type: sub,
      count: 0,
    });
  }
  const count = Number(dae["count"] ?? 1);
  b.pushEdge({
    source: discId,
    target: agentId,
    kind: EdgeKind.DISCUSSION_SPAWNED_AGENT,
    weight: count,
  });
}

function materializeDiscussionCommand(
  b: WorkflowGraphBuilder,
  cmdId: string,
  cmd: string,
  h: string,
  discId: string,
  count0: number,
): void {
  /** Create a minimal command node for a discussion-only Bash invocation. */
  const dom = b.getNode(discId)?.domain_id ?? "domain:__global__";
  b.ensureDomain(dom);
  b.buildToolHubs(dom, [ToolKind.BASH]);
  const hub = NodeIdFactory.toolHubId(dom, ToolKind.BASH);
  const added = b.addChild(
    cmdId,
    NodeKind.COMMAND,
    (cmd || h).slice(0, 80),
    COMMAND_COLOR,
    dom,
    1.0 + Math.min(3.0, count0 * 0.1),
    { body: cmd || h, count: count0 },
  );
  if (added) {
    b.pushEdge({
      source: hub,
      target: cmdId,
      kind: EdgeKind.COMMAND_IN_HUB,
      weight: count0,
    });
  }
}

export function ingestDiscussionCommand(
  b: WorkflowGraphBuilder,
  dce: Record<string, unknown>,
): void {
  /** Link a discussion to each distinct Bash command it ran. */
  const sid = String(require_(dce, "session_id", "discussion_command"));
  const h = String(require_(dce, "cmd_hash", "discussion_command"));
  const cmd = String(dce["cmd"] ?? "");
  const discId = `discussion:${sid}`;
  const cmdId = NodeIdFactory.commandId(h);
  if (!b.hasNode(discId)) return;
  const count0 = Number(dce["count"] ?? 1);
  if (!b.hasNode(cmdId)) {
    materializeDiscussionCommand(b, cmdId, cmd, h, discId, count0);
  }
  b.pushEdge({
    source: discId,
    target: cmdId,
    kind: EdgeKind.DISCUSSION_RAN_COMMAND,
    weight: count0,
  });
}

export function ingestSkillUsage(
  b: WorkflowGraphBuilder,
  sue: Record<string, unknown>,
): void {
  /** Record a slash-command invocation; expand multi-domain skill membership. */
  const name = String(require_(sue, "name", "skill_usage"));
  const dom = b.assignDomain(sue["domain"] as string | undefined);
  b.ensureDomain(dom);
  const sid = NodeIdFactory.skillId(name);
  if (!b.hasNode(sid)) {
    b.setNode(sid, {
      id: sid,
      kind: NodeKind.SKILL,
      label: name,
      color: SKILL_COLOR,
      domain_id: dom,
      size: 2.0,
      extra_domain_ids: [],
      tags: [],
    } satisfies WorkflowNode);
    b.pushEdge({ source: sid, target: dom, kind: EdgeKind.IN_DOMAIN, weight: 1.0 });
  } else {
    const existing = b.getNode(sid)!;
    if (
      existing.domain_id !== dom &&
      !existing.extra_domain_ids.includes(dom)
    ) {
      b.setNode(sid, {
        ...existing,
        extra_domain_ids: [...existing.extra_domain_ids, dom],
      });
      b.pushEdge({ source: sid, target: dom, kind: EdgeKind.IN_DOMAIN, weight: 1.0 });
    }
  }
  b.pushEdge({
    source: dom,
    target: sid,
    kind: EdgeKind.INVOKED_SKILL,
    weight: Number(sue["count"] ?? 1),
  });
}

export function ingestMcpUsage(
  b: WorkflowGraphBuilder,
  mue: Record<string, unknown>,
): void {
  /** Record an MCP-tool invocation; expand multi-domain MCP membership. */
  const server = String(require_(mue, "server", "mcp_usage"));
  const dom = b.assignDomain(mue["domain"] as string | undefined);
  b.ensureDomain(dom);
  const mcpId = NodeIdFactory.mcpId(server);
  const toolName = String(mue["tool"] ?? "");
  const count = Number(mue["count"] ?? 1);
  if (!b.hasNode(mcpId)) {
    b.setNode(mcpId, {
      id: mcpId,
      kind: NodeKind.MCP,
      label: server,
      color: MCP_COLOR,
      domain_id: dom,
      size: 2.2,
      subagent_type: toolName || undefined,
      count,
      extra_domain_ids: [],
      tags: [],
    } satisfies WorkflowNode);
    b.pushEdge({ source: mcpId, target: dom, kind: EdgeKind.IN_DOMAIN, weight: 1.0 });
  } else {
    const existing = b.getNode(mcpId)!;
    if (dom !== existing.domain_id && !existing.extra_domain_ids.includes(dom)) {
      b.setNode(mcpId, {
        ...existing,
        extra_domain_ids: [...existing.extra_domain_ids, dom],
        count: (existing.count ?? 0) + count,
      });
      b.pushEdge({ source: mcpId, target: dom, kind: EdgeKind.IN_DOMAIN, weight: 1.0 });
    }
  }
  b.pushEdge({
    source: dom,
    target: mcpId,
    kind: EdgeKind.INVOKED_MCP,
    weight: count,
    label: toolName || undefined,
  });
}

// ── AST ingestion (ADR-0046) ─────────────────────────────────────────────

export function ingestSymbol(
  b: WorkflowGraphBuilder,
  sym: Record<string, unknown>,
): void {
  /**
   * Create a SYMBOL node + its DEFINED_IN edge anchoring it to a FILE node.
   * Synthesises the parent file node on-demand so AST symbols from files
   * Claude Code sessions never touched still show up in the graph.
   * Idempotent by symbol id.
   */
  const filePath = String(require_(sym, "file_path", "symbol"));
  const qname = String(require_(sym, "qualified_name", "symbol"));
  const fid = NodeIdFactory.fileId(filePath);
  if (!b.hasNode(fid)) {
    // Synthesise a minimal file node anchored to the global domain.
    // _finalizeFiles has already run, so we add the file directly.
    b.setNode(fid, {
      id: fid,
      kind: NodeKind.FILE,
      label: filePath.split("/").at(-1) ?? filePath,
      color: primaryToolColor(PrimaryToolCluster.READ),
      domain_id: "domain:__global__",
      size: 0.8,
      path: filePath,
      extra_domain_ids: [],
      tags: [],
    } satisfies WorkflowNode);
    // Anchor synthesised file to global domain to satisfy in_domain invariant.
    b.pushEdge({
      source: fid,
      target: "domain:__global__",
      kind: EdgeKind.IN_DOMAIN,
      weight: 1.0,
    });
  }
  const sid = NodeIdFactory.symbolId(filePath, qname);
  if (b.hasNode(sid)) return;
  const stype = String(sym["symbol_type"] ?? "function");
  const color = SYMBOL_COLORS[stype] ?? SYMBOL_COLOR_DEFAULT;
  const parent = b.getNode(fid)!;
  b.setNode(sid, {
    id: sid,
    kind: NodeKind.SYMBOL,
    label: qname.split(".").at(-1) ?? qname,
    color,
    domain_id: parent.domain_id,
    size: 0.9,
    symbol_type: stype,
    signature: (sym["signature"] as string | undefined) ?? undefined,
    language: (sym["language"] as string | undefined) ?? undefined,
    line: sym["line"] != null ? Number(sym["line"]) : undefined,
    path: filePath,
    extra_domain_ids: [],
    tags: [],
  } satisfies WorkflowNode);
  // Gap 6: defaults from the central provenance table.
  const [conf, reason] = edgeProvenanceDefaults(EdgeKind.DEFINED_IN);
  b.pushEdge({
    source: sid,
    target: fid,
    kind: EdgeKind.DEFINED_IN,
    weight: 1.0,
    confidence: conf ?? undefined,
    reason: reason ?? undefined,
  });
}

function resolveAstEdgeEndpoints(
  b: WorkflowGraphBuilder,
  edge: Record<string, unknown>,
):
  | [srcId: string, dstId: string, edgeKind: EdgeKind]
  | null {
  /**
   * Resolve (src_id, dst_id, edge_kind) for an AST edge dict, or
   * return null when either endpoint is absent from the builder.
   */
  const kind = String(edge["kind"] ?? "");
  const srcFile = String(edge["src_file"] ?? "");
  const dstFile = String(edge["dst_file"] ?? "");
  const dstName = String(edge["dst_name"] ?? "");
  if (!dstFile || !dstName) return null;
  const dstId = NodeIdFactory.symbolId(dstFile, dstName);
  if (!b.hasNode(dstId)) return null;

  if (kind === "imports") {
    if (!srcFile) return null;
    const srcId = NodeIdFactory.fileId(srcFile);
    if (!b.hasNode(srcId)) return null;
    return [srcId, dstId, EdgeKind.IMPORTS];
  }

  const srcName = String(edge["src_name"] ?? "");
  if (!srcFile || !srcName) return null;
  const srcId = NodeIdFactory.symbolId(srcFile, srcName);
  if (!b.hasNode(srcId)) return null;
  const edgeKind = kind === "calls" ? EdgeKind.CALLS : EdgeKind.MEMBER_OF;
  return [srcId, dstId, edgeKind];
}

export function ingestAstEdge(
  b: WorkflowGraphBuilder,
  edge: Record<string, unknown>,
): void {
  /**
   * Create a CALLS / IMPORTS / MEMBER_OF edge between two symbols
   * (or a file→symbol IMPORTS edge). Skipped silently when either
   * endpoint is absent from the graph.
   */
  const resolved = resolveAstEdgeEndpoints(b, edge);
  if (resolved === null) return;
  const [srcId, dstId, edgeKind] = resolved;
  const [conf, reason] = edgeProvenanceDefaults(
    edgeKind,
    edge["confidence"] != null ? Number(edge["confidence"]) : undefined,
    edge["reason"] as string | undefined,
  );
  b.pushEdge({
    source: srcId,
    target: dstId,
    kind: edgeKind,
    weight: 1.0,
    confidence: conf ?? undefined,
    reason: reason ?? undefined,
  });
}
