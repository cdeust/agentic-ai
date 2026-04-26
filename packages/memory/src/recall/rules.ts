/**
 * Neuro-symbolic rules engine — apply curation rules to recall results.
 *
 * Port of: mcp_server/core/memory_rules.py::apply_rules
 *
 * The full rules engine (pattern matching, rule persistence) is in the
 * port/cortex-automation scope. This module ports only the apply_rules
 * function used directly by the recall handler.
 *
 * TODO(port-pending): Full rule evaluation (evaluate_rules, MemoryRule)
 * requires porting mcp_server/core/memory_rules.py — assign to
 * port/cortex-automation worktree.
 */

// ── Rule shape ─────────────────────────────────────────────────────────────

export interface MemoryRule {
  id: number;
  rule_type: string;
  pattern?: string;
  action: string;
  boost?: number;
  penalty?: number;
  active: boolean;
}

// ── Rule application ───────────────────────────────────────────────────────

/**
 * Apply a set of active neuro-symbolic rules to a list of scored results.
 *
 * Currently supported rule types:
 *   - "boost": multiply score by (1 + rule.boost) when pattern matches content
 *   - "penalize": multiply score by (1 - rule.penalty) when pattern matches content
 *   - "pin": force score to 1.0 (always surfaces this memory)
 *   - "suppress": force score to 0.0 (removes memory from results)
 *
 * Results with score <= 0 after rule application are removed.
 *
 * Port of: mcp_server/core/memory_rules.py::apply_rules
 */
export function applyRules(
  results: Array<Record<string, unknown>>,
  rules: MemoryRule[],
  scoreField = "score",
): Array<Record<string, unknown>> {
  if (rules.length === 0) return results;

  return results
    .map((result) => {
      let score = (result[scoreField] as number) ?? 0;
      const content = (result["content"] as string) ?? "";

      for (const rule of rules) {
        if (!rule.active) continue;
        const matches =
          !rule.pattern ||
          content.toLowerCase().includes(rule.pattern.toLowerCase());
        if (!matches) continue;

        switch (rule.action) {
          case "boost":
            score *= 1 + (rule.boost ?? 0.1);
            break;
          case "penalize":
            score *= 1 - (rule.penalty ?? 0.1);
            break;
          case "pin":
            score = 1.0;
            break;
          case "suppress":
            score = 0.0;
            break;
        }
      }

      return { ...result, [scoreField]: score };
    })
    .filter((result) => ((result[scoreField] as number) ?? 0) > 0);
}
