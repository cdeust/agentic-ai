/**
 * Handler: sync_instructions — push memory insights back into CLAUDE.md.
 *
 * Reads hot memories for the current project directory, extracts key insights
 * (decisions, patterns, conventions), and appends or updates a
 * '## Memory Insights' section in CLAUDE.md.
 *
 * This closes the loop between Cortex's thermodynamic memory and the Claude
 * Code instruction file that is loaded at the start of every session.
 *
 * source: mcp_server/handlers/sync_instructions.py
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  SyncInstructionsRequestSchema,
  type SyncInstructionsRequest,
  type SyncInstructionsResponse,
} from "../types.js";

// ── Store port ────────────────────────────────────────────────────────────────

export interface MemoryReadStore {
  getMemoriesForDirectory(
    directory: string,
    options: { min_heat: number },
  ): Promise<MemoryRecord[]>;

  getHotMemories(options: {
    min_heat: number;
    limit: number;
  }): Promise<MemoryRecord[]>;
}

export interface MemoryRecord {
  content: string;
  heat?: number;
  importance?: number;
}

// ── Tool metadata ─────────────────────────────────────────────────────────────

/** source: sync_instructions.py schema */
export const syncInstructionsInputSchema = SyncInstructionsRequestSchema;

export const syncInstructionsToolMeta = {
  title: "Sync instructions",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description:
    "Render the project's top hot memories (decisions, patterns, conventions, " +
    "lessons) as bullets and write them into CLAUDE.md between " +
    "`<!-- cortex:memory-insights:start -->` markers — adding the section if " +
    "absent, refreshing it in-place if present. Closes the loop between Cortex's " +
    "thermodynamic memory and the Claude Code instruction file loaded at every " +
    "session start, so the next session begins informed without manual querying. " +
    "Use this after a productive session, or on a periodic schedule. Distinct from " +
    "`recall` (transient API response, not persisted to file), `narrative` (prose " +
    "summary, not actionable bullets), and `anchor` (per-memory pinning, no " +
    "CLAUDE.md write). Mutates the CLAUDE.md file in `directory`. Latency ~200ms. " +
    "Returns {written, path, insight_count, dry_run, preview?}.",
} as const;

// ── Constants ─────────────────────────────────────────────────────────────────

/** source: sync_instructions.py _SECTION_START, _SECTION_END */
const SECTION_START = "<!-- cortex:memory-insights:start -->";
const SECTION_END = "<!-- cortex:memory-insights:end -->";

/** source: sync_instructions.py _DECISION_RE */
const DECISION_RE =
  /\b(decided|chose|switching|migrated|using|adopted|went with|replaced)\b/i;

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Pick the most useful bullets from hot memories.
 *
 * Prefer decisions, then high-importance, then high-heat.
 *
 * source: sync_instructions.py _extract_insights()
 */
export function extractInsights(
  memories: MemoryRecord[],
  maxInsights: number,
): string[] {
  const decisions = memories.filter((m) =>
    DECISION_RE.test(m.content ?? ""),
  );
  const others = memories.filter((m) => !DECISION_RE.test(m.content ?? ""));

  const ordered = [
    ...decisions.sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0)),
    ...others.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)),
  ];

  const insights: string[] = [];
  const seen = new Set<string>();

  for (const mem of ordered.slice(0, maxInsights * 2)) {
    const text = (mem.content ?? "").trim();
    if (!text) continue;
    const bullet = text.slice(0, 120).replace(/\n/g, " ");
    if (seen.has(bullet)) continue;
    seen.add(bullet);
    insights.push(bullet);
    if (insights.length >= maxInsights) break;
  }

  return insights;
}

/**
 * Build the CLAUDE.md section block from insight bullets.
 *
 * source: sync_instructions.py _build_section()
 */
export function buildSection(insights: string[]): string {
  const lines = [
    SECTION_START,
    "## Memory Insights",
    "",
    "Auto-synced from Cortex memory. Do not edit manually.",
    "",
    ...insights.map((i) => `- ${i}`),
    "",
    SECTION_END,
  ];
  return lines.join("\n");
}

// ── Filesystem operations ─────────────────────────────────────────────────────

/**
 * Insert or replace the memory insights section in CLAUDE.md.
 *
 * Returns action descriptor for the response.
 *
 * source: sync_instructions.py _update_claude_md()
 */
async function updateClaudeMd(
  claudeMdPath: string,
  section: string,
  dryRun: boolean,
): Promise<{ action: string; path: string; preview?: string }> {
  let exists = false;
  try {
    await fs.access(claudeMdPath);
    exists = true;
  } catch {
    // File does not exist
  }

  if (!exists) {
    if (dryRun) {
      return { action: "would_create", path: claudeMdPath };
    }
    await fs.writeFile(claudeMdPath, section + "\n", "utf-8");
    return { action: "created", path: claudeMdPath };
  }

  const original = await fs.readFile(claudeMdPath, "utf-8");
  const startIdx = original.indexOf(SECTION_START);
  const endIdx = original.indexOf(SECTION_END);

  let updated: string;
  let action: string;

  if (startIdx !== -1 && endIdx !== -1) {
    const before = original.slice(0, startIdx);
    const after = original.slice(endIdx + SECTION_END.length);
    updated = before + section + after;
    action = "updated";
  } else {
    updated = original.trimEnd() + "\n\n" + section + "\n";
    action = "appended";
  }

  if (dryRun) {
    return { action: `would_${action}`, path: claudeMdPath, preview: section };
  }

  await fs.writeFile(claudeMdPath, updated, "utf-8");
  return { action, path: claudeMdPath };
}

/**
 * Find CLAUDE.md in directory or one level up.
 *
 * source: sync_instructions.py _find_claude_md()
 */
async function findClaudeMd(directory: string): Promise<string> {
  const resolved = path.resolve(directory);
  const candidate = path.join(resolved, "CLAUDE.md");
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    const parent = path.join(path.dirname(resolved), "CLAUDE.md");
    try {
      await fs.access(parent);
      return parent;
    } catch {
      return candidate; // return even if it doesn't exist; handler will create it
    }
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Sync memory insights into CLAUDE.md.
 *
 * source: sync_instructions.py handler()
 */
export async function syncInstructionsHandler(
  rawArgs: unknown,
  store: MemoryReadStore,
): Promise<SyncInstructionsResponse> {
  const parseResult = SyncInstructionsRequestSchema.safeParse(rawArgs ?? {});
  const args = parseResult.success
    ? parseResult.data
    : ({ directory: undefined, max_insights: 10, min_heat: 0.3, dry_run: false } satisfies SyncInstructionsRequest);

  const directory = args.directory ?? process.cwd();
  const maxInsights = args.max_insights;
  const minHeat = args.min_heat;
  const dryRun = args.dry_run;

  let memories = await store.getMemoriesForDirectory(directory, { min_heat: minHeat });
  if (memories.length === 0) {
    memories = await store.getHotMemories({ min_heat: minHeat, limit: 50 });
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

  const claudeMdPath = await findClaudeMd(directory);
  const section = buildSection(insights);
  const result = await updateClaudeMd(claudeMdPath, section, dryRun);

  return {
    synced: true,
    action: result.action,
    path: result.path,
    preview: result.preview,
    insights_count: insights.length,
    memory_count: memories.length,
    dry_run: dryRun,
  };
}

export type { SyncInstructionsRequest, SyncInstructionsResponse };
