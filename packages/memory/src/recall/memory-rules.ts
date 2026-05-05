/**
 * Neuro-symbolic rules engine — hard constraints and soft preferences over retrieval.
 *
 * Implements condition parsing (field, operator, value) and evaluation against
 * memory dicts. Hard rules filter, soft rules boost/penalize retrieval scores.
 *
 * Port of: mcp_server/core/memory_rules.py
 * Pure business logic — no I/O. Rule storage is handled by the caller.
 */

/** Simple glob match for 'matches' operator (supports * and ? wildcards). */
function globMatch(str: string, pattern: string): boolean {
  // Escape regex special chars except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    return new RegExp(`^${regexStr}$`).test(str);
  } catch {
    return false;
  }
}

/** Valid condition operators */
export const VALID_OPERATORS = new Set<string>([
  "==", "!=", "contains", "not_contains", ">", "<", ">=", "<=", "matches",
]);

/** Fields that use numeric comparison */
export const NUMERIC_FIELDS = new Set<string>([
  "heat", "importance", "surprise_score", "confidence", "emotional_valence",
  "plasticity", "stability", "excitability", "access_count", "useful_count",
  "compression_level", "reconsolidation_count",
]);

export type ConditionTuple = [field: string, operator: string, value: string];

/**
 * Parse a condition string into [field, operator, value].
 *
 * Examples:
 *   "importance > 0.7"  → ["importance", ">", "0.7"]
 *   "tag contains architecture" → ["tag", "contains", "architecture"]
 *   "content not_contains password" → ["content", "not_contains", "password"]
 *   "directory_context matches /project/*" → ["directory_context", "matches", "/project/*"]
 *
 * Precondition: condition is a non-empty string.
 * Postcondition: returns a 3-tuple or throws Error if condition cannot be parsed.
 */
export function parseCondition(condition: string): ConditionTuple {
  // Helper: split on first occurrence and return tuple
  function splitOn(sep: string): ConditionTuple {
    const idx = condition.indexOf(` ${sep} `);
    const field = condition.slice(0, idx).trim();
    const value = condition.slice(idx + sep.length + 2).trim();
    return [field, sep, value];
  }

  // Multi-word operators first
  if (condition.includes(" not_contains ")) return splitOn("not_contains");
  // Two-char operators
  if (condition.includes(" >= ")) return splitOn(">=");
  if (condition.includes(" <= ")) return splitOn("<=");
  if (condition.includes(" == ")) return splitOn("==");
  if (condition.includes(" != ")) return splitOn("!=");
  // Single-char operators
  if (condition.includes(" > ")) return splitOn(">");
  if (condition.includes(" < ")) return splitOn("<");
  // Word operators
  if (condition.includes(" contains ")) return splitOn("contains");
  if (condition.includes(" matches ")) return splitOn("matches");

  throw new Error(`Cannot parse condition: ${JSON.stringify(condition)}`);
}

/**
 * Parse an action string into [actionType, value].
 *
 * "filter"     → ["filter", 0.0]
 * "boost:0.3"  → ["boost", 0.3]
 * "penalty:0.2"→ ["penalty", 0.2]
 *
 * Precondition: action is a non-empty string.
 * Postcondition: returns a tuple or throws Error on invalid action.
 */
export function parseAction(action: string): [string, number] {
  if (action === "filter") return ["filter", 0.0];
  if (action.startsWith("boost:")) {
    return ["boost", parseFloat(action.slice("boost:".length))];
  }
  if (action.startsWith("penalty:")) {
    return ["penalty", parseFloat(action.slice("penalty:".length))];
  }
  throw new Error(`Invalid action: ${JSON.stringify(action)}`);
}

/**
 * Get a field value from a memory object.
 *
 * Supports direct fields plus 'tag'/'tags' which checks the tags list,
 * and tag-key:value pairs (e.g., "language" checks for "language:python" tags).
 *
 * Postcondition: returns the field value or null/undefined if not found.
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
  // Check for key:value tags
  const tags = memory["tags"];
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag !== "string") continue;
      if (tag.includes(":")) {
        const colonIdx = tag.indexOf(":");
        const kColon = tag.slice(0, colonIdx).trim();
        const vColon = tag.slice(colonIdx + 1).trim();
        if (kColon === field) return vColon;
      } else if (tag.includes("=")) {
        const eqIdx = tag.indexOf("=");
        const kEq = tag.slice(0, eqIdx).trim();
        const vEq = tag.slice(eqIdx + 1).trim();
        if (kEq === field) return vEq;
      }
    }
  }
  return null;
}

function evaluateNumeric(
  fieldValue: unknown,
  operator: string,
  value: string,
): boolean {
  try {
    const numField = typeof fieldValue === "number" ? fieldValue : parseFloat(String(fieldValue));
    const numValue = parseFloat(value);
    if (isNaN(numField) || isNaN(numValue)) return false;
    if (operator === ">") return numField > numValue;
    if (operator === "<") return numField < numValue;
    if (operator === ">=") return numField >= numValue;
    if (operator === "<=") return numField <= numValue;
  } catch {
    return false;
  }
  return false;
}

function evaluateEquality(
  field: string,
  fieldValue: unknown,
  operator: string,
  value: string,
): boolean {
  const isEqual = operator === "==";
  if (NUMERIC_FIELDS.has(field)) {
    try {
      const result = parseFloat(String(fieldValue)) === parseFloat(value);
      return isEqual ? result : !result;
    } catch {
      // fall through
    }
  }
  const strMatch = String(fieldValue).toLowerCase() === value.toLowerCase();
  return isEqual ? strMatch : !strMatch;
}

function evaluateContains(
  fieldValue: unknown,
  value: string,
  negate: boolean,
): boolean {
  let found: boolean;
  if (Array.isArray(fieldValue)) {
    found = fieldValue.some((item) =>
      String(item).toLowerCase().includes(value.toLowerCase()),
    );
  } else {
    found = String(fieldValue).toLowerCase().includes(value.toLowerCase());
  }
  return negate ? !found : found;
}

/**
 * Evaluate a parsed condition against a memory object.
 *
 * Returns true if the condition is satisfied.
 * Returns true on parse errors (fail open).
 *
 * Precondition: condition is a string; memory is a non-null object.
 * Postcondition: returns a boolean.
 */
export function evaluateCondition(condition: string, memory: Record<string, unknown>): boolean {
  let field: string, operator: string, value: string;
  try {
    [field, operator, value] = parseCondition(condition);
  } catch {
    return true; // fail open
  }

  let fieldValue = getFieldValue(memory, field);
  if (fieldValue == null) {
    fieldValue = [">" , "<", ">=", "<="].includes(operator) ? 0.0 : "";
  }

  if ([">", "<", ">=", "<="].includes(operator)) {
    return evaluateNumeric(fieldValue, operator, value);
  }
  if (["==", "!="].includes(operator)) {
    return evaluateEquality(field, fieldValue, operator, value);
  }
  if (operator === "contains") return evaluateContains(fieldValue, value, false);
  if (operator === "not_contains") return evaluateContains(fieldValue, value, true);
  if (operator === "matches") {
    return globMatch(String(fieldValue), value);
  }
  return true;
}

function applySoftRule(
  memories: Record<string, unknown>[],
  condition: string,
  action: string,
  scoreField: string,
): void {
  let actionType: string;
  let actionValue: number;
  try {
    [actionType, actionValue] = parseAction(action);
  } catch {
    return;
  }
  for (const m of memories) {
    if (evaluateCondition(condition, m)) {
      const score = (m[scoreField] as number | undefined) ?? 0.0;
      if (actionType === "boost") m[scoreField] = score + actionValue;
      else if (actionType === "penalty") m[scoreField] = score - actionValue;
    }
  }
}

/**
 * Apply rules to filter and re-rank a list of memories.
 *
 * Hard rules (rule_type="hard") filter out non-matching memories.
 * Soft rules (rule_type="soft") adjust the score field via boost/penalty.
 *
 * @param memories - List of memory objects (must have scoreField).
 * @param rules - List of rule objects with rule_type, condition, action.
 * @param scoreField - Name of the score field to adjust.
 * @returns Filtered and re-ranked list.
 *
 * Precondition: memories and rules are arrays; scoreField is a non-empty string.
 * Postcondition: every memory in result also appeared in input memories;
 *   result is sorted descending by scoreField.
 */
export function applyRules(
  memories: Record<string, unknown>[],
  rules: Record<string, unknown>[],
  scoreField: string = "score",
): Record<string, unknown>[] {
  let result = [...memories];

  for (const rule of rules) {
    const ruleType = (rule["rule_type"] ?? "soft") as string;
    const condition = (rule["condition"] ?? "") as string;
    if (!condition) continue;

    if (ruleType === "hard") {
      result = result.filter((m) => evaluateCondition(condition, m));
    } else if (ruleType === "soft") {
      applySoftRule(result, condition, (rule["action"] ?? "") as string, scoreField);
    }
  }

  result.sort(
    (a, b) => ((b[scoreField] as number) ?? 0) - ((a[scoreField] as number) ?? 0),
  );
  return result;
}

/**
 * Validate a rule definition. Returns list of error messages (empty = valid).
 *
 * Precondition: ruleType, condition, action are strings.
 * Postcondition: returns empty array if and only if the rule is valid.
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
    const [actionType] = parseAction(action);
    if (ruleType === "hard" && actionType !== "filter") {
      errors.push("Hard rules must use 'filter' action");
    }
  } catch (e) {
    errors.push(String(e));
  }

  return errors;
}
