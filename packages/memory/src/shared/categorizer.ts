/**
 * Work-category classification for cognitive sessions.
 *
 * Pattern-matching against 10 categories. Single words score 1.0, multi-word
 * phrases score 1.5. categorize() returns the best match;
 * categorizeWithScores() returns all non-zero scores.
 *
 * Port of: mcp_server/shared/categorizer.py
 */

export type WorkCategory =
  | "bug-fix"
  | "feature"
  | "refactor"
  | "research"
  | "config"
  | "docs"
  | "debug"
  | "architecture"
  | "deployment"
  | "testing"
  | "general";

const CATEGORY_RULES: Readonly<Record<string, readonly string[]>> = {
  "bug-fix": ["fix", "bug", "broken", "crash", "error", "issue", "regression", "failing"],
  feature: ["add", "implement", "new", "build", "create", "introduce", "support"],
  refactor: ["refactor", "restructure", "clean up", "simplify", "extract", "rename"],
  research: ["research", "investigate", "explore", "evaluate", "compare", "analyze"],
  config: ["config", "setup", "install", "environment", "settings", "dependency"],
  docs: ["document", "readme", "changelog", "comment", "guide", "tutorial"],
  debug: ["debug", "log", "trace", "inspect", "diagnose", "why is"],
  architecture: ["architecture", "design", "pattern", "system", "module", "protocol"],
  deployment: ["deploy", "ci/cd", "pipeline", "release", "docker", "publish", "production"],
  testing: ["test", "spec", "assert", "mock", "coverage", "unit test"],
} as const;

interface CompiledSignal {
  readonly signal: string;
  readonly weight: number;
  /** null for multi-word phrases (use substring match) */
  readonly regex: RegExp | null;
}

// Pre-compile word-boundary regexes for single-word signals
const SIGNAL_PATTERNS: ReadonlyMap<string, readonly CompiledSignal[]> = (() => {
  const map = new Map<string, CompiledSignal[]>();
  for (const [cat, signals] of Object.entries(CATEGORY_RULES)) {
    const compiled: CompiledSignal[] = signals.map((signal) => {
      if (signal.includes(" ")) {
        return { signal, weight: 1.5, regex: null };
      }
      return {
        signal,
        weight: 1.0,
        regex: new RegExp(`\\b${signal}\\b`, "i"),
      };
    });
    map.set(cat, compiled);
  }
  return map;
})();

/**
 * Score text against all categories, returning non-zero scores.
 */
export function categorizeWithScores(text: string | null | undefined): Record<string, number> {
  if (!text) return {};
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [category, patterns] of SIGNAL_PATTERNS) {
    let score = 0.0;
    for (const { signal, weight, regex } of patterns) {
      if (regex !== null) {
        if (regex.test(lower)) score += weight;
      } else {
        if (lower.includes(signal)) score += weight;
      }
    }
    if (score > 0) scores[category] = score;
  }

  return scores;
}

/**
 * Classify text into a single best work category.
 *
 * Returns the highest-scoring category, with tie-breaking favoring
 * multi-word phrase matches. Defaults to "general" if no match.
 */
export function categorize(text: string | null | undefined): WorkCategory {
  if (!text) return "general";

  const scores = categorizeWithScores(text);
  if (Object.keys(scores).length === 0) return "general";

  const lower = text.toLowerCase();
  let best: WorkCategory = "general";
  let bestScore = 0.0;
  let bestPhraseCount = 0;

  for (const [cat, sc] of Object.entries(scores)) {
    const patterns = SIGNAL_PATTERNS.get(cat) ?? [];
    const phraseCount = patterns.filter(
      ({ regex, signal }) => regex === null && lower.includes(signal),
    ).length;

    if (sc > bestScore + 0.5) {
      bestScore = sc;
      best = cat as WorkCategory;
      bestPhraseCount = phraseCount;
    } else if (sc >= bestScore && sc > bestScore - 0.5) {
      if (
        phraseCount > bestPhraseCount ||
        (phraseCount === bestPhraseCount && sc > bestScore)
      ) {
        bestScore = sc;
        best = cat as WorkCategory;
        bestPhraseCount = phraseCount;
      }
    }
  }

  return best;
}
