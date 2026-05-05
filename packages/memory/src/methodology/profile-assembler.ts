/**
 * Profile assembler — build domain profiles from scan data.
 *
 * Orchestrates pattern extraction, style classification, bridge finding,
 * blind spot detection, persona vectors, and cross-coding.
 *
 * source: cortex@ed33435 mcp_server/core/profile_assembler.py
 */

import type { DomainProfile, ProfilesStore } from "./types.js";
import { classifyStyle } from "./style-classifier.js";
import { buildPersonaVector } from "./cognitive-profile.js";
import { detectBlindSpotsFull } from "./blindspot-detector.js";
import { findBridges } from "./methodology-engine.js";

// ── Internal types ────────────────────────────────────────────────────────────

interface ConversationRaw {
  allText?: string;
  firstMessage?: string;
  keywords?: string[] | Set<string>;
  startedAt?: string;
  endedAt?: string;
  toolsUsed?: unknown[];
  tools?: unknown[];
  toolCalls?: unknown[];
  durationMinutes?: number;
  duration?: number;
  summary?: string;
  body?: string;
  title?: string;
  filesTouched?: unknown[];
  files?: unknown[];
  categories?: string[];
  category?: string;
}

interface DomainData {
  conversations: ConversationRaw[];
  projects: Set<string>;
}

// ── Project-domain mapping ────────────────────────────────────────────────────

function cwdToLabel(proj: string): string {
  // Strip leading dash, title-case segments
  return proj.replace(/^-/, "").split("-").map(
    (s) => s.charAt(0).toUpperCase() + s.slice(1),
  ).join(" ");
}

function buildProjectDomainMap(
  profiles: ProfilesStore,
  byProject: Record<string, ConversationRaw[]>,
): Record<string, string> {
  const projectDomains: Record<string, string> = {};

  for (const [domainId, domain] of Object.entries(profiles.domains ?? {})) {
    for (const proj of domain.projects ?? []) {
      projectDomains[proj] = domainId;
    }
  }

  for (const proj of Object.keys(byProject)) {
    if (proj in projectDomains) continue;
    // Derive domain ID from project label
    const label = proj.replace(/^-/, "");
    projectDomains[proj] = label || proj;
  }

  return projectDomains;
}

// ── Conversation grouping ─────────────────────────────────────────────────────

function groupConversationsByDomain(
  byProject: Record<string, ConversationRaw[]>,
  projectDomains: Record<string, string>,
  targetDomain: string | null,
): Record<string, DomainData> {
  const domainConversations: Record<string, DomainData> = {};

  for (const [proj, convs] of Object.entries(byProject)) {
    const domainId = projectDomains[proj];
    if (!domainId) continue;
    if (targetDomain && domainId !== targetDomain) continue;

    if (!(domainId in domainConversations)) {
      domainConversations[domainId] = { conversations: [], projects: new Set() };
    }
    domainConversations[domainId]!.conversations.push(...convs);
    domainConversations[domainId]!.projects.add(proj);
  }

  return domainConversations;
}

// ── Category distribution ─────────────────────────────────────────────────────

const CATEGORY_RULES: Array<[string, string[]]> = [
  ["bug-fix", ["fix", "bug", "error", "crash", "regression"]],
  ["feature", ["feature", "implement", "add", "new", "build"]],
  ["refactor", ["refactor", "cleanup", "restructure", "move", "rename"]],
  ["testing", ["test", "spec", "assert", "coverage", "jest", "vitest", "pytest"]],
  ["docs", ["docs", "documentation", "readme", "comment"]],
  ["research", ["research", "explore", "investigate", "analyze", "study"]],
  ["architecture", ["architecture", "design", "pattern", "system", "service"]],
  ["debug", ["debug", "trace", "log", "inspect", "diagnose"]],
  ["config", ["config", "configuration", "env", "setting"]],
  ["deployment", ["deploy", "release", "ship", "publish", "ci", "cd"]],
];

function categorizeText(text: string): string[] {
  const lower = text.toLowerCase();
  return CATEGORY_RULES
    .filter(([, kws]) => kws.some((kw) => lower.includes(kw)))
    .map(([cat]) => cat);
}

function computeCategoryDistribution(
  convs: ConversationRaw[],
): Record<string, number> {
  const categories: Record<string, number> = {};
  let total = 0;

  for (const conv of convs) {
    const text = conv.allText ?? conv.firstMessage ?? "";
    if (!text) continue;
    const cats = categorizeText(text);
    for (const cat of cats) {
      categories[cat] = (categories[cat] ?? 0) + 1;
    }
    if (cats.length === 0) {
      categories["general"] = (categories["general"] ?? 0) + 1;
    }
    total++;
  }

  if (total > 0) {
    for (const cat of Object.keys(categories)) {
      categories[cat] = Math.round(((categories[cat]! / total) * 100)) / 100;
    }
  }

  return categories;
}

// ── Keyword extraction ────────────────────────────────────────────────────────

function extractTopKeywords(convs: ConversationRaw[], limit = 20): string[] {
  const freq: Record<string, number> = {};

  for (const conv of convs) {
    const kws = conv.keywords;
    if (!kws) continue;
    const arr = kws instanceof Set ? [...kws] : Array.isArray(kws) ? kws : [];
    for (const kw of arr as string[]) {
      freq[kw] = (freq[kw] ?? 0) + 1;
    }
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([kw]) => kw);
}

// ── Timestamp computation ─────────────────────────────────────────────────────

function computeTimestamps(
  convs: ConversationRaw[],
): [string | null, string | null] {
  const timestamps = convs
    .flatMap((c) => [c.startedAt, c.endedAt])
    .filter(Boolean) as string[];
  timestamps.sort();
  return [timestamps[0] ?? null, timestamps[timestamps.length - 1] ?? null];
}

// ── Pattern extraction (entry points, recurring patterns, tool prefs, session shape) ──

interface Patterns {
  entryPoints: string[];
  recurringPatterns: string[];
  toolPreferences: Record<string, { ratio: number; avgPerSession: number }>;
  sessionShape: {
    avgDuration: number;
    avgTurns: number;
    avgMessages: number;
    burstRatio: number;
    explorationRatio: number;
    dominantMode: "burst" | "exploration" | "mixed";
  };
}

/** Minimal pattern extraction from conversation array. */
function extractPatterns(convs: ConversationRaw[]): Patterns {
  const entryPointSet = new Set<string>();
  const recurringSet: Record<string, number> = {};
  const toolCounts: Record<string, number> = {};
  let totalSessions = convs.length || 1;

  let durSum = 0;
  let burstCount = 0;
  let explorationCount = 0;

  for (const conv of convs) {
    const dur = conv.durationMinutes ?? conv.duration ?? 0;
    durSum += dur;
    if (dur > 0 && dur < 10) burstCount++;
    if (dur > 20) explorationCount++;

    const text = conv.allText ?? conv.firstMessage ?? "";
    if (text) {
      const cats = categorizeText(text);
      for (const cat of cats) {
        recurringSet[cat] = (recurringSet[cat] ?? 0) + 1;
        entryPointSet.add(cat);
      }
    }

    const tools = (conv.toolsUsed ?? conv.tools ?? conv.toolCalls ?? []) as unknown[];
    for (const t of tools) {
      const name =
        typeof t === "string"
          ? t
          : ((t as Record<string, unknown>)?.["name"] as string | undefined) ?? "";
      if (name) toolCounts[name] = (toolCounts[name] ?? 0) + 1;
    }
  }

  const toolPreferences: Patterns["toolPreferences"] = {};
  for (const [tool, count] of Object.entries(toolCounts)) {
    toolPreferences[tool] = {
      ratio: Math.round((count / totalSessions) * 100) / 100,
      avgPerSession: Math.round((count / totalSessions) * 10) / 10,
    };
  }

  const avgDuration = durSum / totalSessions;
  const burstRatio = burstCount / totalSessions;
  const explorationRatio = explorationCount / totalSessions;

  const recurringPatterns = Object.entries(recurringSet)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  return {
    entryPoints: [...entryPointSet].slice(0, 5),
    recurringPatterns,
    toolPreferences,
    sessionShape: {
      avgDuration,
      avgTurns: 0,
      avgMessages: 0,
      burstRatio,
      explorationRatio,
      dominantMode:
        burstRatio > 0.6 ? "burst" : explorationRatio > 0.6 ? "exploration" : "mixed",
    },
  };
}

// ── Single domain build ───────────────────────────────────────────────────────

/**
 * Build a single domain profile dict from its conversations.
 *
 * precondition: data.conversations.length > 0
 * postcondition: profile has all DomainProfile fields; confidence in [0, 1]
 *
 * source: cortex@ed33435 mcp_server/core/profile_assembler.py _build_single_domain:112-153
 */
function buildSingleDomain(
  domainId: string,
  data: DomainData,
): DomainProfile {
  const convs = data.conversations;
  const patterns = extractPatterns(convs);
  const metacognitive = classifyStyle(convs);
  const categories = computeCategoryDistribution(convs);
  const topKeywords = extractTopKeywords(convs);
  const [firstSeen, lastUpdated] = computeTimestamps(convs);

  const dataQuality = Math.min(convs.length / 10, 1);
  const confidence = Math.round(Math.min(convs.length / 50, 1) * dataQuality * 100) / 100;

  let label: string;
  if (domainId && domainId.includes("-") && !domainId.startsWith("-")) {
    label = domainId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } else {
    label = cwdToLabel([...data.projects][0] ?? domainId);
  }

  const profile: DomainProfile = {
    id: domainId,
    label,
    projects: [...data.projects],
    categories,
    topKeywords,
    entryPoints: patterns.entryPoints,
    recurringPatterns: patterns.recurringPatterns,
    toolPreferences: patterns.toolPreferences,
    sessionShape: patterns.sessionShape,
    connectionBridges: [],
    blindSpots: [],
    metacognitive,
    confidence,
    sessionCount: convs.length,
    lastUpdated,
    firstSeen,
  };

  profile.personaVector = buildPersonaVector(profile);
  return profile;
}

// ── Global style ──────────────────────────────────────────────────────────────

/**
 * Compute session-weighted global cognitive style across all domains.
 * source: cortex@ed33435 mcp_server/core/profile_assembler.py _compute_global_style:213-237
 */
function computeGlobalStyle(profiles: ProfilesStore): void {
  const allDomains = Object.values(profiles.domains ?? {});
  if (allDomains.length === 0) return;

  let totalSessions = 0;
  let arSum = 0;
  let siSum = 0;
  let sgSum = 0;

  for (const d of allDomains) {
    const sc = d.sessionCount ?? 0;
    totalSessions += sc;
    const mc = d.metacognitive;
    if (mc) {
      arSum += (mc.activeReflective ?? 0) * sc;
      siSum += (mc.sensingIntuitive ?? 0) * sc;
      sgSum += (mc.sequentialGlobal ?? 0) * sc;
    }
  }

  if (totalSessions > 0) {
    profiles.globalStyle = {
      activeReflective: Math.round((arSum / totalSessions) * 100) / 100,
      sensingIntuitive: Math.round((siSum / totalSessions) * 100) / 100,
      sequentialGlobal: Math.round((sgSum / totalSessions) * 100) / 100,
      confidence: Math.round(Math.min(totalSessions / 100, 1) * 100) / 100,
      sessionCount: totalSessions,
    };
  }
}

// ── Cross-domain analysis ─────────────────────────────────────────────────────

/**
 * Attach bridges, blind spots to each domain profile.
 * source: cortex@ed33435 mcp_server/core/profile_assembler.py _apply_cross_domain_analysis:239-275
 */
function applyCrossDomainAnalysis(
  profiles: ProfilesStore,
  domainConversations: Record<string, DomainData>,
  allConversations: ConversationRaw[],
  memories: Record<string, unknown> | null,
): void {
  const bridges = findBridges(profiles, memories as never);
  for (const [domainId, domainBridges] of Object.entries(bridges)) {
    if (domainId in profiles.domains) {
      profiles.domains[domainId]!.connectionBridges = domainBridges;
    }
  }

  for (const [domainId, data] of Object.entries(domainConversations)) {
    if (!(domainId in profiles.domains)) continue;
    const blindSpots = detectBlindSpotsFull(
      data.conversations as never,
      allConversations as never,
    );
    profiles.domains[domainId]!.blindSpots = blindSpots;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface BuildDomainProfilesInput {
  existingProfiles: ProfilesStore;
  conversations: ConversationRaw[];
  memories: Record<string, unknown> | null;
  byProject: Record<string, ConversationRaw[]>;
  targetDomain?: string | null;
}

/**
 * Build or update domain profiles from scanned conversation data.
 *
 * precondition: existingProfiles has a "domains" map (may be empty)
 * postcondition: all domains in byProject have a profile; globalStyle updated
 *
 * source: cortex@ed33435 mcp_server/core/profile_assembler.py build_domain_profiles:278-313
 */
export function buildDomainProfiles({
  existingProfiles,
  conversations,
  memories,
  byProject,
  targetDomain = null,
}: BuildDomainProfilesInput): ProfilesStore {
  const profiles = existingProfiles;
  if (!profiles.domains) profiles.domains = {};

  const projectDomains = buildProjectDomainMap(profiles, byProject);
  const domainConversations = groupConversationsByDomain(
    byProject,
    projectDomains,
    targetDomain,
  );

  for (const [domainId, data] of Object.entries(domainConversations)) {
    if (data.conversations.length === 0) continue;
    profiles.domains[domainId] = buildSingleDomain(domainId, data);
  }

  applyCrossDomainAnalysis(profiles, domainConversations, conversations, memories);
  computeGlobalStyle(profiles);

  return profiles;
}
