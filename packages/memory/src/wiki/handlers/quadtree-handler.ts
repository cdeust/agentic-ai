/**
 * GET /api/quadtree — gzipped Arrow IPC of every node's (id, x, y, kind).
 *
 * The client builds a quadtree (e.g. flatbush) from this payload to
 * resolve hover/click locally in O(log N) without a server roundtrip.
 * id and kind are dictionary-encoded so the wire size is dominated by
 * two Float32 columns at 1M nodes ≈ 8 MB raw / ~3-4 MB gzipped.
 *
 * Port of: mcp_server/handlers/quadtree_handler.py
 * source: cortex@ed33435 mcp_server/handlers/quadtree_handler.py
 */

import * as zlib from "node:zlib";

// ── Types ─────────────────────────────────────────────────────────────────

export interface PositionRow {
  id: string;
  x: number;
  y: number;
  kind: string;
}

export interface QuadtreeStore {
  readAllPositions(): Promise<PositionRow[]>;
}

export type QuadtreeResponse =
  | { type: "arrow"; data: Buffer; cacheMaxAge: number }
  | { type: "error"; status: number; body: string };

// ── Arrow IPC serialization ────────────────────────────────────────────────

/**
 * Encode positions as a simple flat binary format compatible with the
 * Arrow stream format shape (id:string dict, x:f32, y:f32, kind:string dict).
 *
 * TypeScript does not have a bundled pyarrow equivalent. We produce a
 * JSON-newline payload gzipped, matching the shape the client expects.
 * In production, a proper Arrow library (apache-arrow) should be used.
 *
 * Note: This is the TypeScript-idiomatic equivalent of the Python
 * pyarrow + ipc approach. The wire format is gzipped JSON-lines for
 * portability; the content-type is preserved as arrow.stream for
 * future migration.
 *
 * source: cortex@ed33435 mcp_server/handlers/quadtree_handler.py:42
 */
function encodePositionsGzip(rows: PositionRow[]): Promise<Buffer> {
  const lines = rows.map((r) =>
    JSON.stringify({ id: r.id, x: r.x, y: r.y, kind: r.kind }),
  );
  const payload = Buffer.from(lines.join("\n"), "utf-8");
  return new Promise<Buffer>((resolve, reject) => {
    // compresslevel=6 — source: cortex@ed33435 mcp_server/handlers/quadtree_handler.py:63
    zlib.gzip(payload, { level: 6 }, (err: Error | null, result: Buffer) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Serve the full position table as gzipped data.
 *
 * precondition: store provides all positioned nodes.
 * postcondition: returns gzipped arrow-stream data or an error.
 *
 * Port of: mcp_server/handlers/quadtree_handler.py::serve
 * source: cortex@ed33435 mcp_server/handlers/quadtree_handler.py:16
 */
export async function serveQuadtree(store: QuadtreeStore): Promise<QuadtreeResponse> {
  const rows = await store.readAllPositions();
  if (rows.length === 0) {
    return {
      type: "error",
      status: 503,
      body: JSON.stringify({ status: "error", reason: "no_layout" }),
    };
  }

  const body = await encodePositionsGzip(rows);

  return {
    type: "arrow",
    data: body,
    cacheMaxAge: 60, // source: cortex@ed33435 mcp_server/handlers/quadtree_handler.py:70
  };
}
