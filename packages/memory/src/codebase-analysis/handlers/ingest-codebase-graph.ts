/**
 * Graph-path resolution for ingest-codebase.
 *
 * Ported from mcp_server/handlers/ingest_codebase_graph.py
 *
 * Encapsulates the "do we already have a Kuzu graph for this project?"
 * decision and the upstream `analyze_codebase` call that builds one
 * when we don't.
 */

import { existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  callUpstream,
  findCachedGraph,
  McpConnectionError,
  memoiseGraphPath,
  normaliseMcpPayload,
  type McpClientPool,
} from "./ingest-helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoryStore = any;

const _UPSTREAM_SERVER = "codebase";

export function silentCleanStaleGraphSlot(outputDir: string): void {
  /**
   * Pre-clean stale graph slots so first-time AP indexing succeeds.
   *
   * AP writes `<output_dir>/graph` as a directory; pre-3.14 versions
   * wrote a single LadybugDB file at the same path. When a user upgrades,
   * the old file occupies the slot and AP's own rm_rf errors out
   * (Not a directory (os error 20)).
   */
  const slot = join(outputDir, "graph");
  try {
    if (existsSync(slot) && !statSync(slot).isDirectory()) {
      rmSync(slot);
    }
  } catch {
    // best-effort
  }
}

async function _callAnalyze(
  projectPath: string,
  outputDir: string,
  language: string,
  pool: McpClientPool | null,
): Promise<unknown> {
  return callUpstream(_UPSTREAM_SERVER, "analyze_codebase", {
    path: resolve(projectPath),
    output_dir: resolve(outputDir),
    language,
  }, pool);
}

/**
 * Return [graphPath, analyzeStats].
 *
 * precondition:  store is a live MemoryStore; projectPath and outputDir
 *                are non-empty strings.
 * postcondition: graphPath points to an existing Kuzu graph directory;
 *                analyzeStats contains upstream response fields including
 *                reused_cached.
 */
export async function ensureGraph(
  store: MemoryStore,
  projectPath: string,
  outputDir: string,
  language: string,
  forceReindex: boolean,
  pool: McpClientPool | null = null,
): Promise<[string, Record<string, unknown>]> {
  /**
   * Return [graphPath, analyzeStats].
   *
   * Reuses the cached graph when available; otherwise calls upstream
   * analyze_codebase and memoises the resulting graph path.
   */
  if (!forceReindex) {
    const cached = findCachedGraph(store, projectPath);
    if (cached) return [cached, { reused_cached: true, graph_path: cached }];
  }

  silentCleanStaleGraphSlot(outputDir);
  let payload = await _callAnalyze(projectPath, outputDir, language, pool);
  let result = normaliseMcpPayload(payload) as Record<string, unknown>;

  // Self-heal: AP returns this specific error when the slot was a
  // non-directory at invocation time.
  if (
    typeof result === "object" &&
    result !== null &&
    result["status"] === "error" &&
    String(result["message"] ?? "").includes("Not a directory")
  ) {
    silentCleanStaleGraphSlot(outputDir);
    payload = await _callAnalyze(projectPath, outputDir, language, pool);
    result = normaliseMcpPayload(payload) as Record<string, unknown>;
  }

  // Refuse to memoise a synthesised path on persistent upstream error —
  // that would poison the cache (Liskov audit Apr-2026, Dijkstra audit #6).
  if (typeof result === "object" && result !== null && result["status"] === "error") {
    throw new McpConnectionError(
      `upstream analyze_codebase failed: ${result["message"] ?? "<no message>"}`,
    );
  }

  const graphPath =
    (result["graph_path"] as string) ?? join(resolve(outputDir), "graph");
  memoiseGraphPath(store, projectPath, graphPath);
  result["graph_path"] = graphPath;
  result["reused_cached"] = false;
  return [graphPath, result];
}
