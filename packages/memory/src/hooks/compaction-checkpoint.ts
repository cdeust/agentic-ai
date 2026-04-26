/**
 * Compaction checkpoint hook — save working state before context compaction.
 *
 * Fires on Notification events with type/notification matching "compacted".
 * Auto-saves a checkpoint so state can be restored after compaction via
 * the `checkpoint` MCP tool with action="restore".
 *
 * Paper backing (consolidation at rest):
 *   - Dewar et al. (2012): rest after encoding boosts long-term retention.
 *     Compaction is a natural rest point — run cascade advancement here.
 *
 * Happens-before contract (Lamport 1978, §2):
 *   I1: this hook fires AFTER the context window is compacted.
 *       Epoch increment MUST complete before the checkpoint is saved
 *       (new epoch is recorded in the checkpoint). This is a causal
 *       dependency within this hook's execution, not a wall-clock claim.
 *   I2: cascade advancement fires AFTER the checkpoint save (best-effort).
 *   I3: no ordering assumption between this compaction event and any
 *       concurrent PostToolUse hooks in other processes.
 *
 * Failure model: non-blocking — exits 0 even on checkpoint failure.
 * All errors logged to stderr.
 *
 * Exit codes: always 0 (falls through on failure per HOOKS.md Hook 5).
 * Timeout: 5 seconds (explicit in settings.json example).
 * source: HOOKS.md Hook 5.
 */

import { loadHookConfig, type NotificationEvent } from "./types.js";

const LOG_PREFIX = "[methodology-compaction-hook]";

function log(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

/** Save checkpoint and advance cascade. Routes through abstraction layer. */
async function saveCheckpointAndCascade(
  event: NotificationEvent | null,
): Promise<void> {
  const { databaseUrl } = loadHookConfig();
  // In the full port: route through checkpoint handler from
  // packages/memory/src/remember/ and consolidation from
  // packages/memory/src/consolidation/.
  // Stub: log the operation until those packages are merged.
  log(
    `checkpoint save: session_id=${event?.session_id ?? "auto-compaction"}, db=${databaseUrl}`,
  );
  log("cascade advancement: stub (wire to consolidation when merged)");
  // TODO: wire to checkpoint handler (merge order #2) and cascade handler (merge order #4).
}

export async function processEvent(
  event: NotificationEvent | null,
): Promise<void> {
  try {
    await saveCheckpointAndCascade(event);
  } catch (err) {
    log(`Auto-checkpoint failed (non-fatal): ${String(err)}`);
  }
}

export async function main(): Promise<void> {
  if (process.stdin.isTTY) {
    log("No stdin data (TTY mode), exiting");
    process.exit(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();

  let event: NotificationEvent | null = null;
  if (raw) {
    try {
      event = JSON.parse(raw) as NotificationEvent;
    } catch (err) {
      log(`Failed to parse event: ${String(err)}`);
    }
  }

  await processEvent(event).catch((err) => {
    log(`process failed (non-fatal): ${String(err)}`);
  });
  process.exit(0);
}

if (process.argv[1]?.endsWith("compaction-checkpoint.js") === true) {
  main().catch(() => process.exit(0));
}
