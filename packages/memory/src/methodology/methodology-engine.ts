/**
 * Methodology engine — Level-2 orchestration layer.
 *
 * Governs HOW profile updates accumulate and how sessions are routed to
 * domains. This is the meta-level relative to cognitive-profile.ts:
 *   - cognitive-profile.ts: Level-1 (what a profile update IS)
 *   - methodology-engine.ts: Level-2 (when and how updates happen)
 *
 * Bateson constraint: collapsing these levels produces a system that runs
 * but loses the source signal — an EMA-updated profile without methodology
 * engine routing is a naked numeric update with no semantic context.
 *
 * source: mcp_server/core/profile_assembler.py
 * source: mcp_server/core/bridge_finder.py
 * source: mcp_server/core/blindspot_detector.py
 * source: mcp_server/core/behavioral_crosscoder.py
 */

import type {
  BlindSpot,
  ConnectionBridge,
  DomainProfile,
  PersistentFeature,
  ProfilesStore,
} from "./types.js";

// ── Blind spot detection ──────────────────────────────────────────────────────

/**
 * All known memory/tool categories.
 * source: mcp_server/core/blindspot_detector.py ALL_CATEGORIES (via CATEGORY_RULES)
 */
const ALL_CATEGORIES = [
  "bug-fix", "feature", "refactor", "testing", "docs",
  "research", "architecture", "debug", "config", "deployment",
] as const;

const COMMON_TOOLS = ["Read", "Edit", "Write", "Grep", "Glob", "Bash", "Agent", "WebSearch", "WebFetch"] as const;

/** source: mcp_server/core/blindspot_detector.py TOOL_CATEGORY_RELEVANCE */
const TOOL_CATEGORY_RELEVANCE: Record<string, string[]> = {
  Read: ["bug-fix", "research", "debug", "refactor", "docs"],
  Edit: ["bug-fix", "feature", "refactor", "config"],
  Write: ["feature", "docs", "config"],
  Grep: ["bug-fix", "debug", "refactor", "research"],
  Glob: ["refactor", "architecture", "config"],
  Bash: ["testing", "deployment", "debug", "config"],
  Agent: ["research", "architecture"],
  WebSearch: ["research", "architecture"],
  WebFetch: ["research", "docs"],
};

interface ConvRecord {
  toolsUsed?: string[];
  tools?: string[];
  category?: string;
  categories?: string[];
  durationMinutes?: number;
  duration?: number;
}

function getConvCategories(conv: ConvRecord): Set<string> {
  if (Array.isArray(conv.categories) && conv.categories.length > 0) {
    return new Set(conv.categories);
  }
  if (typeof conv.category === "string" && conv.category) {
    return new Set([conv.category]);
  }
  return new Set();
}

function getConvTools(conv: ConvRecord): string[] {
  return conv.toolsUsed ?? conv.tools ?? [];
}

function detectCategoryBlindSpots(convs: ConvRecord[]): BlindSpot[] {
  const total = convs.length;
  if (total === 0) return [];
  const spots: BlindSpot[] = [];
  for (const category of ALL_CATEGORIES) {
    const sessionsWith = convs.filter((c) => getConvCategories(c).has(category)).length;
    const ratio = sessionsWith / total;
    if (ratio < 0.05) {
      spots.push({
        type: "category",
        value: category,
        severity: ratio < 0.01 ? "high" : "medium",
        description: `Category "${category}" appears in only ${(ratio * 100).toFixed(1)}% of sessions (threshold: 5%).`,
        suggestion: `Consider intentionally including ${category} work in this domain to broaden coverage.`,
      });
    }
  }
  return spots;
}

function detectToolBlindSpots(convs: ConvRecord[], topCategories: string[]): BlindSpot[] {
  const total = convs.length;
  if (total === 0) return [];
  const topCatSet = new Set(topCategories);
  const spots: BlindSpot[] = [];

  for (const tool of COMMON_TOOLS) {
    const sessionsUsing = convs.filter((c) => getConvTools(c).includes(tool)).length;
    const ratio = sessionsUsing / total;
    if (ratio >= 0.05) continue;
    const relevantCats = TOOL_CATEGORY_RELEVANCE[tool] ?? [];
    const isRelevant = relevantCats.some((cat) => topCatSet.has(cat));
    if (!isRelevant) continue;
    const overlap = relevantCats.filter((cat) => topCatSet.has(cat));
    spots.push({
      type: "tool",
      value: tool,
      severity: overlap.length >= 2 || ratio < 0.01 ? "high" : "medium",
      description: `Tool "${tool}" used in only ${(ratio * 100).toFixed(1)}% of sessions, yet is relevant to domain categories: ${overlap.join(", ")}.`,
      suggestion: `Incorporate "${tool}" more regularly in ${topCategories.join("/")} tasks.`,
    });
  }
  return spots;
}

function countDurationBuckets(convs: ConvRecord[]): [number, number] {
  let short = 0, long = 0;
  for (const c of convs) {
    const dur = c.durationMinutes ?? c.duration ?? 0;
    if (dur > 0 && dur < 10) short++;
    if (dur > 30) long++;
  }
  return [short, long];
}

function detectPatternBlindSpots(
  domainConvs: ConvRecord[],
  allConvs: ConvRecord[],
): BlindSpot[] {
  const total = domainConvs.length;
  if (total === 0) return [];

  const explorationCats = new Set(["research", "architecture"]);
  const domainExplorationCount = domainConvs.filter(
    (c) => [...getConvCategories(c)].some((cat) => explorationCats.has(cat)),
  ).length;
  const globalTotal = allConvs.length || 1;
  const globalExplorationCount = allConvs.filter(
    (c) => [...getConvCategories(c)].some((cat) => explorationCats.has(cat)),
  ).length;
  const globalExpRatio = globalExplorationCount / globalTotal;
  const domainExpRatio = domainExplorationCount / total;

  const spots: BlindSpot[] = [];

  if (domainExpRatio === 0 && globalExpRatio >= 0.4) {
    spots.push({
      type: "pattern", value: "exploration", severity: "high",
      description: `This domain has zero exploration sessions (research/architecture), while globally ${(globalExpRatio * 100).toFixed(0)}% of sessions are exploratory.`,
      suggestion: "Schedule dedicated research or architecture sessions to avoid tunnel vision.",
    });
  } else if (domainExpRatio > 0 && domainExpRatio < globalExpRatio * 0.25 && globalExpRatio >= 0.2) {
    spots.push({
      type: "pattern", value: "exploration", severity: "medium",
      description: `Exploration ratio (${(domainExpRatio * 100).toFixed(1)}%) is significantly below global average (${(globalExpRatio * 100).toFixed(1)}%).`,
      suggestion: "Increase research/architecture sessions to keep up with global breadth.",
    });
  }

  const [domainShort, domainLong] = countDurationBuckets(domainConvs);
  const [globalShort, globalLong] = countDurationBuckets(allConvs);
  const globalShortRatio = globalShort / globalTotal;
  const globalLongRatio = globalLong / globalTotal;

  if (domainLong / total === 0 && globalLongRatio >= 0.3) {
    spots.push({
      type: "pattern", value: "deep-work", severity: "medium",
      description: `No deep-work sessions (>30 min) found in this domain, while globally ${(globalLongRatio * 100).toFixed(0)}% of sessions are deep.`,
      suggestion: "Allocate longer focused sessions for complex problems in this domain.",
    });
  }
  if (domainShort / total === 0 && globalShortRatio >= 0.3) {
    spots.push({
      type: "pattern", value: "quick-iteration", severity: "low",
      description: `No short iteration sessions (<10 min) found in this domain, while globally ${(globalShortRatio * 100).toFixed(0)}% of sessions are short.`,
      suggestion: "Consider quick experiment or fix sessions to build faster feedback loops.",
    });
  }

  return spots;
}

export function detectBlindSpots(
  domainConvs: ConvRecord[],
  allConvs: ConvRecord[],
): BlindSpot[] {
  const counts: Record<string, number> = {};
  for (const conv of domainConvs) {
    for (const cat of getConvCategories(conv)) {
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }
  const topCategories = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat);

  return [
    ...detectCategoryBlindSpots(domainConvs),
    ...detectToolBlindSpots(domainConvs, topCategories),
    ...detectPatternBlindSpots(domainConvs, allConvs),
  ];
}

// ── Cross-domain bridge finding ───────────────────────────────────────────────

const ANALOGY_RE =
  /(like|similar to|analogous to|reminds me of|just as|the same way)\s+(?:a\s+)?(.{5,40})/gi;

function extractAnalogies(
  text: string,
  nodeId: string,
): Array<{ nodeId: string; pattern: string; sourceContext: string; targetConcept: string }> {
  const results: ReturnType<typeof extractAnalogies> = [];
  let match: RegExpExecArray | null;
  ANALOGY_RE.lastIndex = 0;
  while ((match = ANALOGY_RE.exec(text)) !== null) {
    const start = Math.max(0, match.index - 60);
    results.push({
      nodeId,
      pattern: (match[1] ?? "").toLowerCase(),
      sourceContext: text.slice(start, match.index).trim().slice(-60),
      targetConcept: (match[2] ?? "").trim(),
    });
  }
  return results;
}

/**
 * Find cross-domain bridges from structural edges and analogical text.
 * source: mcp_server/core/bridge_finder.py find_bridges
 */
export function findBridges(
  profiles: ProfilesStore | null,
  memories: Record<string, { content?: string; crossRefs?: unknown[] }> | null,
): Record<string, ConnectionBridge[]> {
  const result: Record<string, ConnectionBridge[]> = {};
  if (!profiles?.domains) return result;

  // Build project->domain map
  const projectDomainMap: Record<string, string> = {};
  for (const [domainId, domain] of Object.entries(profiles.domains)) {
    for (const proj of domain.projects ?? []) {
      projectDomainMap[proj] = domainId;
    }
  }

  // Analogical bridges from memories
  for (const [id, mem] of Object.entries(memories ?? {})) {
    const domainId = (mem as Record<string, unknown>)["domain"] as string | undefined;
    if (!domainId) continue;
    const text = mem.content ?? "";
    const analogies = extractAnalogies(text, id);
    if (analogies.length === 0) continue;

    const byPattern: Record<string, typeof analogies> = {};
    for (const a of analogies) byPattern[a.pattern] = [...(byPattern[a.pattern] ?? []), a];

    for (const [pattern, items] of Object.entries(byPattern)) {
      if (!result[domainId]) result[domainId] = [];
      result[domainId].push({
        toDomain: "text-analogy",
        pattern,
        weight: items.length,
        edgeCount: items.length,
        examples: items.slice(0, 5).map((i) => ({
          nodeId: i.nodeId,
          sourceContext: i.sourceContext,
          targetConcept: i.targetConcept,
        })),
      });
    }
  }

  return result;
}

// ── Persistent feature detection ──────────────────────────────────────────────

/**
 * Detect behavioral features active in >50% of domains (persistent).
 * source: mcp_server/core/behavioral_crosscoder.py detect_persistent_features
 */
export function detectPersistentFeatures(
  profiles: Record<string, DomainProfile> | null,
  dictionary: { features: Array<{ label: string }> } | null,
): PersistentFeature[] {
  if (!dictionary?.features) return [];
  const domainIds = Object.keys(profiles ?? {});
  if (domainIds.length < 2) return [];

  const featureActivations: Record<string, Record<string, { sum: number; count: number }>> = {};
  for (const f of dictionary.features) {
    featureActivations[f.label] = {};
  }

  // Populate from profile featureActivations
  for (const [domainId, profile] of Object.entries(profiles ?? {})) {
    const fa = profile.featureActivations ?? {};
    for (const [label, weight] of Object.entries(fa)) {
      if (!(label in featureActivations)) continue;
      (featureActivations[label] as Record<string, { sum: number; count: number }>)[domainId] = {
        sum: Math.abs(weight),
        count: 1,
      };
    }
  }

  const ACTIVATION_THRESHOLD = 0.1;
  const PERSISTENCE_THRESHOLD = 0.5;

  const results: PersistentFeature[] = [];
  for (const [label, domainMap] of Object.entries(featureActivations)) {
    const activeDomains: string[] = [];
    const activationValues: number[] = [];

    for (const [domainId, stats] of Object.entries(domainMap)) {
      const meanActivation = stats.count > 0 ? stats.sum / stats.count : 0;
      if (meanActivation >= ACTIVATION_THRESHOLD) {
        activeDomains.push(domainId);
        activationValues.push(meanActivation);
      }
    }

    const persistence = activeDomains.length / domainIds.length;
    if (persistence < PERSISTENCE_THRESHOLD) continue;

    let consistency = 0;
    if (activationValues.length > 0) {
      const mean = activationValues.reduce((s, v) => s + v, 0) / activationValues.length;
      const variance = activationValues.reduce((s, v) => s + (v - mean) ** 2, 0) / activationValues.length;
      consistency = Math.sqrt(variance);
    }

    results.push({
      label,
      persistence: Math.round(persistence * 100) / 100,
      consistency: Math.round(consistency * 1000) / 1000,
      domains: activeDomains,
    });
  }

  return results.sort((a, b) => b.persistence - a.persistence || a.consistency - b.consistency);
}

/**
 * Compare feature activation profiles of two domains.
 * source: mcp_server/core/behavioral_crosscoder.py compare_feature_profiles
 */
export function compareFeatureProfiles(
  activationsA: Record<string, number> | null,
  activationsB: Record<string, number> | null,
): { shared: string[]; uniqueToA: string[]; uniqueToB: string[] } {
  const threshold = 0.1;
  const activeA = new Set(Object.entries(activationsA ?? {})
    .filter(([, w]) => Math.abs(w) >= threshold).map(([l]) => l));
  const activeB = new Set(Object.entries(activationsB ?? {})
    .filter(([, w]) => Math.abs(w) >= threshold).map(([l]) => l));

  return {
    shared: [...activeA].filter((l) => activeB.has(l)),
    uniqueToA: [...activeA].filter((l) => !activeB.has(l)),
    uniqueToB: [...activeB].filter((l) => !activeA.has(l)),
  };
}

// ── Context generation ────────────────────────────────────────────────────────

/**
 * Generate a prose context summary from a domain profile.
 * source: mcp_server/core/context_generator.py generate_context
 */
export function generateContext(domainId: string, profile: DomainProfile): string {
  const mc = profile.metacognitive;
  const lines: string[] = [`## Cognitive Profile: ${profile.label || domainId}`];

  if (profile.sessionCount > 0) {
    lines.push(`Based on ${profile.sessionCount} session(s) across domain "${domainId}".`);
  }

  if (mc) {
    const style: string[] = [];
    if (mc.activeReflective > 0.3) style.push("active learner");
    else if (mc.activeReflective < -0.3) style.push("reflective learner");
    if (mc.sensingIntuitive > 0.3) style.push("sensing-oriented");
    else if (mc.sensingIntuitive < -0.3) style.push("intuition-oriented");
    if (mc.sequentialGlobal > 0.3) style.push("sequential thinker");
    else if (mc.sequentialGlobal < -0.3) style.push("global thinker");
    if (style.length > 0) lines.push(`Cognitive style: ${style.join(", ")}.`);
  }

  if (profile.recurringPatterns.length > 0) {
    lines.push(`Recurring patterns: ${profile.recurringPatterns.slice(0, 3).join("; ")}.`);
  }

  if (profile.blindSpots.length > 0) {
    const highSpots = profile.blindSpots.filter((b) => b.severity === "high");
    if (highSpots.length > 0) {
      lines.push(`Blind spots: ${highSpots.slice(0, 2).map((b) => b.value).join(", ")}.`);
    }
  }

  if (profile.connectionBridges.length > 0) {
    lines.push(`Cross-domain bridges: ${profile.connectionBridges.slice(0, 2).map((b) => b.toDomain).join(", ")}.`);
  }

  return lines.join("\n");
}
