/**
 * Prospective memory — future-oriented triggers that fire on matching context.
 *
 * "Remember to do X when Y happens" — the ability to remember intentions.
 *
 * Trigger types:
 *   - directory_match: fires when working in a specific directory
 *   - keyword_match: fires when content contains specific keywords
 *   - entity_match: fires when specific entities appear
 *   - time_based: fires at specific times (HH:MM or weekday:N)
 *
 * Auto-extraction detects prospective intent from natural language.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/prospective.py
 */

// ── Valid trigger types ───────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/prospective.py:23-30

export const VALID_TRIGGER_TYPES = new Set([
  "directory_match",
  "keyword_match",
  "entity_match",
  "time_based",
]);

// ── Prospective patterns ──────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/prospective.py:33-59

const PROSPECTIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\bTODO\b[:\s]*(.+?)(?:\n|$)/gi, "keyword_match"],
  [/\bFIXME\b[:\s]*(.+?)(?:\n|$)/gi, "keyword_match"],
  [/remember to\s+(.+?)(?:\.|$)/gi, "keyword_match"],
  [/don'?t forget\s+(.+?)(?:\.|$)/gi, "keyword_match"],
  [/next time\s+(.+?)(?:\.|$)/gi, "keyword_match"],
  [/when we\s+(.+?)(?:\.|$)/gi, "keyword_match"],
  [/later\s+(.+?)(?:\.|$)/gi, "keyword_match"],
  [/eventually\s+(.+?)(?:\.|$)/gi, "keyword_match"],
  [/should also\s+(.+?)(?:\.|$)/gi, "keyword_match"],
  [/always\s+(.+?)\s+when\s+(?:i|you)\s+(?:ask|mention|discuss|talk)\b.+/gi, "keyword_match"],
  [/(?:always|prefer)\s+(?:use|prefer)\s+(.+?)(?:\.|$)/gi, "keyword_match"],
  [/make sure (?:to\s+)?(.+?)(?:\.|$)/gi, "keyword_match"],
];

const TIME_HOUR_RE = /^(\d{1,2}):(\d{2})$/;
const TIME_WEEKDAY_RE = /^weekday:(\d)$/;

const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from"]);

// ── Auto-extraction ───────────────────────────────────────────────────────

/**
 * Scan content for future-oriented phrases.
 *
 * precondition:  content is a string.
 * postcondition: each returned item has content, triggerCondition, triggerType.
 *
 * source: cortex@ed33435 mcp_server/core/prospective.py:67-94
 */
export function extractProspectiveIntents(
  content: string,
): Array<{ content: string; triggerCondition: string; triggerType: string }> {
  const results: Array<{ content: string; triggerCondition: string; triggerType: string }> = [];

  for (const [pattern, triggerType] of PROSPECTIVE_PATTERNS) {
    // Reset lastIndex for each pass since patterns use /g flag
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const actionable = (match[1] ?? "").trim();
      if (!actionable || actionable.length < 5) continue;

      const keywords = actionable
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
        .join(" ");
      if (!keywords) continue;

      results.push({
        content: actionable,
        triggerCondition: keywords,
        triggerType,
      });
    }
  }

  return results;
}

// ── Trigger checking ──────────────────────────────────────────────────────

/**
 * Check if current time matches a cron-like time condition.
 * source: cortex@ed33435 mcp_server/core/prospective.py:128-140
 */
function matchesTime(condition: string, currentTime: Date): boolean {
  const hourMatch = condition.match(TIME_HOUR_RE);
  if (hourMatch) {
    return currentTime.getHours() === parseInt(hourMatch[1]!, 10)
      && currentTime.getMinutes() === parseInt(hourMatch[2]!, 10);
  }
  const weekdayMatch = condition.match(TIME_WEEKDAY_RE);
  if (weekdayMatch) {
    return currentTime.getDay() === parseInt(weekdayMatch[1]!, 10);
  }
  return false;
}

/**
 * Check if a single trigger matches the given context.
 *
 * precondition:  trigger has triggerType and triggerCondition fields.
 * postcondition: returns true iff the trigger fires for the given context.
 *
 * source: cortex@ed33435 mcp_server/core/prospective.py:97-125
 */
export function checkTrigger(
  trigger: Record<string, unknown>,
  opts: {
    directory?: string;
    content?: string;
    entities?: string[];
    currentTime?: Date;
  } = {},
): boolean {
  const triggerType = (trigger["trigger_type"] ?? trigger["triggerType"] ?? "") as string;
  const condition = (trigger["trigger_condition"] ?? trigger["triggerCondition"] ?? "") as string;

  if (triggerType === "directory_match") {
    const target = ((trigger["target_directory"] ?? condition) as string) ?? "";
    return target !== "" && (opts.directory ?? "").includes(target);
  }

  if (triggerType === "keyword_match") {
    const keywords = condition.toLowerCase().split(/\s+/);
    const contentLower = (opts.content ?? "").toLowerCase();
    return keywords.some((kw) => contentLower.includes(kw));
  }

  if (triggerType === "entity_match") {
    const entityName = condition.toLowerCase();
    return (opts.entities ?? []).some((e) => entityName === e.toLowerCase());
  }

  if (triggerType === "time_based") {
    return matchesTime(condition, opts.currentTime ?? new Date());
  }

  return false;
}
