/**
 * Cypher fetchers for ingest-codebase.
 *
 * source: cortex@f2b9f99 mcp_server/handlers/ingest_codebase_cypher.py:1-340
 *
 * Re-synced 2026-04-28 (Phase 7 Group H): ported v3.14.8/v3.14.9 deltas —
 *   - filePathFromQn now returns string[] (priority-ordered candidates, not
 *     a single head). Matches Python file_path_from_qn heuristics 1-4.
 *   - fetchFiles always passes limit=null (files are UNCAPPED; see Python
 *     ingest_codebase.py _pull_symbols_and_files comment).
 *
 * Pure data extraction from the upstream Kuzu graph via the
 * `query_graph` MCP tool. No I/O against Cortex's own stores —
 * that's the writers' job.
 *
 * Schema (probed 2026-04-25 against ai-automatised-pipeline graph):
 *   - Function/Method/Struct nodes: id, name, qualified_name,
 *     start_line, end_line, visibility, is_async (Method also has
 *     receiver_type).
 *   - File node: id, path, name, extension, size_bytes.
 *   - Relationships are untyped in this Kuzu schema; we walk via
 *     label-restricted patterns.
 *
 * File attribution is derived from the (:File)-[]->(:symbol)
 * containment edges, not from string-splitting qualified_name. The
 * containment edges are language-agnostic — whatever the upstream
 * indexer produces for Rust, Python, or TypeScript, the File→symbol
 * relationships are the source of truth. `filePathFromQn` exists
 * only as a last-resort fallback when a symbol has no containment
 * edge in the graph (orphan symbols, virtual symbols).
 */

import { callUpstream, McpConnectionError, normaliseMcpPayload } from "./ingest-helpers.js";

const _UPSTREAM_SERVER = "codebase";

const _SYMBOL_LABELS: ReadonlyArray<[string, string]> = [
  ["Function", "Function"],
  ["Method", "Method"],
  ["Struct", "Struct"],
];

// Errors we expect from a misbehaving upstream/MCP transport.
type TransportError = McpConnectionError | TypeError | RangeError | SyntaxError;
function isTransportError(e: unknown): e is TransportError {
  return (
    e instanceof McpConnectionError ||
    e instanceof TypeError ||
    e instanceof RangeError ||
    e instanceof SyntaxError
  );
}

// ── Exported types ────────────────────────────────────────────────────────

export interface SymbolRow {
  qualified_name: string;
  name: string;
  kind: string;
  file: string | null;
  start_line: number | null;
  end_line: number | null;
  visibility: string | null;
}

export interface FileRow {
  path: string;
  name: string | null;
  extension: string | null;
  size_bytes: number | null;
}

// ── Fallback ──────────────────────────────────────────────────────────────

// source: cortex@f2b9f99 mcp_server/handlers/ingest_codebase_cypher.py:53-111
// file_path_from_qn — Rust-style qualified-name fallback (v3.14.9)
const _CODE_EXTS = [".py", ".ts", ".tsx", ".rs", ".js"] as const;
// Maximum number of tail segments to drop when deriving a Rust-style module path.
// Covers the deepest realistic nesting: module::Class::method::closure (drop 3).
// source: cortex@f2b9f99 ingest_codebase_cypher.py:100-110
// eslint-disable-next-line @typescript-eslint/no-magic-numbers
const _MAX_RUST_QN_DROP = 3 as const;

export function filePathFromQn(qn: string): string[] {
  /**
   * Last-resort heuristic: derive plausible file-path candidates from a
   * qualified_name when the graph has no (:File)-[]->(:symbol) edge for it.
   *
   * Returns a list of candidates in priority order. Callers MUST validate
   * each candidate against the known-files set before trusting it — the qn
   * alone cannot distinguish a Python module from a Rust crate path.
   *
   * Heuristics applied (priority order):
   *   1. `<path/with/extension>::<sym>` — head already a file path (Python).
   *   2. `<dotted.module>::<sym>` — convert dots → slashes + append .py.
   *   3. `<a::b::c>::<sym>` — convert `::` → slashes + append .py, drop last
   *      1, 2, or 3 segments progressively (Rust-style module path).
   *
   * Returns [] when qn is empty or has no `::`.
   *
   * pre:  qn is a non-empty string
   * post: each element is a relative file-path candidate (no validation)
   */
  if (!qn || !qn.includes("::")) return [];

  const candidates: string[] = [];
  const head = qn.split("::", 2)[0] ?? "";
  if (!head) return [];

  const headIsPath =
    head.includes("/") || _CODE_EXTS.some((ext) => head.endsWith(ext));
  const headIsDottedModule =
    !headIsPath &&
    head.includes(".") &&
    !head.includes("/") &&
    !_CODE_EXTS.some((ext) => head.endsWith(ext));

  // (1) head already looks like a file path — trust it as-is.
  if (headIsPath) {
    candidates.push(head);
    return candidates;
  }

  // (2) dotted-module head (classic Python `pkg.mod::Sym`).
  if (headIsDottedModule) {
    candidates.push(head.replaceAll(".", "/") + ".py");
    return candidates;
  }

  // (3) Rust-style `a::b::c::sym` — try progressively shorter prefixes so
  // both `module::function` (drop 1) and `module::Class::method` (drop 2)
  // resolve.
  const parts = qn.split("::");
  for (let drop = 1; drop <= _MAX_RUST_QN_DROP; drop++) {
    if (parts.length - drop < 1) break;
    const prefix = parts.slice(0, parts.length - drop);
    if (prefix.length === 0) continue;
    const cand = prefix.join("/") + ".py";
    if (!candidates.includes(cand)) candidates.push(cand);
  }

  return candidates;
}

// ── Query runner ──────────────────────────────────────────────────────────

async function _runQuery(
  graphPath: string,
  cypher: string,
): Promise<[Record<string, unknown> | null, string | null]> {
  /**
   * Run a single cypher query. Returns [result_dict, error_message].
   */
  const payload = await callUpstream(_UPSTREAM_SERVER, "query_graph", {
    graph_path: graphPath,
    query: cypher,
  });
  const result = normaliseMcpPayload(payload);
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (r["status"] === "error") {
      return [null, String(r["message"] ?? "<unknown upstream error>")];
    }
    return [r, null];
  }
  return [null, `unexpected payload type: ${typeof result}`];
}

// ── Fetchers ──────────────────────────────────────────────────────────────

export async function fetchTopSymbols(
  graphPath: string,
  limit: number | null,
): Promise<[SymbolRow[], string[]]> {
  /**
   * Enumerate symbols across Function/Method/Struct.
   *
   * With `limit=null` pulls every symbol with stable ORDER BY qualified_name.
   * With `limit>0`, ranks by line span and caps each label proportionally.
   *
   * Returns [symbols, diagnostics].
   */
  const rows: SymbolRow[] = [];
  const diagnostics: string[] = [];
  const perLabel =
    limit !== null && limit > 0 ? Math.max(1, Math.floor(limit / _SYMBOL_LABELS.length)) : null;

  for (const [label, kind] of _SYMBOL_LABELS) {
    const clauses = [
      `MATCH (n:${label})`,
      "RETURN n.qualified_name AS qualified_name, n.name AS name, " +
        "n.start_line AS start_line, n.end_line AS end_line, " +
        "n.visibility AS visibility",
    ];
    if (perLabel !== null) {
      clauses.push("ORDER BY (n.end_line - n.start_line) DESC");
      clauses.push(`LIMIT ${perLabel}`);
    } else {
      clauses.push("ORDER BY n.qualified_name");
    }
    const cypher = clauses.join(" ");

    let result: Record<string, unknown> | null;
    let err: string | null;
    try {
      [result, err] = await _runQuery(graphPath, cypher);
    } catch (e) {
      if (isTransportError(e)) {
        diagnostics.push(`${label}: ${(e as Error).constructor.name}: ${(e as Error).message}`);
        continue;
      }
      throw e;
    }
    if (err !== null) {
      diagnostics.push(`${label}: ${err}`);
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const columns = (result!["columns"] as string[]) ?? [
      "qualified_name",
      "name",
      "start_line",
      "end_line",
      "visibility",
    ];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    for (const row of (result!["rows"] as unknown[][]) ?? []) {
      const record: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        record[col] = row[i];
      });
      const qn = (record["qualified_name"] as string) ?? (record["name"] as string);
      if (!qn) continue;
      rows.push({
        qualified_name: qn,
        name: (record["name"] as string) ?? qn,
        kind,
        // file assigned later from containment edges
        file: null,
        start_line: (record["start_line"] as number) ?? null,
        end_line: (record["end_line"] as number) ?? null,
        visibility: (record["visibility"] as string) ?? null,
      });
    }
  }

  const finalRows = limit !== null && limit > 0 ? rows.slice(0, limit) : rows;
  return [finalRows, diagnostics];
}

export async function fetchCallEdges(
  graphPath: string,
  known: Set<string>,
): Promise<[[string, string][], string[]]> {
  /**
   * Pull every call edge whose endpoints are in `known`.
   *
   * Pushes the target-label filter server-side via Kuzu's label-OR
   * pattern. Returns [edges, diagnostics].
   */
  if (known.size === 0) return [[], []];
  const edges: [string, string][] = [];
  const seen = new Set<string>();
  const diagnostics: string[] = [];

  for (const srcLabel of ["Function", "Method", "Struct"]) {
    const cypher =
      `MATCH (a:${srcLabel})-[]->(b:Function|Method|Struct) ` +
      `RETURN a.qualified_name AS src, b.qualified_name AS dst`;

    let result: Record<string, unknown> | null;
    let err: string | null;
    try {
      [result, err] = await _runQuery(graphPath, cypher);
    } catch (e) {
      if (isTransportError(e)) {
        diagnostics.push(
          `call-edges/${srcLabel}: ${(e as Error).constructor.name}: ${(e as Error).message}`,
        );
        continue;
      }
      throw e;
    }
    if (err !== null) {
      diagnostics.push(`call-edges/${srcLabel}: ${err}`);
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    for (const row of (result!["rows"] as unknown[][]) ?? []) {
      if ((row as unknown[]).length < 2) continue;
      const src = row[0] as string;
      const dst = row[1] as string;
      if (!src || !dst) continue;
      if (!known.has(src) || !known.has(dst) || src === dst) continue;
      const key = `${src}::${dst}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([src, dst]);
    }
  }

  return [edges, diagnostics];
}

export async function fetchFileContainment(
  graphPath: string,
  knownFiles: Set<string>,
  knownSymbols: Set<string>,
): Promise<[[string, string][], string[]]> {
  /**
   * Pull (file_path, symbol_qn) containment edges.
   *
   * Single label-OR query (push-down). Returns [edges, diagnostics].
   */
  if (knownFiles.size === 0 || knownSymbols.size === 0) return [[], []];
  const edges: [string, string][] = [];
  const seen = new Set<string>();
  const diagnostics: string[] = [];

  const cypher =
    "MATCH (f:File)-[]->(n:Function|Method|Struct) " +
    "RETURN f.path AS file_path, n.qualified_name AS qn";

  let result: Record<string, unknown> | null;
  let err: string | null;
  try {
    [result, err] = await _runQuery(graphPath, cypher);
  } catch (e) {
    if (isTransportError(e)) {
      diagnostics.push(
        `file-containment: ${(e as Error).constructor.name}: ${(e as Error).message}`,
      );
      return [edges, diagnostics];
    }
    throw e;
  }
  if (err !== null) {
    diagnostics.push(`file-containment: ${err}`);
    return [edges, diagnostics];
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  for (const row of (result!["rows"] as unknown[][]) ?? []) {
    if ((row as unknown[]).length < 2) continue;
    const f = row[0] as string;
    const qn = row[1] as string;
    if (!f || !qn) continue;
    if (!knownFiles.has(f) || !knownSymbols.has(qn)) continue;
    const key = `${f}::${qn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([f, qn]);
  }

  return [edges, diagnostics];
}

export async function fetchFiles(
  graphPath: string,
  limit: number | null,
): Promise<[FileRow[], string[]]> {
  /**
   * Pull every File node so file-level containment edges resolve.
   *
   * `limit=null` => pull all; `limit>0` => cap server-side.
   * Returns [files, diagnostics].
   */
  const clauses = [
    "MATCH (f:File)",
    "RETURN f.path AS path, f.name AS name, f.extension AS extension, f.size_bytes AS size_bytes",
    "ORDER BY f.path",
  ];
  if (limit !== null && limit > 0) clauses.push(`LIMIT ${limit}`);
  const cypher = clauses.join(" ");

  let result: Record<string, unknown> | null;
  let err: string | null;
  try {
    [result, err] = await _runQuery(graphPath, cypher);
  } catch (e) {
    if (isTransportError(e)) {
      return [
        [],
        [`files: ${(e as Error).constructor.name}: ${(e as Error).message}`],
      ];
    }
    throw e;
  }
  if (err !== null) return [[], [`files: ${err}`]];

  const rows: FileRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  for (const row of (result!["rows"] as unknown[][]) ?? []) {
    if ((row as unknown[]).length < 1 || !row[0]) continue;
    // Destructure result row to avoid magic index numbers.
    // Column order matches: RETURN f.path, f.name, f.extension, f.size_bytes
    const [fPath, fName, fExt, fSize] = row as [
      string,
      string | null,
      string | null,
      number | null,
    ];
    rows.push({
      path: fPath,
      name: fName ?? null,
      extension: fExt ?? null,
      size_bytes: fSize ?? null,
    });
  }
  return [rows, []];
}
