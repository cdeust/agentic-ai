/**
 * GET /api/memories — keyset-paged memory listing for Knowledge + Board tabs.
 *
 * Replaces the in-memory JUG.state.lastData.nodes.filter(type==='memory')
 * pattern that breaks at high N. Pagination is keyset over (sort_key, id)
 * pairs so it scales linearly with N regardless of how many memories exist.
 *
 * Port of: mcp_server/handlers/memories_page.py
 * source: cortex@ed33435 mcp_server/handlers/memories_page.py
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type MemorySortKey = "heat" | "recent" | "oldest";

export interface MemoriesPageQuery {
  cursor?: string | null;
  /** default 50, capped at 200 */
  limit?: number;
  domain?: string | null;
  stage?: string | null;
  search?: string | null;
  /** 'heat' | 'recent' | 'oldest' — defaults to 'heat' */
  sort?: string;
  /** bucket: 'urgent' | 'positive' | 'negative' | 'neutral' */
  emotion?: string | null;
  min_heat?: number | null;
  protected?: boolean;
  global?: boolean;
  include_global?: boolean;
}

export interface MemoryNode {
  id: string;
  memory_id: number | undefined;
  type: "memory";
  kind: "memory";
  label: string;
  content: string;
  domain: string;
  domain_id: string;
  tags: string[];
  heat: number;
  importance: number;
  stage: string;
  consolidationStage: string;
  consolidation_stage: string;
  createdAt: unknown;
  lastAccessed: unknown;
  isProtected: boolean;
  is_protected: boolean;
  isGlobal: boolean;
  is_global: boolean;
  emotion: string | null;
  emotional_valence: number;
  store_type: string;
  access_count: number;
  useful_count: number;
}

export interface MemoriesPageResult {
  items: MemoryNode[];
  next_cursor: string | null;
  page_count: number;
  sort: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/memories_page.py:37
const SORT_ORDER_BY: Record<string, string> = {
  heat: "heat_base DESC, id DESC",
  recent: "created_at DESC, id DESC",
  oldest: "created_at ASC, id ASC",
};

// source: cortex@ed33435 mcp_server/handlers/memories_page.py:43
const SORT_KEY_COLUMN: Record<string, string> = {
  heat: "heat_base",
  recent: "created_at",
  oldest: "created_at",
};

// source: cortex@ed33435 mcp_server/handlers/memories_page.py:48
const SORT_DIRECTION: Record<string, string> = {
  heat: "<",
  recent: "<",
  oldest: ">",
};

// source: cortex@ed33435 mcp_server/handlers/memories_page.py:54
const DEFAULT_LIMIT = 50;
// source: cortex@ed33435 mcp_server/handlers/memories_page.py:55
const MAX_LIMIT = 200;

// ── Cursor codec ──────────────────────────────────────────────────────────

/**
 * Decode a base64url cursor string.
 * source: cortex@ed33435 mcp_server/handlers/memories_page.py:58
 */
export function decodeCursor(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const padded = s + "==".slice(0, (4 - (s.length % 4)) % 4);
    const raw = Buffer.from(padded, "base64url").toString("utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Encode a cursor payload as base64url.
 * source: cortex@ed33435 mcp_server/handlers/memories_page.py:68
 */
export function encodeCursor(payload: Record<string, unknown>): string {
  const raw = JSON.stringify(payload);
  return Buffer.from(raw).toString("base64url").replace(/=+$/, "");
}

// ── Row → Node ─────────────────────────────────────────────────────────────

/**
 * Shape a memory row to match the workflow_graph.v1 memory-node fields
 * that knowledge.js + timeline.js read directly. Missing fields are
 * populated with safe defaults.
 *
 * Port of: mcp_server/handlers/memories_page.py::_row_to_node
 * source: cortex@ed33435 mcp_server/handlers/memories_page.py:86
 */
export function rowToNode(row: Record<string, unknown>): MemoryNode {
  const val = Number(row["emotional_valence"] ?? 0);
  let emotion: string | null = null;
  // source: cortex@ed33435 mcp_server/handlers/memories_page.py:94
  if (val >= 0.55) emotion = "satisfaction";
  else if (val >= 0.25) emotion = "discovery";
  else if (val <= -0.55) emotion = "frustration";
  else if (val <= -0.25) emotion = "confusion";
  if (Number(row["importance"] ?? 0) >= 0.75) emotion = "urgency";

  return {
    id: "memory:" + String(row["id"]),
    memory_id: row["id"] as number | undefined,
    type: "memory",
    kind: "memory",
    label: String(row["content"] ?? ""),
    content: String(row["content"] ?? ""),
    domain: String(row["domain"] ?? ""),
    domain_id: "domain:" + (String(row["domain"] ?? "") || "__global__"),
    tags: (row["tags"] as string[] | null) ?? [],
    heat: Number(row["heat_base"] ?? 0),
    importance: Number(row["importance"] ?? 0),
    stage: String(row["consolidation_stage"] ?? "labile"),
    consolidationStage: String(row["consolidation_stage"] ?? "labile"),
    consolidation_stage: String(row["consolidation_stage"] ?? "labile"),
    createdAt: row["created_at"],
    lastAccessed: row["last_accessed"],
    isProtected: Boolean(row["is_protected"]),
    is_protected: Boolean(row["is_protected"]),
    isGlobal: Boolean(row["is_global"]),
    is_global: Boolean(row["is_global"]),
    emotion,
    emotional_valence: val,
    store_type: String(row["store_type"] ?? "episodic"),
    access_count: Number(row["access_count"] ?? 0),
    useful_count: Number(row["useful_count"] ?? 0),
  };
}

// ── Query builder ─────────────────────────────────────────────────────────

export interface BuildQueryOptions {
  sort: string;
  hasCursor: boolean;
  hasDomain: boolean;
  hasStage: boolean;
  hasSearch: boolean;
  hasMinHeat: boolean;
  hasEmotion: boolean;
  protectedOnly: boolean;
  globalOnly: boolean;
  includeGlobal: boolean;
}

/**
 * Build the SQL query string for memories pagination.
 *
 * Port of: mcp_server/handlers/memories_page.py::_build_query
 * source: cortex@ed33435 mcp_server/handlers/memories_page.py:133
 */
export function buildQuery(opts: BuildQueryOptions): string {
  const where: string[] = ["NOT is_stale"];

  if (opts.hasCursor) {
    const col = SORT_KEY_COLUMN[opts.sort];
    const op = SORT_DIRECTION[opts.sort];
    where.push(`(${col}, id) ${op} ($cursor_key, $cursor_id)`);
  }
  if (opts.globalOnly) {
    where.push("is_global = TRUE");
  } else if (opts.hasDomain) {
    if (opts.includeGlobal) {
      where.push("(domain = $domain OR is_global = TRUE)");
    } else {
      where.push("domain = $domain");
    }
  }
  if (opts.hasStage) where.push("consolidation_stage = $stage");
  if (opts.hasSearch) where.push("content_tsv @@ plainto_tsquery('english', $search)");
  if (opts.hasMinHeat) where.push("heat_base >= $min_heat");
  if (opts.hasEmotion) {
    // Four-bucket CASE-style WHERE clause.
    // source: cortex@ed33435 mcp_server/handlers/memories_page.py:168
    where.push(
      "((" +
        "  $emotion = 'urgent' AND importance >= 0.75" +
        ") OR (" +
        "  $emotion = 'positive' AND emotional_valence >= 0.25 AND importance < 0.75" +
        ") OR (" +
        "  $emotion = 'negative' AND emotional_valence <= -0.25 AND importance < 0.75" +
        ") OR (" +
        "  $emotion = 'neutral' AND emotional_valence > -0.25 AND emotional_valence < 0.25 AND importance < 0.75" +
        "))",
    );
  }
  if (opts.protectedOnly) where.push("is_protected = TRUE");

  return (
    "SELECT id, content, domain, heat_base, importance, " +
    "consolidation_stage, emotional_valence, tags, created_at, " +
    "last_accessed, is_protected, is_global, store_type, " +
    "access_count, useful_count " +
    "FROM memories " +
    "WHERE " +
    where.join(" AND ") +
    " " +
    `ORDER BY ${SORT_ORDER_BY[opts.sort]} ` +
    "LIMIT $limit"
  );
}

// ── Main serve function ────────────────────────────────────────────────────

/**
 * Execute the keyset-paged memory query and return the page result.
 *
 * precondition: query params are parsed and validated.
 * postcondition: returns items + next_cursor (null if last page) +
 *   page_count + sort; never throws (errors propagate to caller).
 *
 * Port of: mcp_server/handlers/memories_page.py::serve (query logic)
 * source: cortex@ed33435 mcp_server/handlers/memories_page.py:194
 */
export function serveMemoriesPage(
  query: MemoriesPageQuery,
  executeQuery: (sql: string, params: unknown[]) => Record<string, unknown>[],
): MemoriesPageResult {
  let sort = (query.sort ?? "heat").trim();
  if (!(sort in SORT_ORDER_BY)) sort = "heat";

  let limit = Number(query.limit ?? DEFAULT_LIMIT);
  limit = Math.max(1, Math.min(MAX_LIMIT, limit));

  const cursor = decodeCursor(query.cursor);
  const domain = (query.domain ?? "").trim() || null;
  const stage = (query.stage ?? "").trim() || null;
  const search = (query.search ?? "").trim() || null;
  let emotion = (query.emotion ?? "").trim() || null;
  if (!["urgent", "positive", "negative", "neutral"].includes(emotion ?? "")) {
    emotion = null;
  }
  const minHeat = query.min_heat ?? null;
  const protectedOnly = Boolean(query.protected);
  const globalOnly = Boolean(query.global);
  const includeGlobal = query.include_global !== false; // default true

  const sql = buildQuery({
    sort,
    hasCursor: cursor !== null,
    hasDomain: domain !== null,
    hasStage: stage !== null,
    hasSearch: search !== null,
    hasMinHeat: minHeat !== null,
    hasEmotion: emotion !== null,
    protectedOnly,
    globalOnly,
    includeGlobal,
  });

  // Assemble params in the same order the WHERE clauses append them.
  const params: unknown[] = [];
  if (cursor !== null) {
    params.push(cursor["k"], cursor["id"]);
  }
  if (!globalOnly && domain !== null) params.push(domain);
  if (stage !== null) params.push(stage);
  if (search !== null) params.push(search);
  if (minHeat !== null) params.push(minHeat);
  if (emotion !== null) {
    // Four placeholders for the four-bucket CASE-style WHERE clause.
    // source: cortex@ed33435 mcp_server/handlers/memories_page.py:249
    params.push(emotion, emotion, emotion, emotion);
  }
  // Over-fetch by 1 so we can detect "more pages exist" without a count.
  params.push(limit + 1);

  const rows = executeQuery(sql, params);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1] as Record<string, unknown>;
    let sortValue: unknown;
    if (sort === "heat") {
      sortValue = last["heat_base"] != null ? Number(last["heat_base"]) : 0;
    } else {
      const ts = last["created_at"];
      sortValue =
        ts && typeof ts === "object" && "toISOString" in (ts as object)
          ? (ts as Date).toISOString()
          : ts;
    }
    nextCursor = encodeCursor({ k: sortValue, id: last["id"] });
  }

  const nodes = items.map(rowToNode);
  return {
    items: nodes,
    next_cursor: nextCursor,
    page_count: nodes.length,
    sort,
  };
}
