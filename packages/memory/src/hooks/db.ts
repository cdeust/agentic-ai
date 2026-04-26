/**
 * Cortex hooks — lightweight PostgreSQL helper.
 *
 * All hooks go through this module instead of calling pg directly.
 * This satisfies ADR-0003: adapters declare their preconditions and
 * fail fast with a typed error rather than silently corrupting state.
 *
 * Happens-before contract (Lamport 1978):
 *   A query result is causally after the connection being established.
 *   We never assume two queries from different calls are ordered in
 *   wall-clock time — they are only ordered if issued on the same
 *   connection in sequence.
 *
 * The module uses Node's `pg` client (npm: pg / @types/pg).
 * It does NOT use an ORM — raw parameterised SQL only, so the
 * invariants on the memory schema remain visible at this call site.
 */

import { type CheckpointRow, type MemoryRow } from "./types.js";

// ── Lazy pg import ────────────────────────────────────────────────────────
// We import pg lazily so that hooks that never hit the DB (e.g., on
// cold-start paths that exit early) do not pay the require cost.

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
};

async function openConnection(databaseUrl: string): Promise<PgClient | null> {
  try {
    // Dynamic import — pg is an optional peer dep; hook fails gracefully.
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    return client as unknown as PgClient;
  } catch {
    return null;
  }
}

// ── Type-safe helpers ────────────────────────────────────────────────────

function parseJsonList(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as string[];
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [val];
    } catch {
      return val.trim() ? [val] : [];
    }
  }
  return [];
}

function parseTags(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val as string[];
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ── Exported DB operations ────────────────────────────────────────────────

export interface DbResult<T> {
  ok: true;
  value: T;
}

export interface DbError {
  ok: false;
  error: string;
}

export type DbOutcome<T> = DbResult<T> | DbError;

/** Fetch anchored memories (is_protected = TRUE, has _anchor tag). */
export async function fetchAnchors(
  databaseUrl: string,
  limit: number,
): Promise<MemoryRow[]> {
  const conn = await openConnection(databaseUrl);
  if (!conn) return [];
  try {
    const { rows } = await conn.query(
      `SELECT id, content, tags, domain, is_global
       FROM memories
       WHERE is_protected = TRUE
       ORDER BY heat DESC
       LIMIT $1`,
      [limit],
    );
    return (rows as MemoryRow[]).filter((r) => {
      const tags = parseTags(r.tags);
      return (
        tags.includes("_anchor") ||
        tags.some((t) => typeof t === "string" && t.startsWith("_anchor:"))
      );
    });
  } catch {
    return [];
  } finally {
    await conn.end();
  }
}

/** Fetch team decisions (is_protected + is_global, agent_context set). */
export async function fetchTeamDecisions(
  databaseUrl: string,
  excludeIds: Set<string | number>,
): Promise<MemoryRow[]> {
  const conn = await openConnection(databaseUrl);
  if (!conn) return [];
  try {
    const { rows } = await conn.query(
      `SELECT id, content, domain, agent_context, heat
       FROM memories
       WHERE is_protected = TRUE
         AND is_global = TRUE
         AND agent_context != ''
       ORDER BY heat DESC
       LIMIT 5`,
    );
    return (rows as MemoryRow[]).filter((r) => !excludeIds.has(r.id)).slice(0, 3);
  } catch {
    return [];
  } finally {
    await conn.end();
  }
}

/** Fetch hot memories by heat_base threshold. */
export async function fetchHotMemories(
  databaseUrl: string,
  minHeat: number,
  limit: number,
  excludeIds: Set<string | number>,
): Promise<MemoryRow[]> {
  const conn = await openConnection(databaseUrl);
  if (!conn) return [];
  try {
    const { rows } = await conn.query(
      `SELECT id, content, domain, heat_base AS heat, tags, is_global
       FROM memories
       WHERE heat_base >= $1
       ORDER BY heat_base DESC
       LIMIT $2`,
      [minHeat, limit + excludeIds.size],
    );
    return (rows as MemoryRow[])
      .filter((r) => !excludeIds.has(r.id))
      .slice(0, limit);
  } catch {
    return [];
  } finally {
    await conn.end();
  }
}

/** Fetch the most recent active checkpoint. */
export async function fetchCheckpoint(
  databaseUrl: string,
): Promise<CheckpointRow | null> {
  const conn = await openConnection(databaseUrl);
  if (!conn) return null;
  try {
    const { rows } = await conn.query(
      `SELECT current_task, next_steps, open_questions, active_errors,
              key_decisions, directory_context
       FROM checkpoints
       WHERE is_active = TRUE
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    if (rows.length === 0) return null;
    const row = rows[0] as CheckpointRow;
    return {
      current_task: row.current_task ?? "",
      next_steps: parseJsonList(row.next_steps),
      open_questions: parseJsonList(row.open_questions),
      active_errors: parseJsonList(row.active_errors),
      key_decisions: parseJsonList(row.key_decisions),
      directory_context: row.directory_context ?? "",
    };
  } catch {
    return null;
  } finally {
    await conn.end();
  }
}

/** Count total memories. */
export async function countMemories(databaseUrl: string): Promise<number> {
  const conn = await openConnection(databaseUrl);
  if (!conn) return 0;
  try {
    const { rows } = await conn.query(
      "SELECT COUNT(*) AS c FROM memories",
    );
    const row = rows[0] as { c: string | number };
    return Number(row.c);
  } catch {
    return 0;
  } finally {
    await conn.end();
  }
}

/** FTS-based recall — fast, no embedding model required. */
export async function ftsRecall(
  databaseUrl: string,
  query: string,
  minHeat: number,
  limit: number,
): Promise<MemoryRow[]> {
  const conn = await openConnection(databaseUrl);
  if (!conn) return [];
  try {
    const { rows } = await conn.query(
      `SELECT id, content, heat, domain, agent_context, is_protected,
              ts_rank_cd(content_tsv, q) AS rank
       FROM memories,
            plainto_tsquery('english', $1) q
       WHERE content_tsv @@ q
         AND heat >= $2
         AND NOT is_benchmark
       ORDER BY is_protected DESC, rank DESC, heat DESC
       LIMIT $3`,
      [query.slice(0, 200), minHeat, limit + 2],
    );
    return (rows as MemoryRow[]).slice(0, limit);
  } catch {
    return [];
  } finally {
    await conn.end();
  }
}

/** Fetch agent-scoped memories matching FTS keywords. */
export async function fetchAgentMemories(
  databaseUrl: string,
  agentName: string,
  keywords: string[],
  minHeat: number,
  limit: number,
): Promise<MemoryRow[]> {
  if (!keywords.length) return [];
  const conn = await openConnection(databaseUrl);
  if (!conn) return [];
  try {
    const { rows } = await conn.query(
      `SELECT id, content, heat, agent_context
       FROM memories
       WHERE agent_context = $1
         AND heat >= $2
         AND NOT is_benchmark
         AND content_tsv @@ plainto_tsquery('english', $3)
       ORDER BY heat DESC
       LIMIT $4`,
      [agentName, minHeat, keywords.slice(0, 5).join(" "), limit],
    );
    return rows as MemoryRow[];
  } catch {
    return [];
  } finally {
    await conn.end();
  }
}

/** Fetch team decisions excluding a specific agent. */
export async function fetchTeamDecisionsForAgent(
  databaseUrl: string,
  excludeAgent: string,
  limit: number,
): Promise<MemoryRow[]> {
  const conn = await openConnection(databaseUrl);
  if (!conn) return [];
  try {
    const { rows } = await conn.query(
      `SELECT id, content, heat, agent_context
       FROM memories
       WHERE is_protected = TRUE
         AND is_global = TRUE
         AND agent_context != $1
         AND NOT is_benchmark
       ORDER BY heat DESC
       LIMIT $2`,
      [excludeAgent, limit],
    );
    return rows as MemoryRow[];
  } catch {
    return [];
  } finally {
    await conn.end();
  }
}

/**
 * Heat bump by path — spreading activation on file access.
 * source: Collins & Loftus (1975); canonical A3 boost path
 *         per phase-3-a3-migration-design.md §3.4.
 */
export async function bumpHeatByPath(
  databaseUrl: string,
  filePath: string,
  boost: number,
): Promise<number> {
  const conn = await openConnection(databaseUrl);
  if (!conn) return 0;
  const filename = filePath.split("/").pop() ?? filePath;
  try {
    const { rows } = await conn.query(
      `UPDATE memories
       SET heat_base = LEAST(heat_base + $1, 1.0),
           heat_base_set_at = NOW(),
           last_accessed = NOW()
       WHERE NOT is_benchmark
         AND heat_base < 1.0
         AND (content ILIKE $2 OR content ILIKE $3)
       RETURNING id`,
      [boost, `%${filePath}%`, `%${filename}%`],
    );
    return rows.length;
  } catch {
    return 0;
  } finally {
    await conn.end();
  }
}

/**
 * Heat bump by symbol names — graph-based spreading activation.
 * source: Collins & Loftus (1975) spreading activation on structured graph.
 */
export async function bumpHeatBySymbols(
  databaseUrl: string,
  symbolNames: string[],
  boost: number,
  maxBumps: number,
): Promise<number> {
  if (!symbolNames.length) return 0;
  const conn = await openConnection(databaseUrl);
  if (!conn) return 0;
  const names = symbolNames.slice(0, maxBumps);
  // Build parameterised ILIKE OR clause
  const likeParams = names.map((_, i) => `content ILIKE $${i + 3}`).join(" OR ");
  const params: unknown[] = [boost, ...names.map((n) => `%${n}%`)];
  try {
    const { rows } = await conn.query(
      `UPDATE memories
       SET heat_base = LEAST(heat_base + $1, 1.0),
           heat_base_set_at = NOW(),
           last_accessed = NOW()
       WHERE NOT is_benchmark
         AND NOT is_stale
         AND heat_base < 1.0
         AND (${likeParams})
       RETURNING id`,
      params,
    );
    return rows.length;
  } catch {
    return 0;
  } finally {
    await conn.end();
  }
}
