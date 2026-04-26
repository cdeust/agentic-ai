/**
 * Handler: create_trigger — create a prospective memory trigger.
 *
 * Prospective memory is future-oriented: "remind me when X happens".
 * Triggers are stored in the prospective_memories table and checked at
 * session start and on demand.
 *
 * Trigger types:
 *   keyword  — fires when the user's message contains the keyword
 *   time     — fires after a specified ISO datetime
 *   file     — fires when a specific file is accessed/modified
 *   domain   — fires when a specific domain becomes active
 *
 * source: mcp_server/handlers/create_trigger.py
 * source: Einstein, G. O. & McDaniel, M. A. (2005). "Prospective memory:
 *   Multiple retrieval processes." Current Directions in Psychological
 *   Science, 14(6), 286–290.
 */

import {
  CreateTriggerRequestSchema,
  TriggerTypeSchema,
  type CreateTriggerRequest,
  type CreateTriggerResponse,
  type TriggerType,
} from "../types.js";

// ── Store port ────────────────────────────────────────────────────────────────

export interface ProspectiveMemoryStore {
  insertProspectiveMemory(record: {
    content: string;
    trigger_condition: string;
    trigger_type: string;
    target_directory: string | null;
    is_active: boolean;
    triggered_count: number;
  }): Promise<string>;

  countActiveTriggers(): Promise<number>;
}

// ── Tool metadata ─────────────────────────────────────────────────────────────

/** source: create_trigger.py schema */
export const createTriggerInputSchema = CreateTriggerRequestSchema;

export const createTriggerToolMeta = {
  title: "Create trigger",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Create a prospective-memory trigger that Cortex auto-fires when its " +
    "condition matches future context (Einstein & McDaniel 2005). Trigger " +
    "types: `keyword` (fires when user message contains string), `time` " +
    "(fires after ISO datetime), `file` (fires when path is accessed/modified), " +
    "`domain` (fires when that cognitive domain becomes active). Triggers are " +
    "checked at session start (via `query_methodology`) and on demand. Use this " +
    "to leave instructions for a future session — `next time we touch X, " +
    "remember Y` — that you would otherwise forget. Distinct from `add_rule` " +
    "(passive recall filter applied to ALL queries, no context-match firing), " +
    "`anchor` (pins a memory but doesn't fire), and `remember` (records a fact, " +
    "doesn't activate on context). Mutates the prospective_memories table. " +
    "Latency ~30ms. Returns {trigger_id, trigger_type, trigger_condition, content_preview}.",
} as const;

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Create a prospective memory trigger.
 *
 * source: create_trigger.py handler()
 */
export async function createTriggerHandler(
  rawArgs: unknown,
  store: ProspectiveMemoryStore,
): Promise<CreateTriggerResponse> {
  const parseResult = CreateTriggerRequestSchema.safeParse(rawArgs);
  if (!parseResult.success) {
    return {
      created: false,
      reason: parseResult.error.issues[0]?.message ?? "invalid arguments",
    };
  }

  const args = parseResult.data;

  const validTypes = TriggerTypeSchema.options;
  if (!validTypes.includes(args.trigger_type as TriggerType)) {
    return {
      created: false,
      reason: `invalid trigger_type: ${args.trigger_type}`,
    };
  }

  const triggerId = await store.insertProspectiveMemory({
    content: args.content,
    trigger_condition: args.trigger_condition,
    trigger_type: args.trigger_type,
    target_directory: args.target_directory ?? null,
    is_active: true,
    triggered_count: 0,
  });

  const activeCount = await store.countActiveTriggers();

  return {
    created: true,
    trigger_id: triggerId,
    trigger_type: args.trigger_type,
    trigger_condition: args.trigger_condition,
    content: args.content,
    target_directory: args.target_directory ?? null,
    active_triggers: activeCount,
  };
}

export type { CreateTriggerRequest, CreateTriggerResponse };
