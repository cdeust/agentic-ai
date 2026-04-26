/**
 * Workflow graph builder — reduces heterogeneous Claude-surface events to
 * the canonical node/edge vocabulary in schema.ts. Pure core, no I/O;
 * malformed inputs throw Error.
 *
 * Three-phase pipeline:
 *   Phase 1 — node ingestion: tool events, skills, hooks, agents,
 *             commands, memories, discussions, entities.
 *   Phase 2 — relational edges (after files are finalised).
 *   Phase 3 — AST symbols + edges (ADR-0046).
 *
 * Post-file-finalisation relational ingestion lives in builder-relational.ts
 * so this module stays under the 500-line ceiling.
 *
 * source: Cortex mcp_server/core/workflow_graph_builder.py
 */

import {
  ingestAboutEntity,
  ingestEntity,
} from "./entity.js";
import {
  ingestAstEdge,
  ingestCommandFile,
  ingestDiscussionAgent,
  ingestDiscussionCommand,
  ingestDiscussionFile,
  ingestDiscussionTool,
  ingestMcpUsage,
  ingestSkillUsage,
  ingestSymbol,
} from "./builder-relational.js";
import type { WorkflowBuildInputs } from "./inputs.js";
import {
  AGENT_COLOR,
  COMMAND_COLOR,
  DISCUSSION_COLOR,
  DOMAIN_COLOR,
  HOOK_COLOR,
  MEMORY_STAGE_COLORS,
  SKILL_COLOR,
  TOOL_HUB_COLORS,
  classifyPrimaryTool,
  primaryToolColor,
} from "./palette.js";
import {
  GLOBAL_DOMAIN_ID,
  EdgeKind,
  NodeIdFactory,
  NodeKind,
  ToolKind,
  type WorkflowEdge,
  type WorkflowNode,
} from "./schema.js";

// Scientific-measurement fields forwarded verbatim to memory nodes.
const _MEMORY_SCIENTIFIC_KEYS = (
  "heat_base arousal emotional_valence dominant_emotion importance " +
  "surprise_score confidence access_count useful_count replay_count " +
  "reconsolidation_count plasticity stability excitability " +
  "hippocampal_dependency schema_match_score schema_id separation_index " +
  "interference_score encoding_strength hours_in_stage stage_entered_at " +
  "last_accessed no_decay is_protected is_stale is_benchmark is_global " +
  "store_type compression_level compressed"
).split(" ");

const _TOOL_NAME_TO_ENUM: Record<string, ToolKind> = {};
const _TOOL_NAME_LOWER: Record<string, ToolKind> = {};
for (const t of Object.values(ToolKind)) {
  _TOOL_NAME_TO_ENUM[t] = t as ToolKind;
  _TOOL_NAME_LOWER[t.toLowerCase()] = t as ToolKind;
}

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
  const direct = _TOOL_NAME_TO_ENUM[name];
  if (direct) return direct;
  const lower = _TOOL_NAME_LOWER[name.toLowerCase()];
  if (lower) return lower;
  throw new Error(`unknown ToolKind: ${JSON.stringify(name)}`);
}

type FileTimestamps = {
  first_seen: string | null;
  last_accessed: string | null;
  last_modified: string | null;
};

export class WorkflowGraphBuilder {
  /** Reduce seven data sources to canonical (nodes, edges). */

  _nodes: Map<string, WorkflowNode> = new Map();
  _edges: WorkflowEdge[] = [];
  private _fileToolCounts: Map<string, Map<ToolKind, number>> = new Map();
  private _fileDomains: Map<string, Set<string>> = new Map();
  private _fileTimestamps: Map<string, FileTimestamps> = new Map();

  build(inputs: WorkflowBuildInputs): [WorkflowNode[], WorkflowEdge[]] {
    /**
     * Ingest every stream in inputs and return [nodes, edges].
     * Single DTO parameter satisfies the <=4 parameter-count rule.
     */
    this.ensureDomain(GLOBAL_DOMAIN_ID, "global");

    // Phase 1: node ingestion.
    for (const ev of inputs.tool_events) this._ingestToolEvent(ev);
    for (const sk of inputs.skill_paths) this._ingestSkill(sk);
    for (const hk of inputs.hook_defs) this._ingestHook(hk);
    for (const ag of inputs.agent_events) this._ingestAgent(ag);
    for (const cm of inputs.command_events) this._ingestCommand(cm);
    for (const mem of inputs.memories) this._ingestMemory(mem);
    for (const dc of inputs.discussions) this._ingestDiscussion(dc);
    for (const ent of inputs.entities) ingestEntity(this, ent);
    this._finalizeFiles();

    // Phase 2: relational edges. Every helper assumes file nodes exist.
    for (const ev of inputs.discussion_file_events)
      ingestDiscussionFile(this, ev);
    for (const ev of inputs.command_file_events) ingestCommandFile(this, ev);
    for (const ev of inputs.skill_usage_events) ingestSkillUsage(this, ev);
    for (const ev of inputs.mcp_usage_events) ingestMcpUsage(this, ev);
    for (const ev of inputs.discussion_tool_events)
      ingestDiscussionTool(this, ev);
    for (const ev of inputs.discussion_agent_events)
      ingestDiscussionAgent(this, ev);
    for (const ev of inputs.discussion_command_events)
      ingestDiscussionCommand(this, ev);
    for (const ev of inputs.memory_entity_edges)
      ingestAboutEntity(this, ev);

    // Phase 3 (ADR-0046): AST enrichment.
    for (const sym of inputs.ast_symbols) ingestSymbol(this, sym);
    for (const edge of inputs.ast_edges) ingestAstEdge(this, edge);

    return this._dedupeAndLink(
      Array.from(this._nodes.values()),
      this._edges,
    );
  }

  // ── Public accessors used by relational helpers ───────────────────────

  hasNode(id: string): boolean {
    return this._nodes.has(id);
  }

  getNode(id: string): WorkflowNode | undefined {
    return this._nodes.get(id);
  }

  setNode(id: string, node: WorkflowNode): void {
    this._nodes.set(id, node);
  }

  pushEdge(edge: WorkflowEdge): void {
    this._edges.push(edge);
  }

  // ── Domain helpers ────────────────────────────────────────────────────

  assignDomain(domainId: string | null | undefined): string {
    /**
     * Resolve a free-text domain string to a canonical domain:* id.
     * In the TS port we do not have the Python domain_mapping module;
     * we apply the structural rules only (prefix normalisation).
     * TODO: wire into the shared domain-mapping package when available.
     */
    if (!domainId) return GLOBAL_DOMAIN_ID;
    if (domainId.startsWith("domain:")) return domainId;
    if (domainId.startsWith("-")) return GLOBAL_DOMAIN_ID;
    // Single-word slugs with no hyphen bucketed to global (matches Python logic).
    if (!domainId.includes("-")) return GLOBAL_DOMAIN_ID;
    return NodeIdFactory.domainId(domainId);
  }

  ensureDomain(domainId: string, label?: string): string {
    if (!this._nodes.has(domainId)) {
      this._nodes.set(domainId, {
        id: domainId,
        kind: NodeKind.DOMAIN,
        label: label ?? domainId.replace("domain:", ""),
        color: DOMAIN_COLOR,
        domain_id: domainId,
        size: 5.0,
        extra_domain_ids: [],
        tags: [],
      } satisfies WorkflowNode);
    }
    return domainId;
  }

  buildToolHubs(domainId: string, activeTools: ToolKind[]): WorkflowNode[] {
    const created: WorkflowNode[] = [];
    for (const tool of activeTools) {
      const hubId = NodeIdFactory.toolHubId(domainId, tool);
      if (this._nodes.has(hubId)) continue;
      const node: WorkflowNode = {
        id: hubId,
        kind: NodeKind.TOOL_HUB,
        label: tool,
        color: TOOL_HUB_COLORS[tool],
        domain_id: domainId,
        size: 2.5,
        tool,
        extra_domain_ids: [],
        tags: [],
      };
      this._nodes.set(hubId, node);
      this._edges.push(this._inDomain(hubId, domainId));
      created.push(node);
    }
    return created;
  }

  addChild(
    nodeId: string,
    kind: NodeKind,
    label: string,
    color: string,
    domainId: string,
    size: number,
    extra: Record<string, unknown> = {},
  ): boolean {
    /** Idempotent non-domain node + in_domain edge. Returns true if new. */
    if (this._nodes.has(nodeId)) return false;
    this._nodes.set(nodeId, {
      id: nodeId,
      kind,
      label,
      color,
      domain_id: domainId,
      size,
      extra_domain_ids: [],
      tags: [],
      ...extra,
    } as WorkflowNode);
    this._edges.push(this._inDomain(nodeId, domainId));
    return true;
  }

  // ── Node ingestors ────────────────────────────────────────────────────

  private _ingestToolEvent(ev: Record<string, unknown>): void {
    const tool = asTool(String(require_(ev, "tool", "tool_event")));
    const dom = this.assignDomain(ev["domain"] as string | undefined);
    this.ensureDomain(dom);
    this.buildToolHubs(dom, [tool]);
    const path = ev["file_path"] as string | undefined;
    if (!path) return;
    const count = Number(ev["count"] ?? 1);
    if (!this._fileToolCounts.has(path)) {
      this._fileToolCounts.set(path, new Map());
    }
    const tc = this._fileToolCounts.get(path)!;
    tc.set(tool, (tc.get(tool) ?? 0) + count);
    if (!this._fileDomains.has(path)) {
      this._fileDomains.set(path, new Set());
    }
    this._fileDomains.get(path)!.add(dom);
    this._trackFileTimestamp(path, tool, ev);
    this._edges.push({
      source: NodeIdFactory.toolHubId(dom, tool),
      target: NodeIdFactory.fileId(path),
      kind: EdgeKind.TOOL_USED_FILE,
      weight: count,
    });
  }

  private _trackFileTimestamp(
    path: string,
    tool: ToolKind,
    ev: Record<string, unknown>,
  ): void {
    /**
     * Accumulate per-file first_seen / last_accessed / last_modified.
     * first_seen  = earliest access of any kind.
     * last_accessed = latest access of any kind.
     * last_modified = latest Edit or Write access only.
     */
    const firstTs = ev["first_ts"] as string | undefined;
    const lastTs = ev["last_ts"] as string | undefined;
    if (!firstTs && !lastTs) return;
    if (!this._fileTimestamps.has(path)) {
      this._fileTimestamps.set(path, {
        first_seen: null,
        last_accessed: null,
        last_modified: null,
      });
    }
    const slot = this._fileTimestamps.get(path)!;
    if (firstTs && (slot.first_seen === null || firstTs < slot.first_seen)) {
      slot.first_seen = firstTs;
    }
    if (lastTs && (slot.last_accessed === null || lastTs > slot.last_accessed)) {
      slot.last_accessed = lastTs;
    }
    if (
      (tool === ToolKind.EDIT || tool === ToolKind.WRITE) &&
      lastTs &&
      (slot.last_modified === null || lastTs > slot.last_modified)
    ) {
      slot.last_modified = lastTs;
    }
  }

  _finalizeFiles(): void {
    for (const [path, tc] of this._fileToolCounts) {
      const cluster = classifyPrimaryTool(
        Object.fromEntries(tc.entries()) as Partial<Record<ToolKind, number>>,
      );
      const fid = NodeIdFactory.fileId(path);
      const doms = Array.from(this._fileDomains.get(path) ?? []).sort();
      if (doms.length === 0) {
        throw new Error(`file ${path} has no domain membership`);
      }
      const ts = this._fileTimestamps.get(path) ?? {};
      this._nodes.set(fid, {
        id: fid,
        kind: NodeKind.FILE,
        label: path.split("/").at(-1) || path,
        color: primaryToolColor(cluster),
        domain_id: doms[0]!,
        size: 1.5,
        primary_cluster: cluster,
        path,
        extra_domain_ids: doms.slice(1),
        tags: [],
        ...ts,
      } as WorkflowNode);
      for (const d of doms) {
        this._edges.push(this._inDomain(fid, d));
      }
    }
  }

  private _ingestMemory(mem: Record<string, unknown>): void {
    const pgId = require_(mem, "id", "memory");
    const dom = this.assignDomain(mem["domain"] as string | undefined);
    this.ensureDomain(dom);
    const stage = String(
      mem["consolidation_stage"] ?? mem["stage"] ?? "episodic",
    );
    const heat = parseFloat(String(mem["heat"] ?? mem["heat_base"] ?? 0));
    const content = String(mem["content"] ?? "");
    const rawTags = mem["tags"];
    const tags = Array.isArray(rawTags)
      ? (rawTags as unknown[]).map(String).slice(0, 20)
      : [];
    const science: Record<string, unknown> = {};
    for (const k of _MEMORY_SCIENTIFIC_KEYS) {
      if (k in mem && mem[k] != null) science[k] = mem[k];
    }
    this.addChild(
      NodeIdFactory.memoryId(pgId as string | number),
      NodeKind.MEMORY,
      (content.slice(0, 60).replace(/\n/g, " ")) || `memory ${String(pgId)}`,
      MEMORY_STAGE_COLORS[stage] ?? MEMORY_STAGE_COLORS["episodic"]!,
      dom,
      1.0 + Math.min(3.0, heat * 3.0),
      {
        stage,
        body: content.slice(0, 4000) || undefined,
        heat,
        tags,
        created_at: mem["created_at"],
        ...science,
      },
    );
  }

  private _ingestDiscussion(dc: Record<string, unknown>): void {
    const sid = String(require_(dc, "session_id", "discussion"));
    const dom = this.assignDomain(dc["domain"] as string | undefined);
    this.ensureDomain(dom);
    const mc = Number(dc["message_count"] ?? 0);
    this.addChild(
      `discussion:${sid}`,
      NodeKind.DISCUSSION,
      String(dc["title"] ?? sid.slice(0, 8)),
      DISCUSSION_COLOR,
      dom,
      1.0 + Math.min(3.0, mc * 0.02),
      {
        session_id: sid,
        count: mc,
        started_at: dc["started_at"],
        last_activity: dc["last_activity"],
        duration_ms: dc["duration_ms"],
      },
    );
  }

  private _ingestSkill(sk: Record<string, unknown>): void {
    const name = String(require_(sk, "name", "skill"));
    const path = String(require_(sk, "path", "skill"));
    const rawDoms = sk["domains"] as string[] | undefined;
    const doms =
      (rawDoms ?? []).map((d) => this.assignDomain(d)).filter(Boolean);
    const resolvedDoms = doms.length > 0 ? doms : [GLOBAL_DOMAIN_ID];
    for (const d of resolvedDoms) this.ensureDomain(d);
    const nodeId = NodeIdFactory.skillId(name);
    this.addChild(nodeId, NodeKind.SKILL, name, SKILL_COLOR, resolvedDoms[0]!, 2.0, {
      path,
      extra_domain_ids: resolvedDoms.slice(1),
      body: sk["body"],
    });
    for (const d of resolvedDoms) {
      this._edges.push({
        source: d,
        target: nodeId,
        kind: EdgeKind.INVOKED_SKILL,
        weight: 1.0,
      });
    }
  }

  private _ingestHook(hk: Record<string, unknown>): void {
    const event = String(require_(hk, "event", "hook"));
    const cmd = String(require_(hk, "command", "hook"));
    const dom = this.assignDomain(hk["domain"] as string | undefined);
    this.ensureDomain(dom);
    const nodeId = NodeIdFactory.hookId(event, cmd);
    const matcher = String(hk["matcher"] ?? "");
    const label = matcher ? `${event}:${matcher}` : event;
    if (!this.addChild(nodeId, NodeKind.HOOK, label, HOOK_COLOR, dom, 1.5, {
      path: cmd,
      event,
    })) {
      return;
    }
    this._edges.push({
      source: dom,
      target: nodeId,
      kind: EdgeKind.TRIGGERED_HOOK,
      weight: 1.0,
      label: event,
    });
  }

  private _ingestAgent(ag: Record<string, unknown>): void {
    const sub = String(require_(ag, "subagent_type", "agent"));
    const dom = this.assignDomain(ag["domain"] as string | undefined);
    this.ensureDomain(dom);
    this.buildToolHubs(dom, [ToolKind.TASK]);
    const hub = NodeIdFactory.toolHubId(dom, ToolKind.TASK);
    const nodeId = NodeIdFactory.agentId(dom, sub);
    const count = Number(ag["count"] ?? 1);
    this.addChild(nodeId, NodeKind.AGENT, sub, AGENT_COLOR, dom, 2.0, {
      subagent_type: sub,
      count,
    });
    this._edges.push({
      source: hub,
      target: nodeId,
      kind: EdgeKind.SPAWNED_AGENT,
      weight: count,
    });
  }

  private _ingestCommand(cm: Record<string, unknown>): void {
    const cmd = String(require_(cm, "cmd", "command"));
    const h = String(require_(cm, "cmd_hash", "command"));
    const dom = this.assignDomain(cm["domain"] as string | undefined);
    this.ensureDomain(dom);
    this.buildToolHubs(dom, [ToolKind.BASH]);
    const hub = NodeIdFactory.toolHubId(dom, ToolKind.BASH);
    const nodeId = NodeIdFactory.commandId(h);
    const count = Number(cm["count"] ?? 1);
    if (
      !this.addChild(
        nodeId,
        NodeKind.COMMAND,
        cmd.slice(0, 80),
        COMMAND_COLOR,
        dom,
        1.0 + Math.min(3.0, count * 0.1),
        {
          body: cmd,
          count,
          first_seen: cm["first_ts"],
          last_accessed: cm["last_ts"],
        },
      )
    ) {
      return;
    }
    // Bash hub → command containment. Uses COMMAND_IN_HUB (not
    // TOOL_USED_FILE) so workflow_graph_panel.js renderToolHub's
    // "Files touched" counter isn't inflated by the command count.
    this._edges.push({
      source: hub,
      target: nodeId,
      kind: EdgeKind.COMMAND_IN_HUB,
      weight: count,
    });
  }

  // ── Deduplication ─────────────────────────────────────────────────────

  private _dedupeAndLink(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ): [WorkflowNode[], WorkflowEdge[]] {
    /**
     * Dedupe by (src, tgt, kind); sum weights.
     *
     * Cycle-handling note: INVOKED_SKILL edges from domain→skill survive
     * deduplication when src differs (domain:a→skill:x and domain:b→skill:x
     * have different src), preserving multi-domain fan-out correctly.
     * Only exact (src, tgt, kind) duplicates collapse.
     */
    const seen = new Map<string, WorkflowEdge>();
    for (const e of edges) {
      const key = `${e.source}\0${e.target}\0${e.kind}`;
      const existing = seen.get(key);
      if (existing) {
        seen.set(key, { ...existing, weight: existing.weight + e.weight });
      } else {
        seen.set(key, e);
      }
    }
    return [nodes, Array.from(seen.values())];
  }

  private _inDomain(source: string, domainId: string): WorkflowEdge {
    return {
      source,
      target: domainId,
      kind: EdgeKind.IN_DOMAIN,
      weight: 1.0,
    };
  }
}
