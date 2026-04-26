/**
 * Handler: get_rules — list active neuro-symbolic rules.
 *
 * Returns rules stored in the memory_rules table, optionally filtered
 * by scope or rule type.
 *
 * source: mcp_server/handlers/get_rules.py
 */

import { z } from "zod";

import { RuleScopeSchema, RuleSchema, RuleTypeSchema, type Rule } from "../types.js";

// ── Input schema ──────────────────────────────────────────────────────────────

/** source: get_rules.py inputSchema */
export const getRulesInputSchema = z.object({
  scope: RuleScopeSchema.optional(),
  rule_type: RuleTypeSchema.optional(),
  include_inactive: z.boolean().default(false),
});
export type GetRulesRequest = z.infer<typeof getRulesInputSchema>;

export const getRulesToolMeta = {
  title: "Get rules",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Enumerate active neuro-symbolic rules in the memory_rules table, optionally " +
    "filtered by scope (global/domain/directory) or rule_type (hard=filter, " +
    "soft=rerank, tag=attach metadata). Use this to audit which rules are shaping " +
    "recall before adding a new one or debugging unexpected results. Distinct from " +
    "`add_rule` (creates), `forget` (deletes a memory, not a rule), and " +
    "`get_methodology_graph` (cognitive graph, not the rules table). Read-only. " +
    "Latency ~30ms. Returns {rules: [{id, scope, scope_value, rule_type, condition, " +
    "action, priority, active, created_at}]}.",
} as const;

// ── Store port ────────────────────────────────────────────────────────────────

export interface RuleReadStore {
  getRulesForScope(scope: string): Promise<Rule[]>;
  getAllActiveRules(): Promise<Rule[]>;
  getAllRulesIncludingInactive(): Promise<Rule[]>;
}

// ── Response type ─────────────────────────────────────────────────────────────

export interface GetRulesResponse {
  total: number;
  rules: Rule[];
  by_scope: Record<string, number>;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * List active neuro-symbolic rules.
 *
 * source: get_rules.py handler()
 */
export async function getRulesHandler(
  rawArgs: unknown,
  store: RuleReadStore,
): Promise<GetRulesResponse> {
  const parseResult = getRulesInputSchema.safeParse(rawArgs ?? {});
  const args = parseResult.success ? parseResult.data : { include_inactive: false };

  const scopeFilter = parseResult.success ? args.scope : undefined;
  const typeFilter = parseResult.success ? args.rule_type : undefined;
  const includeInactive = parseResult.success ? args.include_inactive : false;

  let rules: Rule[];

  if (includeInactive && !scopeFilter) {
    rules = await store.getAllRulesIncludingInactive();
  } else if (scopeFilter) {
    rules = await store.getRulesForScope(scopeFilter);
  } else {
    rules = await store.getAllActiveRules();
  }

  if (typeFilter) {
    rules = rules.filter((r) => r.rule_type === typeFilter);
  }

  const byScope: Record<string, number> = {};
  for (const rule of rules) {
    const s = rule.scope ?? "global";
    byScope[s] = (byScope[s] ?? 0) + 1;
  }

  return { total: rules.length, rules, by_scope: byScope };
}
