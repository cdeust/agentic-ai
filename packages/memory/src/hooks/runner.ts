/**
 * Cortex hook runner — dispatches Claude Code lifecycle events.
 *
 * Claude Code invokes hooks by passing the event as JSON on stdin.
 * The hook name (which determines which handler to call) is passed
 * as process.argv[2], or detected from the event's hook_type field.
 *
 * Usage (in Claude Code settings.json):
 *   "command": "${CLAUDE_PLUGIN_ROOT}/packages/memory/dist/hooks/runner.js <hook-name>"
 *
 * ADR-0010: the bare ${CLAUDE_PLUGIN_ROOT} form ONLY. Never :-fallback.
 *
 * Supported hook names:
 *   session-start           → SessionStart
 *   auto-recall             → UserPromptSubmit
 *   post-tool-capture       → PostToolUse (capture)
 *   agent-briefing          → SubagentStart
 *   compaction-checkpoint   → Notification(compacted)
 *   session-lifecycle       → SessionEnd
 *   preemptive-context      → PostToolUse (priming)
 *   pipeline-impact-bump    → PostToolUse (symbol bump)
 *
 * Happens-before contract (Lamport 1978, §2):
 *   stdin read MUST complete before the hook handler is invoked.
 *   The runner acts as a single-entry sequential dispatcher:
 *   only one hook handler runs per invocation (no concurrency within
 *   the runner process itself). Concurrent execution at the Claude Code
 *   level (multiple hook invocations for different events) is outside
 *   the runner's scope — each invocation is a separate process.
 *
 * All hooks are responsible for their own exit codes.
 * The runner exits with the handler's exit code.
 */

import { main as sessionStartMain } from "./session-start.js";
import { main as autoRecallMain } from "./auto-recall.js";
import { main as postToolCaptureMain } from "./post-tool-capture.js";
import { main as agentBriefingMain } from "./agent-briefing.js";
import { main as compactionCheckpointMain } from "./compaction-checkpoint.js";
import { main as sessionLifecycleMain } from "./session-lifecycle.js";
import { main as preemptiveContextMain } from "./preemptive-context.js";
import { main as pipelineImpactBumpMain } from "./pipeline-impact-bump.js";

const HOOK_HANDLERS: Record<string, () => Promise<void>> = {
  "session-start": sessionStartMain,
  "auto-recall": autoRecallMain,
  "post-tool-capture": postToolCaptureMain,
  "agent-briefing": agentBriefingMain,
  "compaction-checkpoint": compactionCheckpointMain,
  "session-lifecycle": sessionLifecycleMain,
  "preemptive-context": preemptiveContextMain,
  "pipeline-impact-bump": pipelineImpactBumpMain,
};

async function run(): Promise<void> {
  const hookName = process.argv[2];

  if (!hookName) {
    process.stderr.write(
      "[cortex-runner] No hook name provided. " +
        `Usage: node runner.js <hook-name>\n` +
        `Available: ${Object.keys(HOOK_HANDLERS).join(", ")}\n`,
    );
    process.exit(1);
  }

  const handler = HOOK_HANDLERS[hookName];
  if (!handler) {
    process.stderr.write(
      `[cortex-runner] Unknown hook: '${hookName}'. ` +
        `Available: ${Object.keys(HOOK_HANDLERS).join(", ")}\n`,
    );
    process.exit(1);
  }

  await handler();
}

run().catch((err) => {
  process.stderr.write(`[cortex-runner] Fatal: ${String(err)}\n`);
  process.exit(1);
});
