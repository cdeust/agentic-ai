/**
 * Entity-node ingestion for WorkflowGraphBuilder (Gap 10).
 *
 * Holds the two helpers that project knowledge-graph entities into the
 * workflow graph:
 *
 *   ingestEntity(b, ent)       — creates one ENTITY node per row from
 *                                the entities table; anchored to its
 *                                domain via IN_DOMAIN.
 *   ingestAboutEntity(b, link) — creates one MEMORY → ENTITY ABOUT_ENTITY
 *                                edge per row of the memory_entities join
 *                                table. Silently skips links whose
 *                                endpoints are not in the graph.
 *
 * Pure core logic. No I/O.
 *
 * source: Cortex mcp_server/core/workflow_graph_entity.py
 */

import { ENTITY_COLORS } from "./palette.js";
import {
  EdgeKind,
  NodeIdFactory,
  NodeKind,
  edgeProvenanceDefaults,
  type WorkflowEdge,
} from "./schema.js";
import type { WorkflowGraphBuilder } from "./builder.js";

function require_<T>(
  rec: Record<string, unknown>,
  key: string,
  ctx: string,
): T {
  if (!(key in rec) || rec[key] == null) {
    throw new Error(`${ctx}: missing key ${JSON.stringify(key)} in ${JSON.stringify(rec)}`);
  }
  return rec[key] as T;
}

export function ingestEntity(
  b: WorkflowGraphBuilder,
  ent: Record<string, unknown>,
): void {
  /**
   * Create one ENTITY node from a knowledge-graph entity row.
   *
   * Args:
   *   b:   WorkflowGraphBuilder instance.
   *   ent: {id, name, type, domain, heat} — output of load_entities.
   *
   * Side effects: adds one ENTITY node + one in_domain edge.
   */
  const pgId = require_<string | number>(ent, "id", "entity");
  const dom = b.assignDomain(ent["domain"] as string | undefined);
  b.ensureDomain(dom);
  const entType = (ent["type"] as string | undefined) ?? "concept";
  const heat = parseFloat(String(ent["heat"] ?? 0));
  b.addChild(
    NodeIdFactory.entityId(pgId),
    NodeKind.ENTITY,
    String(ent["name"] ?? `entity ${pgId}`),
    ENTITY_COLORS[entType] ?? "#50B0C8",
    dom,
    1.0 + Math.min(3.0, heat * 3.0),
    { entityType: entType, heat },
  );
}

export function ingestAboutEntity(
  b: WorkflowGraphBuilder,
  link: Record<string, unknown>,
): void {
  /**
   * Create one MEMORY → ENTITY ABOUT_ENTITY edge.
   *
   * link carries memory_id + entity_id (PG primary keys used by the
   * memory_entities join table). Silently skips when either endpoint is
   * not present in the graph — matches the "skip-missing-endpoint"
   * contract of the other relational helpers.
   */
  const memPg = link["memory_id"];
  const entPg = link["entity_id"];
  if (memPg == null || entPg == null) return;
  const memId = NodeIdFactory.memoryId(memPg as string | number);
  const entId = NodeIdFactory.entityId(entPg as string | number);
  if (!b.hasNode(memId) || !b.hasNode(entId)) return;
  // Gap 6: shared provenance defaults.
  const [conf, reason] = edgeProvenanceDefaults(EdgeKind.ABOUT_ENTITY);
  b.pushEdge({
    source: memId,
    target: entId,
    kind: EdgeKind.ABOUT_ENTITY,
    weight: 1.0,
    confidence: conf ?? undefined,
    reason: reason ?? undefined,
  } satisfies WorkflowEdge);
}
