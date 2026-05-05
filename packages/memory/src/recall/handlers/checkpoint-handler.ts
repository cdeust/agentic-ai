/**
 * Handler: checkpoint — hippocampal replay checkpoint/restore.
 *
 * Creates working state checkpoints before context compaction and
 * reconstructs context after compaction via hippocampal replay.
 *
 * Two operations:
 *   - save: Store current working state as a checkpoint
 *   - restore: Reconstruct context from checkpoint + hot memories
 *
 * Port of: mcp_server/handlers/checkpoint.py
 * source: cortex@ed33435 mcp_server/handlers/checkpoint.py
 */

import { IDEMPOTENT_WRITE } from "../../shared/tool-meta.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface CheckpointArgs {
  /** 'save' | 'restore' */
  action: "save" | "restore";
  directory?: string;
  current_task?: string;
  files_being_edited?: string[];
  key_decisions?: string[];
  open_questions?: string[];
  next_steps?: string[];
  active_errors?: string[];
  custom_context?: string;
  session_id?: string;
}

export interface CheckpointSaveResult {
  status: "saved";
  checkpoint_id: string;
  epoch: number;
}

export interface CheckpointRestoreResult {
  status: "restored";
  checkpoint: boolean;
  anchored_count: number;
  recent_count: number;
  hot_count: number;
  epoch: number;
  formatted: string;
}

export type CheckpointResult = CheckpointSaveResult | CheckpointRestoreResult | { error: string };

/** Interface for the store dependency. */
export interface CheckpointStore {
  insertCheckpoint(data: Record<string, unknown>): Promise<string>;
  getCurrentEpoch(): Promise<number>;
  getActiveCheckpoint(): Promise<Record<string, unknown> | null>;
  getHotMemories(opts: { minHeat: number; limit: number }): Promise<Record<string, unknown>[]>;
  getMemoriesForDirectory(
    dir: string,
    opts: { minHeat: number },
  ): Promise<Record<string, unknown>[]>;
}

export interface FormatRestorationFn {
  (opts: {
    checkpoint: Record<string, unknown> | null;
    anchoredMemories: Record<string, unknown>[];
    recentMemories: Record<string, unknown>[];
    hotMemories: Record<string, unknown>[];
    directory: string;
  }): string;
}

export interface CheckpointSettings {
  REPLAY_MAX_RESTORE_MEMORIES: number;
}

// ── Schema ─────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/checkpoint.py:23

export const schema = {
  title: "Checkpoint (save / restore working state)",
  annotations: IDEMPOTENT_WRITE,
  description:
    "Hippocampal-replay-style save/restore of whole working state across " +
    "context compaction events (McClelland 1995). `save` writes a " +
    "checkpoint row capturing current task, files-being-edited, key " +
    "decisions, open questions, planned next steps, and active errors, " +
    "tied to the current epoch. `restore` reconstructs post-compaction " +
    "context by fusing the latest checkpoint with anchored + hot + " +
    "directory-relevant memories. Use `save` before risking compaction; " +
    "use `restore` immediately after. Distinct from `anchor` (per-" +
    "memory pinning, no task state), `remember` (creates one memory, " +
    "no whole-state snapshot), and `query_methodology` (cognitive " +
    "profile, not session state). Mutates the checkpoints table on " +
    "save; read-only on restore. Latency ~50ms (save) / ~100ms " +
    "(restore). Returns {action, checkpoint_id, restored_context?, " +
    "memories_attached}.",
  inputSchema: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["save", "restore"],
        description:
          "'save' to write a new checkpoint capturing current state; " +
          "'restore' to reconstruct context from the active checkpoint " +
          "plus relevant memories.",
        examples: ["save", "restore"],
      },
      directory: {
        type: "string",
        description: "Current working directory the work is happening in.",
        examples: ["/Users/alice/code/cortex"],
      },
      current_task: {
        type: "string",
        description: "Brief description of the active task or goal.",
        examples: ["Fixing recall regression introduced by FlashRank cache change"],
      },
      files_being_edited: {
        type: "array",
        description: "Absolute or repo-relative paths of files currently open for editing.",
        items: { type: "string" },
        default: [],
      },
      key_decisions: {
        type: "array",
        description: "Important decisions made during this session.",
        items: { type: "string" },
        default: [],
      },
      open_questions: {
        type: "array",
        description: "Unresolved questions that block progress.",
        items: { type: "string" },
        default: [],
      },
      next_steps: {
        type: "array",
        description: "Planned next actions, in order.",
        items: { type: "string" },
        default: [],
      },
      active_errors: {
        type: "array",
        description: "Errors currently being debugged.",
        items: { type: "string" },
        default: [],
      },
      custom_context: {
        type: "string",
        description: "Free-form additional context worth preserving.",
      },
      session_id: {
        type: "string",
        description: "Session identifier this checkpoint belongs to. Defaults to 'default'.",
        default: "default",
      },
    },
  },
} as const;

// ── Save ───────────────────────────────────────────────────────────────────

/**
 * Create a working state checkpoint.
 *
 * Port of: mcp_server/handlers/checkpoint.py::_save_checkpoint
 * source: cortex@ed33435 mcp_server/handlers/checkpoint.py:171
 */
export async function saveCheckpoint(
  args: CheckpointArgs,
  store: CheckpointStore,
): Promise<CheckpointSaveResult> {
  const epoch = await store.getCurrentEpoch();
  const checkpointId = await store.insertCheckpoint({
    session_id: args.session_id ?? "default",
    directory_context: args.directory ?? "",
    current_task: args.current_task ?? "",
    files_being_edited: args.files_being_edited ?? [],
    key_decisions: args.key_decisions ?? [],
    open_questions: args.open_questions ?? [],
    next_steps: args.next_steps ?? [],
    active_errors: args.active_errors ?? [],
    custom_context: args.custom_context ?? "",
    epoch,
  });

  return { status: "saved", checkpoint_id: checkpointId, epoch };
}

// ── Partition helper ───────────────────────────────────────────────────────

/**
 * Split hot memories into anchored and recent partitions.
 * Port of: mcp_server/handlers/checkpoint.py::_partition_hot_memories
 * source: cortex@ed33435 mcp_server/handlers/checkpoint.py:198
 */
export function partitionHotMemories(
  allHot: Record<string, unknown>[],
  maxMemories: number,
): {
  anchored: Record<string, unknown>[];
  anchorIds: Set<number>;
  recent: Record<string, unknown>[];
  recentIds: Set<number>;
} {
  const anchored = allHot.filter((m) => m["is_protected"]).slice(0, maxMemories);
  const anchorIds = new Set<number>(anchored.map((m) => m["id"] as number));
  const recent = allHot
    .filter((m) => !anchorIds.has(m["id"] as number) && !m["is_protected"])
    .slice(0, maxMemories);
  const recentIds = new Set<number>(recent.map((m) => m["id"] as number));
  return { anchored, anchorIds, recent, recentIds };
}

// ── Restore ────────────────────────────────────────────────────────────────

/**
 * Reconstruct context from checkpoint + memories.
 *
 * Port of: mcp_server/handlers/checkpoint.py::_restore_context
 * source: cortex@ed33435 mcp_server/handlers/checkpoint.py:212
 */
export async function restoreContext(
  args: CheckpointArgs,
  store: CheckpointStore,
  settings: CheckpointSettings,
  formatRestoration: FormatRestorationFn,
): Promise<CheckpointRestoreResult> {
  const directory = args.directory ?? "";
  const maxMemories = settings.REPLAY_MAX_RESTORE_MEMORIES;

  const checkpoint = await store.getActiveCheckpoint();
  const allHot = await store.getHotMemories({ minHeat: 0.0, limit: 200 }); // source: cortex@ed33435 checkpoint.py:220
  const { anchored, anchorIds, recent, recentIds } = partitionHotMemories(allHot, maxMemories);

  let hotMems: Record<string, unknown>[];
  if (directory) {
    hotMems = await store.getMemoriesForDirectory(directory, { minHeat: 0.3 }); // source: cortex@ed33435 checkpoint.py:226
  } else {
    hotMems = await store.getHotMemories({ minHeat: 0.5, limit: maxMemories * 2 }); // source: cortex@ed33435 checkpoint.py:228
  }
  const usedIds = new Set([...anchorIds, ...recentIds]);
  const hot = hotMems
    .filter((m) => !usedIds.has(m["id"] as number))
    .slice(0, maxMemories);

  const formatted = formatRestoration({
    checkpoint,
    anchoredMemories: anchored,
    recentMemories: recent,
    hotMemories: hot,
    directory,
  });

  return {
    status: "restored",
    checkpoint: checkpoint !== null,
    anchored_count: anchored.length,
    recent_count: recent.length,
    hot_count: hot.length,
    epoch: checkpoint ? Number(checkpoint["epoch"] ?? 0) : 0,
    formatted,
  };
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * Dispatch to save or restore.
 *
 * precondition: args.action is "save" or "restore".
 * postcondition: on save — inserts checkpoint row, returns {status, checkpoint_id, epoch};
 *   on restore — reads checkpoint + memories, returns {status, counts, formatted}.
 *
 * Port of: mcp_server/handlers/checkpoint.py::handler
 * source: cortex@ed33435 mcp_server/handlers/checkpoint.py:157
 */
export async function handler(
  args: CheckpointArgs | null | undefined,
  store: CheckpointStore,
  settings: CheckpointSettings,
  formatRestoration: FormatRestorationFn,
): Promise<CheckpointResult> {
  if (!args?.action) {
    return { error: "action is required (save or restore)" };
  }

  if (args.action === "save") {
    return saveCheckpoint(args, store);
  }
  if (args.action === "restore") {
    return restoreContext(args, store, settings, formatRestoration);
  }
  return { error: `Unknown action: ${args.action}` };
}
