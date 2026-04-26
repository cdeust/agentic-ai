/**
 * Phase 5.1 — User-editable classifier rule engine.
 *
 * The wiki schema loader reads wiki/_rules/*.md files and returns
 * ClassifierRule[]. This module APPLIES those rules: given memory
 * content + tags, return either the matched target kind or 'reject'.
 *
 * A rule has:
 *   - pattern_kind: 'prefix' | 'regex' | 'substring' | 'tag'
 *   - pattern: the literal/regex/tag value to match
 *   - target_kind: the kind to assign on match, or null to reject
 *   - weight: tie-breaker when multiple rules match (higher wins)
 *   - note: human-readable comment
 *
 * Rules are evaluated in file-order; the first match wins UNLESS
 * multiple rules tie at the same iteration step, in which case weight
 * breaks the tie.
 *
 * Pure logic — no I/O.
 *
 * source: mcp_server/core/wiki_rule_engine.py
 */

import type { ClassifierRule } from "./schema-loader.js";

export const REJECT_TARGETS = new Set(["reject", "-", "", null, "none", undefined]);

export interface RuleMatch {
  readonly matched_rule: ClassifierRule | null;
  readonly target_kind: string | null;
  readonly rationale: string;
}

function matches(rule: ClassifierRule, content: string, tags: Set<string>): boolean {
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
    return tags.has(pattern.toLowerCase());
  }
  return false;
}

/**
 * Evaluate rules in order; return first match (weight-broken tie).
 *
 * Returns RuleMatch with:
 *   - target_kind set to the rule's target, or null if rejected
 *   - matched_rule null if no rule matched (caller falls back to
 *     default behaviour)
 */
export function applyRules(
  content: string,
  tags: readonly string[] | null,
  rules: readonly ClassifierRule[],
): RuleMatch {
  if (!content || !rules.length) {
    return {
      matched_rule: null,
      target_kind: null,
      rationale: "no content or no rules loaded",
    };
  }

  const tagSet = new Set((tags ?? []).filter((t) => typeof t === "string").map((t) => t.toLowerCase()));

  // First-match-wins with tie-break: collect every match, pick by
  // (file_order, -weight) — earliest+heaviest wins.
  const candidates: Array<[number, number, ClassifierRule]> = [];
  for (let idx = 0; idx < rules.length; idx++) {
    const rule = rules[idx];
    if (!rule) continue;
    if (matches(rule, content, tagSet)) {
      candidates.push([idx, -(rule.weight ?? 1.0), rule]);
    }
  }

  if (!candidates.length) {
    return { matched_rule: null, target_kind: null, rationale: "no rule matched" };
  }

  // Sort: earliest first; among ties, highest weight wins
  candidates.sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);

  const best = candidates[0]![2]!;
  const targetNorm: string | null = REJECT_TARGETS.has(best.target_kind ?? null) ? null : (best.target_kind ?? null);

  return {
    matched_rule: best,
    target_kind: targetNorm,
    rationale: `rule [${best.pattern_kind}] ${JSON.stringify(best.pattern)} → ${best.target_kind ?? "reject"}`,
  };
}
