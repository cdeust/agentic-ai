/**
 * sync-instructions.ts — push memory insights back into CLAUDE.md.
 *
 * Reads hot memories for the current project directory, extracts key insights
 * (decisions, patterns, conventions), and appends or updates a
 * '## Memory Insights' section in CLAUDE.md.
 *
 * Port of: mcp_server/handlers/sync_instructions.py
 *
 * Correctness contract:
 *   pre:  store is a connected MemoryStore; directory exists or will be created.
 *   post: CLAUDE.md in `directory` contains a
 *         <!-- cortex:memory-insights:start --> … <!-- cortex:memory-insights:end -->
 *         section with at most max_insights bullet points derived from hot memories.
 *         File is created if absent. On dry_run=true, no file is written.
 *
 * source: cortex@ed33435 mcp_server/handlers/sync_instructions.py
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Structural store interface — no cross-layer import needed.
// Matches the subset of recall/port.ts MemoryStore used here.
// source: cortex@ed33435 mcp_server/handlers/sync_instructions.py — store.get_memories_for_directory / get_hot_memories
interface SyncMemoryStore {
  getMemoriesForDirectory(directory: string, minHeat: number): Promise<Array<{
    content?: string | null;
    heat?: number | null;
    importance?: number | null;
  }>>;
  getHotMemories(minHeat: number, limit: number): Promise<Array<{
    content?: string | null;
    heat?: number | null;
    importance?: number | null;
  }>>;
}

// ── Schema ────────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/sync_instructions.py schema

export const schema = {
  title: "Sync instructions",
  description:
    "Render the project's top hot memories (decisions, patterns, conventions, " +
    "lessons) as bullets and write them into CLAUDE.md between " +
    "`<!-- cortex:memory-insights:start -->` markers — adding the section if " +
    "absent, refreshing it in-place if present. Closes the loop between Cortex's " +
    "thermodynamic memory and the Claude Code instruction file loaded at every " +
    "session start. Distinct from `recall` (transient API response), `narrative` " +
    "(prose summary), and `anchor` (per-memory pinning). Mutates the CLAUDE.md " +
    "file in `directory`.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      directory: {
        type: "string",
        description:
          "Project directory containing the CLAUDE.md to update. " +
          "Defaults to current working directory.",
        examples: ["/Users/alice/code/cortex"],
      },
      max_insights: {
        type: "integer",
        description: "Maximum number of insight bullets to include in the section.",
        default: 10,
        minimum: 1,
        maximum: 50,
        examples: [5, 10, 20],
      },
      min_heat: {
        type: "number",
        description: "Minimum heat (0.0-1.0) for a memory to qualify as an insight.",
        default: 0.3,
        minimum: 0.0,
        maximum: 1.0,
        examples: [0.2, 0.3, 0.5],
      },
      dry_run: {
        type: "boolean",
        description: "Preview the rendered section without writing to CLAUDE.md.",
        default: false,
      },
    },
  },
} as const;

// ── Constants ─────────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/sync_instructions.py:_SECTION_START
const SECTION_START = "<!-- cortex:memory-insights:start -->";
// source: cortex@ed33435 mcp_server/handlers/sync_instructions.py:_SECTION_END
const SECTION_END = "<!-- cortex:memory-insights:end -->";

// source: cortex@ed33435 mcp_server/handlers/sync_instructions.py:_DECISION_RE
const DECISION_RE =
  /\b(decided|chose|switching|migrated|using|adopted|went with|replaced)\b/i;

// source: cortex@ed33435 mcp_server/handlers/sync_instructions.py:_extract_insights — truncate at 120 chars
const INSIGHT_MAX_CHARS = 120;

// ── Insight extraction ────────────────────────────────────────────────────────

/**
 * Pick the most useful bullets from hot memories.
 *
 * Prefers decisions (by DECISION_RE keyword match), then high-importance,
 * then high-heat.
 *
 * source: cortex@ed33435 mcp_server/handlers/sync_instructions.py:_extract_insights
 */
function extractInsights(
  memories: Array<{ content?: string | null; heat?: number | null; importance?: number | null }>,
  maxInsights: number,
): string[] {
  const decisions = memories.filter((m) => DECISION_RE.test(m.content ?? ""));
  const others = memories.filter((m) => !DECISION_RE.test(m.content ?? ""));

  const sortedDecisions = [...decisions].sort(
    (a, b) => (b.heat ?? 0) - (a.heat ?? 0),
  );
  const sortedOthers = [...others].sort(
    (a, b) => (b.importance ?? 0) - (a.importance ?? 0),
  );

  const ordered = [...sortedDecisions, ...sortedOthers];
  const insights: string[] = [];
  const seen = new Set<string>();

  for (const mem of ordered.slice(0, maxInsights * 2)) {
    const text = (mem.content ?? "").trim();
    if (!text) continue;
    const bullet = text.slice(0, INSIGHT_MAX_CHARS).replace(/\n/g, " ");
    if (seen.has(bullet)) continue;
    seen.add(bullet);
    insights.push(bullet);
    if (insights.length >= maxInsights) break;
  }

  return insights;
}

// ── Section building ──────────────────────────────────────────────────────────

/**
 * Build the CLAUDE.md section content.
 *
 * source: cortex@ed33435 mcp_server/handlers/sync_instructions.py:_build_section
 */
function buildSection(insights: string[]): string {
  const lines = [
    SECTION_START,
    "## Memory Insights",
    "",
    "Auto-synced from Cortex memory. Do not edit manually.",
    "",
    ...insights.map((b) => `- ${b}`),
    "",
    SECTION_END,
  ];
  return lines.join("\n");
}

// ── CLAUDE.md update ──────────────────────────────────────────────────────────

interface UpdateResult {
  action: string;
  path: string;
  preview?: string;
}

/**
 * Insert or replace the memory insights section in CLAUDE.md.
 *
 * source: cortex@ed33435 mcp_server/handlers/sync_instructions.py:_update_claude_md
 */
function updateClaudeMd(
  claudeMdPath: string,
  section: string,
  dryRun: boolean,
): UpdateResult {
  if (!fs.existsSync(claudeMdPath)) {
    if (dryRun) {
      return { action: "would_create", path: claudeMdPath };
    }
    fs.writeFileSync(claudeMdPath, section + "\n", "utf-8");
    return { action: "created", path: claudeMdPath };
  }

  const original = fs.readFileSync(claudeMdPath, "utf-8");
  const startIdx = original.indexOf(SECTION_START);
  const endIdx = original.indexOf(SECTION_END);

  let updated: string;
  let action: string;

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    const before = original.slice(0, startIdx);
    const after = original.slice(endIdx + SECTION_END.length);
    updated = before + section + after;
    action = "updated";
  } else {
    // Append new section
    updated = original.trimEnd() + "\n\n" + section + "\n";
    action = "appended";
  }

  if (dryRun) {
    return { action: `would_${action}`, path: claudeMdPath, preview: section };
  }

  fs.writeFileSync(claudeMdPath, updated, "utf-8");
  return { action, path: claudeMdPath };
}

// ── CLAUDE.md path resolution ─────────────────────────────────────────────────

/**
 * Find CLAUDE.md in directory or one level up.
 *
 * source: cortex@ed33435 mcp_server/handlers/sync_instructions.py:_find_claude_md
 */
function findClaudeMd(directory: string): string {
  const resolved = path.resolve(directory);
  const candidate = path.join(resolved, "CLAUDE.md");
  if (!fs.existsSync(candidate)) {
    const parent = path.join(path.dirname(resolved), "CLAUDE.md");
    if (fs.existsSync(parent)) return parent;
  }
  return candidate;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export interface SyncInstructionsResult {
  synced: boolean;
  reason?: string;
  action?: string;
  path?: string;
  preview?: string;
  insights_count?: number;
  memory_count?: number;
  dry_run?: boolean;
  directory?: string;
}

/**
 * Sync memory insights into CLAUDE.md.
 *
 * source: cortex@ed33435 mcp_server/handlers/sync_instructions.py:handler
 */
export async function syncInstructionsHandler(
  args: Record<string, unknown> | null | undefined,
  store: SyncMemoryStore,
): Promise<SyncInstructionsResult> {
  const a = args ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directory = String(a["directory"] ?? "").trim() || (globalThis as any).process?.cwd?.() || ".";
  const maxInsights = Math.max(1, Number(a["max_insights"] ?? 10));
  const minHeat = Math.max(0.0, Math.min(1.0, Number(a["min_heat"] ?? 0.3)));
  const dryRun = Boolean(a["dry_run"] ?? false);

  // Fetch relevant memories for directory, falling back to hot memories.
  let memories: Array<{ content?: string | null; heat?: number | null; importance?: number | null }> = [];
  try {
    memories = await store.getMemoriesForDirectory(directory, minHeat);
    if (memories.length === 0) {
      memories = await store.getHotMemories(minHeat, 50);
    }
  } catch {
    memories = [];
  }

  if (memories.length === 0) {
    return { synced: false, reason: "no_memories_found", directory };
  }

  const insights = extractInsights(memories, maxInsights);
  if (insights.length === 0) {
    return {
      synced: false,
      reason: "no_insights_extracted",
      memory_count: memories.length,
    };
  }

  const section = buildSection(insights);
  const updateResult = updateClaudeMd(findClaudeMd(directory), section, dryRun);

  return {
    synced: true,
    action: updateResult.action,
    path: updateResult.path,
    ...(updateResult.preview ? { preview: updateResult.preview } : {}),
    insights_count: insights.length,
    memory_count: memories.length,
    dry_run: dryRun,
  };
}
