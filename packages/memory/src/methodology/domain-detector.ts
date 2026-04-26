/**
 * Three-signal weighted domain classification for cognitive sessions.
 *
 * Weighted linear combination of three orthogonal signals:
 *   - Project match (0.5): exact project ID lookup
 *   - Content match (0.3): Jaccard similarity between keywords
 *   - Category match (0.2): dot-product of category distributions
 *
 * source: mcp_server/core/domain_detector.py
 */

import type { DomainContext, DomainDetectionResult, ProfilesStore } from "./types.js";

// ── Weights ───────────────────────────────────────────────────────────────────

/** source: mcp_server/core/domain_detector.py W_PROJECT */
const W_PROJECT = 0.5;
/** source: mcp_server/core/domain_detector.py W_CONTENT */
const W_CONTENT = 0.3;
/** source: mcp_server/core/domain_detector.py W_CATEGORY */
const W_CATEGORY = 0.2;

/** Minimum confidence to treat detection as reliable. */
const THRESHOLD_CONFIDENT = 0.6;
/** Minimum confidence to return a tentative match. */
const THRESHOLD_TENTATIVE = 0.3;

// ── Text helpers (inline — avoids cross-package dependency at this layer) ─────

/** Convert cwd path to a project ID (last path segment slugified). */
export function cwdToProjectId(cwd: string | undefined): string | null {
  if (!cwd) return null;
  // Mirror logic of shared/project_ids.py cwd_to_project_id
  return cwd.replace(/\//g, "-").replace(/^-/, "");
}

/** Extract simple keyword set from a text string (lowercase word tokens ≥4 chars). */
function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 4),
  );
}

/** Jaccard similarity between two sets. */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Normalize a category score dict to sum to 1. */
function normalizeCategoryScores(raw: Record<string, number>): Record<string, number> {
  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  if (total === 0) return {};
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total]));
}

/**
 * Naive keyword-based category scorer for offline use (no ML model).
 * Returns category → score for a handful of well-known categories.
 * source: mcp_server/shared/categorizer.py categorize_with_scores (simplified)
 */
function categorizeWithScores(text: string): Record<string, number> {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};
  const rules: Array<[string, string[]]> = [
    ["bug-fix", ["fix", "bug", "error", "crash", "regression"]],
    ["feature", ["feature", "implement", "add", "new", "build"]],
    ["refactor", ["refactor", "cleanup", "restructure", "move", "rename"]],
    ["testing", ["test", "spec", "assert", "coverage", "jest", "vitest", "pytest"]],
    ["docs", ["docs", "documentation", "readme", "comment"]],
    ["research", ["research", "explore", "investigate", "analyze", "study"]],
    ["architecture", ["architecture", "design", "pattern", "system", "service"]],
    ["debug", ["debug", "trace", "log", "inspect", "diagnose"]],
  ];
  for (const [category, keywords] of rules) {
    const count = keywords.filter((kw) => lower.includes(kw)).length;
    if (count > 0) scores[category] = count;
  }
  return scores;
}

// ── Signal scorers ────────────────────────────────────────────────────────────

function scoreProjectMatch(
  projectId: string | null,
  domain: { projects?: string[] },
): number {
  if (!projectId) return 0;
  return (domain.projects ?? []).includes(projectId) ? 1 : 0;
}

function scoreContentMatch(
  firstMessage: string | undefined,
  domain: { topKeywords?: string[] },
): number {
  if (!firstMessage) return 0;
  const topKeywords = domain.topKeywords ?? [];
  if (topKeywords.length === 0) return 0;
  const msgKeywords = extractKeywords(firstMessage);
  const domainKeySet = new Set(topKeywords.map((k) => k.toLowerCase()));
  return jaccardSimilarity(msgKeywords, domainKeySet);
}

function scoreCategoryMatch(
  firstMessage: string | undefined,
  domain: { categoryDistribution?: Record<string, number> },
): number {
  if (!firstMessage) return 0;
  const catDist = domain.categoryDistribution ?? {};
  if (Object.keys(catDist).length === 0) return 0;
  const raw = categorizeWithScores(firstMessage);
  if (Object.keys(raw).length === 0) return 0;
  const msgDist = normalizeCategoryScores(raw);
  const dotProduct = Object.entries(msgDist).reduce(
    (s, [cat, score]) => s + score * (catDist[cat] ?? 0),
    0,
  );
  return Math.min(1, dotProduct);
}

// ── Domain mapping helper ─────────────────────────────────────────────────────

export function mapProjectToDomain(
  projectId: string | null,
  profiles: ProfilesStore | null,
): string | null {
  if (!projectId || !profiles) return null;
  for (const [domainId, domain] of Object.entries(profiles.domains)) {
    if ((domain.projects ?? []).includes(projectId)) return domainId;
  }
  return null;
}

// ── Ranking ───────────────────────────────────────────────────────────────────

interface DomainScore {
  id: string;
  confidence: number;
}

function rankDomains(
  profiles: ProfilesStore,
  projectId: string | null,
  firstMessage: string | undefined,
): DomainScore[] {
  const scored: DomainScore[] = [];

  for (const [domainId, domain] of Object.entries(profiles.domains)) {
    const sProject = scoreProjectMatch(projectId, domain);
    const sContent = scoreContentMatch(firstMessage, domain);
    const sCategory = scoreCategoryMatch(firstMessage, domain);
    const score = W_PROJECT * sProject + W_CONTENT * sContent + W_CATEGORY * sCategory;
    scored.push({ id: domainId, confidence: score });
  }

  return scored.sort((a, b) => b.confidence - a.confidence);
}

function filterAlternatives(
  domainScores: DomainScore[],
  minConf: number,
  maxConf?: number,
): Array<{ id: string; confidence: number }> {
  return domainScores
    .slice(1)
    .filter(
      (d) =>
        d.confidence >= minConf && (maxConf === undefined || d.confidence < maxConf),
    )
    .map((d) => ({ id: d.id, confidence: d.confidence }));
}

function buildDetectionResult(domainScores: DomainScore[]): DomainDetectionResult {
  const best = domainScores[0];
  if (!best) {
    return { coldStart: false, domain: null, confidence: 0, isNew: true, alternativeDomains: [] };
  }

  if (best.confidence >= THRESHOLD_CONFIDENT) {
    return {
      coldStart: false,
      domain: best.id,
      confidence: best.confidence,
      isNew: false,
      alternativeDomains: filterAlternatives(domainScores, THRESHOLD_TENTATIVE, THRESHOLD_CONFIDENT),
    };
  }

  if (best.confidence >= THRESHOLD_TENTATIVE) {
    return {
      coldStart: false,
      domain: best.id,
      confidence: best.confidence,
      isNew: false,
      alternativeDomains: filterAlternatives(domainScores, THRESHOLD_TENTATIVE),
    };
  }

  return {
    coldStart: false,
    domain: null,
    confidence: best.confidence,
    isNew: true,
    alternativeDomains: [],
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Classify which cognitive domain a session belongs to.
 *
 * Returns a DomainDetectionResult with coldStart, domain, confidence,
 * isNew, alternativeDomains, and optional context message.
 *
 * source: mcp_server/core/domain_detector.py detect_domain
 */
export function detectDomain(
  context: DomainContext | null,
  profiles: ProfilesStore | null,
): DomainDetectionResult {
  const ctx = context ?? {};
  const hasDomains =
    profiles !== null &&
    profiles.domains !== undefined &&
    Object.keys(profiles.domains).length > 0;

  if (!hasDomains) {
    return {
      coldStart: true,
      domain: null,
      confidence: 0,
      isNew: false,
      alternativeDomains: [],
      context: "No cognitive profile yet. Building one as we go.",
    };
  }

  const projectId = ctx.project ?? cwdToProjectId(ctx.cwd);
  const domainScores = rankDomains(profiles!, projectId, ctx.firstMessage);
  return buildDetectionResult(domainScores);
}
