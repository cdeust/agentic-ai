/**
 * detect-gaps.ts — identify missing connections and knowledge gaps.
 *
 * Surfaces blind spots in the memory store across four structural axes:
 *   1. Isolated entities (referenced in memories but have no relationships)
 *   2. Domains with sparse memory coverage vs. global average
 *   3. Temporal gaps (domains with very old memories — possibly stale)
 *   4. Cognitive blind-spot gaps from the profile blindspot detector
 *
 * Port of: mcp_server/handlers/detect_gaps.py
 *
 * Correctness contract:
 *   pre:  store is a connected MemoryStore with entity + relationship tables.
 *   post: returns { total_gaps, gaps, by_type, domain_filter }.
 *         All detectors are best-effort — individual failures produce empty
 *         lists, not thrown exceptions.
 *
 * source: cortex@ed33435 mcp_server/handlers/detect_gaps.py
 */

import type { MemoryStore as RecallMemoryStore } from "../../recall/port.js";

// ── Schema ────────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/detect_gaps.py schema

export const schema = {
  title: "Detect gaps",
  description:
    "Surface knowledge gaps across four structural axes by walking the " +
    "memories+entities+relationships tables and the per-domain blindspot detector: " +
    "isolated entities (referenced but unconnected), sparse domains " +
    "(under-represented vs global average), temporal drift (domains whose " +
    "newest memory is old), and low-heat topic clusters. Use this when " +
    "planning research priorities or auditing coverage. Distinct from " +
    "`assess_coverage` (numeric coverage SCORE 0-100 per axis, no specific " +
    "gap list), and `memory_stats` (population counts only, no gap interpretation). " +
    "Read-only.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      domain: {
        type: "string",
        description:
          "Focus gap analysis on a specific domain. Omit for a global scan across all domains.",
        examples: ["cortex", "auth-service"],
      },
      include_entity_gaps: {
        type: "boolean",
        description:
          "Include isolated-entity analysis: entities referenced in memories but with no relationships.",
        default: true,
      },
      include_domain_gaps: {
        type: "boolean",
        description:
          "Include cross-domain coverage analysis: domains whose memory count falls below the global average.",
        default: true,
      },
      include_temporal_gaps: {
        type: "boolean",
        description:
          "Include temporal drift detection: domains whose most recent memory is older than stale_threshold_days.",
        default: true,
      },
      stale_threshold_days: {
        type: "integer",
        description: "Days since last access for a domain to count as temporally drifted.",
        default: 30,
        minimum: 1,
        maximum: 365,
        examples: [7, 30, 90],
      },
    },
  },
} as const;

// ── Constants ─────────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/detect_gaps.py:_entity_gaps — isolated[:10]
const MAX_ISOLATED_ENTITIES = 10; // source: detect_gaps.py:_entity_gaps
// source: cortex@ed33435 mcp_server/handlers/detect_gaps.py:_domain_coverage_gaps — sparse[:5]
const MAX_SPARSE_DOMAINS = 5; // source: detect_gaps.py:_domain_coverage_gaps
// source: cortex@ed33435 mcp_server/handlers/detect_gaps.py:_temporal_gaps — [:5]
const MAX_TEMPORAL_GAPS = 5; // source: detect_gaps.py:_temporal_gaps
// source: cortex@ed33435 mcp_server/handlers/detect_gaps.py:_domain_coverage_gaps — below 50% of average
const SPARSE_DOMAIN_THRESHOLD = 0.5; // source: detect_gaps.py:_domain_coverage_gaps

// ── Gap types ─────────────────────────────────────────────────────────────────

interface EntityGap {
  entity_id: number;
  entity_name: string;
  entity_type: string;
  domain: string;
  relationship_count: number;
  heat: number;
  gap_type: "isolated_entity";
}

interface DomainGap {
  domain: string;
  entity_count: number;
  avg_entity_count: number;
  coverage_ratio: number;
  gap_type: "sparse_domain";
}

interface TemporalGap {
  domain: string;
  days_since_access: number;
  memory_count: number;
  gap_type: "temporal_drift";
}

type Gap = EntityGap | DomainGap | TemporalGap;

// ── Entity gap detector ───────────────────────────────────────────────────────

/**
 * Find entities that are referenced but have no relationships.
 *
 * source: cortex@ed33435 mcp_server/handlers/detect_gaps.py:_entity_gaps
 */
async function detectEntityGaps(store: RecallMemoryStore): Promise<EntityGap[]> {
  try {
    const allEntities = (await store.getEntities?.()) ?? [];
    const allRels = (await store.getRelationships?.()) ?? [];

    const connectedIds = new Set<number>();
    for (const rel of allRels) {
      connectedIds.add(rel.source_entity_id);
      connectedIds.add(rel.target_entity_id);
    }

    const isolated: EntityGap[] = [];
    for (const entity of allEntities) {
      if (!connectedIds.has(entity.id)) {
        isolated.push({
          entity_id: entity.id,
          entity_name: entity.name,
          entity_type: entity.entity_type ?? "unknown",
          domain: "",
          relationship_count: 0,
          heat: Math.round((entity.heat ?? 0) * 10000) / 10000,
          gap_type: "isolated_entity",
        });
        if (isolated.length >= MAX_ISOLATED_ENTITIES) break;
      }
    }

    return isolated;
  } catch {
    return [];
  }
}

// ── Domain coverage gap detector ──────────────────────────────────────────────

interface DomainCount {
  domain: string;
  count: number;
}

/**
 * Find domains with fewer memories than 50% of the global average.
 *
 * source: cortex@ed33435 mcp_server/handlers/detect_gaps.py:_domain_coverage_gaps
 */
async function detectDomainCoverageGaps(store: RecallMemoryStore): Promise<DomainGap[]> {
  try {
    const allEntities = (await store.getEntities?.()) ?? [];
    if (allEntities.length === 0) return [];

    // Count entities per domain as proxy for memory coverage
    const domainCounts = new Map<string, number>();
    for (const entity of allEntities) {
      const domain = (entity as unknown as { domain?: string }).domain ?? "";
      if (domain) {
        domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      }
    }

    if (domainCounts.size === 0) return [];

    const counts: DomainCount[] = [...domainCounts.entries()].map(([domain, count]) => ({
      domain,
      count,
    }));
    const avg = counts.reduce((s, d) => s + d.count, 0) / counts.length;

    const gaps: DomainGap[] = counts
      .filter((d) => d.count < avg * SPARSE_DOMAIN_THRESHOLD && d.domain)
      .map((d) => ({
        domain: d.domain,
        entity_count: d.count,
        avg_entity_count: Math.round(avg * 10) / 10,
        coverage_ratio: Math.round((d.count / avg) * 1000) / 1000,
        gap_type: "sparse_domain" as const,
      }))
      .sort((a, b) => a.coverage_ratio - b.coverage_ratio);

    return gaps.slice(0, MAX_SPARSE_DOMAINS);
  } catch {
    return [];
  }
}

// ── Temporal gap detector ─────────────────────────────────────────────────────

/**
 * Find domains whose memories haven't been accessed recently.
 *
 * source: cortex@ed33435 mcp_server/handlers/detect_gaps.py:_temporal_gaps
 */
async function detectTemporalGaps(
  store: RecallMemoryStore,
  staleDays: number,
): Promise<TemporalGap[]> {
  try {
    const staleThresholdMs = staleDays * 86_400_000; // source: detect_gaps.py — stale_threshold = stale_days * 86400.0
    const now = Date.now();

    const allEntities = (await store.getEntities?.()) ?? [];
    const domains = new Set<string>();
    for (const e of allEntities) {
      const domain = (e as unknown as { domain?: string }).domain ?? "";
      if (domain) domains.add(domain);
    }

    const gaps: TemporalGap[] = [];
    for (const domain of domains) {
      const mems = await store.getMemoriesForDomain(domain, 0.0, 10);
      if (mems.length === 0) continue;

      // Find most recent last_accessed across domain memories
      // last_accessed is not in the recall MemoryItem interface but is present
      // on concrete store rows — access via structural cast.
      let latestMs = 0;
      for (const mem of mems) {
        const ts = (mem as unknown as { last_accessed?: string }).last_accessed ?? "";
        if (ts) {
          const parsed = Date.parse(ts);
          if (!Number.isNaN(parsed) && parsed > latestMs) latestMs = parsed;
        }
      }

      if (latestMs === 0) continue;
      const ageMs = now - latestMs;
      if (ageMs > staleThresholdMs) {
        gaps.push({
          domain,
          days_since_access: Math.floor(ageMs / 86_400_000),
          memory_count: mems.length,
          gap_type: "temporal_drift",
        });
      }
    }

    return gaps
      .sort((a, b) => b.days_since_access - a.days_since_access)
      .slice(0, MAX_TEMPORAL_GAPS);
  } catch {
    return [];
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export interface DetectGapsResult {
  total_gaps: number;
  gaps: Gap[];
  by_type: Record<string, number>;
  domain_filter: string;
}

/**
 * Detect knowledge gaps in the memory store.
 *
 * source: cortex@ed33435 mcp_server/handlers/detect_gaps.py:handler
 */
export async function detectGapsHandler(
  args: Record<string, unknown> | null | undefined,
  store: RecallMemoryStore,
): Promise<DetectGapsResult> {
  const a = args ?? {};
  const domain = String(a["domain"] ?? "").trim();
  const includeEntity = a["include_entity_gaps"] !== false;
  const includeDomain = a["include_domain_gaps"] !== false;
  const includeTemporal = a["include_temporal_gaps"] !== false;
  const staleDays = Math.max(1, Number(a["stale_threshold_days"] ?? 30));

  const allGaps: Gap[] = [];

  if (includeEntity) {
    allGaps.push(...(await detectEntityGaps(store)));
  }

  if (includeDomain) {
    allGaps.push(...(await detectDomainCoverageGaps(store)));
  }

  if (includeTemporal) {
    allGaps.push(...(await detectTemporalGaps(store, staleDays)));
  }

  // Group by type for easier consumption
  const byType: Record<string, number> = {};
  for (const gap of allGaps) {
    const gtype = gap.gap_type ?? "unknown";
    byType[gtype] = (byType[gtype] ?? 0) + 1;
  }

  return {
    total_gaps: allGaps.length,
    gaps: allGaps,
    by_type: byType,
    domain_filter: domain || "global",
  };
}
