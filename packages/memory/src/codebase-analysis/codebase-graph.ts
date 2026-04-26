/**
 * Codebase graph analysis — import resolution, call graph, communities.
 *
 * Ported from mcp_server/core/codebase_graph.py
 *
 * Takes parsed FileAnalysis objects and produces resolved edges:
 * - File → file import edges (resolved from module names)
 * - Function → function call edges
 * - Class → method containment edges
 * - Class → parent inheritance edges
 * - Community assignments via Louvain
 *
 * Pure business logic — no I/O.
 */

import { posix } from "node:path";
import type {
  CallEdge,
  FileAnalysis,
  FileEdge,
  InheritanceEdge,
  ResolvedCallEdge,
} from "./types.js";

// ── Import resolution ─────────────────────────────────────────────────────

export function resolveImportToFile(
  module: string,
  importingFile: string,
  knownFiles: Set<string>,
  isRelative = false,
): string | null {
  /**
   * Resolve a module name to a known file path.
   *
   * Args:
   *   module: Import module name (e.g., "auth.tokens").
   *   importingFile: Path of the file doing the import.
   *   knownFiles: Set of all known file paths in the project.
   *   isRelative: Whether this is a relative import.
   *
   * Returns:
   *   Resolved file path or null if not found.
   */
  const candidates = _buildCandidates(module, importingFile, isRelative);
  for (const candidate of candidates) {
    const normalized = posix.normalize(candidate);
    if (knownFiles.has(normalized)) return normalized;
  }
  return null;
}

function _buildCandidates(
  module: string,
  importingFile: string,
  isRelative: boolean,
): string[] {
  const candidates: string[] = [];

  if (isRelative) {
    const baseDir = posix.dirname(importingFile);
    const clean = module.replace(/^\.+/, "");
    if (clean) {
      const rel = clean.replace(/\./g, "/");
      candidates.push(`${baseDir}/${rel}.py`);
      candidates.push(`${baseDir}/${rel}/__init__.py`);
    }
  } else {
    // Try full path and progressively strip leading segments
    // e.g. ai_architect_mcp._adapters.ports -> _adapters/ports.py
    const asPath = module.replace(/\./g, "/");
    _addPathVariants(candidates, asPath);
    const parts = asPath.split("/");
    for (let i = 1; i < parts.length; i++) {
      _addPathVariants(candidates, parts.slice(i).join("/"));
    }
  }

  return candidates;
}

function _addPathVariants(candidates: string[], base: string): void {
  candidates.push(`${base}.py`);
  candidates.push(`${base}/__init__.py`);
  candidates.push(`${base}.ts`);
  candidates.push(`${base}.tsx`);
  candidates.push(`${base}.js`);
}

export function resolveAllImports(analyses: FileAnalysis[]): FileEdge[] {
  /**
   * Resolve imports across all files to file→file edges.
   *
   * Returns:
   *   List of [sourceFile, targetFile] tuples.
   */
  const knownFiles = new Set(analyses.map((a) => a.path));
  const edges: FileEdge[] = [];

  for (const analysis of analyses) {
    for (const imp of analysis.imports) {
      const target = resolveImportToFile(
        imp.module,
        analysis.path,
        knownFiles,
        imp.isRelative,
      );
      if (target && target !== analysis.path) {
        edges.push([analysis.path, target]);
      }
    }
  }

  return edges;
}

// ── Inheritance extraction ────────────────────────────────────────────────

export function extractInheritance(analyses: FileAnalysis[]): InheritanceEdge[] {
  /**
   * Extract class inheritance edges from definition signatures.
   *
   * Returns:
   *   List of [childClass, parentClass] tuples.
   */
  const edges: InheritanceEdge[] = [];
  for (const analysis of analyses) {
    for (const sym of analysis.definitions) {
      if (sym.kind === "class" && sym.signature) {
        const parents = _parseParentClasses(sym.signature);
        for (const parent of parents) {
          edges.push([sym.name, parent]);
        }
      }
    }
  }
  return edges;
}

function _parseParentClasses(signature: string): string[] {
  const clean = signature.replace(/^\(|\)$/g, "");
  if (!clean) return [];
  const parents: string[] = [];
  for (const part of clean.split(",")) {
    const name = part.trim().split("[")[0]!.trim();
    if (name && !["object", "ABC", "Protocol"].includes(name)) {
      parents.push(name);
    }
  }
  return parents;
}

// ── Call graph ────────────────────────────────────────────────────────────

export function buildCallEdges(
  analyses: FileAnalysis[],
  callSites: Map<string, string[]>,
): CallEdge[] {
  /**
   * Build function→function call edges.
   *
   * Args:
   *   analyses: All parsed file analyses.
   *   callSites: Map of file_path → list of called function names.
   *
   * Returns:
   *   List of [callerFile, calledSymbol, definingFile] tuples.
   */
  // Build symbol→file lookup
  const symbolToFile = new Map<string, string>();
  for (const analysis of analyses) {
    for (const sym of analysis.definitions) {
      const baseName = sym.name.split(".").at(-1)!;
      if (!symbolToFile.has(baseName)) {
        symbolToFile.set(baseName, analysis.path);
      }
    }
  }

  const edges: CallEdge[] = [];
  for (const [filePath, calls] of callSites) {
    for (const callName of calls) {
      const base = callName.split(".").at(-1)!.split("(")[0]!;
      const targetFile = symbolToFile.get(base);
      if (targetFile && targetFile !== filePath) {
        edges.push([filePath, base, targetFile]);
      }
    }
  }
  return edges;
}

export function buildResolvedCallEdges(analyses: FileAnalysis[]): ResolvedCallEdge[] {
  /**
   * Caller-qualified CALLS edges resolved against the known-files set.
   *
   * Uses FileAnalysis.callsPerFunction (populated by the tree-sitter
   * path in ast-parser.parseFileAst) to emit edges where the SOURCE
   * is a specific function/method — not just the file.
   * That is what lets the workflow graph render the full dependency
   * chain between methods as part of a file.
   *
   * Returns:
   *   [[callerFile, callerQname, calleeFile, calleeQname], ...].
   *   The fourth position is the FULL qualified name of the resolved
   *   callee (e.g. `Foo.baz`), NOT the basename. This matches the
   *   shape ingest_symbol uses to mint SYMBOL node ids and the shape
   *   AP emits for its CALLS edges; if we returned a basename instead,
   *   ingest_ast_edge would hash a different symbol_id for `dst` than
   *   the one stored for the target SYMBOL, and the edge would be
   *   dropped silently. See Wu error archaeology 2026-04-24 and the
   *   boundary-crossing regression test in tests_py/infrastructure.
   */
  // Build basename → (first-defining-file, full-qname) lookup. We key
  // by basename because the tree-sitter call sites produce "baz", not
  // "Foo.baz" — we resolve the basename to the known symbol, then
  // emit the symbol's full qname so the edge endpoints carry the
  // same string the ingester hashed at ingest_symbol time.
  //
  // First-wins collision semantics on basename match buildCallEdges
  // (documented / intentional).
  const symbolToQname = new Map<string, [string, string]>();
  for (const analysis of analyses) {
    for (const sym of analysis.definitions) {
      const base = sym.name.split(".").at(-1)!;
      if (!symbolToQname.has(base)) {
        symbolToQname.set(base, [analysis.path, sym.name]);
      }
    }
  }

  const edges: ResolvedCallEdge[] = [];
  for (const analysis of analyses) {
    const perFn = analysis.callsPerFunction ?? {};
    for (const [callerQname, callees] of Object.entries(perFn)) {
      const seenPair = new Set<string>();
      for (const callName of callees) {
        let base = callName.split(".").at(-1) ?? "";
        for (const c of ["(", "[", "<"]) {
          const idx = base.indexOf(c);
          if (idx >= 0) base = base.slice(0, idx);
        }
        base = base.trim();
        if (!base) continue;
        const hit = symbolToQname.get(base);
        if (!hit) continue;
        const [targetFile, targetQname] = hit;
        const key = `${targetFile}::${targetQname}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        edges.push([analysis.path, callerQname, targetFile, targetQname]);
      }
    }
  }
  return edges;
}

// ── Community detection ───────────────────────────────────────────────────

export function detectCommunities(
  fileEdges: FileEdge[],
  callEdges: CallEdge[],
): Map<string, number> {
  /**
   * Detect functional communities using Louvain on import+call graph.
   *
   * Returns:
   *   Map of filePath → communityId.
   *
   * NOTE: The Python implementation uses networkx's Louvain. The TS port
   * implements a simple greedy label-propagation fallback since networkx
   * is not available in Node.js. For parity testing, inject a Louvain
   * implementation via the optional parameter.
   */
  const adj = _buildAdjacency(fileEdges, callEdges);
  const nodes = new Set<string>();
  for (const [a, b] of adj) {
    nodes.add(a);
    nodes.add(b);
  }
  if (nodes.size < 2) {
    const result = new Map<string, number>();
    for (const n of nodes) result.set(n, 0);
    return result;
  }

  return _labelPropagation(adj, nodes);
}

function _buildAdjacency(
  fileEdges: FileEdge[],
  callEdges: CallEdge[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();

  function addEdge(a: string, b: string): void {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }

  for (const [src, tgt] of fileEdges) addEdge(src, tgt);
  for (const [src, , tgt] of callEdges) addEdge(src, tgt);
  return adj;
}

function _labelPropagation(
  adj: Map<string, Set<string>>,
  nodes: Set<string>,
): Map<string, number> {
  /**
   * Simple label-propagation community detection.
   *
   * Not Louvain, but O(n) and deterministic (sorted node order).
   * Produces connected-component clusters as a baseline.
   */
  const label = new Map<string, number>();
  let nextLabel = 0;
  const sorted = [...nodes].sort();

  for (const node of sorted) {
    if (label.has(node)) continue;
    // BFS flood-fill connected component
    const queue = [node];
    const lbl = nextLabel++;
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (label.has(cur)) continue;
      label.set(cur, lbl);
      for (const neighbor of adj.get(cur) ?? []) {
        if (!label.has(neighbor)) queue.push(neighbor);
      }
    }
  }
  return label;
}

// ── Impact analysis ───────────────────────────────────────────────────────

export function computeImpact(
  targetFile: string,
  fileEdges: FileEdge[],
  callEdges: CallEdge[],
  maxDepth = 3,
): { upstream: string[]; downstream: string[] } {
  /**
   * Compute blast radius: what depends on targetFile.
   *
   * Args:
   *   targetFile: The file being changed.
   *   fileEdges: [source, target] import edges.
   *   callEdges: [caller, symbol, target] call edges.
   *   maxDepth: Maximum traversal depth.
   *
   * Returns:
   *   Object with "upstream" and "downstream" file lists.
   */
  // Build adjacency lists
  const dependents = new Map<string, Set<string>>(); // target → who imports it
  const dependencies = new Map<string, Set<string>>(); // source → what it imports

  function add(map: Map<string, Set<string>>, k: string, v: string): void {
    if (!map.has(k)) map.set(k, new Set());
    map.get(k)!.add(v);
  }

  for (const [src, tgt] of fileEdges) {
    add(dependents, tgt, src);
    add(dependencies, src, tgt);
  }
  for (const [src, , tgt] of callEdges) {
    add(dependents, tgt, src);
    add(dependencies, src, tgt);
  }

  const upstream = _bfs(targetFile, dependents, maxDepth);
  const downstream = _bfs(targetFile, dependencies, maxDepth);

  return {
    upstream: [...upstream].filter((f) => f !== targetFile).sort(),
    downstream: [...downstream].filter((f) => f !== targetFile).sort(),
  };
}

function _bfs(
  start: string,
  adj: Map<string, Set<string>>,
  maxDepth: number,
): Set<string> {
  const visited = new Set<string>([start]);
  let frontier = [start];
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adj.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return visited;
}
