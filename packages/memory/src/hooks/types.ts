/**
 * Cortex Hook Types — Claude Code lifecycle hook event schemas.
 *
 * Happens-before contracts (Lamport 1978, §2):
 *
 *   SessionStart fires BEFORE any UserPromptSubmit in the session.
 *   UserPromptSubmit fires BEFORE the model processes the prompt.
 *   PostToolUse fires AFTER the named tool returns to the model.
 *   SubagentStart fires BEFORE the spawned agent's first LLM turn.
 *   Notification(compacted) fires AFTER the context window is compacted.
 *   SessionEnd fires AFTER the last tool call in the session.
 *
 * No wall-clock assumptions. Ordering is causal, not temporal.
 * Hook timestamps (if present in events) are informational only —
 * clock-skew may make them non-monotone across machines.
 *
 * Exit code invariants (Claude Code hook protocol):
 *   exit 0 + stdout content → injected into Claude Code context window
 *   exit 0 + empty stdout   → no injection, no error
 *   exit 1                  → hook failed; Claude Code logs, does not block
 *   exit 2                  → reserved for validation hooks (block operation)
 *
 * All hooks write diagnostics to stderr ONLY.
 * Stdout is the injection channel.
 */

import { z } from "zod";

// ── Base event fields shared by all Claude Code hook events ───────────────

export const BaseEventSchema = z.object({
  session_id: z.string().optional(),
  cwd: z.string().optional(),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

// ── SessionStart event ────────────────────────────────────────────────────

export const SessionStartEventSchema = BaseEventSchema.extend({
  hook_type: z.literal("SessionStart").optional(),
});

export type SessionStartEvent = z.infer<typeof SessionStartEventSchema>;

// ── UserPromptSubmit event ────────────────────────────────────────────────
// Claude Code passes the user's message as one of several possible fields.
// source: Claude Code hooks protocol; field names derived from live testing.

export const UserPromptSubmitEventSchema = BaseEventSchema.extend({
  hook_type: z.literal("UserPromptSubmit").optional(),
  // Possible top-level content fields (try in order)
  content: z.string().optional(),
  prompt: z.string().optional(),
  message: z.string().optional(),
  text: z.string().optional(),
  query: z.string().optional(),
  // Nested messages array fallback
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.union([z.string(), z.unknown()]),
      }),
    )
    .optional(),
});

export type UserPromptSubmitEvent = z.infer<typeof UserPromptSubmitEventSchema>;

// ── PostToolUse event ─────────────────────────────────────────────────────

export const PostToolUseEventSchema = BaseEventSchema.extend({
  hook_type: z.literal("PostToolUse").optional(),
  tool_name: z.string(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
  tool_response: z.unknown().optional(),
});

export type PostToolUseEvent = z.infer<typeof PostToolUseEventSchema>;

// ── SubagentStart event ───────────────────────────────────────────────────

export const SubagentStartEventSchema = BaseEventSchema.extend({
  hook_type: z.literal("SubagentStart").optional(),
  agent_name: z.string().optional(),
  agent_type: z.string().optional(),
  prompt: z.string().optional(),
});

export type SubagentStartEvent = z.infer<typeof SubagentStartEventSchema>;

// ── Notification event (compaction) ──────────────────────────────────────

export const NotificationEventSchema = BaseEventSchema.extend({
  hook_type: z.literal("Notification").optional(),
  // The compaction notification carries the literal string "compacted"
  // in either the 'type' or 'notification' field depending on version.
  type: z.string().optional(),
  notification: z.string().optional(),
  epoch: z.number().optional(),
});

export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

// ── SessionEnd event ──────────────────────────────────────────────────────

export const SessionEndEventSchema = BaseEventSchema.extend({
  hook_type: z.literal("SessionEnd").optional(),
  project: z.string().optional(),
  tools_used: z.array(z.string()).optional(),
  duration: z.number().optional(),
  turn_count: z.number().optional(),
  keywords: z.array(z.string()).optional(),
});

export type SessionEndEvent = z.infer<typeof SessionEndEventSchema>;

// ── Union of all hook events ──────────────────────────────────────────────

export type HookEvent =
  | SessionStartEvent
  | UserPromptSubmitEvent
  | PostToolUseEvent
  | SubagentStartEvent
  | NotificationEvent
  | SessionEndEvent;

// ── HookResponse — what a hook returns to the runner ─────────────────────
// stdout: string to print to stdout (injected by Claude Code when non-empty)
// exitCode: 0 = success, 1 = failure (non-blocking), 2 = block (validation)

export interface HookResponse {
  stdout: string;
  exitCode: 0 | 1 | 2;
}

// ── HookContext — ambient environment injected into every hook handler ────

export interface HookConfig {
  databaseUrl: string;
  pluginRoot: string;
  projectRoot: string;
}

export function loadHookConfig(): HookConfig {
  return {
    databaseUrl:
      process.env["DATABASE_URL"] ?? "postgresql://localhost:5432/cortex",
    pluginRoot: process.env["CLAUDE_PLUGIN_ROOT"] ?? "",
    projectRoot: process.env["CLAUDE_PROJECT_ROOT"] ?? process.cwd(),
  };
}

// ── Timeout budget constants (ms) — load-bearing per HOOKS.md ────────────
// source: port-inventory-cortex/inventory/HOOKS.md summary table

export const HOOK_TIMEOUTS_MS = {
  SESSION_START: 30_000, // No explicit limit; we budget 30s
  USER_PROMPT_SUBMIT: 3_000, // Explicit: "Must complete within 3s"
  POST_TOOL_USE: 5_000, // Typical Claude Code PostToolUse budget
  SUBAGENT_START: 3_000, // Same as UserPromptSubmit per HOOKS.md Hook 4
  COMPACTION: 5_000, // Explicit: settings.json "timeout": 5
  SESSION_END: 0, // No budget — runs after session, sync
  BACKGROUND: 0, // Detached — no budget
} as const;

// ── DB memory row shape returned by SQL queries ───────────────────────────

export interface MemoryRow {
  id: string | number;
  content: string;
  heat?: number;
  heat_base?: number;
  domain?: string;
  agent_context?: string;
  is_protected?: boolean;
  is_global?: boolean;
  tags?: string | string[];
}

export interface CheckpointRow {
  current_task?: string;
  next_steps?: string | string[];
  open_questions?: string | string[];
  active_errors?: string | string[];
  key_decisions?: string | string[];
  directory_context?: string;
}
