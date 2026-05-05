/**
 * GET /api/tile/{z}/{x}/{y}.png — composition root.
 *
 * Pulls positions from PG via the layout store, hands them to the
 * tile renderer, returns PNG bytes. No caching in v1.
 *
 * Port of: mcp_server/handlers/tile_handler.py
 * source: cortex@ed33435 mcp_server/handlers/tile_handler.py
 */

// ── Path parsing ───────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/tile_handler.py:13
const PATH_RE = /^\/api\/tile\/(\d+)\/(\d+)\/(\d+)\.png$/;

/**
 * Parse z/x/y from a tile path.
 * Port of: mcp_server/handlers/tile_handler.py::_parse
 * source: cortex@ed33435 mcp_server/handlers/tile_handler.py:16
 */
export function parseTilePath(urlPath: string): [number, number, number] | null {
  const m = PATH_RE.exec(urlPath.split("?")[0] ?? "");
  if (!m) return null;
  return [parseInt(m[1] ?? "0", 10), parseInt(m[2] ?? "0", 10), parseInt(m[3] ?? "0", 10)];
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface TilePosition {
  x: number;
  y: number;
  [k: string]: unknown;
}

export interface TileLayoutStore {
  readPositionsInBbox(opts: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }): Promise<TilePosition[]>;
}

export interface TileRenderer {
  tileWorldBbox(z: number, x: number, y: number): [number, number, number, number];
  renderTilePng(rows: TilePosition[], opts: { z: number; x: number; y: number }): Promise<Buffer>;
}

export type TileResponse =
  | { type: "png"; data: Buffer; cacheMaxAge: number }
  | { type: "error"; status: number; body: string };

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Serve a map tile PNG for the given z/x/y coordinates.
 *
 * precondition: urlPath matches /api/tile/{z}/{x}/{y}.png pattern.
 * postcondition: returns PNG buffer or an error response object.
 *
 * Port of: mcp_server/handlers/tile_handler.py::serve
 * source: cortex@ed33435 mcp_server/handlers/tile_handler.py:23
 */
export async function serveTile(
  urlPath: string,
  layoutStore: TileLayoutStore,
  renderer: TileRenderer,
): Promise<TileResponse> {
  const parsed = parseTilePath(urlPath);
  if (!parsed) {
    return { type: "error", status: 404, body: "" };
  }
  const [z, x, y] = parsed;

  const [minX, minY, maxX, maxY] = renderer.tileWorldBbox(z, x, y);
  const rows = await layoutStore.readPositionsInBbox({ minX, minY, maxX, maxY });

  const png = await renderer.renderTilePng(rows, { z, x, y });

  return {
    type: "png",
    data: png,
    cacheMaxAge: 300, // source: cortex@ed33435 mcp_server/handlers/tile_handler.py:68
  };
}
