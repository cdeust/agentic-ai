/**
 * Handler: add_rule — add a neuro-symbolic rule to the memory system.
 *
 * Rules are stored in the memory_rules table and applied during recall to
 * hard-filter or soft-rerank results.
 *
 * Rule types:
 *   hard  — exclude memories matching the condition from results
 *   soft  — boost or penalize matching memories (action = "boost:N" | "penalty:N")
 *   tag   — apply a tag to matching memories on retrieval
 *
 * Scopes:
 *   global    — applies everywhere
 *   domain    — applies only within a named domain (scope_value = domain name)
 *   directory — applies within a project directory
 *
 * source: mcp_server/handlers/add_rule.py
 */

import { validateRule } from "../rule-engine.js";
import {
  AddRuleRequestSchema,
  type AddRuleRequest,
  type AddRuleResponse,
} from "../types.js";

// ── Store port ────────────────────────────────────────────────────────────────

/**
 * Minimal interface the handler requires from the store layer.
 * The store is injected at construction time (DIP).
 */
export interface RuleStore {
  insertRule(rule: {
    rule_type: string;
    scope: string;
    scope_value: string | null;
    condition: string;
    action: string;
    priority: number;
    is_active: boolean;
  }): Promise<number>;
}

// ── Input schema ──────────────────────────────────────────────────────────────

/** source: add_rule.py inputSchema */
export const addRuleInputSchema = AddRuleRequestSchema;

export const addRuleToolMeta = {
  title: "Add rule",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Insert a neuro-symbolic rule into memory_rules so the `apply_rules` engine " +
    "applies it on every subsequent recall — hard-filter (exclude), soft-rerank " +
    "(boost/penalty), or tag the matching memories. Conditions match on tags / " +
    "keywords / metadata; actions specify the effect. Scopes: global, domain, " +
    "directory; resolved by priority then specificity. Use this to encode operating " +
    "principles like `never surface deprecated memories` or `boost lessons in the " +
    "recall pipeline`. Distinct from `create_trigger` (proactive prospective memory, " +
    "fires on context match — not a recall filter), and from `anchor` (per-memory pin, " +
    "not a population rule). Mutates the memory_rules table; effect is visible at the " +
    "next `recall` call. Latency ~20ms. Returns {rule_id, condition, action, scope, priority}.",
} as const;

// ── Validation ────────────────────────────────────────────────────────────────

function validateArgs(args: AddRuleRequest): string | null {
  const { condition, action, rule_type, scope, scope_value } = args;

  const ruleErrors = validateRule(rule_type, condition, action);
  if (ruleErrors.length > 0) {
    return ruleErrors[0] ?? "invalid rule";
  }

  if ((scope === "domain" || scope === "directory") && !scope_value) {
    return `scope_value required when scope=${scope}`;
  }

  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Add a neuro-symbolic rule.
 *
 * source: add_rule.py handler()
 */
export async function addRuleHandler(
  rawArgs: unknown,
  store: RuleStore,
): Promise<AddRuleResponse> {
  const parseResult = AddRuleRequestSchema.safeParse(rawArgs);
  if (!parseResult.success) {
    return {
      created: false,
      reason: parseResult.error.issues[0]?.message ?? "invalid arguments",
    };
  }

  const args = parseResult.data;

  const validationError = validateArgs(args);
  if (validationError !== null) {
    return { created: false, reason: validationError };
  }

  const ruleId = await store.insertRule({
    rule_type: args.rule_type,
    scope: args.scope,
    scope_value: args.scope_value ?? null,
    condition: args.condition,
    action: args.action,
    priority: args.priority,
    is_active: true,
  });

  return {
    created: true,
    rule_id: ruleId,
    rule_type: args.rule_type,
    scope: args.scope,
    scope_value: args.scope_value ?? null,
    condition: args.condition,
    action: args.action,
    priority: args.priority,
  };
}

// ── Convenience re-export ─────────────────────────────────────────────────────

export type { AddRuleRequest, AddRuleResponse };
