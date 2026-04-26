/**
 * Prospective memory — future-oriented triggers that fire on matching context.
 *
 * "Remember to do X when Y happens" — the ability to remember intentions.
 *
 * Trigger types:
 *   keyword / keyword_match     — fires when content contains specific keywords
 *   directory_match             — fires when working in a specific directory
 *   entity_match                — fires when specific entities appear
 *   time / time_based           — fires at specific times (HH:MM or weekday:N)
 *   domain                      — fires when a specific domain becomes active
 *   file                        — fires when a specific file is accessed/modified
 *
 * Auto-extraction detects prospective intent from natural language:
 *   - "TODO: ...", "FIXME: ...", "remember to ...", "next time ..."
 *   - "don't forget ...", "when we ...", "later ...", "should also ..."
 *
 * Pure business logic — no I/O.
 *
 * source: mcp_server/core/prospective.py
 * source: Einstein, G. O. & McDaniel, M. A. (2005). "Prospective memory:
 *   Multiple retrieval processes." Current Directions in Psychological
 *   Science, 14(6), 286–290.
 * source: Marsh, R. L., Hicks, J. L., & Bink, M. L. (1998). "Activation of
 *   completed, uncompleted, and partially completed intentions." Journal of
 *   Experimental Psychology: Learning, Memory, and Cognition, 24(2), 350–361.
 */

import type { Trigger, TriggerContext } from "./types.js";

// ── Prospective-intent patterns ───────────────────────────────────────────────

/** source: prospective.py _PROSPECTIVE_PATTERNS */
interface ProspectivePattern {
  regex: RegExp;
  trigger_type: "keyword_match";
}

const PROSPECTIVE_PATTERNS: ProspectivePattern[] = [
  { regex: /\bTODO\b[:\s]*(.+?)(?:\n|$)/gi, trigger_type: "keyword_match" },
  { regex: /\bFIXME\b[:\s]*(.+?)(?:\n|$)/gi, trigger_type: "keyword_match" },
  { regex: /remember to\s+(.+?)(?:\.|$)/gi, trigger_type: "keyword_match" },
  { regex: /don'?t forget\s+(.+?)(?:\.|$)/gi, trigger_type: "keyword_match" },
  { regex: /next time\s+(.+?)(?:\.|$)/gi, trigger_type: "keyword_match" },
  { regex: /when we\s+(.+?)(?:\.|$)/gi, trigger_type: "keyword_match" },
  { regex: /later\s+(.+?)(?:\.|$)/gi, trigger_type: "keyword_match" },
  { regex: /eventually\s+(.+?)(?:\.|$)/gi, trigger_type: "keyword_match" },
  { regex: /should also\s+(.+?)(?:\.|$)/gi, trigger_type: "keyword_match" },
  {
    regex: /always\s+(.+?)\s+when\s+(?:i|you)\s+(?:ask|mention|discuss|talk)\b.+/gi,
    trigger_type: "keyword_match",
  },
  {
    regex: /(?:always|prefer)\s+(?:use|prefer)\s+(.+?)(?:\.|$)/gi,
    trigger_type: "keyword_match",
  },
  {
    regex: /make sure (?:to\s+)?(.+?)(?:\.|$)/gi,
    trigger_type: "keyword_match",
  },
];

const STOP_WORDS = new Set<string>([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
]);

/** source: prospective.py _TIME_HOUR_RE */
const TIME_HOUR_RE = /^(\d{1,2}):(\d{2})$/;
/** source: prospective.py _TIME_WEEKDAY_RE */
const TIME_WEEKDAY_RE = /^weekday:(\d)$/;

// ── Intent extraction ─────────────────────────────────────────────────────────

export interface ProspectiveIntent {
  content: string;
  trigger_condition: string;
  trigger_type: "keyword_match";
}

/**
 * Scan content for future-oriented phrases.
 *
 * Returns list of {content, trigger_condition, trigger_type} objects.
 *
 * source: prospective.py extract_prospective_intents()
 */
export function extractProspectiveIntents(content: string): ProspectiveIntent[] {
  const results: ProspectiveIntent[] = [];

  for (const { regex, trigger_type } of PROSPECTIVE_PATTERNS) {
    // Reset lastIndex because we reuse compiled regexes with /g flag
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const group1 = match[1];
      if (!group1) continue;
      const actionable = group1.trim();
      if (!actionable || actionable.length < 5) continue;

      const keywords = actionable
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
        .join(" ");

      if (!keywords) continue;

      results.push({
        content: actionable,
        trigger_condition: keywords,
        trigger_type,
      });
    }
  }

  return results;
}

// ── Time matching ─────────────────────────────────────────────────────────────

/**
 * Check if currentTime matches a cron-like time condition.
 *
 * Supports "HH:MM" and "weekday:N" formats.
 *
 * source: prospective.py _matches_time()
 */
function matchesTime(condition: string, currentTime: Date): boolean {
  const hourMatch = TIME_HOUR_RE.exec(condition);
  if (hourMatch) {
    const h = parseInt(hourMatch[1] as string, 10);
    const m = parseInt(hourMatch[2] as string, 10);
    return currentTime.getUTCHours() === h && currentTime.getUTCMinutes() === m;
  }

  const weekdayMatch = TIME_WEEKDAY_RE.exec(condition);
  if (weekdayMatch) {
    // JS getDay(): 0=Sunday, Python weekday(): 0=Monday — normalize to Monday=0
    const pyWeekday = (currentTime.getUTCDay() + 6) % 7;
    return pyWeekday === parseInt(weekdayMatch[1] as string, 10);
  }

  return false;
}

// ── Single trigger evaluation ─────────────────────────────────────────────────

/**
 * Check if a single trigger matches the given context.
 *
 * source: prospective.py check_trigger()
 */
export function checkTrigger(trigger: Trigger, context: TriggerContext): boolean {
  const { trigger_type, trigger_condition, target_directory } = trigger;
  const condition = trigger_condition;

  // Canonical types from create_trigger handler
  if (trigger_type === "keyword") {
    const keywords = condition.toLowerCase().split(/\s+/);
    const contentLower = context.content.toLowerCase();
    return keywords.some((kw) => contentLower.includes(kw));
  }

  if (trigger_type === "time") {
    const now = context.current_time
      ? new Date(context.current_time)
      : new Date();
    return matchesTime(condition, now);
  }

  if (trigger_type === "file") {
    return condition !== "" && context.content.includes(condition);
  }

  if (trigger_type === "domain") {
    // domain trigger fires when the active domain matches the condition
    return condition !== "" && context.content.toLowerCase().includes(condition.toLowerCase());
  }

  // Extended types from core/prospective.py
  if (trigger_type === "directory_match") {
    const target = (target_directory ?? "") || condition;
    return target !== "" && context.directory.includes(target);
  }

  if (trigger_type === "keyword_match") {
    const keywords = condition.toLowerCase().split(/\s+/);
    const contentLower = context.content.toLowerCase();
    return keywords.some((kw) => contentLower.includes(kw));
  }

  if (trigger_type === "entity_match") {
    const entityName = condition.toLowerCase();
    return context.entities.some((e) => entityName === e.toLowerCase());
  }

  if (trigger_type === "time_based") {
    const now = context.current_time
      ? new Date(context.current_time)
      : new Date();
    return matchesTime(condition, now);
  }

  return false;
}

/**
 * Filter a list of triggers to those that match the given context.
 *
 * Kay: this is the runtime dispatch — the trigger set is data loaded from the
 * store, not hard-coded. Extending with new trigger types only requires adding
 * a new branch in checkTrigger and a new enum value; no caller changes needed.
 */
export function matchTriggers(
  triggers: ReadonlyArray<Trigger>,
  context: TriggerContext,
): Trigger[] {
  return triggers.filter((t) => t.is_active && checkTrigger(t, context));
}
