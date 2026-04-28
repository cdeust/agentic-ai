/**
 * AST-backed loader for the workflow graph (ADR-0046).
 *
 * source: cortex@f2b9f99 mcp_server/infrastructure/workflow_graph_source_ast.py:1-709
 *
 * Re-synced 2026-04-28 (Phase 7 Group H) — ported Group 6 L6 AST uncap deltas:
 *   - Drop _MAX_SYMBOLS_PER_FILE LIMIT in load-all mode (paths=[]).
 *     Load-all callers (paths=[]) get an uncapped query; per-file cap only when
 *     paths are given. Source: py:33-34 + py:369-372.
 *   - Replace hand-typed edge-label list with Cartesian product over _SYMBOL_LABELS.
 *     Source: py:543-565.
 *   - Add `Import` to _SYMBOL_LABELS; define _NON_QUALIFIED_LABELS = {"Import"}.
 *     Source: py:167-204.
 *   - Patch _loadSymbolsAsync and _runEdge to use s.id / s.path for
 *     non-qualified labels. Source: py:354-361 + py:591-613.
 *   - Wire `Defines_File_Import` as an "imports" edge. Source: py:677-687.
 *   - Add `Uses_*` edges. Source: py:689-704.
 *
 * AP bridge dependency: the Python original uses APBridge (subprocess IPC to
 * the automatised-pipeline Rust binary). The TS port delegates to callUpstream
 * from ingest-helpers, which routes through the MCP client pool (port-pending:
 * mcp_client_pool). Until the pool is wired, every AP call throws
 * McpConnectionError and the loader returns [] gracefully. The public API is
 * identical to the Python original; callers see the correct degraded behavior.
 *
 * Peer of source-jsonl.ts, source-native-ast.ts, source-pg.ts.
 * Pure infrastructure — no core imports.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  callUpstream,
  McpConnectionError,
  normaliseMcpPayload,
} from "../../codebase-analysis/handlers/ingest-helpers.js";

// Upstream MCP server name (matches ingest-codebase-cypher.ts).
const _AP_SERVER = "codebase";

// Per-file paranoid cap, applied ONLY when the caller specifies paths.
// Load-all callers (paths=[]) get an uncapped query — the L6 viz pipeline
// legitimately needs every symbol the AP graph holds.
// source: cortex@f2b9f99 workflow_graph_source_ast.py:34
const _MAX_SYMBOLS_PER_FILE = 500;

// Default result limit for searchCodebase.
// source: cortex@f2b9f99 workflow_graph_source_ast.py:414 — default limit=20
const _DEFAULT_SEARCH_LIMIT = 20;

// AP's node labels carrying symbol semantics. Derived from stage-3
// tree-sitter extractors; see automatised-pipeline/src/clustering.rs.
// source: cortex@f2b9f99 workflow_graph_source_ast.py:167-199
const _SYMBOL_LABELS = [
  // Core — Rust + Python (original set)
  "Function",
  "Method",
  "Struct",
  "Enum",
  "Trait",
  "Constant",
  "TypeAlias",
  // JVM family — Java, Kotlin
  "Class",
  "Interface",
  "Field",
  "Property",
  // Swift / ObjC family
  "Protocol",
  "Extension",
  // C / C++
  "Union",
  "Typedef",
  "Macro",
  // Go / general
  "Module",
  "Package",
  "Namespace",
  "Variable",
  // Import statements (one node per `import` site). AP wires every
  // file to its imports via the Defines_File_Import rel table; the
  // nodes themselves carry id (<file>::<modpath>), path, alias, is_glob.
  // Loaded via a custom property mapping in _loadSymbolsAsync because
  // imports lack qualified_name.
  "Import",
] as const;

type _SymbolLabel = (typeof _SYMBOL_LABELS)[number];

// Labels whose nodes don't expose qualified_name / name. The load query
// falls back to id / path (or whatever the node DOES carry) so they still
// flow into the graph.
// source: cortex@f2b9f99 workflow_graph_source_ast.py:204
const _NON_QUALIFIED_LABELS = new Set<string>(["Import"]);

// ── Environment helpers ────────────────────────────────────────────────────

/**
 * Return true when AP enrichment is active.
 *
 * pre:  none
 * post: returns true iff CORTEX_MEMORY_AP_ENABLED is unset or != "0"
 *
 * source: cortex@f2b9f99 ap_bridge.py:46-67
 */
function _isEnabled(): boolean {
  const raw = process.env["CORTEX_MEMORY_AP_ENABLED"];
  if (raw === undefined || raw === null) return true; // default: enabled
  return raw.trim() !== "0";
}

/**
 * Return every LadybugDB graph_path that exists on this machine.
 *
 * Scans legacy (~/.cortex/ap_graph/graph) and current
 * (~/.cache/cortex/code-graphs/<project>/graph) locations.
 * Explicit CORTEX_AP_GRAPH_PATH env override takes precedence.
 *
 * pre:  _isEnabled() is true
 * post: each element is an absolute path to an existing graph file/dir
 *
 * source: cortex@f2b9f99 ap_bridge.py:89-138
 */
function _resolveGraphPaths(): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  function addPath(p: string): void {
    if (!seen.has(p) && existsSync(p)) {
      paths.push(p);
      seen.add(p);
    }
  }

  const explicit = (process.env["CORTEX_AP_GRAPH_PATH"] ?? "").trim();
  if (explicit) {
    addPath(explicit);
  }

  const home = homedir();
  // Legacy location
  addPath(join(home, ".cortex", "ap_graph", "graph"));

  // Current location roster
  for (const roster of [
    join(home, ".cortex", "ap_graphs"),
    join(home, ".cache", "cortex", "code-graphs"),
  ]) {
    if (!existsSync(roster)) continue;
    let entries: string[];
    try {
      entries = readdirSync(roster);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const candidate = join(roster, entry, "graph");
      addPath(candidate);
    }
  }

  return paths;
}

// ── AP response normalizer ─────────────────────────────────────────────────

/**
 * Normalise AP's `query_graph` response into a list of row objects.
 *
 * AP's Stage-3a query_graph returns:
 *   { "columns": ["a","b"], "rows": [["1","2"],["3","4"]], "status": "ok", ... }
 * We zip columns with each row to produce [{a:"1", b:"2"}, ...].
 * Error responses (status:"error") surface as []. Plain lists and dicts
 * with a "rows" key containing dicts are also accepted for forward-compat.
 *
 * pre:  payload is any value returned by callUpstream
 * post: each element is a Record<string, unknown> extracted from the payload
 *
 * source: cortex@f2b9f99 workflow_graph_source_ast.py:116-161
 */
function _asList(payload: unknown): Record<string, unknown>[] {
  const normalised = normaliseMcpPayload(payload);
  if (normalised === null || normalised === undefined) return [];
  if (Array.isArray(normalised)) {
    return normalised.filter(
      (r): r is Record<string, unknown> =>
        typeof r === "object" && r !== null && !Array.isArray(r),
    );
  }
  if (typeof normalised !== "object") return [];
  const p = normalised as Record<string, unknown>;
  if (p["status"] === "error") return [];

  const cols = p["columns"];
  const rows = p["rows"];
  if (Array.isArray(cols) && Array.isArray(rows)) {
    const out: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (Array.isArray(row) && row.length === (cols as unknown[]).length) {
        const obj: Record<string, unknown> = {};
        (cols as string[]).forEach((c, i) => {
          obj[String(c)] = row[i];
        });
        out.push(obj);
      } else if (typeof row === "object" && row !== null && !Array.isArray(row)) {
        out.push(row as Record<string, unknown>);
      }
    }
    return out;
  }

  // Older {"content": [...]} / {"data": [...]} shapes — already handled by
  // normaliseMcpPayload above; reaching here means a bare dict was returned.
  return [];
}

// ── Symbol type mapper ─────────────────────────────────────────────────────

/**
 * Map AP's label → workflow-graph symbol_type.
 *
 * Keeps the value set small so the palette (SYMBOL_COLORS) stays compact.
 * Every AP label from every supported language collapses into one of:
 * function · method · class · module · constant · import.
 *
 * source: cortex@f2b9f99 workflow_graph_source_ast.py:207-248
 */
function _symbolTypeFromLabel(label: string): string {
  const low = label.toLowerCase();
  if (low === "function") return "function";
  if (low === "method") return "method";
  if (low === "import") return "import";
  // All type-like constructs → class (Rust struct/enum/trait, Java/Kotlin
  // class/interface, Swift/ObjC protocol/extension, C/C++ union).
  if (
    ["struct", "enum", "trait", "class", "interface", "protocol", "extension", "union"].includes(
      low,
    )
  )
    return "class";
  // Module-ish containers → module (amber).
  if (["module", "package", "namespace"].includes(low)) return "module";
  // Value-ish / alias-ish → constant (slate).
  if (
    ["constant", "typealias", "typedef", "macro", "field", "property", "variable"].includes(low)
  )
    return "constant";
  return low;
}

// ── Core implementation ────────────────────────────────────────────────────

export class WorkflowGraphASTSource {
  /**
   * AST-layer loader. Construct once per graph build; the inner bridge caches
   * its MCP connection across calls.
   *
   * pre:  constructor can be called unconditionally; enabled() guards queries
   * post: loadSymbols / loadAstEdges return [] when AP is disabled / unreachable
   *
   * source: cortex@f2b9f99 workflow_graph_source_ast.py:250-268
   */

  enabled(): boolean {
    /**
     * Return true when AP enrichment is active.
     * pre:  none
     * post: false iff CORTEX_MEMORY_AP_ENABLED=0
     */
    return _isEnabled();
  }

  async loadSymbolsAsync(filePaths: Iterable<string>): Promise<Record<string, unknown>[]> {
    /**
     * Return one row per AST symbol defined in a file Cortex knows about.
     * Row shape: {file_path, qualified_name, symbol_type, signature, language, line, domain}.
     * domain is always "" — the builder infers it from the file node.
     *
     * pre:  _isEnabled() is true (checked at entry)
     * post: each row has file_path and qualified_name set; signature/language/line may be null
     *
     * source: cortex@f2b9f99 workflow_graph_source_ast.py:269-297
     */
    if (!_isEnabled()) return [];
    const graphPaths = _resolveGraphPaths();
    if (graphPaths.length === 0) return [];
    const paths = [...filePaths].filter(Boolean);

    const out: Record<string, unknown>[] = [];
    for (const gp of graphPaths) {
      try {
        const rows = await this._loadSymbolsAsync(gp, paths);
        out.push(...rows);
      } catch {
        // One bad graph (corrupt / missing) never kills the whole visualization.
        continue;
      }
    }
    return out;
  }

  // Sync façade — retained for callers that don't await.
  // WARNING: this runs the async work synchronously via a micro-task drain.
  // Prefer loadSymbolsAsync() in new code.
  loadSymbols(filePaths: Iterable<string>): Record<string, unknown>[] {
    // port-pending: sync façade over async AP calls. Returns [] immediately;
    // callers that need AP data must use loadSymbolsAsync().
    void this.loadSymbolsAsync(filePaths);
    return [];
  }

  async loadAstEdgesAsync(filePaths: Iterable<string>): Promise<Record<string, unknown>[]> {
    /**
     * Return CALLS / IMPORTS / MEMBER_OF / USES edges across every project graph.
     * Empty filePaths means "no path filter" (load-all mode).
     *
     * pre:  _isEnabled() is true (checked at entry)
     * post: each row has {kind, src_file, src_name, dst_file, dst_name, confidence, reason}
     *
     * source: cortex@f2b9f99 workflow_graph_source_ast.py:299-322
     */
    if (!_isEnabled()) return [];
    const graphPaths = _resolveGraphPaths();
    if (graphPaths.length === 0) return [];
    const paths = [...filePaths].filter(Boolean);

    const out: Record<string, unknown>[] = [];
    for (const gp of graphPaths) {
      try {
        const rows = await this._loadEdgesAsync(gp, paths);
        out.push(...rows);
      } catch {
        continue;
      }
    }
    return out;
  }

  // Sync façade — retained for callers that don't await.
  loadAstEdges(filePaths: Iterable<string>): Record<string, unknown>[] {
    // port-pending: sync façade over async AP calls. Returns [] immediately;
    // callers that need AP data must use loadAstEdgesAsync().
    void this.loadAstEdgesAsync(filePaths);
    return [];
  }

  async searchCodebase(
    query: string,
    { limit = _DEFAULT_SEARCH_LIMIT }: { limit?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    /**
     * Forward search_codebase to AP and normalize to a flat list of
     * {id, qualified_name, file_path, score, snippet}.
     *
     * pre:  query is a non-empty string
     * post: each row has id, qualified_name, file_path, score, snippet, source
     *
     * source: cortex@f2b9f99 workflow_graph_source_ast.py:409-451
     */
    if (!_isEnabled() || !query.trim()) return [];
    const graphPaths = _resolveGraphPaths();
    if (graphPaths.length === 0) return [];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const gp = graphPaths[0]!;

    let resp: unknown;
    try {
      resp = await callUpstream(_AP_SERVER, "search_codebase", {
        graph_path: gp,
        query,
        limit: Math.floor(limit),
      });
    } catch {
      return [];
    }

    const out: Record<string, unknown>[] = [];
    for (const r of _asList(resp)) {
      const qname = String(r["qualified_name"] ?? r["name"] ?? "");
      const fpath = String(r["file_path"] ?? r["abs_path"] ?? "");
      if (!qname) continue;
      out.push({
        id: `symbol:${fpath}::${qname}`,
        qualified_name: qname,
        file_path: fpath,
        score: Number(r["score"] ?? 0),
        snippet: String(r["snippet"] ?? r["signature"] ?? ""),
        source: "ap",
      });
    }
    return out;
  }

  async verifySymbols(qualnames: string[]): Promise<Record<string, boolean>> {
    /**
     * Return {qualname: exists_in_ap} for each candidate.
     *
     * pre:  qualnames is a list of qualified names to check
     * post: each key maps to true iff the symbol exists in the AP graph
     *
     * source: cortex@f2b9f99 workflow_graph_source_ast.py:453-513
     */
    if (!_isEnabled()) return Object.fromEntries(qualnames.map((q) => [q, false]));
    const graphPaths = _resolveGraphPaths();
    if (graphPaths.length === 0) return Object.fromEntries(qualnames.map((q) => [q, false]));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const gp = graphPaths[0]!;
    const uniq = [...new Set(qualnames)].filter(Boolean);
    if (uniq.length === 0) return {};
    return this._verifySymbolsAsync(gp, uniq);
  }

  close(): void {
    // no-op in TS — no long-lived subprocess to clean up; the MCP client pool
    // manages connections. Idempotent.
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _loadSymbolsAsync(
    graphPath: string,
    paths: string[],
  ): Promise<Record<string, unknown>[]> {
    /**
     * Pull all symbols whose owning file ∈ paths.
     *
     * precondition:  paths may be [] (load-all mode) or a non-empty list
     * postcondition: each returned row has file_path + qualified_name set
     *
     * source: cortex@f2b9f99 workflow_graph_source_ast.py:324-407
     */
    const out: Record<string, unknown>[] = [];

    // Build a set of tail fragments for fast matching.
    const pathTails = new Set<string>();
    for (const p of paths) {
      if (!p) continue;
      pathTails.add(p);
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) {
        pathTails.add(parts.slice(i).join("/"));
      }
    }

    for (const label of _SYMBOL_LABELS) {
      // Import nodes don't carry qualified_name / name — they use id
      // (<file>::<modpath>) and path (the imported module).
      // source: cortex@f2b9f99 workflow_graph_source_ast.py:354-361
      let baseQuery: string;
      if (_NON_QUALIFIED_LABELS.has(label)) {
        baseQuery =
          `MATCH (s:${label}) ` +
          "RETURN s.id   AS qualified_name, " +
          "       s.path AS name";
      } else {
        baseQuery =
          `MATCH (s:${label}) ` +
          "RETURN s.qualified_name AS qualified_name, " +
          "       s.name           AS name";
      }

      // No LIMIT in load-all mode (paths=[]). Per-file cap only when paths are given.
      // source: cortex@f2b9f99 workflow_graph_source_ast.py:369-372
      const query =
        paths.length > 0
          ? baseQuery + ` LIMIT ${_MAX_SYMBOLS_PER_FILE * paths.length}`
          : baseQuery;

      let rows: unknown;
      try {
        rows = await callUpstream(_AP_SERVER, "query_graph", {
          graph_path: graphPath,
          query,
        });
      } catch (e) {
        if (e instanceof McpConnectionError) continue;
        throw e;
      }

      for (const r of _asList(rows)) {
        const qn = r["qualified_name"];
        if (!qn) continue;
        const qnStr = String(qn);
        const colonIdx = qnStr.indexOf("::");
        if (colonIdx === -1) continue;
        const filePart = qnStr.slice(0, colonIdx);

        // Match the symbol's file against the known set.
        if (
          pathTails.size > 0 &&
          !([...pathTails].some(
            (p) => p === filePart || p.endsWith(filePart) || filePart.endsWith(p),
          ))
        ) {
          continue;
        }

        // Resolve file_path back to the absolute form if possible.
        const absMatch = paths.find((p) => p.endsWith(filePart)) ?? filePart;

        out.push({
          file_path: absMatch,
          qualified_name: qnStr,
          symbol_type: _symbolTypeFromLabel(label),
          signature: null,
          language: null,
          line: null,
        });
      }
    }

    return out;
  }

  private async _loadEdgesAsync(
    graphPath: string,
    paths: string[],
  ): Promise<Record<string, unknown>[]> {
    /**
     * Pull CALLS / IMPORTS / MEMBER_OF / USES edges from the AP graph.
     *
     * AP uses per-label-pair typed rel tables (LadybugDB convention):
     *   Calls_<Src>_<Dst>     for Function/Method call edges
     *   Imports_File_<Lbl>    for File → imported symbol
     *   HasMethod_<Parent>_Method for struct/enum/trait → method
     *   Defines_File_Import   for File → Import statement nodes
     *   Uses_<Src>_<Dst>      for Method/Function type-usage edges
     *
     * We enumerate the full Cartesian product of label kinds so no rel
     * table is silently dropped. AP returns empty rows for non-existent
     * tables, so over-enumeration is safe.
     *
     * precondition:  graphPath is a valid AP graph path
     * postcondition: each row has {kind, src_file, src_name, dst_file, dst_name, confidence, reason}
     *
     * source: cortex@f2b9f99 workflow_graph_source_ast.py:516-705
     */
    const out: Record<string, unknown>[] = [];

    // Same path-matching strategy as _loadSymbolsAsync.
    const pathTails = new Set<string>();
    for (const p of paths) {
      if (!p) continue;
      pathTails.add(p);
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) {
        pathTails.add(parts.slice(i).join("/"));
      }
    }

    function matchFile(filePart: string): boolean {
      if (pathTails.size === 0) return true;
      return [...pathTails].some(
        (p) => p === filePart || p.endsWith(filePart) || filePart.endsWith(p),
      );
    }

    // Enumerate the full Cartesian product of label kinds AP could have
    // produced rel tables for. The narrower prior lists were the reason the
    // cortex viz showed ~4k imports instead of tens of thousands.
    // source: cortex@f2b9f99 workflow_graph_source_ast.py:543-565
    const _CALL_LABELS = ["Function", "Method", "Macro"] as const;
    const _IMPORT_TARGETS = _SYMBOL_LABELS; // File can import any symbol kind
    const _CONTAINER_LBLS = [
      "Struct", "Enum", "Trait", "Class", "Interface",
      "Protocol", "Extension", "Union",
    ] as const;
    const _MEMBER_LBLS = ["Method", "Field", "Property", "Constant", "TypeAlias"] as const;

    const callsRels: [string, string][] = _CALL_LABELS.flatMap((s) =>
      _CALL_LABELS.map((d) => [s, d] as [string, string]),
    );
    const importsRels: [string, string][] = (_IMPORT_TARGETS as readonly string[]).map(
      (t) => ["File", t] as [string, string],
    );
    const memberRels: [string, string][] = _CONTAINER_LBLS.flatMap((s) =>
      _MEMBER_LBLS.map((d) => [s, d] as [string, string]),
    );

    const runEdge = async (
      kind: string,
      table: string,
      srcLbl: string,
      dstLbl: string,
      hasProvenance: boolean,
    ): Promise<void> => {
      /**
       * Query AP for edges of `kind` in `table`.
       *
       * hasProvenance gates whether to fetch r.confidence + r.resolution_method:
       * Kuzu raises a Binder exception on missing-property access, so we only
       * request those columns for rel tables the AP resolver actually annotates
       * (Calls_* / Imports_* / Implements_* / Extends_* / Uses_*). Structural
       * tables (HasMethod_* / Defines_*) have no such columns.
       *
       * source: cortex@f2b9f99 workflow_graph_source_ast.py:575-666
       */
      // Import nodes (and _NON_QUALIFIED_LABELS) carry id instead of
      // qualified_name. source: cortex@f2b9f99 py:591-613
      let selectSrc: string;
      if (srcLbl === "File") {
        selectSrc = "src.id AS src_name";
      } else if (_NON_QUALIFIED_LABELS.has(srcLbl)) {
        selectSrc = "src.id AS src_name";
      } else {
        selectSrc = "src.qualified_name AS src_name";
      }

      const dstQn = _NON_QUALIFIED_LABELS.has(dstLbl)
        ? "dst.id AS dst_name"
        : "dst.qualified_name AS dst_name";

      const returnTail = hasProvenance
        ? `       ${dstQn}, ` +
          "       r.confidence       AS confidence, " +
          "       r.resolution_method AS reason"
        : `       ${dstQn}`;

      const query =
        `MATCH (src:${srcLbl})-[r:${table}]->(dst:${dstLbl}) ` +
        `RETURN ${selectSrc}, ${returnTail}`;

      let rows: unknown;
      try {
        rows = await callUpstream(_AP_SERVER, "query_graph", {
          graph_path: graphPath,
          query,
        });
      } catch (e) {
        if (e instanceof McpConnectionError) return;
        throw e;
      }

      for (const r of _asList(rows)) {
        const src = String(r["src_name"] ?? "");
        const dst = String(r["dst_name"] ?? "");
        if (!dst) continue;

        let srcFile: string;
        let srcQn: string;
        if (srcLbl === "File") {
          srcFile = src;
          srcQn = "";
        } else {
          const colonIdx = src.indexOf("::");
          srcFile = colonIdx >= 0 ? src.slice(0, colonIdx) : src;
          srcQn = src;
        }
        const dstColonIdx = dst.indexOf("::");
        const dstFile = dstColonIdx >= 0 ? dst.slice(0, dstColonIdx) : dst;

        if (kind === "imports") {
          if (!matchFile(srcFile)) continue;
        } else {
          if (!matchFile(srcFile) || !matchFile(dstFile)) continue;
        }

        // AP stores resolution_method wrapped in literal single quotes
        // (see automatised-pipeline resolver.rs:183). Strip them at the
        // infrastructure boundary. Remove this strip once AP fixes the
        // upstream quoting.
        // source: cortex@f2b9f99 workflow_graph_source_ast.py:644-655
        const confRaw = hasProvenance ? r["confidence"] : null;
        let confidence: number | null = null;
        if (confRaw !== null && confRaw !== undefined) {
          const n = Number(confRaw);
          if (Number.isFinite(n)) confidence = n;
        }
        const reasonRaw = hasProvenance ? r["reason"] : null;
        const reason =
          reasonRaw !== null && reasonRaw !== undefined
            ? String(reasonRaw).replace(/^['"]|['"]$/g, "") || null
            : null;

        out.push({ kind, src_file: srcFile, src_name: srcQn, dst_file: dstFile, dst_name: dst, confidence, reason });
      }
    };

    // source: cortex@f2b9f99 workflow_graph_source_ast.py:668-676
    for (const [s, d] of callsRels) {
      await runEdge("calls", `Calls_${s}_${d}`, s, d, true);
    }
    for (const [s, d] of importsRels) {
      await runEdge("imports", `Imports_${s}_${d}`, s, d, true);
    }
    for (const [s, d] of memberRels) {
      await runEdge("member_of", `HasMethod_${s}_${d}`, s, d, false);
    }

    // File → Import node. AP wires every `import` statement to its
    // file via this rel table; counts in the tens of thousands per
    // project. Without this, the cortex viz captures only the small
    // subset that AP managed to RESOLVE to in-graph symbols.
    // source: cortex@f2b9f99 workflow_graph_source_ast.py:677-687
    await runEdge("imports", "Defines_File_Import", "File", "Import", false);

    // Type-usage edges (Method/Function uses Struct/Class/etc).
    // Captured by AP's resolver and exposed as Uses_<src>_<dst>.
    // source: cortex@f2b9f99 workflow_graph_source_ast.py:689-704
    const _USES_SRC = ["Method", "Function"] as const;
    const _USES_DST = [
      "Struct", "Enum", "Trait", "Class", "Interface",
      "Protocol", "Extension", "Union", "TypeAlias",
    ] as const;
    for (const s of _USES_SRC) {
      for (const d of _USES_DST) {
        await runEdge("uses", `Uses_${s}_${d}`, s, d, true);
      }
    }

    return out;
  }

  private async _verifySymbolsAsync(
    graphPath: string,
    qualnames: string[],
  ): Promise<Record<string, boolean>> {
    /**
     * Batch verification across every AP symbol label.
     *
     * AP has no unified Symbol label — we iterate the known set.
     * A qualname counts as found if any AP symbol name equals it, its name
     * equals the tail, or the qualified_name ends with ::tail or .tail.
     *
     * precondition:  qualnames is non-empty; graphPath exists
     * postcondition: every key in input appears in output
     *
     * source: cortex@f2b9f99 workflow_graph_source_ast.py:471-513
     */
    const out: Record<string, boolean> = Object.fromEntries(
      qualnames.map((q) => [q, false]),
    );
    const allNames: string[] = [];
    const allShort: string[] = [];

    for (const label of _SYMBOL_LABELS) {
      const query =
        `MATCH (s:${label}) ` +
        "RETURN DISTINCT s.qualified_name AS qualified_name, " +
        "                s.name           AS name";
      let rows: unknown;
      try {
        rows = await callUpstream(_AP_SERVER, "query_graph", {
          graph_path: graphPath,
          query,
        });
      } catch {
        continue;
      }
      for (const r of _asList(rows)) {
        const qn = String(r["qualified_name"] ?? "");
        const nm = String(r["name"] ?? "");
        if (qn) allNames.push(qn);
        if (nm) allShort.push(nm);
      }
    }

    for (const q of qualnames) {
      // split().pop() on a non-empty string always returns a string; the
      // split produces at least one element, and q is guaranteed non-empty by
      // the filter at entry. The ! is provably safe here.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const tail = q.includes(".") ? q.split(".").pop()! : q.split("::").pop()!;
      if (allShort.includes(tail)) {
        out[q] = true;
        continue;
      }
      for (const qn of allNames) {
        if (qn === q || qn.endsWith(`::${tail}`) || qn.endsWith(`.${tail}`)) {
          out[q] = true;
          break;
        }
      }
    }

    return out;
  }
}
