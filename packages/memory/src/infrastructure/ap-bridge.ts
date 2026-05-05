/**
 * Bridge to the ``automatised-pipeline`` sibling MCP server (ADR-0046).
 *
 * AP is a Rust MCP server that indexes codebases into a property graph
 * (tree-sitter → LadybugDB → Louvain → BM25 + TF-IDF + RRF) and exposes
 * 23 tools. Cortex consumes a subset of those tools — indexing, graph
 * queries, symbol lookup, search — to add AST-level depth to its
 * workflow graph.
 *
 * Enabled by default (MemorySettings.AP_ENABLED = True) so the L6
 * symbol ring has depth out of the box. Users cut token / subprocess
 * cost by setting CORTEX_MEMORY_AP_ENABLED=0 in their MCP config.
 * When off, no connection is attempted, every call returns null,
 * and the workflow graph falls back to the native in-process AST source.
 *
 * Infrastructure layer only. No core imports.
 *
 * source: Cortex mcp_server/infrastructure/ap_bridge.py
 */

import { existsSync, accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { McpConnectionError } from "../shared/errors.js";
import { MCPClient } from "./mcp-client.js";

// AP tool allowlist — matches ap_bridge.py:_AP_TOOLS
// source: ap_bridge.py:29-43
const _AP_TOOLS = new Set([
  "health_check",
  "index_codebase",
  "query_graph",
  "resolve_graph",
  "cluster_graph",
  "analyze_codebase", // all-in-one: index + resolve + cluster
  "search_codebase",
  "get_context",
  "get_symbol",
  "get_impact",
  "detect_changes",
]);

// ── Feature flag ───────────────────────────────────────────────────────

/**
 * Return true when AP enrichment is active.
 *
 * Single source of truth: CORTEX_MEMORY_AP_ENABLED env var.
 * Default is ``true`` — the L6 symbol ring has depth out of the box.
 * Users who want to cut token / subprocess cost set
 * CORTEX_MEMORY_AP_ENABLED=0 in their MCP server env block.
 *
 * AP absence still degrades gracefully: APBridge.connect() returns
 * false silently and every tool call short-circuits to null; the native
 * in-process AST source fills the L6 ring.
 *
 * source: ap_bridge.py:46-66
 */
export function isEnabled(): boolean {
  const raw = process.env["CORTEX_MEMORY_AP_ENABLED"];
  if (raw === undefined || raw === null) return true; // default on
  return raw !== "0" && raw.toLowerCase() !== "false";
}

// ── Graph path resolution ──────────────────────────────────────────────

/**
 * Return a LadybugDB graph path (single-graph callers).
 *
 * Preference order:
 *   1. CORTEX_AP_GRAPH_PATH env var (explicit caller override).
 *   2. The conventional legacy location $HOME/.cortex/ap_graph/graph.
 *   3. The first graph in the multi-project roster (resolveGraphPaths).
 *
 * source: ap_bridge.py:69-86
 */
export function resolveGraphPath(): string | null {
  const raw = (process.env["CORTEX_AP_GRAPH_PATH"] ?? "").trim();
  if (raw) return raw;

  const defaultPath = join(homedir(), ".cortex", "ap_graph", "graph");
  if (existsSync(defaultPath)) return defaultPath;

  const paths = resolveGraphPaths();
  return paths.length > 0 ? (paths[0] ?? null) : null;
}

/**
 * Return every LadybugDB graph the visualization should query.
 *
 * Cortex keeps AP-indexed graphs under TWO directory schemes — the
 * legacy ~/.cortex/ap_graphs/<project>/graph (predates the AP CLI
 * rename) and the current ~/.cache/cortex/code-graphs/<project>-<hash>/graph
 * (where the in-tree ingest_codebase handler writes them). Both
 * must be scanned so a fresh install with no manual setup discovers
 * every graph the user already has.
 *
 * Each candidate must exist (file or directory — AP's LadybugDB is a
 * single ``graph`` file with a ``graph.wal`` sibling, NOT a directory;
 * earlier filtering on ``is_dir`` silently dropped every valid graph).
 *
 * source: ap_bridge.py:89-131
 */
export function resolveGraphPaths(): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  function _add(p: string): void {
    if (seen.has(p) || !existsSync(p)) return;
    paths.push(p);
    seen.add(p);
  }

  const raw = (process.env["CORTEX_AP_GRAPH_PATH"] ?? "").trim();
  if (raw) _add(raw);

  const legacy = join(homedir(), ".cortex", "ap_graph", "graph");
  _add(legacy);

  const rosters = [
    join(homedir(), ".cortex", "ap_graphs"),
    join(homedir(), ".cache", "cortex", "code-graphs"),
  ];

  for (const roster of rosters) {
    if (!existsSync(roster)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(roster).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      _add(join(roster, entry, "graph"));
    }
  }

  return paths;
}

// ── Command resolution ─────────────────────────────────────────────────

/**
 * Resolve the MCP-client config for AP.
 *
 * Priority:
 *   1. CORTEX_AP_COMMAND env var — full shell-free invocation
 *      spec (JSON: {"command": "...", "args": [...]}).
 *   2. Methodology bin symlink — ~/.claude/methodology/bin/mcp-server
 *      set up by Cortex's silent installer (pipeline_installer.py).
 *      Basename ``mcp-server`` matches the MCPClient allowlist.
 *   3. Plugin-cache probe — ``automatised-pipeline`` installed as a
 *      sibling marketplace plugin exposes its MCP entrypoint via
 *      ~/.claude/plugins/cache/<marketplace>/automatised-pipeline/
 *      \/\*\/bin\/\*.
 *
 * Returns null when no AP install can be discovered.
 *
 * source: ap_bridge.py:134-176
 */
function _resolveCommand(): { command: string; args: string[] } | null {
  const raw = process.env["CORTEX_AP_COMMAND"];
  if (raw) {
    try {
      const cfg = JSON.parse(raw) as unknown;
      if (
        cfg &&
        typeof cfg === "object" &&
        "command" in cfg &&
        typeof (cfg as Record<string, unknown>)["command"] === "string"
      ) {
        return cfg as { command: string; args: string[] };
      }
    } catch {
      return null;
    }
  }

  const home = homedir();
  // Methodology bin symlink (preferred — same path the live MCP
  // server uses via mcp-connections.json).
  // source: ap_bridge.py:167-171
  const binPath = join(home, ".claude", "methodology", "bin", "mcp-server");
  if (_isExecutable(binPath)) {
    return { command: binPath, args: [] };
  }

  // Plugin-cache probe.
  // source: ap_bridge.py:172-175
  const pluginRoot = join(home, ".claude", "plugins", "cache");
  if (existsSync(pluginRoot)) {
    const candidates = _globPluginBins(pluginRoot);
    if (candidates.length > 0) {
      return { command: "node", args: [candidates[0] ?? ""] };
    }
  }

  return null;
}

function _isExecutable(p: string): boolean {
  try {
    accessSync(p, fsConstants.F_OK | fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function _globPluginBins(pluginRoot: string): string[] {
  // Shallow glob: pluginRoot/*/automatised-pipeline/*/bin/*
  const results: string[] = [];
  try {
    for (const marketplace of readdirSync(pluginRoot)) {
      const apDir = join(pluginRoot, marketplace, "automatised-pipeline");
      if (!existsSync(apDir)) continue;
      for (const version of readdirSync(apDir)) {
        const binDir = join(apDir, version, "bin");
        if (!existsSync(binDir)) continue;
        for (const bin of readdirSync(binDir)) {
          const full = join(binDir, bin);
          if (_isExecutable(full)) results.push(full);
        }
      }
    }
  } catch {
    // ignore FS errors
  }
  return results;
}

// ── APBridge class ─────────────────────────────────────────────────────

/**
 * Thin wrapper around MCPClient scoped to AP's tool namespace.
 *
 * Lazy-connects on first call. Safe to construct unconditionally —
 * connect() bails out when the feature flag is off.
 *
 * source: ap_bridge.py:179-358
 */
export class APBridge {
  private readonly _config: { command: string; args: string[] } | null;
  private _client: MCPClient | null = null;
  private _connectPromise: Promise<boolean> | null = null;
  private _connected = false;
  private _unavailableReason: string | null = null;

  constructor(config?: { command: string; args: string[] } | null) {
    this._config = config ?? null;
  }

  /**
   * True iff the flag is on and no prior connect attempt failed.
   * source: ap_bridge.py:194-196
   */
  get available(): boolean {
    return isEnabled() && this._unavailableReason === null;
  }

  get unavailableReason(): string | null {
    return this._unavailableReason;
  }

  /**
   * Connect on demand. Returns false if the flag is off or the
   * server can't be reached; the caller treats that as graceful
   * degradation, not an error.
   *
   * source: ap_bridge.py:202-242
   */
  async connect(): Promise<boolean> {
    if (!isEnabled()) {
      this._unavailableReason = "disabled";
      return false;
    }
    if (this._connected) return true;

    // Deduplicate concurrent connect() calls
    if (this._connectPromise !== null) {
      return this._connectPromise;
    }

    this._connectPromise = this._doConnect();
    const result = await this._connectPromise;
    this._connectPromise = null;
    return result;
  }

  private async _doConnect(): Promise<boolean> {
    if (this._connected) return true;
    const cfg = this._config ?? _resolveCommand();
    if (cfg === null) {
      this._unavailableReason = "no_command_resolved";
      return false;
    }
    try {
      // Disable the per-call timeout for AP. Fresh indexing of
      // large codebases can exceed any fixed bound; liveness is
      // governed by the child process and explicit cancellation.
      // See mcp_client.py: callTimeoutMs=0 -> no asyncio.wait_for.
      // source: ap_bridge.py:221-223
      const clientCfg = { ...cfg, callTimeoutMs: 0 };
      this._client = new MCPClient(clientCfg);
      // AP's binary is not in the default allowlist.
      // ``automatised-pipeline`` is the bin name shipped by
      // cdeust/automatised-pipeline ≥ v0.0.7; ``node`` is for
      // the plugin-cache resolution path.
      // source: ap_bridge.py:228-232
      this._client._extraAllowedCommands = new Set(["node", "automatised-pipeline"]);
      await this._client.connect();
      this._connected = true;
      return true;
    } catch (exc) {
      this._unavailableReason = `${(exc as Error).constructor?.name ?? "Error"}: ${String(exc)}`;
      process.stderr.write(
        `[cortex] AP bridge disabled: ${this._unavailableReason}\n`,
      );
      return false;
    }
  }

  /**
   * Call an AP tool. Returns null if AP is unavailable.
   * source: ap_bridge.py:244-258
   */
  async call(tool: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!_AP_TOOLS.has(tool)) {
      throw new Error(`AP tool not in allowlist: ${JSON.stringify(tool)}`);
    }
    if (!(await this.connect())) return null;
    try {
      return await this._client!.call(tool, args ?? {});
    } catch (exc) {
      this._unavailableReason = `${(exc as Error).constructor?.name ?? "Error"}: ${String(exc)}`;
      process.stderr.write(
        `[cortex] AP call ${tool} failed: ${String(exc)}\n`,
      );
      return null;
    }
  }

  // ── Convenience wrappers matching AP's MCP schema (src/tool_schemas.rs).
  // All Stage-3a tools are scoped to a graph_path returned by
  // index_codebase; callers pass it through or rely on the cached one.

  /** source: ap_bridge.py:263-264 */
  async healthCheck(): Promise<unknown> {
    return this.call("health_check", {});
  }

  /**
   * Index ``path`` into a LadybugDB graph at ``outputDir``.
   *
   * AP requires both ``path`` (source root) and ``outputDir``
   * (where ``graph/`` lives). Returns a dict including
   * ``graphPath``; subsequent calls must pass that path.
   *
   * source: ap_bridge.py:266-282
   */
  async indexCodebase(
    apPath: string,
    opts: { outputDir: string; language?: string },
  ): Promise<unknown> {
    return this.call("index_codebase", {
      path: apPath,
      output_dir: opts.outputDir,
      language: opts.language ?? "auto",
    });
  }

  /**
   * Execute a Cypher ``query`` against the graph at ``graphPath``.
   * source: ap_bridge.py:284-289
   */
  async queryGraph(graphPath: string, query: string): Promise<unknown> {
    return this.call("query_graph", { graph_path: graphPath, query });
  }

  /**
   * Look up a symbol by its ``file::name`` qualified name.
   * source: ap_bridge.py:291-296
   */
  async getSymbol(graphPath: string, qualifiedName: string): Promise<unknown> {
    return this.call("get_symbol", {
      graph_path: graphPath,
      qualified_name: qualifiedName,
    });
  }

  /** source: ap_bridge.py:298-303 */
  async getContext(graphPath: string, symbolId: string): Promise<unknown> {
    return this.call("get_context", {
      graph_path: graphPath,
      symbol_id: symbolId,
    });
  }

  /** source: ap_bridge.py:305-313 */
  async searchCodebase(
    graphPath: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<unknown> {
    return this.call("search_codebase", {
      graph_path: graphPath,
      query,
      limit: opts?.limit ?? 20,
    });
  }

  /** source: ap_bridge.py:315-323 */
  async detectChanges(
    graphPath: string,
    opts?: { base?: string; head?: string },
  ): Promise<unknown> {
    return this.call("detect_changes", {
      graph_path: graphPath,
      base: opts?.base ?? "HEAD~1",
      head: opts?.head ?? "HEAD",
    });
  }

  /** source: ap_bridge.py:325-329 */
  async getImpact(graphPath: string, symbolId: string): Promise<unknown> {
    return this.call("get_impact", {
      graph_path: graphPath,
      symbol_id: symbolId,
    });
  }

  /**
   * All-in-one: runs index_codebase + resolve_graph + cluster_graph.
   *
   * search_codebase (Stage 3d) requires all three to have run; use
   * this when you want Phase-3 unified search against a fresh index.
   *
   * source: ap_bridge.py:331-349
   */
  async analyzeCodebase(
    apPath: string,
    opts: { outputDir: string; language?: string },
  ): Promise<unknown> {
    return this.call("analyze_codebase", {
      path: apPath,
      output_dir: opts.outputDir,
      language: opts.language ?? "auto",
    });
  }

  /** source: ap_bridge.py:351-358 */
  async close(): Promise<void> {
    if (this._client !== null) {
      try {
        this._client.close();
      } catch {
        // ignore
      }
      this._client = null;
    }
    this._connected = false;
  }
}
