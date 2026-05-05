/**
 * Native AST source for the workflow graph — Cortex's in-house tree-sitter
 * pipeline, used when automatised-pipeline (AP) is disabled or has not yet
 * indexed a project.
 *
 * Mirrors the public API of ``workflow_graph_source_ast`` (AP bridge) so the
 * handler treats them uniformly. Emits the same dict shapes the builder
 * already expects (see ingest_symbol / ingest_ast_edge in
 * core/workflow_graph_builder_relational.py).
 *
 * Output shapes:
 *
 *     symbols → [{
 *         file_path, qualified_name, symbol_type, signature, language, line,
 *     }]
 *
 *     edges → [{
 *         kind: "calls" | "imports" | "member_of",
 *         src_file, src_name,          # src_name empty for file-level IMPORTS
 *         dst_file, dst_name,
 *         confidence: 1.0,             # AST facts — Gap 6 provenance default
 *         reason: "native-ast",
 *     }]
 *
 * Why this module exists (user-visible motivation): v3.14's L6 symbol ring
 * is wired end-to-end but only populated when AP is present. On a fresh
 * project with AP disabled, the graph renders Claude's file entry-points
 * faithfully but has no INTERNAL depth — no functions, classes, methods
 * are visible. This source closes that gap using only the codebase-analysis
 * module that Cortex TS already ships.
 *
 * Source: docs/program/v3.14-gap-analysis-v2-corrected.md §5 move 1 +
 * docs/program/gitnexus-competitive-analysis.md M4; ADR-0046 Phase 1 (the
 * "6th ring" of symbols inside files) now works without AP.
 *
 * source: Cortex mcp_server/infrastructure/workflow_graph_source_native_ast.py
 */

import { existsSync, statSync, readFileSync } from "node:fs";
import * as nodePath from "node:path";
import {
  isAvailable as astAvailableFn,
  parseFileAst,
} from "../../codebase-analysis/ast-parser.js";
import {
  buildResolvedCallEdges,
  resolveAllImports,
} from "../../codebase-analysis/codebase-graph.js";
import {
  detectLanguage,
  parseFile,
} from "../../codebase-analysis/codebase-parser.js";
import type { FileAnalysis } from "../../codebase-analysis/types.js";

// Per-file parse cap — same limit AP uses (1 MB) for bounded parse work.
// source: workflow_graph_source_native_ast.py:53
const _MAX_PARSE_BYTES = 1_048_576;

// How many files to parse per call. A typical session touches fewer than
// this many files; the cap protects against runaway when the caller
// passes an unbounded list.
// source: workflow_graph_source_native_ast.py:58
const _MAX_FILES_PER_CALL = 2_000;

export interface SymbolRow {
  file_path: string;
  qualified_name: string;
  symbol_type: string;
  signature: string;
  language: string;
  line: number | null;
  domain: string;
}

export interface AstEdgeRow {
  kind: "calls" | "imports" | "member_of";
  src_file: string;
  src_name: string;
  dst_file: string;
  dst_name: string;
  confidence: number;
  reason: string;
}

/**
 * In-process AST source — tree-sitter when installed, regex fallback
 * otherwise. Enabled whenever the caller provides at least one readable
 * file path with a detectable language.
 *
 * source: workflow_graph_source_native_ast.py:61-65
 */
export class WorkflowGraphNativeASTSource {
  /**
   * Always enabled — regex fallback handles the languages where
   * tree-sitter isn't installed. The loaders simply return [] when
   * no file paths are provided.
   * source: workflow_graph_source_native_ast.py:67-71
   */
  enabled(): boolean {
    return true;
  }

  /**
   * Tree-sitter proper is installed (deeper extraction).
   * source: workflow_graph_source_native_ast.py:73-75
   */
  astAvailable(): boolean {
    return astAvailableFn();
  }

  /**
   * Return one symbol row per function/class/method definition
   * found in each readable file. Skips unreadable files silently.
   *
   * source: workflow_graph_source_native_ast.py:77-96
   */
  loadSymbols(filePaths: Iterable<string>): SymbolRow[] {
    const analyses = this._parseAll(filePaths);
    const symbols: SymbolRow[] = [];
    for (const a of analyses) {
      for (const sym of a.definitions) {
        symbols.push({
          file_path: a.path,
          qualified_name: sym.name,
          symbol_type: sym.kind,
          signature: sym.signature,
          language: a.language,
          line: null, // regex/AST extractors don't carry line numbers (yet)
          domain: "",
        });
      }
    }
    return symbols;
  }

  /**
   * Return CALLS, IMPORTS, and MEMBER_OF edges for the given files.
   *
   * CALLS are now caller-qualified: src_name is the enclosing
   * function/method qualified name (e.g. Foo.bar), not just the
   * file. This is what renders the full dependency chain between
   * methods as part of a file in the L6 ring.
   *
   * Unresolved callees (stdlib, external deps, dynamic lookups)
   * are dropped silently — the resolver only emits edges where the
   * target basename corresponds to a known SYMBOL.
   *
   * source: workflow_graph_source_native_ast.py:98-117
   */
  loadAstEdges(filePaths: Iterable<string>): AstEdgeRow[] {
    const analyses = this._parseAll(filePaths);
    if (analyses.length === 0) return [];
    const edges: AstEdgeRow[] = [];
    edges.push(...this._memberOfEdges(analyses));
    edges.push(...this._importEdges(analyses));
    edges.push(...this._callEdges(analyses));
    return edges;
  }

  // ── private ────────────────────────────────────────────────────────

  /**
   * Caller-qualified CALLS edges via codebase-graph.buildResolvedCallEdges.
   *
   * Both src_name and dst_name are the FULL qualified names
   * ("Foo.bar" / "Foo.baz"), matching the shape ingest_symbol uses
   * to mint SYMBOL ids. A basename shape ("baz") would hash a different
   * symbol_id and the edge would be silently dropped by ingest_ast_edge
   * — which is exactly what happened before the Wu audit caught it.
   *
   * source: workflow_graph_source_native_ast.py:119-148
   */
  private _callEdges(analyses: FileAnalysis[]): AstEdgeRow[] {
    const out: AstEdgeRow[] = [];
    for (const [
      callerFile,
      callerQname,
      calleeFile,
      calleeQname,
    ] of buildResolvedCallEdges(analyses)) {
      out.push({
        kind: "calls",
        src_file: callerFile,
        src_name: callerQname,
        dst_file: calleeFile,
        dst_name: calleeQname,
        confidence: 1.0,
        reason: "native-ast:call",
      });
    }
    return out;
  }

  /**
   * Read + parse each file; skip unreadable / too-large / non-source.
   * source: workflow_graph_source_native_ast.py:152-176
   */
  private _parseAll(filePaths: Iterable<string>): FileAnalysis[] {
    const analyses: FileAnalysis[] = [];
    let n = 0;
    for (const rawPath of filePaths) {
      n += 1;
      if (n > _MAX_FILES_PER_CALL) break;
      if (!rawPath) continue;
      // Skip files with no language we can parse — saves the
      // stat + open call on every .md / .txt Claude touched.
      const lang = detectLanguage(rawPath);
      if (!lang || lang === "unknown") continue;
      try {
        if (!existsSync(rawPath)) continue;
        const st = statSync(rawPath);
        if (!st.isFile()) continue;
        if (st.size > _MAX_PARSE_BYTES) continue;
        const content = readFileSync(rawPath);
        analyses.push(this._parseOne(rawPath, content));
      } catch {
        continue;
      }
    }
    return analyses;
  }

  /**
   * Prefer tree-sitter; fall back to regex. parseFileAst
   * already does the fallback internally when AST_SUPPORTED doesn't
   * cover the language or tree-sitter isn't installed.
   *
   * source: workflow_graph_source_native_ast.py:178-195
   */
  private _parseOne(path: string, content: Buffer): FileAnalysis {
    try {
      return parseFileAst(path, content);
    } catch {
      try {
        return parseFile(path, content.toString("utf8"));
      } catch {
        // Empty analysis — caller treats missing data as normal.
        return {
          path,
          language: detectLanguage(path) || "unknown",
          contentHash: "",
          imports: [],
          definitions: [],
          docstring: "",
          lineCount: 0,
          callsPerFunction: {},
        };
      }
    }
  }

  /**
   * method → class MEMBER_OF. The parser emits method names as
   * ClassName.method; we split on . and attach the method
   * symbol to the class symbol in the same file.
   *
   * source: workflow_graph_source_native_ast.py:197-223
   */
  private _memberOfEdges(analyses: FileAnalysis[]): AstEdgeRow[] {
    const out: AstEdgeRow[] = [];
    for (const a of analyses) {
      // class names defined in THIS file (MEMBER_OF is intra-file).
      const classesInFile = new Set(
        a.definitions.filter((d) => d.kind === "class").map((d) => d.name),
      );
      for (const sym of a.definitions) {
        if (sym.kind !== "method") continue;
        if (!sym.name.includes(".")) continue;
        const parent = sym.name.split(".").slice(0, -1).join(".");
        if (!classesInFile.has(parent)) continue;
        out.push({
          kind: "member_of",
          src_file: a.path,
          src_name: sym.name,
          dst_file: a.path,
          dst_name: parent,
          confidence: 1.0,
          reason: "native-ast:member-of",
        });
      }
    }
    return out;
  }

  /**
   * File → imported-symbol IMPORTS. Resolves each import's target
   * file via codebase-graph.resolveAllImports; then, for every imported name
   * that corresponds to a SYMBOL defined in the target file, emit one edge.
   *
   * codebase-graph.resolveAllImports builds candidate paths like lib.ts or
   * lib/index.ts — it's only useful when FileAnalysis.path is relative to
   * the project root. Absolute paths from session tool-events would never
   * match. We normalise every analysis to a relative-to-common-prefix path
   * before resolving, then map results back to absolutes for the emitted
   * edges (ingest_ast_edge keys nodes by absolute path).
   *
   * source: workflow_graph_source_native_ast.py:226-296
   */
  private _importEdges(analyses: FileAnalysis[]): AstEdgeRow[] {
    if (analyses.length === 0) return [];

    const absPaths = analyses.map((a) => a.path);
    const relPaths = _relativize(absPaths);
    const relToAbs = new Map<string, string>(
      relPaths.map((r, i) => [r, absPaths[i] ?? ""]),
    );

    // Build a shallow copy with relative paths so resolveAllImports
    // can find candidates. Original analyses stay untouched.
    const relAnalyses: FileAnalysis[] = analyses.map((a, i) => ({
      ...a,
      path: relPaths[i] ?? a.path,
    }));

    // resolveAllImports returns FileEdge = [string, string]
    // Build a lookup: relSrc → relTgt (first match wins, mirrors Python logic)
    const srcToTgt = new Map<string, string>();
    for (const [src, tgt] of resolveAllImports(relAnalyses)) {
      if (!srcToTgt.has(src)) srcToTgt.set(src, tgt);
    }

    // Map target-file path (ABSOLUTE) → set of top-level symbol names.
    const symbolsInFile = new Map<string, Set<string>>();
    for (const a of analyses) {
      const names = new Set(
        a.definitions
          .filter((sym) => !sym.name.includes("."))
          .map((sym) => sym.name),
      );
      symbolsInFile.set(a.path, names);
    }

    const out: AstEdgeRow[] = [];
    for (let i = 0; i < analyses.length; i++) {
      const a = analyses[i];
      if (!a) continue;
      const relSrc = relPaths[i];
      if (relSrc === undefined) continue;
      for (const imp of a.imports) {
        if (!imp.names || imp.names.length === 0) continue; // e.g. `import foo` with no named members
        const targetRel = srcToTgt.get(relSrc);
        if (targetRel === undefined) continue;
        const targetAbs = relToAbs.get(targetRel);
        if (targetAbs === undefined) continue;
        const tgtNames = symbolsInFile.get(targetAbs) ?? new Set<string>();
        for (const name of imp.names) {
          if (!tgtNames.has(name)) continue;
          out.push({
            kind: "imports",
            src_file: a.path,
            src_name: "",
            dst_file: targetAbs,
            dst_name: name,
            confidence: 1.0,
            reason: "native-ast:import",
          });
        }
      }
    }
    return out;
  }
}

// ── Module-level helpers ───────────────────────────────────────────────

/**
 * Return each path relative to their longest common parent. Strips
 * the leading slash + shared directory so codebase-graph's candidate
 * logic (which assumes repo-root-relative paths) can find targets.
 *
 * source: workflow_graph_source_native_ast.py:299-316
 */
function _relativize(absPaths: string[]): string[] {
  if (absPaths.length === 0) return [];

  try {
    // Find common prefix by splitting on sep and comparing parts
    const split = absPaths.map((p) => p.split(nodePath.sep));
    let commonParts: string[] = split[0] ?? [];
    for (let i = 1; i < split.length; i++) {
      const parts: string[] = split[i] ?? [];
      let j = 0;
      while (
        j < commonParts.length &&
        j < parts.length &&
        (commonParts[j] ?? "") === (parts[j] ?? "")
      ) {
        j++;
      }
      commonParts = commonParts.slice(0, j);
    }
    const root = commonParts.join(nodePath.sep);
    if (!root || root === nodePath.sep) return [...absPaths];
    return absPaths.map((p) => nodePath.relative(root, p));
  } catch {
    return [...absPaths];
  }
}
