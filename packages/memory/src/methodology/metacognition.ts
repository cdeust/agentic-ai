/**
 * Metacognition — gap detection for knowledge graphs.
 *
 * Implements 5 gap types:
 *   - isolated_entity: entities with 0 or 1 connection
 *   - stale_region: groups of stale (low-heat) memories
 *   - low_confidence: memories below confidence threshold
 *   - missing_connection: entity pairs co-occurring with no graph edge
 *   - unresolved_error: error entities with no resolution
 *
 * Coverage, chunking, and context management live in metacognition-analysis.ts.
 * This module provides gap detection only.
 *
 * Pure business logic — no I/O.
 *
 * source: cortex@ed33435 mcp_server/core/metacognition.py
 */

// ── Gap types ─────────────────────────────────────────────────────────────────

export interface KnowledgeGap {
  type:
    | "isolated_entity"
    | "stale_region"
    | "low_confidence"
    | "missing_connection"
    | "unresolved_error";
  description: string;
  severity: number;
  entities: string[];
  suggestion: string;
}

// ── Gap detectors ─────────────────────────────────────────────────────────────

/**
 * Find entities with zero or one connection.
 *
 * precondition: entities have "id" and "name" fields
 * postcondition: severity = 0.6 for degree 0, 0.4 for degree 1
 *
 * source: cortex@ed33435 mcp_server/core/metacognition.py:21-49
 */
export function detectIsolatedEntities(
  entities: Array<{ id: number; name: string }>,
  relationshipCounts: Map<number, number>,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  for (const ent of entities) {
    const degree = relationshipCounts.get(ent.id) ?? 0;
    if (degree <= 1) {
      gaps.push({
        type: "isolated_entity",
        description: `Entity '${ent.name}' has only ${degree} connection(s)`,
        severity: degree === 0 ? 0.6 : 0.4,
        entities: [ent.name],
        suggestion: `Add context or relationships for '${ent.name}'`,
      });
    }
  }
  return gaps;
}

/**
 * Find groups of stale (low-heat) memories.
 *
 * precondition: memories have optional "heat" and "domain" fields
 * postcondition: severity capped at 0.9; only domains with >= minStale mems reported
 *
 * source: cortex@ed33435 mcp_server/core/metacognition.py:52-80
 */
export function detectStaleRegions(
  memories: Array<{ heat?: number; domain?: string }>,
  heatThreshold = 0.3,
  minStale = 2,
): KnowledgeGap[] {
  const staleByDomain = new Map<string, number>();

  for (const mem of memories) {
    if ((mem.heat ?? 1.0) < heatThreshold) {
      const domain = mem.domain ?? "unknown";
      staleByDomain.set(domain, (staleByDomain.get(domain) ?? 0) + 1);
    }
  }

  const gaps: KnowledgeGap[] = [];
  for (const [domain, count] of staleByDomain) {
    if (count >= minStale) {
      const severity = Math.round(Math.min(0.9, 0.3 + count * 0.1) * 100) / 100;
      gaps.push({
        type: "stale_region",
        description: `${count} stale memories in domain '${domain}'`,
        severity,
        entities: [],
        suggestion: `Review or refresh memories in '${domain}'`,
      });
    }
  }
  return gaps;
}

/**
 * Find memories with low confidence scores.
 *
 * precondition: memories have optional "confidence" field
 * postcondition: returns [] if no low-confidence memories; severity capped at 0.8
 *
 * source: cortex@ed33435 mcp_server/core/metacognition.py:83-101
 */
export function detectLowConfidence(
  memories: Array<{ confidence?: number }>,
  confidenceThreshold = 0.5,
): KnowledgeGap[] {
  const lowConf = memories.filter(
    (m) => (m.confidence ?? 1.0) < confidenceThreshold,
  );
  if (lowConf.length === 0) return [];

  const severity = Math.round(Math.min(0.8, 0.3 + lowConf.length * 0.1) * 100) / 100;
  return [
    {
      type: "low_confidence",
      description: `${lowConf.length} memories have confidence < ${confidenceThreshold}`,
      severity,
      entities: [],
      suggestion: "Verify or strengthen low-confidence memories",
    },
  ];
}

/**
 * Find entity pairs that co-occur in memories but have no graph edge.
 *
 * precondition: coOccurringPairs and existingRelationships contain canonical name pairs
 * postcondition: severity capped at 0.7; entity_names includes first 5 unique entities
 *
 * source: cortex@ed33435 mcp_server/core/metacognition.py:104-135
 */
export function detectMissingConnections(
  coOccurringPairs: Array<[string, string]>,
  existingRelationships: Set<string>,
): KnowledgeGap[] {
  const missing: Array<[string, string]> = [];
  for (const [a, b] of coOccurringPairs) {
    const key1 = `${a}|||${b}`;
    const key2 = `${b}|||${a}`;
    if (!existingRelationships.has(key1) && !existingRelationships.has(key2)) {
      missing.push([a, b]);
    }
  }
  if (missing.length === 0) return [];

  const severity = Math.round(Math.min(0.7, 0.2 + missing.length * 0.1) * 100) / 100;
  const entityNames = [
    ...new Set(missing.slice(0, 5).flatMap(([a, b]) => [a, b])),
  ];

  return [
    {
      type: "missing_connection",
      description: `${missing.length} entity pairs co-occur but have no relationship`,
      severity,
      entities: entityNames,
      suggestion: "Consider linking frequently co-occurring entities",
    },
  ];
}

/**
 * Find error entities with no 'resolved_by' relationship.
 *
 * precondition: errorEntities are entities of type "error" or "exception"
 * postcondition: severity = 0.5 fixed; reports up to 5 entity names
 *
 * source: cortex@ed33435 mcp_server/core/metacognition.py:138-163
 */
export function detectUnresolvedErrors(
  errorEntities: Array<{ id: number; name: string }>,
  resolvedEntityIds: Set<number>,
): KnowledgeGap[] {
  const unresolved = errorEntities.filter((e) => !resolvedEntityIds.has(e.id));
  if (unresolved.length === 0) return [];

  return [
    {
      type: "unresolved_error",
      description: `${unresolved.length} error(s) recorded without resolution`,
      severity: 0.5,
      entities: unresolved.slice(0, 5).map((e) => e.name),
      suggestion: "Record fix/resolution for outstanding errors",
    },
  ];
}

// ── Combined detection ────────────────────────────────────────────────────────

/**
 * Run all gap detectors and return combined results sorted by severity (desc).
 *
 * precondition: all inputs are coherent (relationship_counts matches entities)
 * postcondition: result sorted descending by severity; may be empty
 *
 * source: cortex@ed33435 mcp_server/core/metacognition.py:166-185
 */
export function detectAllGaps(
  entities: Array<{ id: number; name: string }>,
  relationshipCounts: Map<number, number>,
  memories: Array<{ heat?: number; domain?: string; confidence?: number }>,
  coOccurringPairs: Array<[string, string]>,
  existingRelationships: Set<string>,
  errorEntities: Array<{ id: number; name: string }>,
  resolvedEntityIds: Set<number>,
  heatThreshold = 0.3,
  confidenceThreshold = 0.5,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [
    ...detectIsolatedEntities(entities, relationshipCounts),
    ...detectStaleRegions(memories, heatThreshold),
    ...detectLowConfidence(memories, confidenceThreshold),
    ...detectMissingConnections(coOccurringPairs, existingRelationships),
    ...detectUnresolvedErrors(errorEntities, resolvedEntityIds),
  ];

  gaps.sort((a, b) => b.severity - a.severity);
  return gaps;
}
