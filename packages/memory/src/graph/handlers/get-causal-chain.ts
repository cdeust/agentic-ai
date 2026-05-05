/**
 * get-causal-chain.ts — trace entity relationships through the knowledge graph.
 *
 * Given an entity name (or memory ID), performs BFS through the relationship
 * graph to surface chains of causation, dependency, and resolution.
 *
 * Port of: mcp_server/handlers/get_causal_chain.py
 *
 * Correctness contract:
 *   pre:  args provides entity_name OR memory_id (at least one).
 *   post: returns { start_entity, chain, total_edges, related_memories,
 *                   max_depth, direction }.
 *         chain.length ≤ max_edges (capped at 200).
 *         BFS terminates in ≤ max_depth hops (bounded by max_depth ≤ 10).
 *
 * source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py
 */

import type { MemoryStore as RecallMemoryStore } from "../../recall/port.js";

// ── Schema ────────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py schema

export const schema = {
  title: "Get causal chain",
  description:
    "Walk the Cortex knowledge graph (entities + typed relationships " +
    "extracted from memory content) via bounded BFS from a seed entity " +
    "or from every entity in a given memory. Returns chains of " +
    "causation, dependency, and resolution — useful for understanding " +
    "why a bug occurred, tracing the origin of a decision, or following " +
    "imports across modules. Distinct from `navigate_memory` (memory-level " +
    "co-access SR graph, not entity relationships), `recall` (no graph " +
    "traversal), and `drill_down` (cluster tree, not graph). Read-only.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      entity_name: {
        type: "string",
        description:
          "Name of the entity to trace from. Mutually exclusive with memory_id; " +
          "one of the two must be provided.",
        examples: ["DatabaseError", "PgRecallEngine", "WRRFFusion"],
      },
      memory_id: {
        type: "integer",
        description: "Memory ID whose extracted entities seed the BFS frontier.",
        minimum: 1,
        examples: [42, 1024],
      },
      relationship_types: {
        type: "array",
        description:
          "Filter traversal to specific relationship types. Common types: " +
          "'caused_by', 'resolved_by', 'imports', 'depends_on'. " +
          "Omit to traverse all types.",
        items: { type: "string" },
        default: [],
        examples: [["caused_by", "resolved_by"], ["imports", "depends_on"]],
      },
      max_depth: {
        type: "integer",
        description:
          "Maximum BFS depth from the seed entities. Higher = wider blast radius.",
        default: 3,
        minimum: 1,
        maximum: 10,
        examples: [2, 3, 5],
      },
      max_edges: {
        type: "integer",
        description:
          "Hard cap on the number of edges returned to keep payloads small.",
        default: 200,
        minimum: 10,
        maximum: 5000,
        examples: [100, 200, 1000],
      },
      direction: {
        type: "string",
        description:
          "'outgoing' = effects/impact, 'incoming' = causes/origins, " +
          "'both' = full neighborhood.",
        enum: ["outgoing", "incoming", "both"],
        default: "both",
        examples: ["outgoing", "incoming"],
      },
    },
  },
} as const;

// ── Constants ─────────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:_handler_impl — max_depth = min(…, 5)
const ABSOLUTE_MAX_DEPTH = 5; // source: get_causal_chain.py line 255
// source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:_handler_impl — max_edges = min(…, 200)
const ABSOLUTE_MAX_EDGES = 200; // source: get_causal_chain.py line 256
// source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:_bfs_entity_graph — limit=20 rels per entity
const RELS_PER_ENTITY_LIMIT = 20; // source: get_causal_chain.py:_bfs_entity_graph
// source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:_get_related_memory_previews — limit=5
const RELATED_MEMORY_LIMIT = 5; // source: get_causal_chain.py:_get_related_memory_previews

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EdgeRecord {
  source_id: number;
  source_name: string;
  source_type: string;
  target_id: number;
  target_name: string;
  target_type: string;
  relationship_type: string;
  weight: number;
  confidence: number;
  depth: number;
}

export interface StartEntity {
  id: number;
  name: string;
  type: string;
}

export interface RelatedMemoryPreview {
  memory_id: number;
  content: string;
  heat: number;
}

export interface CausalChainResult {
  start_entity: StartEntity;
  chain: EdgeRecord[];
  total_edges: number;
  related_memories: RelatedMemoryPreview[];
  max_depth: number;
  direction: string;
}

export interface CausalChainError {
  chain: [];
  total_edges: 0;
  reason: string;
}

// ── Entity resolution helpers ─────────────────────────────────────────────────

interface EntityRow {
  id: number;
  name: string;
  entity_type?: string;
  heat?: number;
}

interface RelationshipRow {
  source_entity_id: number;
  target_entity_id: number;
  weight?: number;
  confidence?: number;
  relationship_type?: string;
}

/**
 * Resolve starting entity by name.
 *
 * source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:_resolve_start_entity_by_name
 */
async function resolveByName(
  entityName: string,
  store: RecallMemoryStore,
): Promise<EntityRow | null> {
  return (await store.getEntityByName?.(entityName)) ?? null;
}

/**
 * Resolve starting entity from a memory's extracted entities.
 *
 * Pre:  memoryId is a positive integer.
 * Post: returns the first known entity extracted from the memory's content, or null.
 *
 * source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:_resolve_start_entity_from_memory
 */
async function resolveFromMemory(
  memoryId: number,
  store: RecallMemoryStore,
): Promise<EntityRow | null> {
  const mem = await store.getMemory(memoryId);
  if (!mem) return null;

  const content = mem.content ?? "";
  // Lightweight capitalized-token extraction (mirrors TS runtime entity extraction)
  const tokens = content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  const STOPWORDS = new Set(["The", "A", "An", "I", "It", "This", "That", "We", "They"]);
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    const entity = await store.getEntityByName?.(token);
    if (entity) return entity;
  }
  return null;
}

// ── BFS traversal ─────────────────────────────────────────────────────────────

/**
 * BFS through the entity relationship graph from startEntityId.
 *
 * Invariant: edges.length ≤ maxEdges throughout the loop.
 * Termination: depth increases monotonically; loop exits when depth ≥ maxDepth
 *              or edges.length ≥ maxEdges or queue is empty.
 *
 * source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:_bfs_entity_graph
 */
async function bfsEntityGraph(
  startEntityId: number,
  store: RecallMemoryStore,
  maxDepth: number,
  maxEdges: number,
  direction: string,
  relFilter: Set<string> | null,
): Promise<EdgeRecord[]> {
  const visitedEntities = new Set<number>([startEntityId]);
  const queue: Array<[number, number]> = [[startEntityId, 0]]; // [entity_id, depth]
  const edges: EdgeRecord[] = [];

  // Get all relationships once (store interface provides all relationships for domain).
  let allRels: RelationshipRow[] = [];
  let allEntities: EntityRow[] = [];
  try {
    allRels = (await store.getRelationships?.()) ?? [];
    allEntities = (await store.getEntities?.()) ?? [];
  } catch {
    return [];
  }

  const entityMap = new Map<number, EntityRow>();
  for (const e of allEntities) {
    entityMap.set(e.id, e);
  }

  // Build adjacency index: entity_id → relevant rels
  const outgoing = new Map<number, RelationshipRow[]>();
  const incoming = new Map<number, RelationshipRow[]>();
  for (const rel of allRels) {
    const src = rel.source_entity_id;
    const tgt = rel.target_entity_id;
    if (!outgoing.has(src)) outgoing.set(src, []);
    if (!incoming.has(tgt)) incoming.set(tgt, []);
    outgoing.get(src)!.push(rel);
    incoming.get(tgt)!.push(rel);
  }

  // BFS loop
  // Invariant: at each iteration, edges.length ≤ maxEdges; depth ≤ maxDepth.
  while (queue.length > 0 && edges.length < maxEdges) {
    const [entityId, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;

    // Gather relevant rels based on direction
    const rels: RelationshipRow[] = [];
    if (direction === "outgoing" || direction === "both") {
      rels.push(...(outgoing.get(entityId) ?? []).slice(0, RELS_PER_ENTITY_LIMIT));
    }
    if (direction === "incoming" || direction === "both") {
      rels.push(...(incoming.get(entityId) ?? []).slice(0, RELS_PER_ENTITY_LIMIT));
    }

    for (const rel of rels) {
      if (edges.length >= maxEdges) break;
      const relType = rel.relationship_type ?? "";
      if (relFilter && relType && !relFilter.has(relType)) continue;

      const srcEntity = entityMap.get(rel.source_entity_id);
      const tgtEntity = entityMap.get(rel.target_entity_id);

      edges.push({
        source_id: rel.source_entity_id,
        source_name: srcEntity?.name ?? `entity:${rel.source_entity_id}`,
        source_type: srcEntity?.entity_type ?? "unknown",
        target_id: rel.target_entity_id,
        target_name: tgtEntity?.name ?? `entity:${rel.target_entity_id}`,
        target_type: tgtEntity?.entity_type ?? "unknown",
        relationship_type: relType,
        weight: Math.round((rel.weight ?? 1.0) * 10000) / 10000,
        confidence: Math.round(((rel.confidence ?? 1.0) as number) * 10000) / 10000,
        depth: depth + 1,
      });

      // Enqueue unvisited neighbor
      for (const nextId of [rel.source_entity_id, rel.target_entity_id]) {
        if (!visitedEntities.has(nextId)) {
          visitedEntities.add(nextId);
          queue.push([nextId, depth + 1]);
        }
      }
    }
  }

  return edges;
}

// ── Related memory previews ───────────────────────────────────────────────────

/**
 * Fetch memory previews mentioning an entity (FTS name lookup).
 *
 * source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:_get_related_memory_previews
 */
async function getRelatedMemoryPreviews(
  store: RecallMemoryStore,
  entityName: string,
): Promise<RelatedMemoryPreview[]> {
  try {
    const results = await store.searchByFts(entityName, RELATED_MEMORY_LIMIT);
    const previews: RelatedMemoryPreview[] = [];
    for (const r of results) {
      const mem = await store.getMemory(r.memory_id);
      if (mem) {
        previews.push({
          memory_id: mem.id,
          content: mem.content.slice(0, 150),
          heat: Math.round((mem.heat ?? 0) * 10000) / 10000,
        });
      }
    }
    return previews;
  } catch {
    return [];
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Trace causal/dependency chain from an entity or memory.
 *
 * source: cortex@ed33435 mcp_server/handlers/get_causal_chain.py:_handler_impl
 */
export async function getCausalChainHandler(
  args: Record<string, unknown> | null | undefined,
  store: RecallMemoryStore,
): Promise<CausalChainResult | CausalChainError> {
  const a = args ?? {};
  const entityName = String(a["entity_name"] ?? "").trim();
  const memoryIdRaw = a["memory_id"];

  if (!entityName && memoryIdRaw === undefined) {
    return { chain: [], total_edges: 0, reason: "provide entity_name or memory_id" };
  }

  // source: cortex@ed33435 get_causal_chain.py:255-256 — clamp to ABSOLUTE limits
  const maxDepth = Math.min(Number(a["max_depth"] ?? 3), ABSOLUTE_MAX_DEPTH);
  const maxEdges = Math.min(Number(a["max_edges"] ?? 50), ABSOLUTE_MAX_EDGES);
  const direction = String(a["direction"] ?? "both");
  const relTypes = Array.isArray(a["relationship_types"]) ? a["relationship_types"] as string[] : [];
  const relFilter = relTypes.length > 0 ? new Set(relTypes) : null;

  // Resolve starting entity
  let startEntity: EntityRow | null = null;
  if (entityName) {
    startEntity = await resolveByName(entityName, store);
    if (!startEntity) {
      return { chain: [], total_edges: 0, reason: `entity not found: ${entityName}` };
    }
  } else {
    startEntity = await resolveFromMemory(Number(memoryIdRaw), store);
    if (!startEntity) {
      return { chain: [], total_edges: 0, reason: "no known entities found in memory" };
    }
  }

  const edges = await bfsEntityGraph(
    startEntity.id,
    store,
    maxDepth,
    maxEdges,
    direction,
    relFilter,
  );

  const relatedMemories = await getRelatedMemoryPreviews(store, startEntity.name);

  return {
    start_entity: {
      id: startEntity.id,
      name: startEntity.name,
      type: startEntity.entity_type ?? "unknown",
    },
    chain: edges,
    total_edges: edges.length,
    related_memories: relatedMemories,
    max_depth: maxDepth,
    direction,
  };
}
