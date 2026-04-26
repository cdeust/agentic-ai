/**
 * Handler: ingest-codebase — pull codebase analysis from the upstream
 * ai-automatised-pipeline MCP server into Cortex's store.
 *
 * Ported from mcp_server/handlers/ingest_codebase.py
 *
 * Flow
 * ----
 * 1. Resolve the project's graph path (cache hit or upstream analyze).
 * 2. Pull the FULL chain hierarchy from the Kuzu graph via Cypher:
 *    every Function/Method/Struct, every File, every call edge between
 *    symbols, every File→symbol containment edge.
 * 3. Project upstream artefacts into Cortex's stores: memories + KG
 *    entities + KG edges + wiki reference pages per process.
 * 4. Return an ingestion summary.
 *
 * Cortex is the CONSUMER — upstream owns analysis, Cortex owns
 * documentation and knowledge-graph state.
 *
 * This file is the composition root. Implementation is split:
 *   - ingest-codebase-schema.ts    — MCP tool schema
 *   - ingest-codebase-graph.ts     — graph-path resolution + analyze
 *   - ingest-codebase-cypher.ts    — Kuzu fetchers
 *   - ingest-codebase-writers.ts   — MemoryStore writers
 *   - ingest-codebase-pages.ts     — process wiki rendering
 */

import { homedir } from "node:os";
import { join } from "node:path";
import * as cypher from "./ingest-codebase-cypher.js";
import * as graphmod from "./ingest-codebase-graph.js";
import * as pages from "./ingest-codebase-pages.js";
import { schema } from "./ingest-codebase-schema.js";
import * as writers from "./ingest-codebase-writers.js";
import {
  callUpstream,
  McpConnectionError,
  normaliseMcpPayload,
  projectKey,
} from "./ingest-helpers.js";

export { schema };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoryStore = any;

const _UPSTREAM_SERVER = "codebase";

const _DEFAULT_TOP_SYMBOLS: number | null = null;
const _DEFAULT_TOP_PROCESSES: number | null = null;

// ── Store singleton (port-pending: replace with DI when shared lands) ─────

let _store: MemoryStore | null = null;
let _wikiRoot = "";

export function initStore(store: MemoryStore, wikiRoot: string): void {
  _store = store;
  _wikiRoot = wikiRoot;
}

function _getStore(): MemoryStore {
  if (!_store) {
    throw new Error(
      "MemoryStore not initialised. Call ingest-codebase.initStore() first. " +
        "port-pending: DI wiring from port/cortex-shared",
    );
  }
  return _store;
}

function _defaultOutputDir(projectPath: string): string {
  return join(
    homedir(),
    ".cache",
    "cortex",
    "code-graphs",
    projectKey(projectPath),
  );
}

function _parseIntOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ── File attribution ──────────────────────────────────────────────────────

function _attributeFilesToSymbols(
  symbols: (cypher.SymbolRow & Record<string, unknown>)[],
  fileEdges: [string, string][],
  knownFiles: Set<string>,
): string[] {
  /**
   * Assign `sym.file` from the authoritative File→symbol containment edges.
   * Returns diagnostic strings for symbols that fell through to the qn-split
   * fallback (so non-Python indexers that don't emit containment edges are
   * visible to the user).
   */
  const qnToFile = new Map(fileEdges.map(([f, qn]) => [qn, f]));
  let fallbackUsed = 0;
  let fallbackUnverified = 0;

  for (const sym of symbols) {
    const qn = sym.qualified_name;
    if (!qn) continue;
    const authoritative = qnToFile.get(qn);
    if (authoritative !== undefined) {
      sym.file = authoritative;
      continue;
    }
    // No containment edge — try the qn-split fallback
    const candidate = cypher.filePathFromQn(qn);
    if (candidate && knownFiles.has(candidate)) {
      sym.file = candidate;
      fallbackUsed++;
    } else {
      sym.file = null;
      if (candidate) fallbackUnverified++;
    }
  }

  const diagnostics: string[] = [];
  if (fallbackUsed > 0) {
    diagnostics.push(
      `file-attribution: ${fallbackUsed} symbols had no ` +
        `(:File)-[]->(:symbol) edge; used qn-split fallback ` +
        `(verified against known files)`,
    );
  }
  if (fallbackUnverified > 0) {
    diagnostics.push(
      `file-attribution: ${fallbackUnverified} symbols had no ` +
        `containment edge AND the qn-split fallback didn't match a ` +
        `known file (likely non-Python indexer); file=null`,
    );
  }
  return diagnostics;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────

async function _pullSymbolsAndFiles(
  graphPath: string,
  topSymbols: number | null,
): Promise<{
  symbols: (cypher.SymbolRow & Record<string, unknown>)[];
  files: cypher.FileRow[];
  callEdges: [string, string][];
  fileEdges: [string, string][];
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];
  const [symbols, symDiag] = await cypher.fetchTopSymbols(graphPath, topSymbols);
  diagnostics.push(...symDiag);
  const [files, fileDiag] = await cypher.fetchFiles(graphPath, topSymbols);
  diagnostics.push(...fileDiag);

  let callEdges: [string, string][] = [];
  let fileEdges: [string, string][] = [];

  if (symbols.length > 0) {
    const knownSymbols = new Set(
      symbols.map((s) => s.qualified_name).filter(Boolean),
    );
    const [ce, ceDiag] = await cypher.fetchCallEdges(graphPath, knownSymbols);
    callEdges = ce;
    diagnostics.push(...ceDiag);

    const knownFiles = new Set(files.map((f) => f.path).filter(Boolean));
    if (knownFiles.size > 0) {
      const [fe, feDiag] = await cypher.fetchFileContainment(
        graphPath,
        knownFiles,
        knownSymbols,
      );
      fileEdges = fe;
      diagnostics.push(...feDiag);
    }
    diagnostics.push(
      ..._attributeFilesToSymbols(
        symbols as (cypher.SymbolRow & Record<string, unknown>)[],
        fileEdges,
        knownFiles,
      ),
    );
  }

  return { symbols: symbols as (cypher.SymbolRow & Record<string, unknown>)[], files, callEdges, fileEdges, diagnostics };
}

async function _pullProcesses(
  graphPath: string,
  topProcesses: number | null,
): Promise<Record<string, unknown>[]> {
  try {
    const procPayload = await callUpstream(_UPSTREAM_SERVER, "get_processes", {
      graph_path: graphPath,
    });
    const procResult = normaliseMcpPayload(procPayload) as Record<string, unknown>;
    const allProcs = (procResult["processes"] as Record<string, unknown>[]) ?? [];
    return topProcesses === null ? allProcs : allProcs.slice(0, topProcesses);
  } catch {
    return [];
  }
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handler(
  args: Record<string, unknown> | null = null,
): Promise<Record<string, unknown>> {
  /**
   * Ingest a codebase analysis into Cortex's store.
   */
  const a = args ?? {};
  const projectPath = ((a["project_path"] as string) ?? "").trim();
  if (!projectPath) return { ingested: false, reason: "project_path is required" };

  const outputDir = (a["output_dir"] as string) ?? _defaultOutputDir(projectPath);
  const language = (a["language"] as string) ?? "auto";
  const forceReindex = Boolean(a["force_reindex"] ?? false);
  const topSymbols = _parseIntOrNull(a["top_symbols"] ?? _DEFAULT_TOP_SYMBOLS);
  const topProcesses = _parseIntOrNull(a["top_processes"] ?? _DEFAULT_TOP_PROCESSES);

  const store = _getStore();

  let graphPath: string;
  let analyzeStats: Record<string, unknown>;
  try {
    [graphPath, analyzeStats] = await graphmod.ensureGraph(
      store,
      projectPath,
      outputDir,
      language,
      forceReindex,
    );
  } catch (e) {
    if (e instanceof McpConnectionError) {
      return { ingested: false, reason: "upstream_mcp_unreachable", error: String(e) };
    }
    return {
      ingested: false,
      reason: "analyze_failed",
      error: `${(e as Error).constructor.name}: ${(e as Error).message}`,
    };
  }

  let symbols: (cypher.SymbolRow & Record<string, unknown>)[] = [];
  let files: cypher.FileRow[] = [];
  let callEdges: [string, string][] = [];
  let fileEdges: [string, string][] = [];
  let diagnostics: string[] = [];

  if (topSymbols === null || topSymbols > 0) {
    ({ symbols, files, callEdges, fileEdges, diagnostics } = await _pullSymbolsAndFiles(
      graphPath,
      topSymbols,
    ));
  }

  const processes =
    topProcesses === null || topProcesses > 0
      ? await _pullProcesses(graphPath, topProcesses)
      : [];

  const symMem = writers.writeSymbolMemories(store, symbols, projectPath, `code:${projectPath.split("/").pop()}`);
  const domain = `code:${projectPath.split("/").pop() ?? "unknown"}`;
  const fileMem = writers.writeFileMemories(store, files, projectPath, domain);
  const [symEnt, entDiag] = writers.writeSymbolEntities(store, symbols, domain);
  diagnostics.push(...entDiag);
  const fileEnt = writers.writeFileEntities(store, files, domain);
  const callCount = writers.writeSymbolRelationships(store, callEdges, symEnt);
  const containCount = writers.writeFileRelationships(store, fileEdges, fileEnt, symEnt);
  const wikiPaths = pages.writeProcessPages(processes, _wikiRoot);

  const response: Record<string, unknown> = {
    ingested: true,
    graph_path: graphPath,
    analyze: analyzeStats,
    memories_written: symMem.length + fileMem.length,
    entities_written: symEnt.size + fileEnt.size,
    edges_written: callCount + containCount,
    wiki_pages_written: wikiPaths,
    symbol_count_seen: symbols.length,
    file_count_seen: files.length,
    process_count_seen: processes.length,
  };
  if (diagnostics.length > 0) response["diagnostics"] = diagnostics;
  return response;
}
