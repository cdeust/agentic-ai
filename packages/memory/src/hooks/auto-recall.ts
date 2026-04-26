/**
 * UserPromptSubmit hook — automatic memory recall.
 *
 * When the user sends a message, retrieves relevant memories and injects
 * them into Claude's context. Implements context reinstatement before
 * the model processes the user's prompt.
 *
 * Paper backing:
 *   - Smith & Vela (2001): context reinstatement produces ~15-20% recall
 *     boost (d=0.28). Injecting matching memories implements reinstatement.
 *   - Bar (2007): proactive brain generates predictions from context
 *     BEFORE conscious retrieval request.
 *   - Collins & Loftus (1975): query text activates related memory nodes
 *     via spreading activation.
 *
 * Happens-before invariants (Lamport 1978, §2):
 *   I1: stdin read MUST complete before query extraction.
 *   I2: query extraction and skip-check MUST complete before DB query.
 *   I3: DB query result MUST be available before formatting output.
 *   I4: this hook fires AFTER Claude Code receives the user prompt
 *       and BEFORE the model processes it. No ordering assumption
 *       with other concurrent PostToolUse hooks.
 *
 * Exit codes:
 *   exit 0 + stdout → injected into model context (memories found)
 *   exit 0 + empty  → no injection (nothing relevant, query too short)
 *   exit 1          → error (non-blocking)
 *
 * Timeout: MUST complete within 3 seconds.
 * source: HOOKS.md Hook 2 "Must complete within 3s (hook timeout)"
 */

import { ftsRecall } from "./db.js";
import {
  loadHookConfig,
  HOOK_TIMEOUTS_MS,
  type UserPromptSubmitEvent,
} from "./types.js";

const LOG_PREFIX = "[cortex-auto-recall]";
const MAX_MEMORIES = 3;
const MIN_HEAT = 0.15;
const MIN_QUERY_LENGTH = 10;
const MAX_INJECTION_CHARS = 800;

// Skip recall for meta/system messages
const SKIP_PATTERN =
  /^(\/|yes$|no$|ok$|sure$|thanks|continue|go ahead|y$|n$)/i;

function log(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

// ── Query extraction ──────────────────────────────────────────────────────

function extractQuery(event: UserPromptSubmitEvent): string | null {
  // Try known top-level fields in order
  for (const field of [
    "content",
    "prompt",
    "message",
    "text",
    "query",
  ] as const) {
    const val = (event as Record<string, unknown>)[field];
    if (typeof val === "string" && val.length >= MIN_QUERY_LENGTH) {
      return val.trim();
    }
  }

  // Try nested messages array — extract last user turn
  const messages = event.messages;
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        msg &&
        typeof msg === "object" &&
        "role" in msg &&
        msg.role === "user"
      ) {
        const content = (msg as { role: string; content: unknown }).content;
        if (typeof content === "string" && content.length >= MIN_QUERY_LENGTH) {
          return content.trim();
        }
      }
    }
  }

  return null;
}

function shouldSkip(query: string): boolean {
  if (query.length < MIN_QUERY_LENGTH) return true;
  if (SKIP_PATTERN.test(query)) return true;
  return false;
}

// ── Formatting ────────────────────────────────────────────────────────────

function formatInjection(
  memories: Array<{ content: string; agent_context?: string; is_protected?: boolean }>,
): string {
  const lines: string[] = ["**Cortex context:**"];
  let totalChars = lines[0]?.length ?? 0;

  for (const m of memories) {
    const content = m.content.replace(/\n/g, " ").trim();
    const truncated =
      content.length > 200 ? content.slice(0, 197) + "..." : content;
    const agent = m.agent_context ?? "";
    const prefix = agent ? `[${agent}] ` : "";
    const protectedMark = m.is_protected ? " (decision)" : "";
    const line = `- ${prefix}${truncated}${protectedMark}`;

    if (totalChars + line.length > MAX_INJECTION_CHARS) break;
    lines.push(line);
    totalChars += line.length;
  }

  if (lines.length === 1) return ""; // Nothing fit
  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

export async function processEvent(
  event: UserPromptSubmitEvent,
): Promise<void> {
  const query = extractQuery(event);
  if (!query || shouldSkip(query)) return;

  const { databaseUrl } = loadHookConfig();

  const memories = await Promise.race([
    ftsRecall(databaseUrl, query, MIN_HEAT, MAX_MEMORIES),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("recall timeout")),
        HOOK_TIMEOUTS_MS.USER_PROMPT_SUBMIT - 200, // 200ms margin
      ),
    ),
  ]);

  if (!memories.length) return;

  const injection = formatInjection(
    memories.map((m) => ({
      content: m.content,
      agent_context: m.agent_context,
      is_protected: m.is_protected,
    })),
  );

  if (!injection) return;

  process.stdout.write(injection + "\n");
  log(`injected ${memories.length} memories for query: ${query.slice(0, 50)}...`);
}

export async function main(): Promise<void> {
  if (process.stdin.isTTY) {
    process.exit(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) process.exit(0);

  let event: UserPromptSubmitEvent;
  try {
    event = JSON.parse(raw) as UserPromptSubmitEvent;
  } catch {
    process.exit(0);
  }

  await processEvent(event).catch(() => {});
  process.exit(0);
}

if (process.argv[1]?.endsWith("auto-recall.js") === true) {
  main().catch(() => process.exit(1));
}
