/**
 * Automation DSL types — prospective-memory triggers + neuro-symbolic rules.
 *
 * source: Einstein, G. O. & McDaniel, M. A. (2005). "Prospective memory:
 *   Multiple retrieval processes." Current Directions in Psychological
 *   Science, 14(6), 286–290.
 * source: Marsh, R. L., Hicks, J. L., & Bink, M. L. (1998). "Activation of
 *   completed, uncompleted, and partially completed intentions." Journal of
 *   Experimental Psychology: Learning, Memory, and Cognition, 24(2), 350–361.
 *
 * Design note (Kay): the rule DSL is the load-bearing surface here — rules
 * are data, not code. The engine (rule-engine.ts) resolves them at runtime,
 * so new rule types can be added without touching the evaluation loop.
 * This is late binding: the set of rules is determined at runtime from the
 * store, not hard-coded at build time.
 */

import { z } from "zod";

// ── Trigger types ─────────────────────────────────────────────────────────────

/**
 * The four trigger mechanisms for prospective memory.
 * source: create_trigger.py handler documentation; prospective.py VALID_TRIGGER_TYPES
 */
export const TriggerTypeSchema = z.enum([
  "keyword",
  "time",
  "file",
  "domain",
  "keyword_match",
  "directory_match",
  "entity_match",
  "time_based",
]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const TriggerSchema = z.object({
  id: z.string().optional(),
  content: z.string().min(1),
  trigger_condition: z.string().min(1),
  trigger_type: TriggerTypeSchema.default("keyword"),
  target_directory: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  triggered_count: z.number().int().nonnegative().default(0),
  created_at: z.string().datetime().optional(),
});
export type Trigger = z.infer<typeof TriggerSchema>;

export const TriggerContextSchema = z.object({
  directory: z.string().default(""),
  content: z.string().default(""),
  entities: z.array(z.string()).default([]),
  /** ISO 8601 datetime string; defaults to now when omitted */
  current_time: z.string().datetime().optional(),
});
export type TriggerContext = z.infer<typeof TriggerContextSchema>;

export const TriggerConditionSchema = z.object({
  trigger: TriggerSchema,
  context: TriggerContextSchema,
});
export type TriggerCondition = z.infer<typeof TriggerConditionSchema>;

// ── Rule types ────────────────────────────────────────────────────────────────

/**
 * Neuro-symbolic rule types:
 *   hard  — exclude memories matching the condition (hard filter)
 *   soft  — boost or penalize matching memories (score adjustment)
 *   tag   — attach metadata tag to matching memories
 *
 * source: memory_rules.py
 */
export const RuleTypeSchema = z.enum(["hard", "soft", "tag"]);
export type RuleType = z.infer<typeof RuleTypeSchema>;

export const RuleScopeSchema = z.enum(["global", "domain", "directory"]);
export type RuleScope = z.infer<typeof RuleScopeSchema>;

export const RuleSchema = z.object({
  id: z.number().int().optional(),
  rule_type: RuleTypeSchema.default("soft"),
  scope: RuleScopeSchema.default("global"),
  scope_value: z.string().nullable().optional(),
  condition: z.string().min(1),
  action: z.string().min(1),
  priority: z.number().int().min(-100).max(100).default(0),
  is_active: z.boolean().default(true),
  created_at: z.string().datetime().optional(),
});
export type Rule = z.infer<typeof RuleSchema>;

/**
 * Parsed condition: field + operator + value triple.
 * source: memory_rules.py parse_condition()
 */
export const ParsedConditionSchema = z.object({
  field: z.string(),
  operator: z.enum([
    "==",
    "!=",
    "contains",
    "not_contains",
    ">",
    "<",
    ">=",
    "<=",
    "matches",
  ]),
  value: z.string(),
});
export type ParsedCondition = z.infer<typeof ParsedConditionSchema>;

/**
 * Parsed action: type + optional numeric delta.
 * source: memory_rules.py parse_action()
 */
export const ParsedActionSchema = z.object({
  action_type: z.enum(["filter", "boost", "penalty"]),
  value: z.number().default(0),
});
export type ParsedAction = z.infer<typeof ParsedActionSchema>;

// ── Rule action results ───────────────────────────────────────────────────────

export const RuleActionSchema = z.object({
  rule_id: z.number().int().optional(),
  rule_type: RuleTypeSchema,
  matched: z.boolean(),
  action: z.string(),
});
export type RuleAction = z.infer<typeof RuleActionSchema>;

// ── Classifier rule (wiki_rule_engine) ───────────────────────────────────────

export const PatternKindSchema = z.enum(["prefix", "regex", "substring", "tag"]);
export type PatternKind = z.infer<typeof PatternKindSchema>;

export const ClassifierRuleSchema = z.object({
  pattern_kind: PatternKindSchema,
  pattern: z.string(),
  target_kind: z.string().nullable().optional(),
  weight: z.number().default(1.0),
  note: z.string().optional(),
});
export type ClassifierRule = z.infer<typeof ClassifierRuleSchema>;

export const RuleMatchSchema = z.object({
  matched_rule: ClassifierRuleSchema.nullable(),
  target_kind: z.string().nullable(),
  rationale: z.string(),
});
export type RuleMatch = z.infer<typeof RuleMatchSchema>;

// ── Automation request/response ───────────────────────────────────────────────

export const AddRuleRequestSchema = z.object({
  condition: z.string().min(1),
  action: z.string().min(1),
  rule_type: RuleTypeSchema.default("soft"),
  scope: RuleScopeSchema.default("global"),
  scope_value: z.string().optional(),
  priority: z.number().int().min(-100).max(100).default(0),
});
export type AddRuleRequest = z.infer<typeof AddRuleRequestSchema>;

export const AddRuleResponseSchema = z.object({
  created: z.boolean(),
  rule_id: z.number().int().optional(),
  rule_type: RuleTypeSchema.optional(),
  scope: RuleScopeSchema.optional(),
  scope_value: z.string().nullable().optional(),
  condition: z.string().optional(),
  action: z.string().optional(),
  priority: z.number().int().optional(),
  reason: z.string().optional(),
});
export type AddRuleResponse = z.infer<typeof AddRuleResponseSchema>;

export const CreateTriggerRequestSchema = z.object({
  content: z.string().min(1),
  trigger_condition: z.string().min(1),
  trigger_type: TriggerTypeSchema.default("keyword"),
  target_directory: z.string().optional(),
});
export type CreateTriggerRequest = z.infer<typeof CreateTriggerRequestSchema>;

export const CreateTriggerResponseSchema = z.object({
  created: z.boolean(),
  trigger_id: z.string().optional(),
  trigger_type: TriggerTypeSchema.optional(),
  trigger_condition: z.string().optional(),
  content: z.string().optional(),
  target_directory: z.string().nullable().optional(),
  active_triggers: z.number().int().optional(),
  reason: z.string().optional(),
});
export type CreateTriggerResponse = z.infer<typeof CreateTriggerResponseSchema>;

export const SyncInstructionsRequestSchema = z.object({
  directory: z.string().optional(),
  max_insights: z.number().int().min(1).max(50).default(10),
  min_heat: z.number().min(0).max(1).default(0.3),
  dry_run: z.boolean().default(false),
});
export type SyncInstructionsRequest = z.infer<typeof SyncInstructionsRequestSchema>;

export const SyncInstructionsResponseSchema = z.object({
  synced: z.boolean(),
  action: z.string().optional(),
  path: z.string().optional(),
  insights_count: z.number().int().optional(),
  memory_count: z.number().int().optional(),
  dry_run: z.boolean().optional(),
  preview: z.string().optional(),
  reason: z.string().optional(),
  directory: z.string().optional(),
});
export type SyncInstructionsResponse = z.infer<typeof SyncInstructionsResponseSchema>;

/**
 * Unified automation request envelope — routes to the appropriate handler.
 * The operation field is the late-binding dispatch key: callers specify what
 * they want done; the router decides at runtime which handler executes it.
 */
export const AutomationRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("add_rule"), params: AddRuleRequestSchema }),
  z.object({
    operation: z.literal("create_trigger"),
    params: CreateTriggerRequestSchema,
  }),
  z.object({
    operation: z.literal("sync_instructions"),
    params: SyncInstructionsRequestSchema,
  }),
]);
export type AutomationRequest = z.infer<typeof AutomationRequestSchema>;
