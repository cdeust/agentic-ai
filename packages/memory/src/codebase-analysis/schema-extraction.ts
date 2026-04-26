/**
 * Schema extraction — formation from clusters and merging of schemas.
 *
 * Ported from mcp_server/core/schema_extraction.py
 *
 * Handles the creation side of the schema lifecycle:
 *   1. Formation: cluster of memories -> Schema via entity/tag frequency analysis
 *   2. Merging: two similar schemas -> single unified Schema
 *
 * Theoretical basis (all qualitative — no published equations):
 *   Tse D et al. (2007) — Demonstrates schema-accelerated consolidation
 *       in rats (~15x faster). No computational model provided.
 *   Gilboa A, Marlatte H (2017) — Reviews neurobiology of schemas:
 *       schemas as networks of neocortical traces, schema formation via
 *       statistical regularity extraction. Conceptual framework only.
 *
 * Engineering implementation:
 *   Schema formation extracts entity/tag frequencies from memory clusters
 *   using simple counting and threshold filtering. Merging uses Jaccard
 *   similarity — standard set overlap, not derived from any schema paper.
 *   All thresholds are hand-tuned:
 *     _MIN_FORMATION_COUNT=5, _ENTITY_FREQUENCY_THRESHOLD=0.4,
 *     _HIGH_MATCH_THRESHOLD=0.7, _SCHEMA_MERGE_THRESHOLD=0.6,
 *     _SCHEMA_EMA_ALPHA=0.1, _RELATIONSHIP_FREQUENCY_THRESHOLD=0.3
 *
 * Pure business logic — no I/O.
 */

import type { Schema } from "./types.js";

// ── Configuration ─────────────────────────────────────────────────────────

const _MIN_FORMATION_COUNT = 5;
const _ENTITY_FREQUENCY_THRESHOLD = 0.4;
const _HIGH_MATCH_THRESHOLD = 0.7;
const _SCHEMA_MERGE_THRESHOLD = 0.6;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _SCHEMA_EMA_ALPHA = 0.1;
const _RELATIONSHIP_FREQUENCY_THRESHOLD = 0.3;

// ── Schema factory ────────────────────────────────────────────────────────

export function makeSchema(overrides: Partial<Schema> = {}): Schema {
  return {
    schemaId: "",
    domain: "",
    label: "",
    entitySignature: {},
    relationshipTypes: [],
    tagSignature: {},
    consistencyThreshold: _HIGH_MATCH_THRESHOLD,
    formationCount: 0,
    assimilationCount: 0,
    violationCount: 0,
    lastUpdatedHours: 0,
    ...overrides,
  };
}

// ── Schema Formation ─────────────────────────────────────────────────────

export function extractSchemaFromCluster(
  clusterMemories: Record<string, unknown>[],
  domain = "",
  schemaId = "",
  entityThreshold = _ENTITY_FREQUENCY_THRESHOLD,
  minMemories = _MIN_FORMATION_COUNT,
): Schema | null {
  /**
   * Form a schema from a cluster of related memories.
   *
   * Extracts recurring entities, tags, and relationship patterns that appear
   * across multiple memories in the cluster.
   *
   * Returns:
   *   Schema if formation criteria met, null otherwise.
   */
  if (clusterMemories.length < minMemories) return null;

  const n = clusterMemories.length;
  const entitySignature = _extractEntitySignature(clusterMemories, n, entityThreshold);
  const tagSignature = _extractTagSignature(clusterMemories, n, entityThreshold);
  const frequentPatterns = _extractRelationshipPatterns(clusterMemories, n);

  if (
    Object.keys(entitySignature).length === 0 &&
    Object.keys(tagSignature).length === 0
  ) {
    return null;
  }

  return makeSchema({
    schemaId,
    domain,
    label: generateLabel(entitySignature, tagSignature),
    entitySignature,
    relationshipTypes: frequentPatterns,
    tagSignature,
    formationCount: n,
  });
}

function _extractEntitySignature(
  memories: Record<string, unknown>[],
  n: number,
  threshold: number,
): Record<string, number> {
  const entityCounts = new Map<string, number>();
  for (const mem of memories) {
    const seen = new Set<string>();
    const entities = (mem["entities"] as unknown[]) ?? [];
    for (const ent of entities) {
      const name = typeof ent === "string" ? ent : ((ent as Record<string, unknown>)["name"] as string) ?? "";
      if (name && !seen.has(name)) {
        entityCounts.set(name, (entityCounts.get(name) ?? 0) + 1);
        seen.add(name);
      }
    }
  }
  const result: Record<string, number> = {};
  for (const [name, count] of entityCounts) {
    if (count / n >= threshold) result[name] = count / n;
  }
  return result;
}

function _extractTagSignature(
  memories: Record<string, unknown>[],
  n: number,
  threshold: number,
): Record<string, number> {
  const tagCounts = new Map<string, number>();
  for (const mem of memories) {
    for (const tag of (mem["tags"] as string[]) ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const result: Record<string, number> = {};
  for (const [tag, count] of tagCounts) {
    if (count / n >= threshold) result[tag] = count / n;
  }
  return result;
}

function _extractRelationshipPatterns(
  memories: Record<string, unknown>[],
  n: number,
): [string, string, string][] {
  const relPatterns = new Map<string, number>();
  for (const mem of memories) {
    for (const rel of (mem["relationships"] as Record<string, unknown>[]) ?? []) {
      if (typeof rel === "object" && rel !== null) {
        const pattern = [
          (rel["source_type"] as string) ?? "",
          (rel["relationship_type"] as string) ?? "",
          (rel["target_type"] as string) ?? "",
        ] as [string, string, string];
        if (pattern.every(Boolean)) {
          const key = pattern.join("|");
          relPatterns.set(key, (relPatterns.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const result: [string, string, string][] = [];
  for (const [key, count] of relPatterns) {
    if (count / n >= _RELATIONSHIP_FREQUENCY_THRESHOLD) {
      result.push(key.split("|") as [string, string, string]);
    }
  }
  return result;
}

export function generateLabel(
  entitySig: Record<string, number>,
  tagSig: Record<string, number>,
): string {
  const topEntities = Object.entries(entitySig)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const topTags = Object.entries(tagSig)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  const parts: string[] = topEntities.map(([name]) => name);
  if (topTags.length > 0) {
    parts.push(`[${topTags.map(([t]) => t).join(", ")}]`);
  }
  return parts.length > 0 ? parts.join(" + ") : "unnamed_schema";
}

// ── Schema Merging ────────────────────────────────────────────────────────

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export function shouldMergeSchemas(schemaA: Schema, schemaB: Schema): boolean {
  const entitiesA = new Set(Object.keys(schemaA.entitySignature));
  const entitiesB = new Set(Object.keys(schemaB.entitySignature));
  return jaccardSimilarity(entitiesA, entitiesB) >= _SCHEMA_MERGE_THRESHOLD;
}

function _computeMergeWeights(
  schemaA: Schema,
  schemaB: Schema,
): [number, number, number] {
  const total = schemaA.formationCount + schemaB.formationCount || 1;
  return [schemaA.formationCount / total, schemaB.formationCount / total, total];
}

export function mergeSchemas(
  schemaA: Schema,
  schemaB: Schema,
  mergedId = "",
): Schema {
  /**
   * Merge two similar schemas into one via weighted average.
   *
   * Weights are proportional to formation count.
   */
  const [wA, wB, total] = _computeMergeWeights(schemaA, schemaB);

  const mergedEntities = _weightedMergeDicts(
    schemaA.entitySignature,
    schemaB.entitySignature,
    wA,
    wB,
  );
  const mergedTags = _weightedMergeDicts(
    schemaA.tagSignature,
    schemaB.tagSignature,
    wA,
    wB,
  );
  const allRels = [
    ...new Set([
      ...schemaA.relationshipTypes.map((r) => r.join("|")),
      ...schemaB.relationshipTypes.map((r) => r.join("|")),
    ]),
  ].map((s) => s.split("|") as [string, string, string]);

  return makeSchema({
    schemaId: mergedId || `merged_${schemaA.schemaId}_${schemaB.schemaId}`,
    domain: schemaA.domain || schemaB.domain,
    label: generateLabel(mergedEntities, mergedTags),
    entitySignature: mergedEntities,
    relationshipTypes: allRels,
    tagSignature: mergedTags,
    consistencyThreshold: Math.min(
      schemaA.consistencyThreshold,
      schemaB.consistencyThreshold,
    ),
    formationCount: total,
    assimilationCount: schemaA.assimilationCount + schemaB.assimilationCount,
    violationCount: 0,
  });
}

function _weightedMergeDicts(
  dictA: Record<string, number>,
  dictB: Record<string, number>,
  wA: number,
  wB: number,
): Record<string, number> {
  const allKeys = new Set([...Object.keys(dictA), ...Object.keys(dictB)]);
  const result: Record<string, number> = {};
  for (const key of allKeys) {
    result[key] = (dictA[key] ?? 0) * wA + (dictB[key] ?? 0) * wB;
  }
  return result;
}

// ── Serialization ─────────────────────────────────────────────────────────

export function schemaToDict(schema: Schema): Record<string, unknown> {
  return {
    schema_id: schema.schemaId,
    domain: schema.domain,
    label: schema.label,
    entity_signature: schema.entitySignature,
    relationship_types: schema.relationshipTypes.map((r) => [...r]),
    tag_signature: schema.tagSignature,
    consistency_threshold: schema.consistencyThreshold,
    formation_count: schema.formationCount,
    assimilation_count: schema.assimilationCount,
    violation_count: schema.violationCount,
    last_updated_hours: schema.lastUpdatedHours,
  };
}

export function schemaFromDict(data: Record<string, unknown>): Schema {
  return makeSchema({
    schemaId: (data["schema_id"] as string) ?? "",
    domain: (data["domain"] as string) ?? "",
    label: (data["label"] as string) ?? "",
    entitySignature: (data["entity_signature"] as Record<string, number>) ?? {},
    relationshipTypes:
      ((data["relationship_types"] as unknown[][]) ?? []).map(
        (r) => r as [string, string, string],
      ),
    tagSignature: (data["tag_signature"] as Record<string, number>) ?? {},
    consistencyThreshold:
      (data["consistency_threshold"] as number) ?? _HIGH_MATCH_THRESHOLD,
    formationCount: (data["formation_count"] as number) ?? 0,
    assimilationCount: (data["assimilation_count"] as number) ?? 0,
    violationCount: (data["violation_count"] as number) ?? 0,
    lastUpdatedHours: (data["last_updated_hours"] as number) ?? 0,
  });
}
