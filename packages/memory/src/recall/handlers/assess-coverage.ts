/**
 * assess-coverage.ts — knowledge completeness evaluation.
 *
 * Evaluates how well the memory store covers the current codebase/project
 * across five axes:
 *   1. File coverage (memories scoped to the project directory)
 *   2. Domain balance (distribution across detected domains)
 *   3. Age distribution (fresh vs stale)
 *   4. Entity density (richness signal)
 *   5. Compression ratio (content loss signal)
 *
 * Returns a 0-100 coverage score and actionable recommendations.
 *
 * Port of: mcp_server/handlers/assess_coverage.py
 *
 * Correctness contract:
 *   pre:  store is a connected MemoryStore with memories + entities tables.
 *   post: returns { coverage_score ∈ [0,100], total_memories, age_distribution,
 *                   entity_density, compression, domain_balance, recommendations,
 *                   directory, domain }.
 *
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py
 */

import type { MemoryStore as RecallMemoryStore } from "../port.js";

// ── Schema ────────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/assess_coverage.py schema

export const schema = {
  title: "Assess coverage",
  description:
    "Score how well the memory store covers a project across five axes: " +
    "file coverage (which key files are remembered), domain balance (per-domain " +
    "memory distribution), age distribution (fresh vs stale), entity density " +
    "(richness signal), and compression ratio (loss signal). Combines into a " +
    "0-100 coverage score and emits actionable recommendations. Use this before " +
    "claiming Cortex `knows` a codebase, or as a milestone-completion check. " +
    "Distinct from `detect_gaps` (lists specific missing connections, no aggregate " +
    "score), `memory_stats` (raw counts, no scoring), and `narrative` (prose " +
    "summary, no numeric coverage). Read-only.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      directory: {
        type: "string",
        description:
          "Absolute project directory to assess. Defaults to current working directory.",
        examples: ["/Users/alice/code/cortex"],
      },
      domain: {
        type: "string",
        description:
          "Cognitive domain to assess when 'directory' is not supplied.",
        examples: ["cortex", "auth-service"],
      },
      stale_days: {
        type: "integer",
        description:
          "Days since last access for a memory to count as stale in the age-distribution score.",
        default: 14,
        minimum: 1,
        maximum: 365,
        examples: [7, 14, 30],
      },
    },
  },
} as const;

// ── Sub-evaluators ────────────────────────────────────────────────────────────

interface AgeDistribution {
  fresh: number;
  stale: number;
  total: number;
  freshness_ratio: number;
}

/**
 * Compute age distribution: fresh vs stale memories.
 *
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py:_age_distribution
 */
function ageDistribution(
  memories: Array<{ created_at?: string | null }>,
  staleDays: number,
): AgeDistribution {
  const now = Date.now();
  const staleMs = staleDays * 86_400_000;
  const freshMs = (staleDays / 3) * 86_400_000; // source: assess_coverage.py — fresh_cutoff = stale_days // 3

  let fresh = 0;
  let stale = 0;
  let total = 0;

  for (const mem of memories) {
    const raw = mem.created_at ?? "";
    if (!raw) continue;
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) continue;
    total += 1;
    const age = now - parsed;
    if (age <= freshMs) {
      fresh += 1;
    } else if (age > staleMs) {
      stale += 1;
    }
  }

  if (total === 0) {
    return { fresh: 0, stale: 0, total: 0, freshness_ratio: 0.0 };
  }

  return {
    fresh,
    stale,
    total,
    freshness_ratio: Math.round((fresh / total) * 1000) / 1000,
  };
}

interface EntityDensityResult {
  avg_entities_per_memory: number;
  total_entities: number;
}

/**
 * Compute average entity count per memory (richness).
 *
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py:_entity_density
 */
async function entityDensity(
  memories: unknown[],
  store: RecallMemoryStore,
): Promise<EntityDensityResult> {
  if (memories.length === 0) {
    return { avg_entities_per_memory: 0.0, total_entities: 0 };
  }
  try {
    const allEntities = (await store.getEntities?.()) ?? [];
    const total = allEntities.length;
    const avg = total / memories.length;
    return {
      avg_entities_per_memory: Math.round(avg * 100) / 100,
      total_entities: total,
    };
  } catch {
    return { avg_entities_per_memory: 0.0, total_entities: 0 };
  }
}

interface CompressionResult {
  compressed: number;
  total: number;
  ratio: number;
}

/**
 * Measure how much content has been compressed.
 *
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py:_compression_ratio
 */
function compressionRatio(
  memories: Array<{ compression_level?: number | null }>,
): CompressionResult {
  if (memories.length === 0) {
    return { compressed: 0, total: 0, ratio: 0.0 };
  }
  const compressed = memories.filter((m) => (m.compression_level ?? 0) > 0).length;
  return {
    compressed,
    total: memories.length,
    ratio: Math.round((compressed / memories.length) * 1000) / 1000,
  };
}

interface DomainBalanceResult {
  domains: Record<string, number>;
  balance_score: number;
}

/**
 * Evaluate how evenly distributed memories are across domains.
 *
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py:_domain_balance
 */
function domainBalance(
  memories: Array<{ domain?: string | null }>,
): DomainBalanceResult {
  const domainCounts: Record<string, number> = {};
  for (const mem of memories) {
    const d = mem.domain || "unassigned";
    domainCounts[d] = (domainCounts[d] ?? 0) + 1;
  }

  if (Object.keys(domainCounts).length === 0) {
    return { domains: {}, balance_score: 0.0 };
  }

  const counts = Object.values(domainCounts);
  const avg = counts.reduce((s, c) => s + c, 0) / counts.length;

  let balanceScore = 0.0;
  if (avg > 0) {
    const variance = counts.reduce((s, c) => s + (c - avg) ** 2, 0) / counts.length;
    const cv = Math.sqrt(variance) / avg;
    balanceScore = Math.max(0.0, 1.0 - cv);
  }

  return {
    domains: domainCounts,
    balance_score: Math.round(balanceScore * 1000) / 1000,
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Compute 0-100 coverage score from sub-signals.
 *
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py:_compute_coverage_score
 */
function computeCoverageScore(
  totalMemories: number,
  freshnessRatio: number,
  entityDensityAvg: number,
  compressionRatioVal: number,
  balanceScore: number,
): number {
  // source: assess_coverage.py:_compute_coverage_score — weights
  const quantityScore = Math.min(1.0, totalMemories / 100); // source: assess_coverage.py:128
  const entityScore = Math.min(1.0, entityDensityAvg / 3.0);   // source: assess_coverage.py:129
  const compressionPenalty = compressionRatioVal * 0.3;         // source: assess_coverage.py:130

  const raw =
    quantityScore * 0.30 +
    freshnessRatio * 0.25 +
    entityScore * 0.20 +
    balanceScore * 0.15 -
    compressionPenalty +
    0.10; // source: assess_coverage.py:137 — base +0.10

  return Math.max(0, Math.min(100, Math.floor(raw * 100)));
}

// ── Recommendations ───────────────────────────────────────────────────────────

/**
 * Generate actionable recommendations based on the coverage signals.
 *
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py:_recommendations
 */
function buildRecommendations(
  total: number,
  stale: number,
  entityDensityAvg: number,
  compressed: number,
  balanceScore: number,
): string[] {
  const recs: string[] = [];

  if (total < 20) {
    recs.push("Run `seed_project` to bootstrap memory from the codebase.");
  }
  if (stale > total * 0.4) {
    recs.push("Run `validate_memory` — more than 40% of memories are stale.");
  }
  if (entityDensityAvg < 0.5) {
    recs.push("Low entity density. Use `remember` with more specific content.");
  }
  if (compressed > total * 0.5) {
    recs.push("High compression ratio — consider re-seeding with `seed_project`.");
  }
  if (balanceScore < 0.4) {
    recs.push(
      "Unbalanced domain coverage. Use `remember` with explicit `domain` tags.",
    );
  }
  if (recs.length === 0) {
    recs.push(
      "Coverage looks healthy. Run `consolidate` periodically to maintain quality.",
    );
  }

  return recs;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export interface AssessCoverageResult {
  coverage_score: number;
  total_memories: number;
  age_distribution?: AgeDistribution;
  entity_density?: EntityDensityResult;
  compression?: CompressionResult;
  domain_balance?: DomainBalanceResult;
  recommendations: string[];
  directory?: string;
  domain?: string;
}

/**
 * Assess knowledge coverage completeness.
 *
 * source: cortex@ed33435 mcp_server/handlers/assess_coverage.py:handler
 */
export async function assessCoverageHandler(
  args: Record<string, unknown> | null | undefined,
  store: RecallMemoryStore,
): Promise<AssessCoverageResult> {
  const a = args ?? {};
  const directory = String(a["directory"] ?? "").trim();
  const domain = String(a["domain"] ?? "").trim();
  const staleDays = Math.max(1, Number(a["stale_days"] ?? 14));

  // Fetch memories scoped by directory, domain, or global
  let memories: Awaited<ReturnType<typeof store.getHotMemories>> = [];
  try {
    if (directory) {
      memories = await store.getMemoriesForDirectory(directory, 0.0);
    } else if (domain) {
      memories = await store.getMemoriesForDomain(domain, 0.0, 1000);
    } else {
      memories = await store.getHotMemories(0.0, 1000);
    }
  } catch {
    memories = [];
  }

  if (memories.length === 0) {
    return {
      coverage_score: 0,
      total_memories: 0,
      recommendations: ["No memories found. Run `seed_project` to bootstrap."],
      directory: directory || undefined,
      domain: domain || undefined,
    };
  }

  const ageDist = ageDistribution(memories, staleDays);
  const densityResult = await entityDensity(memories, store);
  const compressResult = compressionRatio(
    memories.map((m) => ({ compression_level: (m as unknown as Record<string, unknown>)["compression_level"] as number | null })),
  );
  const balanceResult = domainBalance(
    memories.map((m) => ({ domain: m.domain ?? null })),
  );

  const score = computeCoverageScore(
    memories.length,
    ageDist.freshness_ratio,
    densityResult.avg_entities_per_memory,
    compressResult.ratio,
    balanceResult.balance_score,
  );

  const recs = buildRecommendations(
    memories.length,
    ageDist.stale,
    densityResult.avg_entities_per_memory,
    compressResult.compressed,
    balanceResult.balance_score,
  );

  return {
    coverage_score: score,
    total_memories: memories.length,
    age_distribution: ageDist,
    entity_density: densityResult,
    compression: compressResult,
    domain_balance: balanceResult,
    recommendations: recs,
    directory: directory || undefined,
    domain: domain || undefined,
  };
}
