/**
 * PostgreSQL-backed loaders for the workflow graph.
 *
 * Extracts tool events, bash commands, command-to-file touches, and
 * memory rows from the PG store. Pure infrastructure — no core imports.
 *
 * The pgStore parameter is typed as unknown and accessed via duck typing
 * (matching the Python side's `pg_store.get_hot_memories(...)` calls)
 * so this module does not depend on a concrete DB adapter.
 *
 * source: Cortex mcp_server/infrastructure/workflow_graph_source_pg.py
 */

// source: Cortex workflow_graph_source_pg.py regex constants
const _FILE_LINE_RE = /\*\*(?:File|Read):\*\*\s*`([^`]+)`/;
const _COMMAND_LINE_RE = /\*\*Command:\*\*\s*`([^`]+)`/;
const _PATH_TOKEN_RE = /(?:^|\s)((?:\.{1,2}\/|~\/|\/)[^\s`'"]{3,})/g;

const _MEMORY_PASSTHROUGH_KEYS = (
  "heat_base arousal emotional_valence dominant_emotion importance " +
  "surprise_score confidence access_count useful_count replay_count " +
  "reconsolidation_count plasticity stability excitability " +
  "hippocampal_dependency schema_match_score schema_id separation_index " +
  "interference_score encoding_strength hours_in_stage stage_entered_at " +
  "no_decay is_protected is_stale is_benchmark is_global store_type " +
  "last_accessed created_at compression_level compressed tags"
).split(" ");

type ToolFromTags = (tags: unknown[]) => string | null;
type DomainFromDirectory = (dir: string | null) => string | null;
type CmdHash = (cmd: string) => string;
type FirstLine = (text: string) => string;

function isoTs(ts: unknown): string | null {
  if (ts == null) return null;
  if (ts instanceof Date) {
    try {
      return ts.toISOString();
    } catch {
      return null;
    }
  }
  return String(ts);
}

// ── Loader functions ──────────────────────────────────────────────────────

export function loadToolEvents(
  pgStore: unknown,
  toolFromTags: ToolFromTags,
  domainFromDirectory: DomainFromDirectory,
  _cmdHash: CmdHash,
  _firstLine: FirstLine,
): Record<string, unknown>[] {
  /**
   * Parse post_tool_capture memories → one row per (tool, file_path,
   * domain) with count + first/last timestamps.
   */
  const store = pgStore as Record<string, unknown>;
  if (typeof store?.["search_by_tag_vector"] !== "function") return [];
  let rows: Record<string, unknown>[];
  try {
    rows = (
      store["search_by_tag_vector"] as (opts: Record<string, unknown>) => Record<string, unknown>[]
    )({
      query_embedding: null,
      tag: "auto-captured",
      domain: null,
      min_heat: 0.0,
      limit: 1e9,
    });
  } catch {
    return [];
  }
  type Slot = [count: number, first: string | null, last: string | null];
  const buckets = new Map<string, Slot>();
  for (const mem of rows) {
    const tags = (mem["tags"] as unknown[] | undefined) ?? [];
    const tool = toolFromTags(tags);
    if (!tool) continue;
    const domain =
      (mem["domain"] as string | undefined) ??
      domainFromDirectory(
        (mem["directory_context"] as string | undefined) ?? null,
      ) ??
      "";
    const content = String(mem["content"] ?? "");
    let filePath: string | null = null;
    if (["Edit", "Write", "Read"].includes(tool)) {
      const m = _FILE_LINE_RE.exec(content);
      if (m) filePath = m[1]?.trim() ?? null;
    }
    const ts = isoTs(mem["created_at"]);
    const key = `${tool}|${filePath ?? ""}|${domain}`;
    const slot = buckets.get(key);
    if (!slot) {
      buckets.set(key, [1, ts, ts]);
    } else {
      slot[0]++;
      if (ts && (slot[1] === null || ts < slot[1])) slot[1] = ts;
      if (ts && (slot[2] === null || ts > slot[2])) slot[2] = ts;
    }
  }
  return Array.from(buckets, ([k, [n, first, last]]) => {
    const [t = "", fp = "", d = ""] = k.split("|");
    return { tool: t, file_path: fp || null, domain: d, count: n, first_ts: first, last_ts: last };
  });
}

export function loadCommandEvents(
  pgStore: unknown,
  domainFromDirectory: DomainFromDirectory,
  cmdHashFn: CmdHash,
  firstLineFn: FirstLine,
): Record<string, unknown>[] {
  /** Parse Bash command memories; one row per (cmd, hash, domain) with count. */
  const store = pgStore as Record<string, unknown>;
  if (typeof store?.["search_by_tag_vector"] !== "function") return [];
  let rows: Record<string, unknown>[];
  try {
    rows = (
      store["search_by_tag_vector"] as (opts: Record<string, unknown>) => Record<string, unknown>[]
    )({
      query_embedding: null,
      tag: "tool:bash",
      domain: null,
      min_heat: 0.0,
      limit: 1e9,
    });
  } catch {
    return [];
  }
  type Slot = [count: number, first: string | null, last: string | null];
  const buckets = new Map<string, Slot>();
  for (const mem of rows) {
    const m = _COMMAND_LINE_RE.exec(String(mem["content"] ?? ""));
    if (!m) continue;
    const cmd = firstLineFn(m[1]!);
    if (!cmd) continue;
    const h = cmdHashFn(cmd);
    const dom =
      (mem["domain"] as string | undefined) ??
      domainFromDirectory(
        (mem["directory_context"] as string | undefined) ?? null,
      ) ??
      "";
    const ts = isoTs(mem["created_at"]);
    const key = `${cmd}|${h}|${dom}`;
    const slot = buckets.get(key);
    if (!slot) {
      buckets.set(key, [1, ts, ts]);
    } else {
      slot[0]++;
      if (ts && (slot[1] === null || ts < slot[1])) slot[1] = ts;
      if (ts && (slot[2] === null || ts > slot[2])) slot[2] = ts;
    }
  }
  return Array.from(buckets, ([k, [n, first, last]]) => {
    const idx1 = k.indexOf("|");
    const idx2 = k.indexOf("|", idx1 + 1);
    const c = k.slice(0, idx1);
    const h = k.slice(idx1 + 1, idx2);
    const d = k.slice(idx2 + 1);
    return { cmd: c, cmd_hash: h, domain: d, count: n, first_ts: first, last_ts: last };
  });
}

export function loadCommandFiles(
  pgStore: unknown,
  knownPaths: Iterable<string>,
  cmdHashFn: CmdHash,
  firstLineFn: FirstLine,
): Record<string, unknown>[] {
  /**
   * Extract absolute paths from bash commands; retain only those that
   * match a known file node.
   */
  const known = new Set(knownPaths);
  if (known.size === 0) return [];
  const store = pgStore as Record<string, unknown>;
  if (typeof store?.["search_by_tag_vector"] !== "function") return [];
  let rows: Record<string, unknown>[];
  try {
    rows = (
      store["search_by_tag_vector"] as (opts: Record<string, unknown>) => Record<string, unknown>[]
    )({
      query_embedding: null,
      tag: "tool:bash",
      domain: null,
      min_heat: 0.0,
      limit: 1e9,
    });
  } catch {
    return [];
  }
  const buckets = new Map<string, number>();
  for (const mem of rows) {
    const m = _COMMAND_LINE_RE.exec(String(mem["content"] ?? ""));
    if (!m) continue;
    const cmd = firstLineFn(m[1]!);
    if (!cmd) continue;
    const h = cmdHashFn(cmd);
    _PATH_TOKEN_RE.lastIndex = 0;
    let pm: RegExpExecArray | null;
    while ((pm = _PATH_TOKEN_RE.exec(` ${cmd}`)) !== null) {
      const tok = pm[1]!.replace(/[.,;:)]+$/, "");
      if (known.has(tok)) {
        const key = `${h}|${tok}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
  }
  return Array.from(buckets, ([k, n]) => {
    const idx = k.indexOf("|");
    return { cmd_hash: k.slice(0, idx), file_path: k.slice(idx + 1), count: n };
  });
}

export function loadMemories(
  pgStore: unknown,
  minHeat = 0.0,
  limit = 10000,
): Record<string, unknown>[] {
  /** Return every memory row for the graph with its scientific fields. */
  const store = pgStore as Record<string, unknown>;
  if (typeof store?.["get_hot_memories"] !== "function") return [];
  let rows: Record<string, unknown>[];
  try {
    rows = (
      store["get_hot_memories"] as (
        opts: Record<string, unknown>,
      ) => Record<string, unknown>[]
    )({
      min_heat: minHeat,
      limit,
      include_benchmarks: true,
    });
  } catch {
    return [];
  }
  return rows.map((r) => {
    const row: Record<string, unknown> = {
      id: r["id"],
      domain: r["domain"] ?? "",
      consolidation_stage: r["consolidation_stage"] ?? "episodic",
      heat: parseFloat(String(r["heat"] ?? r["heat_base"] ?? 0)),
      content: r["content"] ?? "",
    };
    for (const k of _MEMORY_PASSTHROUGH_KEYS) {
      if (k in r && r[k] != null) row[k] = r[k];
    }
    return row;
  });
}

export function loadEntities(
  pgStore: unknown,
  minHeat = 0.05,
): Record<string, unknown>[] {
  /**
   * Return knowledge-graph entity rows suitable for ENTITY-node ingest.
   * Uses get_all_entities with include_archived=false.
   */
  const store = pgStore as Record<string, unknown>;
  if (typeof store?.["get_all_entities"] !== "function") return [];
  let rows: Record<string, unknown>[];
  try {
    rows = (
      store["get_all_entities"] as (
        opts: Record<string, unknown>,
      ) => Record<string, unknown>[]
    )({ min_heat: minHeat, include_archived: false });
  } catch {
    return [];
  }
  return rows
    .filter((r) => r["id"] != null && r["name"])
    .map((r) => ({
      id: r["id"],
      name: r["name"],
      type: r["type"] ?? "concept",
      domain: r["domain"] ?? "",
      heat: parseFloat(String(r["heat"] ?? 0)),
    }));
}

export function loadMemoryEntityEdges(
  pgStore: unknown,
): Record<string, unknown>[] {
  /**
   * Bulk-fetch every row in memory_entities.
   * Delegates to pgStore.list_memory_entity_edges.
   */
  const store = pgStore as Record<string, unknown>;
  if (typeof store?.["list_memory_entity_edges"] !== "function") return [];
  try {
    return (
      store["list_memory_entity_edges"] as () => Record<string, unknown>[]
    )();
  } catch {
    return [];
  }
}
