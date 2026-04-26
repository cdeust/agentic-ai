/**
 * User-editable classifier rule engine.
 *
 * Given a memory's content + tags and a list of ClassifierRules, returns
 * either the matched target kind or null (rejection).
 *
 * A rule has:
 *   - pattern_kind: 'prefix' | 'regex' | 'substring' | 'tag'
 *   - pattern: the literal/regex/tag value to match
 *   - target_kind: the kind to assign on match, or null to reject
 *   - weight: tie-breaker when multiple rules match (higher wins)
 *   - note: human-readable comment
 *
 * Rules are evaluated in file-order; the first match wins UNLESS multiple
 * rules tie at the same iteration step, in which case weight breaks the tie.
 *
 * Pure logic — no I/O.
 *
 * source: mcp_server/core/wiki_rule_engine.py
 */

import type { ClassifierRule, RuleMatch } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** source: wiki_rule_engine.py REJECT_TARGETS */
const REJECT_TARGETS = new Set<string | null | undefined>([
  "reject",
  "-",
  "",
  null,
  undefined,
  "none",
]);

// ── Pattern matching ──────────────────────────────────────────────────────────

/**
 * Return true if a single classifier rule matches content+tags.
 *
 * All text matchers (prefix/substring/regex) are case-insensitive.
 * Tag matching is case-insensitive against a pre-lowered tag set.
 *
 * source: wiki_rule_engine.py _matches()
 */
function matchesRule(
  rule: ClassifierRule,
  content: string,
  tagSet: Set<string>,
): boolean {
  const pattern = rule.pattern ?? "";
  const kind = (rule.pattern_kind ?? "").toLowerCase();
  if (!pattern) return false;

  if (kind === "prefix") {
    return content.trimStart().toLowerCase().startsWith(pattern.toLowerCase());
  }
  if (kind === "substring") {
    return content.toLowerCase().includes(pattern.toLowerCase());
  }
  if (kind === "regex") {
    try {
      return new RegExp(pattern, "i").test(content);
    } catch {
      return false;
    }
  }
  if (kind === "tag") {
    return tagSet.has(pattern.toLowerCase());
  }
  return false;
}

// ── Rule application ──────────────────────────────────────────────────────────

/**
 * Evaluate rules in order; return first match (weight-broken tie).
 *
 * Returns RuleMatch with:
 *   - target_kind set to the rule's target (string), or null if rejected
 *   - matched_rule null if no rule matched (caller falls back to default)
 *
 * source: wiki_rule_engine.py apply_rules()
 */
export function applyClassifierRules(
  content: string,
  tags: string[] | null,
  rules: ClassifierRule[],
): RuleMatch {
  if (!content || rules.length === 0) {
    return {
      matched_rule: null,
      target_kind: null,
      rationale: "no content or no rules loaded",
    };
  }

  const tagSet = new Set<string>(
    (tags ?? [])
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toLowerCase()),
  );

  // Collect all matching rules with (index, -weight, rule) for stable sort
  const candidates: Array<[number, number, ClassifierRule]> = [];
  for (let idx = 0; idx < rules.length; idx++) {
    const rule = rules[idx];
    if (rule !== undefined && matchesRule(rule, content, tagSet)) {
      candidates.push([idx, -(rule.weight ?? 1.0), rule]);
    }
  }

  if (candidates.length === 0) {
    return {
      matched_rule: null,
      target_kind: null,
      rationale: "no rule matched",
    };
  }

  // Earliest first; among ties, highest weight wins (weight stored negated)
  candidates.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1] - b[1]; // lower negated weight = higher original weight
  });

  const best = candidates[0]?.[2];
  if (!best) {
    return { matched_rule: null, target_kind: null, rationale: "no rule matched" };
  }

  const targetNorm = REJECT_TARGETS.has(best.target_kind ?? null)
    ? null
    : (best.target_kind ?? null);

  return {
    matched_rule: best,
    target_kind: targetNorm,
    rationale: `rule [${best.pattern_kind}] ${JSON.stringify(best.pattern)} → ${best.target_kind ?? "reject"}`,
  };
}
