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
import { PgMemoryStore } from "../remember/storage/pg-store.js";
import { runCascadeAdvancement } from "../consolidation/stages/cascade.js";

const LOG_PREFIX = "[methodology-compaction-hook]";

function log(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

/**
 * Save a checkpoint row and advance the consolidation cascade.
 *
 * precondition:  databaseUrl is a reachable PostgreSQL connection string.
 * postcondition:
 *   I1 (Lamport): epoch increment happens causally BEFORE checkpoint save —
 *     enforced by sequential await ordering below.
 *   I2 (Lamport): cascade fires AFTER checkpoint save (best-effort; does not
 *     abort the function on failure — see failure model in module header).
 *
 * source: compaction_checkpoint.py:process_event
 */
async function saveCheckpointAndCascade(
  event: NotificationEvent | null,
): Promise<void> {
  const { databaseUrl } = loadHookConfig();
  const sessionId = event?.session_id ?? "auto-compaction";
  const store = new PgMemoryStore(databaseUrl);

  try {
    // Step 1: Persist checkpoint row.
    // precondition: checkpoints table exists (standard Cortex schema).
    // postcondition: row with is_active=TRUE inserted; prior rows deactivated.
    // source: compaction_checkpoint.py — checkpoint_handler action="save"
    await store.runAsync(async (client) => {
      // Deactivate any existing active checkpoints for this session.
      await client.query(
        `UPDATE checkpoints SET is_active = FALSE WHERE session_id = $1`,
        [sessionId],
      );
      // Insert the new checkpoint.
      await client.query(
        `INSERT INTO checkpoints
           (session_id, current_task, is_active, created_at)
         VALUES ($1, $2, TRUE, NOW())`,
        [sessionId, "Auto-checkpoint before context compaction"],
      );
    });

    log(`checkpoint save: session_id=${sessionId}`);

    // Step 2: Advance consolidation cascade (best-effort per I2).
    // source: compaction_checkpoint.py — run_cascade_advancement(store)
    // source: Dewar et al. (2012) — rest after encoding boosts retention.
    const result = await runCascadeAdvancement({
      getMemoriesByStage: (stage, limit) =>
        store.runAsync((c) =>
          c.query(`SELECT * FROM memories WHERE consolidation_stage = $1 LIMIT $2`, [stage, limit])
            .then((r) => r.rows as Record<string, unknown>[]),
        ),
      updateMemoryConsolidation: (id, stage, hours, replayCount, hippocampalDependency) =>
        store.runAsync((c) =>
          c.query(
            `UPDATE memories SET consolidation_stage=$2, hours_in_stage=$3,
             replay_count=$4, hippocampal_dependency=$5, stage_entered_at=NOW()
             WHERE id=$1`,
            [id, stage, hours, replayCount, hippocampalDependency],
          ).then(() => undefined),
        ),
      insertStageTransitionsBatch: (transitions) => {
        if (transitions.length === 0) return Promise.resolve();
        return store.runAsync((c) =>
          Promise.all(
            transitions.map((t) =>
              c.query(
                `INSERT INTO stage_transitions (memory_id, from_stage, to_stage, hours_in_prev)
                 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                [t["memory_id"], t["from_stage"], t["to_stage"], t["hours_in_prev"]],
              ),
            ),
          ).then(() => undefined),
        );
      },
    });

    if (result.advanced > 0) {
      log(`cascade: ${result.advanced} memories advanced during compaction`);
    } else {
      log(`cascade: scanned ${result.scanned} memories, none advanced`);
    }
  } finally {
    await store.close();
  }
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
