/**
 * Tree-sitter AST parser — structured code analysis with cross-file resolution.
 *
 * Ported from mcp_server/core/ast_parser.py
 *
 * Replaces regex-based extraction with proper AST parsing. Extracts:
 * - Imports with resolved target files
 * - Function/method definitions with scope
 * - Class definitions with inheritance
 * - Function call sites for call graph edges
 * - Class-method containment
 *
 * Falls back to regex parser if tree-sitter is not installed.
 *
 * Pure business logic — no I/O. Callers pass file content as Buffers.
 *
 * AST SUBSTRATE: native Node.js bindings (`tree-sitter` + per-language
 *   grammar packages). See docs/ADR/0012-tree-sitter-bindings.md.
 *   Grammar packages are optionalDependencies — the module degrades
 *   gracefully to the regex parser when native modules are absent.
 *   Decision closed: ADR-0012 (2026-04-27).
 */

import { createHash } from "node:crypto";
import { detectLanguage, parseFile } from "./codebase-parser.js";
import * as _astExtractors from "./ast-extractors.js";
import * as _astExtractorsExtra from "./ast-extractors-extra.js";
import type { FileAnalysis, ImportInfo, SymbolDef } from "./types.js";

// Languages supported by our AST queries
const AST_SUPPORTED = new Set(["python", "typescript", "javascript", "go", "rust", "swift"]);

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@f2b9f99 mcp_server/core/ast_parser.py — 16-hex-char SHA-256 prefix for content dedup
const CONTENT_HASH_HEX_CHARS = 16;

// source: cortex@f2b9f99 mcp_server/core/ast_parser.py — 200-char docstring/comment truncation cap
const DOCSTRING_MAX_CHARS = 200;

// ── Substrate availability ─────────────────────────────────────────────────

let _treeSitterChecked = false;
let _treeSitterAvailable = false;

export function isAvailable(): boolean {
  if (_treeSitterChecked) return _treeSitterAvailable;
  _treeSitterChecked = true;
  try {
    // Probe: attempt to require the tree-sitter binding. Fails gracefully
    // when the native module is not installed (CI, lightweight deploys).
    require("tree-sitter"); // eslint-disable-line @typescript-eslint/no-require-imports
    _treeSitterAvailable = true;
  } catch {
    _treeSitterAvailable = false;
  }
  return _treeSitterAvailable;
}

// ── Node type alias (avoids hard dep on tree-sitter types at call site) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TsNode = any;

// ── Public API ────────────────────────────────────────────────────────────

export function parseFileAst(path: string, content: Buffer): FileAnalysis {
  /**
   * Parse a source file using tree-sitter AST.
   *
   * Args:
   *   path: Relative file path.
   *   content: Raw file content as bytes.
   *
   * Returns:
   *   FileAnalysis with imports, definitions, and content hash.
   */
  const language = detectLanguage(path);
  const contentHash = createHash("sha256").update(content).digest("hex").slice(0, CONTENT_HASH_HEX_CHARS); // source: cortex@f2b9f99 mcp_server/core/ast_parser.py — SHA-256 hash truncated to CONTENT_HASH_HEX_CHARS hex chars
  const text = content.toString("utf8");

  const extractorAndTree = _getExtractorAndTree(language, content);
  if (!extractorAndTree) {
    return parseFile(path, text);
  }

  const { extractor, tree } = extractorAndTree;
  const root: TsNode = tree.rootNode;
  const { imports, definitions } = extractor(root, content);
  const docstring = _extractModuleDoc(root, language, content);

  const callsPerFunction = _astExtractors.extractCallsPerFunction(root, content);

  return {
    path,
    language,
    contentHash,
    imports,
    definitions,
    docstring,
    lineCount: text.split("\n").length,
    callsPerFunction,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────

function _getExtractorAndTree(
  language: string,
  content: Buffer,
): { extractor: Extractor; tree: TsNode } | null {
  if (!AST_SUPPORTED.has(language)) return null;
  const extractor = _EXTRACTORS[language];
  if (!extractor) return null;
  if (!isAvailable()) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TreeSitter = require("tree-sitter");
    const parser = new TreeSitter();
    const grammar = _loadGrammar(language);
    if (!grammar) return null;
    parser.setLanguage(grammar);
    const tree = parser.parse(content);
    return { extractor, tree };
  } catch {
    return null;
  }
}

function _loadGrammar(language: string): TsNode | null {
  const pkgMap: Record<string, string> = {
    python: "tree-sitter-python",
    javascript: "tree-sitter-javascript",
    typescript: "tree-sitter-typescript/typescript",
    go: "tree-sitter-go",
    rust: "tree-sitter-rust",
    swift: "tree-sitter-swift",
  };
  const pkg = pkgMap[language];
  if (!pkg) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(pkg);
  } catch {
    return null;
  }
}

export function nodeText(node: TsNode, source: Buffer): string {
  return source.slice(node.startIndex as number, node.endIndex as number).toString("utf8");
}

function _extractModuleDoc(root: TsNode, language: string, source: Buffer): string {
  const children: TsNode[] = root.children ?? [];
  if (children.length === 0) return "";
  const first: TsNode = children[0];
  if (first === undefined) return "";
  if (language === "python") {
    let target: TsNode = first;
    if (first.type === "expression_statement" && (first.children ?? []).length > 0) {
      const child0: TsNode = (first.children as TsNode[])[0];
      if (child0 !== undefined) target = child0;
    }
    if (target.type === "string") {
      return nodeText(target, source).replace(/^["']+|["']+$/g, "").trim().slice(0, DOCSTRING_MAX_CHARS);
    }
  }
  if (first.type === "comment") {
    return nodeText(first, source).replace(/^[/#* ]+/, "").trim().slice(0, DOCSTRING_MAX_CHARS);
  }
  return "";
}

// ── Language extractors ───────────────────────────────────────────────────

type ExtractorResult = { imports: ImportInfo[]; definitions: SymbolDef[]; calls: string[] };
type Extractor = (root: TsNode, source: Buffer) => ExtractorResult;

function _extractPython(root: TsNode, source: Buffer): ExtractorResult {
  return {
    imports: _astExtractors.extractPythonImports(root, source),
    definitions: _astExtractors.extractPythonDefinitions(root, source),
    calls: _astExtractors.extractCallsGeneric(root, source),
  };
}

function _extractJs(root: TsNode, source: Buffer): ExtractorResult {
  return {
    imports: _astExtractors.extractJsImports(root, source),
    definitions: _astExtractors.extractJsDefinitions(root, source),
    calls: _astExtractors.extractCallsGeneric(root, source),
  };
}

function _extractGo(root: TsNode, source: Buffer): ExtractorResult {
  return {
    imports: _astExtractorsExtra.extractGoImports(root, source),
    definitions: _astExtractorsExtra.extractGoDefinitions(root, source),
    calls: _astExtractors.extractCallsGeneric(root, source),
  };
}

function _extractSwift(root: TsNode, source: Buffer): ExtractorResult {
  return {
    imports: _astExtractorsExtra.extractSwiftImports(root, source),
    definitions: _astExtractorsExtra.extractSwiftDefinitions(root, source),
    calls: _astExtractors.extractCallsGeneric(root, source),
  };
}

function _extractRust(root: TsNode, source: Buffer): ExtractorResult {
  return {
    imports: _astExtractorsExtra.extractRustImports(root, source),
    definitions: _astExtractorsExtra.extractRustDefinitions(root, source),
    calls: _astExtractors.extractCallsGeneric(root, source),
  };
}

const _EXTRACTORS: Record<string, Extractor> = {
  python: _extractPython,
  javascript: _extractJs,
  typescript: _extractJs,
  go: _extractGo,
  swift: _extractSwift,
  rust: _extractRust,
};
