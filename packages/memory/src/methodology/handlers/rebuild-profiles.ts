/**
 * Handler for the rebuild_profiles tool — full profile rescan.
 *
 * This is the Level-2 orchestration: it decides WHICH domains to rebuild
 * from scratch by scanning all session data. Distinct from update-profiles
 * (Level-1 incremental EMA step).
 *
 * Full profile assembly (bridge finding, blind spot detection, feature
 * dictionary learning) is only triggered here, not on individual session
 * updates. This is the Bateson Level-2 invariant: the meta-level operation
 * that governs the accumulation rules.
 *
 * source: mcp_server/handlers/rebuild_profiles.py
 * source: mcp_server/core/profile_assembler.py
 */

import type { DomainProfile, ProfilesStore } from "../types.js";
import { detectBlindSpots, findBridges, generateContext } from "../methodology-engine.js";
import { buildPersonaVector } from "../cognitive-profile.js";

export interface RebuildInput {
  /**
   * Conversations grouped by project ID.
   * Each conversation record must have at minimum: toolsUsed, category, keywords.
   */
  byProject: Record<string, ConversationRecord[]>;
  existingProfiles: ProfilesStore;
  /** Optional target domain for single-domain rebuild. */
  targetDomain?: string;
  memories?: Record<string, { content?: string; crossRefs?: unknown[] }>;
}

export interface ConversationRecord {
  toolsUsed?: string[];
  tools?: string[];
  category?: string;
  categories?: string[];
  keywords?: string[];
  startedAt?: string;
  endedAt?: string;
  durationMinutes?: number;
  duration?: number;
  firstMessage?: string;
  allText?: string;
}

export interface RebuildResult {
  domains: string[];
  totalSessions: number;
  profiles: ProfilesStore;
}

// ── Project → domain mapping ──────────────────────────────────────────────────

function buildProjectDomainMap(
  existingProfiles: ProfilesStore,
  byProject: Record<string, ConversationRecord[]>,
): Record<string, string> {
  const map: Record<string, string> = {};

  // Use existing domain→project assignments
  for (const [domainId, domain] of Object.entries(existingProfiles.domains)) {
    for (const proj of domain.projects ?? []) map[proj] = domainId;
  }

  // Derive for unassigned projects
  for (const proj of Object.keys(byProject)) {
    if (proj in map) continue;
    // Simple derivation: last non-empty path segment, lowercased, dashes
    const label = proj.replace(/^-/, "").replace(/-+/g, "-").toLowerCase();
    map[proj] = label || proj;
  }

  return map;
}

// ── Per-domain profile builder ────────────────────────────────────────────────

function computeCategoryDistribution(convs: ConversationRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const conv of convs) {
    const cats = Array.isArray(conv.categories) ? conv.categories : (conv.category ? [conv.category] : []);
    for (const cat of cats) counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const total = convs.length || 1;
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round((v / total) * 100) / 100]));
}

function extractTopKeywords(convs: ConversationRecord[], limit: number = 20): string[] {
  const freq: Record<string, number> = {};
  for (const conv of convs) {
    for (const kw of conv.keywords ?? []) freq[kw] = (freq[kw] ?? 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([kw]) => kw);
}

function buildSingleDomain(
  domainId: string,
  projects: Set<string>,
  convs: ConversationRecord[],
): DomainProfile {
  const catDist = computeCategoryDistribution(convs);
  const topKeywords = extractTopKeywords(convs);

  const timestamps = convs
    .flatMap((c) => [c.startedAt, c.endedAt].filter(Boolean) as string[])
    .sort();

  const label = domainId.includes("-") && !domainId.startsWith("-")
    ? domainId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : domainId;

  const dataQuality = Math.min(convs.length / 10, 1);
  const confidence = Math.round(Math.min(convs.length / 50, 1) * dataQuality * 100) / 100;

  const toolCounts: Record<string, number> = {};
  for (const conv of convs) {
    for (const t of conv.toolsUsed ?? conv.tools ?? []) {
      toolCounts[t] = (toolCounts[t] ?? 0) + 1;
    }
  }
  const toolPreferences = Object.fromEntries(
    Object.entries(toolCounts).map(([t, c]) => [t, { ratio: c / convs.length, avgPerSession: c / convs.length }]),
  );

  const dp: DomainProfile = {
    id: domainId,
    label,
    projects: [...projects],
    categories: catDist,
    categoryDistribution: catDist,
    topKeywords,
    entryPoints: [],
    recurringPatterns: [],
    toolPreferences,
    sessionShape: {
      avgDuration: 0, avgTurns: 0, avgMessages: 0,
      burstRatio: 0, explorationRatio: 0, dominantMode: "mixed",
    },
    connectionBridges: [],
    blindSpots: [],
    metacognitive: { activeReflective: 0, sensingIntuitive: 0, sequentialGlobal: 0 },
    confidence,
    sessionCount: convs.length,
    lastUpdated: timestamps[timestamps.length - 1] ?? null,
    firstSeen: timestamps[0] ?? null,
  };

  dp.personaVector = buildPersonaVector(dp);
  return dp;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Rebuild domain profiles from scanned conversation data.
 *
 * source: mcp_server/core/profile_assembler.py build_domain_profiles
 */
export function rebuildProfiles(input: RebuildInput): RebuildResult {
  const { byProject, existingProfiles, targetDomain, memories } = input;
  const profiles = { ...existingProfiles, domains: { ...existingProfiles.domains } };

  const projectDomainMap = buildProjectDomainMap(existingProfiles, byProject);

  // Group conversations by domain
  const domainData: Record<string, { convs: ConversationRecord[]; projects: Set<string> }> = {};
  for (const [projId, convs] of Object.entries(byProject)) {
    const domainId = projectDomainMap[projId];
    if (!domainId) continue;
    if (targetDomain && domainId !== targetDomain) continue;
    if (!domainData[domainId]) domainData[domainId] = { convs: [], projects: new Set() };
    domainData[domainId].convs.push(...convs);
    domainData[domainId].projects.add(projId);
  }

  const allConvs = Object.values(byProject).flat();

  // Build each domain profile
  for (const [domainId, data] of Object.entries(domainData)) {
    if (data.convs.length === 0) continue;
    profiles.domains[domainId] = buildSingleDomain(domainId, data.projects, data.convs);
  }

  // Cross-domain enrichment
  for (const [domainId, data] of Object.entries(domainData)) {
    const dp = profiles.domains[domainId];
    if (!dp) continue;
    dp.blindSpots = detectBlindSpots(data.convs, allConvs);
  }

  const bridges = findBridges(profiles, memories ?? {});
  for (const [domainId, domainBridges] of Object.entries(bridges)) {
    if (profiles.domains[domainId]) {
      profiles.domains[domainId].connectionBridges = domainBridges;
    }
  }

  // Global style
  const allDomains = Object.values(profiles.domains);
  const totalSessions = allDomains.reduce((s, d) => s + (d.sessionCount ?? 0), 0);
  if (totalSessions > 0) {
    let arSum = 0, siSum = 0, sgSum = 0;
    for (const d of allDomains) {
      const sc = d.sessionCount ?? 0;
      arSum += (d.metacognitive?.activeReflective ?? 0) * sc;
      siSum += (d.metacognitive?.sensingIntuitive ?? 0) * sc;
      sgSum += (d.metacognitive?.sequentialGlobal ?? 0) * sc;
    }
    profiles.globalStyle = {
      activeReflective: Math.round((arSum / totalSessions) * 100) / 100,
      sensingIntuitive: Math.round((siSum / totalSessions) * 100) / 100,
      sequentialGlobal: Math.round((sgSum / totalSessions) * 100) / 100,
      confidence: Math.round(Math.min(totalSessions / 100, 1) * 100) / 100,
      sessionCount: totalSessions,
    };
  }

  profiles.updatedAt = new Date().toISOString().replace("+00:00", "Z");

  return {
    domains: Object.keys(profiles.domains),
    totalSessions: allConvs.length,
    profiles,
  };
}

// ── Freshness check ───────────────────────────────────────────────────────────

/**
 * Check if profiles are fresh enough to skip rebuild.
 * Returns a skip reason if profiles were updated less than 1h ago.
 * source: mcp_server/handlers/rebuild_profiles.py _check_skip
 */
export function checkSkip(
  profiles: ProfilesStore,
  force: boolean = false,
): { skip: boolean; reason?: string; domains?: string[]; updatedAt?: string } {
  if (force) return { skip: false };
  const updatedAt = profiles.updatedAt;
  if (!updatedAt) return { skip: false };

  try {
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    if (ageMs < 3_600_000 && Object.keys(profiles.domains).length > 0) {
      return {
        skip: true,
        reason: "Profiles updated less than 1 hour ago. Use force=true to override.",
        domains: Object.keys(profiles.domains),
        updatedAt,
      };
    }
  } catch {
    // invalid date — proceed with rebuild
  }
  return { skip: false };
}

// ── Context generation for rebuilt profiles ───────────────────────────────────

export { generateContext } from "../methodology-engine.js";
