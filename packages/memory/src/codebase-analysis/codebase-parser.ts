/**
 * Codebase parser — regex-based source file analysis.
 *
 * Ported from mcp_server/core/codebase_parser.py
 *
 * Extracts imports, type definitions, function definitions, and module
 * structure from source files. No AST parsing — pure regex heuristics
 * that work across Python, TypeScript, Go, Rust, Swift, and more.
 *
 * Pure business logic — no I/O. Callers pass file content as strings.
 * Language-specific extractors live in codebase-extractors.ts.
 */

import { createHash } from "node:crypto";
import * as _extractors from "./codebase-extractors.js";
import type { FileAnalysis, ImportInfo, SymbolDef } from "./types.js";

// ── Language detection ────────────────────────────────────────────────────

export const EXT_TO_LANG: Record<string, string> = {
  ".py": "python",
  ".js": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".jsx": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".swift": "swift",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".cs": "csharp",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".m": "objc",
};

export function detectLanguage(path: string): string {
  for (const [ext, lang] of Object.entries(EXT_TO_LANG)) {
    if (path.endsWith(ext)) return lang;
  }
  return "unknown";
}

export function parseFile(path: string, content: string): FileAnalysis {
  /**
   * Parse a source file and extract its structure.
   *
   * Args:
   *   path: Relative file path.
   *   content: Full file content as string.
   *
   * Returns:
   *   FileAnalysis with imports, definitions, docstring, and content hash.
   */
  const { IMPORT_EXTRACTORS, SYMBOL_EXTRACTORS, extractDocstring } = _extractors;

  const language = detectLanguage(path);
  const contentHash = createHash("sha256")
    .update(content, "utf8")
    .digest("hex")
    .slice(0, 16);

  const importExtractor = IMPORT_EXTRACTORS[language] ?? ((_: string) => [] as ImportInfo[]);
  const symbolExtractor = SYMBOL_EXTRACTORS[language] ?? ((_: string) => [] as SymbolDef[]);

  const imports = importExtractor(content);
  const definitions = symbolExtractor(content);
  const docstring = extractDocstring(content, language);

  return {
    path,
    language,
    contentHash,
    imports,
    definitions,
    docstring,
    lineCount: content.split("\n").length,
    callsPerFunction: {},
  };
}

export function buildMemoryContent(analysis: FileAnalysis): string {
  /**
   * Build structured memory content from a file analysis.
   *
   * Format designed for good embeddings — includes file path, language,
   * imports, definitions, and purpose in a human-readable format.
   */
  const parts: string[] = [`# File: ${analysis.path}`, `Language: ${analysis.language}`];

  if (analysis.docstring) {
    parts.push(`Purpose: ${analysis.docstring}`);
  }

  if (analysis.imports.length > 0) {
    parts.push("", "## Imports");
    for (const imp of analysis.imports.slice(0, 20)) {
      if (imp.names.length > 0) {
        parts.push(`- from ${imp.module} import ${imp.names.slice(0, 5).join(", ")}`);
      } else {
        parts.push(`- ${imp.module}`);
      }
    }
  }

  if (analysis.definitions.length > 0) {
    parts.push("", "## Definitions");
    for (const sym of analysis.definitions.slice(0, 30)) {
      const sig = sym.signature ? `(${sym.signature})` : "";
      parts.push(`- ${sym.kind}: ${sym.name}${sig}`);
    }
  }

  parts.push(`\n${analysis.lineCount} lines`);
  return parts.join("\n");
}
