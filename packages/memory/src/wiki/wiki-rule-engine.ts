/**
 * Phase 5.1 — User-editable classifier rule engine.
 *
 * The wiki schema loader reads wiki/_rules/*.md files and returns a
 * list of ClassifierRule. This module APPLIES those rules: given a memory
 * content + tags, return either the matched target kind or 'reject'.
 *
 * Rules are evaluated in file-order; the first match wins UNLESS
 * multiple rules tie at the same iteration step, in which case weight
 * breaks the tie.
 *
 * Pure logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/wiki_rule_engine.py
 */

// ── ClassifierRule type (mirrors wiki_schema_loader.py) ──────────────────
// source: cortex@ed33435 mcp_server/core/wiki_schema_loader.py:56-68

export interface ClassifierRule {
  readonly pattern: string;
  readonly patternKind: string; // 'prefix' | 'regex' | 'substring' | 'tag'
  readonly targetKind: string | null; // null → reject
  readonly weight: number;
  readonly note: string;
}

// ── Reject targets ────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/wiki_rule_engine.py:30

const REJECT_TARGETS = new Set(["reject", "-", "", "none"]);

// ── RuleMatch ─────────────────────────────────────────────────────────────

/**
 * Outcome of rule application against a single memory.
 * source: cortex@ed33435 mcp_server/core/wiki_rule_engine.py:33-37
 */
export interface RuleMatch {
  readonly matchedRule: ClassifierRule | null;
  readonly targetKind: string | null; // null means rejection
  readonly rationale: string;
}

// ── Rule matching ─────────────────────────────────────────────────────────

/**
 * Return true if a single rule matches the input.
 *
 * All text matchers (prefix/substring/regex) are case-insensitive.
 * Tag matching is case-insensitive against a pre-lowered tag set.
 *
 * source: cortex@ed33435 mcp_server/core/wiki_rule_engine.py:42-64
 */
function matchesRule(rule: ClassifierRule, content: string, tags: Set<string>): boolean {
  const pattern = rule.pattern ?? "";
  const kind = (rule.patternKind ?? "").toLowerCase();
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

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Evaluate rules in order; return first match (weight-broken tie).
 *
 * precondition:  content is a string; rules is an array of ClassifierRule.
 * postcondition: returned RuleMatch has:
 *   - targetKind set to the rule's target (string), or null if rejected.
 *   - matchedRule null if no rule matched (caller falls back to default).
 *
 * source: cortex@ed33435 mcp_server/core/wiki_rule_engine.py:67-114
 */
export function applyRules(
  content: string,
  tags: string[] | null,
  rules: ClassifierRule[],
): RuleMatch {
  if (!content || rules.length === 0) {
    return {
      matchedRule: null,
      targetKind: null,
      rationale: "no content or no rules loaded",
    };
  }

  const tagSet = new Set(
    (tags ?? []).filter((t) => typeof t === "string").map((t) => t.toLowerCase()),
  );

  // Collect every match, then sort by (file_order, -weight) — earliest+heaviest wins
  const candidates: Array<[number, number, ClassifierRule]> = [];
  for (let idx = 0; idx < rules.length; idx++) {
    const rule = rules[idx]!;
    if (matchesRule(rule, content, tagSet)) {
      candidates.push([idx, -(rule.weight ?? 1.0), rule]);
    }
  }

  if (candidates.length === 0) {
    return { matchedRule: null, targetKind: null, rationale: "no rule matched" };
  }

  // Sort: earliest first; among ties, highest weight wins (most negative -weight first)
  candidates.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    return a[1] - b[1];
  });

  const best = candidates[0]![2];
  const targetRaw = best.targetKind;
  const targetNorm = (targetRaw === null || REJECT_TARGETS.has(targetRaw)) ? null : targetRaw;

  return {
    matchedRule: best,
    targetKind: targetNorm,
    rationale: `rule [${best.patternKind}] ${JSON.stringify(best.pattern)} → ${best.targetKind ?? "reject"}`,
  };
}
