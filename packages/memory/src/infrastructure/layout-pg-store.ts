/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * PostgreSQL persistence for precomputed graph-layout coordinates.
 *
 * Reads / writes workflow_graph_layout (defined in pg-schema.ts).
 * Pure infrastructure — no core imports. The handler layer composes this
 * with core.layout-engine to produce + persist coords.
 *
 * Layer: INFRASTRUCTURE — PostgreSQL I/O only.
 * source: Cortex mcp_server/infrastructure/layout_pg_store.py
 */

// (no process import needed — Date.now() used directly)

/** Minimal pool interface (psycopg_pool compatible shape). */
interface ConnectionPool {
  connection(): Promise<PoolConnection>;
}

/** Minimal connection handle. */
interface PoolConnection {
  cursor(): Cursor;
  commit(): void;
}

/** Minimal cursor handle. */
interface Cursor {
  execute(sql: string, params?: unknown[]): void;
  executemany(sql: string, params: unknown[][]): void;
  fetchone(): unknown[] | null;
  fetchall(): unknown[][];
}

/** Object exposing a batch_pool property (implemented by PgMemoryStore). */
interface StoreWithPool {
  batch_pool: ConnectionPool;
}

/**
 * Context-manager accessor on PgMemoryStore.
 *
 * The PG store exposes a batch_pool (psycopg_pool ConnectionPool)
 * via the property declared in pg-store.ts. We use the batch pool —
 * layout reads/writes are bulk, not interactive — and isolate the
 * pool name here so the rest of this module never touches psycopg
 * directly.
 *
 * precondition:  store has a batch_pool property.
 * postcondition: returns the pool's connection context manager.
 *
 * source: Cortex mcp_server/infrastructure/layout_pg_store.py:_conn
 */
function _pool(store: unknown): ConnectionPool {
  const s = store as Partial<StoreWithPool>;
  if (!s.batch_pool) {
    throw new Error(
      "layout_pg_store requires PgMemoryStore (no .batch_pool on this store)",
    );
  }
  return s.batch_pool;
}

/** Layout row tuple: (node_id, x, y, kind, topology_fingerprint, layout_version) */
type LayoutRow = [string, number, number, string, string, number];

/**
 * Persist (node_id, x, y, kind) rows. Returns layout_version.
 *
 * layout_version is monotonically increasing wall-clock-millis;
 * we use it as the cache key the tile + quadtree endpoints invalidate
 * on. Bulk-inserted via executemany for speed.
 *
 * The write is fully replacing — every prior row is removed before
 * the new set lands. This is correct because the layout is a global
 * snapshot, not an incremental update.
 *
 * precondition:  store has a batch_pool; coords is iterable of [id, x, y] triples.
 * postcondition: workflow_graph_layout contains exactly the rows in coords;
 *   returns layout_version (monotonically increasing ms timestamp).
 *
 * source: Cortex mcp_server/infrastructure/layout_pg_store.py:write_layout
 */
export async function writeLayout(
  store: unknown,
  coords: Iterable<[string, number, number]>,
  kinds: Record<string, string>,
  opts: { topologyFingerprint: string },
): Promise<number> {
  const layoutVersion = Date.now();
  const rows: LayoutRow[] = [];
  for (const [nid, x, y] of coords) {
    rows.push([
      nid,
      Number(x),
      Number(y),
      kinds[nid] ?? "unknown",
      opts.topologyFingerprint,
      layoutVersion,
    ]);
  }
  if (rows.length === 0) {
    return layoutVersion;
  }

  // source: Cortex mcp_server/infrastructure/layout_pg_store.py:write_layout — sql_clear
  const sqlClear = "DELETE FROM workflow_graph_layout";
  // source: Cortex mcp_server/infrastructure/layout_pg_store.py:write_layout — sql_ins
  const sqlIns =
    "INSERT INTO workflow_graph_layout " +
    "(node_id, x, y, kind, topology_fingerprint, layout_version) " +
    "VALUES ($1, $2, $3, $4, $5, $6)";

  const pool = _pool(store);
  const conn = await pool.connection();
  const cur = conn.cursor();
  cur.execute(sqlClear);
  cur.executemany(sqlIns, rows);
  conn.commit();

  return layoutVersion;
}

/** Shape of the layout version metadata returned by readLayoutVersion. */
export interface LayoutVersionInfo {
  version: number;
  fingerprint: string;
  count: number;
}

/**
 * Return { version, fingerprint, count } or null if empty.
 *
 * source: Cortex mcp_server/infrastructure/layout_pg_store.py:read_layout_version
 */
export async function readLayoutVersion(
  store: unknown,
): Promise<LayoutVersionInfo | null> {
  // source: Cortex mcp_server/infrastructure/layout_pg_store.py:read_layout_version — sql
  const sql =
    "SELECT layout_version, topology_fingerprint, COUNT(*) " +
    "FROM workflow_graph_layout " +
    "GROUP BY layout_version, topology_fingerprint " +
    "ORDER BY layout_version DESC LIMIT 1";

  const pool = _pool(store);
  const conn = await pool.connection();
  const cur = conn.cursor();
  cur.execute(sql);
  const row = cur.fetchone();
  if (!row) {
    return null;
  }
  return {
    version: Number(row[0]),
    fingerprint: String(row[1]),
    count: Number(row[2]),
  };
}

/** Layout position tuple: (node_id, x, y, kind) */
export type LayoutPosition = [string, number, number, string];

/**
 * Return every persisted (node_id, x, y, kind) row.
 *
 * Used by the quadtree endpoint to ship the full picking index to
 * the client.
 *
 * source: Cortex mcp_server/infrastructure/layout_pg_store.py:read_all_positions
 */
export async function readAllPositions(
  store: unknown,
): Promise<LayoutPosition[]> {
  // source: Cortex mcp_server/infrastructure/layout_pg_store.py:read_all_positions — sql
  const sql = "SELECT node_id, x, y, kind FROM workflow_graph_layout";

  const pool = _pool(store);
  const conn = await pool.connection();
  const cur = conn.cursor();
  cur.execute(sql);
  return cur.fetchall().map((r) => [
    String(r[0]),
    Number(r[1]),
    Number(r[2]),
    String(r[3]),
  ] as LayoutPosition);
}

/**
 * Return positions intersecting the world-space bbox.
 *
 * Used by the tile renderer: each tile request asks PG for only the
 * nodes whose coordinates fall inside the tile's world-space cell.
 *
 * precondition:  minX, minY, maxX, maxY are finite numbers.
 * postcondition: returns all rows where x BETWEEN minX AND maxX
 *   AND y BETWEEN minY AND maxY.
 *
 * source: Cortex mcp_server/infrastructure/layout_pg_store.py:read_positions_in_bbox
 */
export async function readPositionsInBbox(
  store: unknown,
  opts: { minX: number; minY: number; maxX: number; maxY: number },
): Promise<LayoutPosition[]> {
  // source: Cortex mcp_server/infrastructure/layout_pg_store.py:read_positions_in_bbox — sql
  const sql =
    "SELECT node_id, x, y, kind FROM workflow_graph_layout " +
    "WHERE x BETWEEN $1 AND $2 AND y BETWEEN $3 AND $4";

  const pool = _pool(store);
  const conn = await pool.connection();
  const cur = conn.cursor();
  cur.execute(sql, [opts.minX, opts.maxX, opts.minY, opts.maxY]);
  return cur.fetchall().map((r) => [
    String(r[0]),
    Number(r[1]),
    Number(r[2]),
    String(r[3]),
  ] as LayoutPosition);
}
