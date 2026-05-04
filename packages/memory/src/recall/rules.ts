/**
 * Neuro-symbolic rules engine — apply curation rules to recall results.
 *
 * Port of: mcp_server/core/memory_rules.py::apply_rules
 *
 * This module ports the apply_rules function used directly by the recall
 * handler. The full rule engine (condition parsing, validate_rule,
 * evaluate_condition) is ported in automation/rule-engine.ts; that module
 * owns the full MemoryRule DSL. This file retains a simpler MemoryRule
 * type that matches the shape returned by MemoryStore.getAllActiveRules()
 * (pattern + action strings already resolved), so recall does not need
 * to depend on the automation layer.
 *
 * source: cortex@ed33435 mcp_server/core/memory_rules.py:apply_rules
 */

// source: cortex@ed33435 mcp_server/core/memory_rules.py — default score adjustments
const DEFAULT_BOOST = 0.1;
const DEFAULT_PENALTY = 0.1;

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
            score *= 1 + (rule.boost ?? DEFAULT_BOOST);
            break;
          case "penalize":
            score *= 1 - (rule.penalty ?? DEFAULT_PENALTY);
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
