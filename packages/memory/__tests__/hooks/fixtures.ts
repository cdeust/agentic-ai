/**
 * Test fixture events — one per hook trigger type.
 *
 * These are the canonical minimal valid events for each hook.
 * Tests feed these via stdin to assert hook output shapes.
 */

import type {
  SessionStartEvent,
  UserPromptSubmitEvent,
  PostToolUseEvent,
  SubagentStartEvent,
  NotificationEvent,
  SessionEndEvent,
} from "../../src/hooks/types.js";

export const SESSION_START_EVENT: SessionStartEvent = {
  hook_type: "SessionStart",
  session_id: "test-session-001",
  cwd: "/tmp/test-project",
};

export const USER_PROMPT_SUBMIT_EVENT: UserPromptSubmitEvent = {
  hook_type: "UserPromptSubmit",
  session_id: "test-session-001",
  cwd: "/tmp/test-project",
  content: "How do I fix the reranker score normalization bug?",
};

export const USER_PROMPT_SUBMIT_SHORT_EVENT: UserPromptSubmitEvent = {
  hook_type: "UserPromptSubmit",
  session_id: "test-session-001",
  content: "ok",
};

export const USER_PROMPT_SUBMIT_SKIP_EVENT: UserPromptSubmitEvent = {
  hook_type: "UserPromptSubmit",
  session_id: "test-session-001",
  content: "yes",
};

export const POST_TOOL_USE_EDIT_EVENT: PostToolUseEvent = {
  hook_type: "PostToolUse",
  session_id: "test-session-001",
  cwd: "/tmp/test-project",
  tool_name: "Edit",
  tool_input: {
    file_path: "/tmp/test-project/src/main.ts",
    old_string: "const x = 1",
    new_string: "const x = 2",
  },
  tool_response:
    "File edited successfully. Changed line 42 from const x = 1 to const x = 2. " +
    "This fixed the normalization bug that caused score overflow.",
};

export const POST_TOOL_USE_READ_EVENT: PostToolUseEvent = {
  hook_type: "PostToolUse",
  session_id: "test-session-001",
  cwd: "/tmp/test-project",
  tool_name: "Read",
  tool_input: {
    file_path: "/tmp/test-project/src/utils.ts",
  },
  tool_response: "const helper = () => {};",
};

export const POST_TOOL_USE_LOW_VALUE_EVENT: PostToolUseEvent = {
  hook_type: "PostToolUse",
  session_id: "test-session-001",
  tool_name: "TodoRead",
  tool_input: {},
  tool_response: "[]",
};

export const SUBAGENT_START_EVENT: SubagentStartEvent = {
  hook_type: "SubagentStart",
  session_id: "test-session-001",
  cwd: "/tmp/test-project",
  agent_name: "engineer",
  agent_type: "custom",
  prompt:
    "Fix the reranker score normalization bug in src/recall/multi_signal_fusion.ts. " +
    "The scores must be normalized to [0,1] before ranking.",
};

export const SUBAGENT_START_UNKNOWN_AGENT_EVENT: SubagentStartEvent = {
  hook_type: "SubagentStart",
  session_id: "test-session-001",
  agent_name: "unknown-agent-xyz",
  prompt: "Do something for me please ensure the work is done correctly.",
};

export const COMPACTION_EVENT: NotificationEvent = {
  hook_type: "Notification",
  session_id: "test-session-001",
  type: "compacted",
};

export const SESSION_END_NO_SESSION_ID_EVENT: SessionEndEvent = {
  hook_type: "SessionEnd",
  cwd: "/tmp/test-project",
};

export const SESSION_END_EVENT: SessionEndEvent = {
  hook_type: "SessionEnd",
  session_id: "test-session-001",
  cwd: "/tmp/test-project",
  tools_used: ["Read", "Edit", "Bash"],
  duration: 1800,
  turn_count: 12,
  keywords: ["normalization", "reranker", "bug"],
};
