/**
 * Detect whether a memory should be marked as global (cross-project).
 *
 * Global memories are visible to all projects during recall. They represent
 * knowledge that transcends any single codebase: architecture rules, coding
 * conventions, infrastructure facts, security policies, team agreements,
 * and reusable patterns.
 *
 * Classification uses weighted keyword/phrase signals across 6 categories.
 * A memory is global when its score exceeds a threshold AND it doesn't
 * contain project-specific anchors (file paths, branch names, PR numbers).
 *
 * Port of: mcp_server/core/global_detector.py
 * Pure business logic -- no I/O.
 */

// ── Signal categories ─────────────────────────────────────────────────────────
// Each category contributes to the global score. Phrases (multi-word)
// score higher than single keywords to reduce false positives.

export type SignalCategory =
  | "architecture"
  | "convention"
  | "infrastructure"
  | "security"
  | "cross_project"
  | "knowledge";

export const GLOBAL_SIGNALS: Record<SignalCategory, Array<[string, number]>> = {
  architecture: [
    ["clean architecture", 2.0], ["single responsibility", 2.0],
    ["dependency injection", 2.0], ["dependency inversion", 2.0],
    ["separation of concerns", 2.0], ["composition root", 1.8],
    ["hexagonal architecture", 1.8], ["domain driven design", 1.5],
    ["solid principles", 1.8], ["design pattern", 1.5],
    ["anti-pattern", 1.5], ["coupling", 1.0], ["cohesion", 1.0],
    ["abstraction", 0.8], ["interface segregation", 1.8],
    ["open closed principle", 1.8], ["liskov substitution", 1.8],
  ],
  convention: [
    ["coding standard", 2.0], ["naming convention", 2.0],
    ["code style", 1.5], ["best practice", 1.5],
    ["always use", 1.5], ["never use", 1.5],
    ["prefer", 0.8], ["convention", 1.0], ["rule of thumb", 1.5],
    ["we always", 1.5], ["we never", 1.5], ["team agreement", 2.0],
    ["standard approach", 1.5],
  ],
  infrastructure: [
    ["server at", 1.8], ["database url", 2.0], ["connection string", 2.0],
    ["production server", 2.0], ["staging server", 2.0], ["home network", 1.8],
    ["docker compose", 1.5], ["ci/cd pipeline", 1.8], ["github actions", 1.5],
    ["deployment", 1.0], ["kubernetes", 1.0], ["load balancer", 1.5],
    ["reverse proxy", 1.5], ["dns", 0.8], ["vpn", 1.0],
    ["ssl certificate", 1.5], ["backups", 0.8], ["backup", 0.8],
    ["monitoring", 0.8], ["database", 0.6],
  ],
  security: [
    ["api key rotation", 2.0], ["secret rotation", 2.0], ["security policy", 2.0],
    ["access control", 1.5], ["authentication", 1.0], ["authorization", 1.0],
    ["jwt", 1.0], ["oauth", 1.0], ["encryption", 1.0], ["password policy", 2.0],
    ["credentials", 1.0], ["credential", 1.0], ["vulnerability", 1.0],
    ["owasp", 1.5], ["cors policy", 1.5], ["rate limiting", 1.5],
  ],
  cross_project: [
    ["across all projects", 2.5], ["all projects", 2.0], ["cross-project", 2.5],
    ["shared across", 2.0], ["every project", 2.0], ["universal", 1.5],
    ["global rule", 2.5], ["global policy", 2.5], ["applies everywhere", 2.0],
    ["company-wide", 2.0], ["team-wide", 2.0], ["organization", 1.0],
    ["reusable", 1.0],
  ],
  knowledge: [
    ["utc timestamp", 1.8], ["wal mode", 1.5], ["connection pool", 1.5],
    ["idempotent", 1.5], ["eventual consistency", 1.5], ["cap theorem", 1.5],
    ["acid", 1.0], ["race condition", 1.2], ["deadlock", 1.2],
    ["memory leak", 1.2], ["cache invalidation", 1.5], ["index on", 1.2],
    ["foreign key", 1.0], ["migration", 0.8], ["schema design", 1.5],
  ],
};

// ── Negative signals — project-specific anchors ───────────────────────────────
// Content with these patterns is likely project-specific, not global.

const PROJECT_ANCHORS_RE =
  /(?:(?:\.{0,2}\/)?(?:[\w@.-]+\/){2,}[\w@.-]+\.\w+|PR\s*#\d+|issue\s*#\d+|branch\s+[\w/-]+|commit\s+[0-9a-f]{7,}|\bv\d+\.\d+\.\d+)/gi;

// Tool log prefix — auto-captured tool output is never global
const TOOL_LOG_PREFIX_RE = /^#\s*Tool:\s/m;

// IP addresses and hostnames are infrastructure (positive, not negative)
const IP_PATTERN_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
const HOST_PATTERN_RE = /\b[\w-]+\.(internal|local|dev|prod|staging)\b/i;

/** Score threshold for global classification. */
export const GLOBAL_THRESHOLD = 3.0;

// ── Pre-compiled signal structures ────────────────────────────────────────────

interface CompiledSignal {
  phrase: string;
  weight: number;
  regex: RegExp | null; // null = multi-word phrase match (substring)
  category: SignalCategory;
}

const COMPILED_SIGNALS: CompiledSignal[] = [];

for (const [cat, signals] of Object.entries(GLOBAL_SIGNALS) as [SignalCategory, Array<[string, number]>][]) {
  for (const [phrase, weight] of signals) {
    const isMultiWord = phrase.includes(" ");
    COMPILED_SIGNALS.push({
      phrase,
      weight,
      regex: isMultiWord ? null : new RegExp(`\\b${phrase}\\b`, "i"),
      category: cat,
    });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Classify whether memory content should be global.
 *
 * @returns [is_global, score, reason]
 *   - is_global: true if score >= GLOBAL_THRESHOLD
 *   - score: weighted sum of matched signals
 *   - reason: best-matching category or "not_global"
 *
 * Precondition: content is a string; tags is an array of strings or undefined.
 * Postcondition: is_global === (score >= GLOBAL_THRESHOLD).
 */
export function detectGlobal(
  content: string,
  tags?: string[],
): [boolean, number, string] {
  if (!content) return [false, 0.0, "empty"];

  // Skip auto-captured tool logs
  if (TOOL_LOG_PREFIX_RE.test(content)) return [false, 0.0, "tool_log"];

  const lower = content.toLowerCase();
  const tagText = (tags ?? []).join(" ").toLowerCase();
  const haystack = lower + " " + tagText;

  // Score positive signals
  let score = 0.0;
  const categoryScores = new Map<string, number>();

  for (const { phrase, weight, regex, category } of COMPILED_SIGNALS) {
    const matched = regex !== null ? regex.test(haystack) : haystack.includes(phrase);
    if (matched) {
      score += weight;
      categoryScores.set(category, (categoryScores.get(category) ?? 0) + weight);
    }
  }

  // Boost for infrastructure indicators
  if (IP_PATTERN_RE.test(content)) {
    score += 1.0;
    categoryScores.set("infrastructure", (categoryScores.get("infrastructure") ?? 0) + 1.0);
  }
  if (HOST_PATTERN_RE.test(content)) {
    score += 1.0;
    categoryScores.set("infrastructure", (categoryScores.get("infrastructure") ?? 0) + 1.0);
  }

  // Boost for explicit global tags
  const globalTagSet = new Set(["global", "shared", "infrastructure", "cross-project", "universal"]);
  const tagOverlap = (tags ?? []).filter((t) => globalTagSet.has(t.toLowerCase()));
  if (tagOverlap.length > 0) {
    score += 1.5 * tagOverlap.length;
    categoryScores.set(
      "cross_project",
      (categoryScores.get("cross_project") ?? 0) + 1.5 * tagOverlap.length,
    );
  }

  // Penalize project-specific anchors (but not zero — infra can have paths)
  PROJECT_ANCHORS_RE.lastIndex = 0;
  const anchorMatches = content.match(PROJECT_ANCHORS_RE);
  const anchorCount = anchorMatches ? anchorMatches.length : 0;
  if (anchorCount >= 3) {
    score *= 0.4;
  } else if (anchorCount >= 1) {
    score *= 0.7;
  }

  if (categoryScores.size === 0) return [false, 0.0, "not_global"];

  let bestCat = "";
  let bestCatScore = -Infinity;
  for (const [cat, s] of categoryScores) {
    if (s > bestCatScore) {
      bestCatScore = s;
      bestCat = cat;
    }
  }

  const isGlobal = score >= GLOBAL_THRESHOLD;
  const reason = isGlobal ? `global_${bestCat}` : "not_global";

  return [isGlobal, Math.round(score * 100) / 100, reason];
}
