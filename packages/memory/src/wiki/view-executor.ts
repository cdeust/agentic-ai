/**
 * Phase 5.3 — Safe view DSL executor.
 *
 * A view is a YAML-shaped query block inside a wiki/_views/*.md page:
 *
 *   ```cortex-query
 *   table: pages
 *   where:
 *     kind: spec
 *     lifecycle_state: [active, evergreen]
 *     heat_min: 0.5
 *   order_by: heat
 *   direction: desc
 *   limit: 20
 *   ```
 *
 * This module parses the YAML, validates fields against a whitelist,
 * and produces a parameterised SQL query. Never builds SQL by string
 * concatenation of user input — every value goes through bind params,
 * every column name comes from a hardcoded whitelist.
 *
 * Pure logic — returns CompiledView. The handler executes the query.
 *
 * source: mcp_server/core/wiki_view_executor.py (Cortex ed33435)
 */

// ── Whitelists ────────────────────────────────────────────────────────────
// source: mcp_server/core/wiki_view_executor.py:35-112

const TABLE_WHITELIST: Readonly<Record<string, string>> = {
  pages: "wiki.pages",
  concepts: "wiki.concepts",
  drafts: "wiki.drafts",
  claim_events: "wiki.claim_events",
  links: "wiki.links",
  citations: "wiki.citations",
  memos: "wiki.memos",
} as const;

const COLUMN_WHITELIST: Readonly<Record<string, ReadonlySet<string>>> = {
  pages: new Set([
    "id", "memory_id", "concept_id", "rel_path", "slug", "kind", "title",
    "domain", "status", "lifecycle_state", "heat", "access_count",
    "citation_count", "backlink_count", "is_stale", "tended", "planted",
    "last_accessed_at", "last_cited_at", "archived_at",
  ]),
  concepts: new Set([
    "id", "label", "status", "saturation_rate", "saturation_streak",
    "first_seen_at", "last_property_at", "promoted_page_id",
  ]),
  drafts: new Set([
    "id", "concept_id", "memory_id", "title", "kind", "status",
    "confidence", "synth_model", "created_at", "reviewed_at", "published_page_id",
  ]),
  claim_events: new Set([
    "id", "memory_id", "session_id", "claim_type", "confidence",
    "supersedes", "extracted_at",
  ]),
  links: new Set(["src_page_id", "dst_slug", "dst_page_id", "link_kind"]),
  citations: new Set(["id", "page_id", "session_id", "domain", "memory_id", "cited_at"]),
  memos: new Set([
    "id", "subject_type", "subject_id", "decision", "confidence",
    "author", "created_at",
  ]),
} as const;

// source: mcp_server/core/wiki_view_executor.py:114-115
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

// ── Types ─────────────────────────────────────────────────────────────────

export interface CompiledView {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly errors: readonly string[];
  readonly table: string;
  readonly ok: boolean;
}

// ── YAML-ish parser ───────────────────────────────────────────────────────
// source: mcp_server/core/wiki_view_executor.py:132-245
// Line length cap + key regex keep this immune to polynomial-redos.
// source: mcp_server/core/wiki_view_executor.py:147-148 (CodeQL guards)

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// source: mcp_server/core/wiki_view_executor.py:150 — defence-in-depth line cap
const MAX_LINE_LEN = 2000;

function parseKvLine(line: string): [string, string] | null {
  if (line.length > MAX_LINE_LEN) return null;
  const stripped = line.trim();
  if (!stripped.includes(":")) return null;
  const colonIdx = stripped.indexOf(":");
  const key = stripped.slice(0, colonIdx).trim();
  const value = stripped.slice(colonIdx + 1).trim();
  if (!KEY_RE.test(key)) return null;
  return [key, value];
}

function coerceScalar(s: string): unknown {
  const t = s.trim();
  if (!t) return null;
  if (t.toLowerCase() === "true") return true;
  if (t.toLowerCase() === "false") return false;
  if (["null", "none", "~"].includes(t.toLowerCase())) return null;
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => coerceScalar(x.trim()));
  }
  if (t.length >= 2 && t[0] === t[t.length - 1] && (t[0] === "'" || t[0] === '"')) {
    return t.slice(1, -1);
  }
  if (t.includes(".")) {
    const f = parseFloat(t);
    if (!isNaN(f)) return f;
  }
  const i = parseInt(t, 10);
  if (!isNaN(i) && String(i) === t) return i;
  return t;
}

function isIndented(line: string): boolean {
  return line.length > 0 && (line[0] === " " || line[0] === "\t");
}

/**
 * Parse the cortex-query block.
 *
 * Precondition: text is the raw query block content (no fences).
 * Postcondition: returns a plain dict with coerced scalar / list values.
 *   No regex-based line parsing — immune to polynomial-redos by construction.
 *
 * source: mcp_server/core/wiki_view_executor.py:203-245
 */
export function parseYamlish(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split("\n");
  let i = 0;

  // invariant: i increases each iteration; termination: i reaches lines.length
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) {
      i++;
      continue;
    }
    if (isIndented(line)) {
      i++;
      continue;
    }
    const parsed = parseKvLine(line);
    if (parsed === null) {
      i++;
      continue;
    }
    const [key, valueStr] = parsed;
    if (valueStr) {
      out[key] = coerceScalar(valueStr);
      i++;
      continue;
    }
    // Empty value means nested dict on indented lines
    const nested: Record<string, unknown> = {};
    i++;
    while (i < lines.length) {
      const nxt = lines[i]!;
      if (!nxt.trim()) { i++; continue; }
      if (!isIndented(nxt)) break;
      const sub = parseKvLine(nxt);
      if (sub !== null) nested[sub[0]] = coerceScalar(sub[1]);
      i++;
    }
    out[key] = nested;
  }

  return out;
}

// ── Compiler ──────────────────────────────────────────────────────────────

const OPERATORS: Readonly<Record<string, string>> = {
  _min: ">=",
  _max: "<=",
  _after: ">",
  _before: "<",
} as const;

function compileWhere(
  where: Record<string, unknown>,
  allowedCols: ReadonlySet<string>,
): [string[], unknown[], string[]] {
  const fragments: string[] = [];
  const params: unknown[] = [];
  const errors: string[] = [];

  for (const [k, v] of Object.entries(where)) {
    let op = "=";
    let col = k;
    for (const [suffix, sqlOp] of Object.entries(OPERATORS)) {
      if (k.endsWith(suffix)) {
        col = k.slice(0, -suffix.length);
        op = sqlOp;
        break;
      }
    }
    if (!allowedCols.has(col)) {
      errors.push(`unknown column: ${JSON.stringify(k)}`);
      continue;
    }
    if (Array.isArray(v)) {
      if (op !== "=") {
        errors.push(`list value not supported for operator ${op} on ${k}`);
        continue;
      }
      const placeholders = v.map(() => "%s").join(", ");
      fragments.push(`${col} IN (${placeholders})`);
      params.push(...v);
    } else if (v === null || v === undefined) {
      fragments.push(`${col} IS NULL`);
    } else {
      fragments.push(`${col} ${op} %s`);
      params.push(v);
    }
  }

  return [fragments, params, errors];
}

/**
 * Compile a cortex-query block into parameterised SQL.
 *
 * Precondition: text is the raw block content (no fences).
 * Postcondition: CompiledView.ok is true iff no errors; sql + params are ready
 *   to pass to a pg execute call. No user input is ever interpolated into SQL
 *   directly — all values are bind parameters, all column names from whitelist.
 *
 * source: mcp_server/core/wiki_view_executor.py:306-363
 */
export function compileView(text: string): CompiledView {
  const parsed = parseYamlish(text);
  const errors: string[] = [];

  const rawTable = parsed["table"];
  const table = (typeof rawTable === "string" ? rawTable : "pages").trim();
  if (!TABLE_WHITELIST[table]) {
    return {
      sql: "",
      params: [],
      errors: [`unknown table: ${JSON.stringify(table)}`],
      table,
      ok: false,
    };
  }

  const realTable = TABLE_WHITELIST[table]!;
  const allowedCols = COLUMN_WHITELIST[table]!;

  // SELECT projection
  const selectRaw = parsed["select"];
  let proj: string;
  if (Array.isArray(selectRaw) && selectRaw.length > 0) {
    const projCols = (selectRaw as string[]).filter(
      (c) => typeof c === "string" && allowedCols.has(c),
    );
    if (!projCols.length) {
      errors.push("select list contains no allowed columns");
      proj = "id";
    } else {
      proj = projCols.join(", ");
    }
  } else {
    proj = "*";
  }

  const whereRaw = parsed["where"];
  const whereDict =
    typeof whereRaw === "object" && !Array.isArray(whereRaw) && whereRaw !== null
      ? (whereRaw as Record<string, unknown>)
      : {};
  const [whereFrags, whereParams, whereErrs] = compileWhere(whereDict, allowedCols);
  errors.push(...whereErrs);

  // ORDER BY
  const orderColRaw = parsed["order_by"];
  const orderCol = typeof orderColRaw === "string" ? orderColRaw : null;
  const directionRaw = parsed["direction"];
  let direction = (typeof directionRaw === "string" ? directionRaw : "desc").toLowerCase();
  let orderClause = "";
  if (orderCol) {
    if (!allowedCols.has(orderCol)) {
      errors.push(`unknown order_by column: ${JSON.stringify(orderCol)}`);
    } else {
      if (direction !== "asc" && direction !== "desc") {
        errors.push(`direction must be 'asc' or 'desc', got ${JSON.stringify(direction)}`);
        direction = "desc";
      }
      orderClause = ` ORDER BY ${orderCol} ${direction.toUpperCase()} NULLS LAST`;
    }
  }

  let limit = parsed["limit"] ?? DEFAULT_LIMIT;
  if (typeof limit !== "number") {
    const parsed2 = parseInt(String(limit), 10);
    if (isNaN(parsed2)) {
      errors.push(`limit must be an integer, got ${JSON.stringify(limit)}`);
      limit = DEFAULT_LIMIT;
    } else {
      limit = parsed2;
    }
  }
  limit = Math.max(1, Math.min(MAX_LIMIT, limit as number));

  const whereClause =
    whereFrags.length > 0 ? " WHERE " + whereFrags.join(" AND ") : "";
  const sql = `SELECT ${proj} FROM ${realTable}${whereClause}${orderClause} LIMIT %s`;
  const params = [...whereParams, limit];

  return {
    sql,
    params,
    errors,
    table,
    ok: errors.length === 0,
  };
}
