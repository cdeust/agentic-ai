/**
 * Neuro-symbolic rule engine — hard constraints and soft preferences over
 * retrieval.
 *
 * Implements condition parsing (field, operator, value) and evaluation against
 * memory dicts. Hard rules filter; soft rules boost/penalize retrieval scores.
 *
 * Pure business logic — no I/O. Rule storage is handled by the caller.
 *
 * source: mcp_server/core/memory_rules.py
 */

import { minimatch } from "minimatch";

import type {
  ParsedAction,
  ParsedCondition,
  Rule,
} from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fields that use numeric comparison semantics. source: memory_rules.py NUMERIC_FIELDS */
const NUMERIC_FIELDS = new Set<string>([
  "heat",
  "importance",
  "surprise_score",
  "confidence",
  "emotional_valence",
  "plasticity",
  "stability",
  "excitability",
  "access_count",
  "useful_count",
  "compression_level",
  "reconsolidation_count",
]);

const REJECT_TARGETS = new Set<string | null | undefined>([
  "reject",
  "-",
  "",
  null,
  undefined,
  "none",
]);

// ── Condition parsing ─────────────────────────────────────────────────────────

/**
 * Parse a condition string into a {field, operator, value} triple.
 *
 * Examples:
 *   "importance > 0.7"           → {field:"importance", operator:">", value:"0.7"}
 *   "tag contains architecture"  → {field:"tag", operator:"contains", value:"architecture"}
 *   "content not_contains pass"  → {field:"content", operator:"not_contains", value:"pass"}
 *   "dir matches /project/*"     → {field:"dir", operator:"matches", value:"/project/*"}
 *
 * source: memory_rules.py parse_condition()
 */
export function parseCondition(condition: string): ParsedCondition {
  // Multi-word operators first
  const notContainsSplit = condition.split(" not_contains ", 2);
  if (notContainsSplit.length === 2) {
    return {
      field: (notContainsSplit[0] as string).trim(),
      operator: "not_contains",
      value: (notContainsSplit[1] as string).trim(),
    };
  }

  // Two-char operators
  for (const op of [">=", "<=", "==", "!="] as const) {
    const parts = condition.split(` ${op} `, 2);
    if (parts.length === 2) {
      return {
        field: (parts[0] as string).trim(),
        operator: op,
        value: (parts[1] as string).trim(),
      };
    }
  }

  // Single-char operators
  for (const op of [">", "<"] as const) {
    const parts = condition.split(` ${op} `, 2);
    if (parts.length === 2) {
      return {
        field: (parts[0] as string).trim(),
        operator: op,
        value: (parts[1] as string).trim(),
      };
    }
  }

  // Word operators
  for (const op of ["contains", "matches"] as const) {
    const parts = condition.split(` ${op} `, 2);
    if (parts.length === 2) {
      return {
        field: (parts[0] as string).trim(),
        operator: op,
        value: (parts[1] as string).trim(),
      };
    }
  }

  throw new Error(`Cannot parse condition: ${JSON.stringify(condition)}`);
}

/**
 * Parse an action string into {action_type, value}.
 *
 * "filter"      → {action_type:"filter", value:0}
 * "boost:0.3"   → {action_type:"boost",  value:0.3}
 * "penalty:0.2" → {action_type:"penalty", value:0.2}
 *
 * source: memory_rules.py parse_action()
 */
export function parseAction(action: string): ParsedAction {
  if (action === "filter") {
    return { action_type: "filter", value: 0 };
  }
  if (action.startsWith("boost:")) {
    return { action_type: "boost", value: parseFloat(action.slice(6)) };
  }
  if (action.startsWith("penalty:")) {
    return { action_type: "penalty", value: parseFloat(action.slice(8)) };
  }
  throw new Error(`Invalid action: ${JSON.stringify(action)}`);
}

// ── Field extraction ──────────────────────────────────────────────────────────

/**
 * Get a field value from a memory dict.
 *
 * Supports direct fields plus "tag"/"tags" which checks the tags list,
 * and tag-key:value pairs (e.g., "language" checks for "language:python" tags).
 *
 * source: memory_rules.py get_field_value()
 */
export function getFieldValue(
  memory: Record<string, unknown>,
  field: string,
): unknown {
  if (field === "tag" || field === "tags") {
    return memory["tags"] ?? [];
  }
  if (field in memory) {
    return memory[field];
  }
  // Check for key:value or key=value tags
  const tags = memory["tags"];
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      const tagStr = String(tag);
      if (tagStr.includes(":")) {
        const colonIdx = tagStr.indexOf(":");
        const key = tagStr.slice(0, colonIdx).trim();
        if (key === field) return tagStr.slice(colonIdx + 1).trim();
      } else if (tagStr.includes("=")) {
        const eqIdx = tagStr.indexOf("=");
        const key = tagStr.slice(0, eqIdx).trim();
        if (key === field) return tagStr.slice(eqIdx + 1).trim();
      }
    }
  }
  return undefined;
}

// ── Operator evaluation ───────────────────────────────────────────────────────

function evaluateNumeric(
  fieldValue: unknown,
  operator: ">" | "<" | ">=" | "<=",
  value: string,
): boolean {
  const numField =
    typeof fieldValue === "number" ? fieldValue : parseFloat(String(fieldValue));
  const numValue = parseFloat(value);
  if (isNaN(numField) || isNaN(numValue)) return false;
  if (operator === ">") return numField > numValue;
  if (operator === "<") return numField < numValue;
  if (operator === ">=") return numField >= numValue;
  return numField <= numValue;
}

function evaluateEquality(
  field: string,
  fieldValue: unknown,
  operator: "==" | "!=",
  value: string,
): boolean {
  const isEqual = operator === "==";
  if (NUMERIC_FIELDS.has(field)) {
    const n = parseFloat(String(fieldValue));
    const v = parseFloat(value);
    if (!isNaN(n) && !isNaN(v)) {
      return isEqual ? n === v : n !== v;
    }
  }
  const strMatch =
    String(fieldValue).toLowerCase() === value.toLowerCase();
  return isEqual ? strMatch : !strMatch;
}

function evaluateContains(
  fieldValue: unknown,
  value: string,
  negate: boolean,
): boolean {
  const needle = value.toLowerCase();
  let found: boolean;
  if (Array.isArray(fieldValue)) {
    found = fieldValue.some((item) =>
      String(item).toLowerCase().includes(needle),
    );
  } else {
    found = String(fieldValue).toLowerCase().includes(needle);
  }
  return negate ? !found : found;
}

// ── Core evaluation ───────────────────────────────────────────────────────────

/**
 * Evaluate a parsed condition string against a memory dict.
 *
 * Returns true if the condition is satisfied.
 * Returns true on parse errors (fail-open — same as Python original).
 *
 * source: memory_rules.py evaluate_condition()
 */
export function evaluateCondition(
  condition: string,
  memory: Record<string, unknown>,
): boolean {
  let parsed: ParsedCondition;
  try {
    parsed = parseCondition(condition);
  } catch {
    return true; // fail-open on parse error
  }

  const { field, operator, value } = parsed;
  let fieldValue = getFieldValue(memory, field);

  if (fieldValue === undefined || fieldValue === null) {
    fieldValue = operator === ">" || operator === "<" || operator === ">=" || operator === "<="
      ? 0.0
      : "";
  }

  if (operator === ">" || operator === "<" || operator === ">=" || operator === "<=") {
    return evaluateNumeric(fieldValue, operator, value);
  }
  if (operator === "==" || operator === "!=") {
    return evaluateEquality(field, fieldValue, operator, value);
  }
  if (operator === "contains") {
    return evaluateContains(fieldValue, value, false);
  }
  if (operator === "not_contains") {
    return evaluateContains(fieldValue, value, true);
  }
  if (operator === "matches") {
    // source: memory_rules.py — Python fnmatch is glob-style matching
    return minimatch(String(fieldValue), value);
  }
  return true;
}

// ── Rule application ──────────────────────────────────────────────────────────

function applySoftRule(
  memories: Array<Record<string, unknown>>,
  condition: string,
  action: string,
  scoreField: string,
): void {
  let parsed: ParsedAction;
  try {
    parsed = parseAction(action);
  } catch {
    return;
  }
  for (const m of memories) {
    if (evaluateCondition(condition, m)) {
      const score = typeof m[scoreField] === "number" ? (m[scoreField] as number) : 0.0;
      if (parsed.action_type === "boost") {
        m[scoreField] = score + parsed.value;
      } else if (parsed.action_type === "penalty") {
        m[scoreField] = score - parsed.value;
      }
    }
  }
}

/**
 * Apply rules to filter and re-rank a list of memories.
 *
 * Hard rules (rule_type="hard") filter out non-matching memories.
 * Soft rules (rule_type="soft") adjust the score field via boost/penalty.
 *
 * Kay note: rules are resolved at runtime from the `rules` array passed in.
 * The caller loads them from the store; this function is a pure evaluator.
 * Adding a new rule requires no code change — only a new row in the store.
 *
 * source: memory_rules.py apply_rules()
 */
export function applyRules(
  memories: ReadonlyArray<Record<string, unknown>>,
  rules: ReadonlyArray<Rule>,
  scoreField = "score",
): Array<Record<string, unknown>> {
  let result = [...memories] as Array<Record<string, unknown>>;

  for (const rule of rules) {
    const condition = rule.condition;
    if (!condition) continue;

    if (rule.rule_type === "hard") {
      result = result.filter((m) => evaluateCondition(condition, m));
    } else if (rule.rule_type === "soft") {
      applySoftRule(result, condition, rule.action, scoreField);
    }
  }

  result.sort((a, b) => {
    const as = typeof a[scoreField] === "number" ? (a[scoreField] as number) : 0;
    const bs = typeof b[scoreField] === "number" ? (b[scoreField] as number) : 0;
    return bs - as;
  });

  return result;
}

/**
 * Validate a rule definition. Returns list of error messages (empty = valid).
 *
 * source: memory_rules.py validate_rule()
 */
export function validateRule(
  ruleType: string,
  condition: string,
  action: string,
): string[] {
  const errors: string[] = [];

  if (ruleType !== "hard" && ruleType !== "soft") {
    errors.push(`rule_type must be 'hard' or 'soft', got ${JSON.stringify(ruleType)}`);
  }

  try {
    parseCondition(condition);
  } catch (e) {
    errors.push(String(e));
  }

  try {
    const { action_type } = parseAction(action);
    if (ruleType === "hard" && action_type !== "filter") {
      errors.push("Hard rules must use 'filter' action");
    }
  } catch (e) {
    errors.push(String(e));
  }

  return errors;
}
