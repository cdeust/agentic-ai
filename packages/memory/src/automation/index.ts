/**
 * automation — prospective-memory triggers + neuro-symbolic rules + CLAUDE.md sync.
 *
 * Public surface of packages/memory/src/automation.
 *
 * Kay design note: rules and triggers are runtime-configurable data, not
 * hard-coded logic. The engines here are pure evaluators that consume whatever
 * rules/triggers are loaded from the store at runtime. This is late binding:
 * the automation behaviour can change without a code change or redeploy.
 */

// Types (Zod schemas + TS types)
export * from "./types.js";

// Core engines (pure business logic — no I/O)
export {
  parseCondition,
  parseAction,
  getFieldValue,
  evaluateCondition,
  applyRules,
  validateRule,
} from "./rule-engine.js";

export {
  extractProspectiveIntents,
  checkTrigger,
  matchTriggers,
} from "./trigger-matcher.js";

export { applyClassifierRules } from "./classifier-rule-engine.js";

// Handler functions (I/O via injected store ports)
export {
  addRuleHandler,
  addRuleInputSchema,
  addRuleToolMeta,
  type RuleStore,
} from "./handlers/add-rule.js";

export {
  createTriggerHandler,
  createTriggerInputSchema,
  createTriggerToolMeta,
  type ProspectiveMemoryStore,
} from "./handlers/create-trigger.js";

export {
  getRulesHandler,
  getRulesInputSchema,
  getRulesToolMeta,
  type RuleReadStore,
  type GetRulesResponse,
} from "./handlers/get-rules.js";

export {
  syncInstructionsHandler,
  syncInstructionsInputSchema,
  syncInstructionsToolMeta,
  extractInsights,
  buildSection,
  type MemoryReadStore,
  type MemoryRecord,
} from "./handlers/sync-to-claude-md.js";
