/**
 * Per-language import and symbol extractors for codebase analysis.
 *
 * Ported from mcp_server/core/codebase_extractors.py
 *
 * Regex-based heuristics for Python, TypeScript/JavaScript, Go, Rust,
 * and Swift. No AST parsing — works on raw text.
 *
 * Pure functions — no I/O, no state.
 */

import type { ImportInfo, SymbolDef } from "./types.js";
import { makeImportInfo, makeSymbolDef } from "./types.js";

// ── Import patterns ───────────────────────────────────────────────────────

const PY_IMPORT = /^import\s+([\w.]+)/gm;
const PY_FROM_IMPORT = /^from\s+([\w.]+)\s+import\s+(.+?)$/gm;
const JS_IMPORT =
  /^import\s+(?:\{[^}]*\}|[\w*]+(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]/gm;
const JS_REQUIRE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const GO_IMPORT_SINGLE = /^import\s+"([^"]+)"/gm;
const GO_IMPORT_BLOCK = /^import\s*\(([\s\S]*?)\)/gm;
const GO_IMPORT_LINE = /"([^"]+)"/g;
const RUST_USE = /^use\s+([\w:]+(?:::\{[^}]+\})?)/gm;
const SWIFT_IMPORT = /^import\s+(\w+)/gm;

// ── Symbol patterns ───────────────────────────────────────────────────────

const PY_DEF = /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/gm;
const PY_CLASS = /^\s*class\s+(\w+)(?:\(([^)]*)\))?/gm;

const JS_FUNC =
  /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm;
const JS_CLASS =
  /^(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/gm;
const JS_INTERFACE = /^(?:export\s+)?interface\s+(\w+)/gm;
const JS_TYPE = /^(?:export\s+)?type\s+(\w+)\s*=/gm;

const GO_FUNC = /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)/gm;
const GO_TYPE = /^type\s+(\w+)\s+(struct|interface)\b/gm;

const RUST_FN =
  /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*)?\s*\(([^)]*)\)/gm;
const RUST_STRUCT = /^(?:pub\s+)?struct\s+(\w+)/gm;
const RUST_ENUM = /^(?:pub\s+)?enum\s+(\w+)/gm;
const RUST_TRAIT = /^(?:pub\s+)?trait\s+(\w+)/gm;

const SWIFT_FUNC =
  /^\s*(?:public\s+|private\s+|internal\s+|open\s+|static\s+)*func\s+(\w+)\s*\(([^)]*)\)/gm;
const SWIFT_CLASS =
  /^\s*(?:public\s+|private\s+|open\s+|final\s+)*class\s+(\w+)/gm;
const SWIFT_STRUCT = /^\s*(?:public\s+|private\s+)*struct\s+(\w+)/gm;
const SWIFT_PROTOCOL = /^\s*(?:public\s+|private\s+)*protocol\s+(\w+)/gm;
const SWIFT_ENUM = /^\s*(?:public\s+|private\s+)*enum\s+(\w+)/gm;

// ── Docstring patterns ────────────────────────────────────────────────────

const PY_MODULE_DOC = /^(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/;
const JS_MODULE_DOC = /^\/\*\*([\s\S]*?)\*\//;

// ── Import extractors ────────────────────────────────────────────────────

function allMatches(re: RegExp, content: string): RegExpExecArray[] {
  const results: RegExpExecArray[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(content)) !== null) results.push(m);
  return results;
}

export function extractImportsPython(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const m of allMatches(PY_IMPORT, content)) {
    imports.push(makeImportInfo(m[1]!));
  }
  for (const m of allMatches(PY_FROM_IMPORT, content)) {
    const module = m[1]!;
    const names = m[2]!.split(",").map((n) => n.trim());
    imports.push(makeImportInfo(module, names, module.startsWith(".")));
  }
  return imports;
}

export function extractImportsJs(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const m of allMatches(JS_IMPORT, content)) {
    const mod = m[1]!;
    imports.push(makeImportInfo(mod, [], mod.startsWith(".")));
  }
  for (const m of allMatches(JS_REQUIRE, content)) {
    const mod = m[1]!;
    imports.push(makeImportInfo(mod, [], mod.startsWith(".")));
  }
  return imports;
}

export function extractImportsGo(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const m of allMatches(GO_IMPORT_SINGLE, content)) {
    imports.push(makeImportInfo(m[1]!));
  }
  for (const m of allMatches(GO_IMPORT_BLOCK, content)) {
    const block = m[1]!;
    for (const lm of allMatches(GO_IMPORT_LINE, block)) {
      imports.push(makeImportInfo(lm[1]!));
    }
  }
  return imports;
}

export function extractImportsRust(content: string): ImportInfo[] {
  return allMatches(RUST_USE, content).map((m) => makeImportInfo(m[1]!));
}

export function extractImportsSwift(content: string): ImportInfo[] {
  return allMatches(SWIFT_IMPORT, content).map((m) => makeImportInfo(m[1]!));
}

// ── Symbol extractors ─────────────────────────────────────────────────────

export function extractSymbolsPython(content: string): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const m of allMatches(PY_DEF, content)) {
    defs.push(makeSymbolDef(m[1]!, "function", (m[2] ?? "").slice(0, 120)));
  }
  for (const m of allMatches(PY_CLASS, content)) {
    defs.push(makeSymbolDef(m[1]!, "class", m[2] ?? ""));
  }
  return defs;
}

export function extractSymbolsJs(content: string): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const m of allMatches(JS_FUNC, content)) {
    defs.push(makeSymbolDef(m[1]!, "function", (m[2] ?? "").slice(0, 120)));
  }
  for (const m of allMatches(JS_CLASS, content)) {
    defs.push(makeSymbolDef(m[1]!, "class", m[2] ?? ""));
  }
  for (const m of allMatches(JS_INTERFACE, content)) {
    defs.push(makeSymbolDef(m[1]!, "interface"));
  }
  for (const m of allMatches(JS_TYPE, content)) {
    defs.push(makeSymbolDef(m[1]!, "type"));
  }
  return defs;
}

export function extractSymbolsGo(content: string): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const m of allMatches(GO_FUNC, content)) {
    defs.push(makeSymbolDef(m[1]!, "function", (m[2] ?? "").slice(0, 120)));
  }
  for (const m of allMatches(GO_TYPE, content)) {
    defs.push(makeSymbolDef(m[1]!, m[2]!));
  }
  return defs;
}

export function extractSymbolsRust(content: string): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const m of allMatches(RUST_FN, content)) {
    defs.push(makeSymbolDef(m[1]!, "function", (m[2] ?? "").slice(0, 120)));
  }
  for (const m of allMatches(RUST_STRUCT, content)) {
    defs.push(makeSymbolDef(m[1]!, "class"));
  }
  for (const m of allMatches(RUST_ENUM, content)) {
    defs.push(makeSymbolDef(m[1]!, "enum"));
  }
  for (const m of allMatches(RUST_TRAIT, content)) {
    defs.push(makeSymbolDef(m[1]!, "trait"));
  }
  return defs;
}

export function extractSymbolsSwift(content: string): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const m of allMatches(SWIFT_FUNC, content)) {
    defs.push(makeSymbolDef(m[1]!, "function", (m[2] ?? "").slice(0, 120)));
  }
  for (const m of allMatches(SWIFT_CLASS, content)) {
    defs.push(makeSymbolDef(m[1]!, "class"));
  }
  for (const m of allMatches(SWIFT_STRUCT, content)) {
    defs.push(makeSymbolDef(m[1]!, "class"));
  }
  for (const m of allMatches(SWIFT_PROTOCOL, content)) {
    defs.push(makeSymbolDef(m[1]!, "protocol"));
  }
  for (const m of allMatches(SWIFT_ENUM, content)) {
    defs.push(makeSymbolDef(m[1]!, "enum"));
  }
  return defs;
}

export function extractDocstring(content: string, language: string): string {
  if (language === "python") {
    const m = PY_MODULE_DOC.exec(content);
    if (m) return ((m[1] ?? m[2]) ?? "").trim().slice(0, 200);
  } else if (language === "javascript" || language === "typescript") {
    const m = JS_MODULE_DOC.exec(content);
    if (m) {
      const text = m[1]!.trim().replace(/^\s*\*\s?/gm, "");
      return text.trim().slice(0, 200);
    }
  }
  for (const line of content.split("\n").slice(0, 5)) {
    const stripped = line.trim();
    if (stripped.startsWith("#") && !stripped.startsWith("#!")) {
      return stripped.replace(/^#+\s*/, "").trim().slice(0, 200);
    }
    if (stripped.startsWith("//")) {
      return stripped.replace(/^\/+\s*/, "").trim().slice(0, 200);
    }
  }
  return "";
}

// ── Registry maps ─────────────────────────────────────────────────────────

export const IMPORT_EXTRACTORS: Record<string, (c: string) => ImportInfo[]> = {
  python: extractImportsPython,
  javascript: extractImportsJs,
  typescript: extractImportsJs,
  go: extractImportsGo,
  rust: extractImportsRust,
  swift: extractImportsSwift,
};

export const SYMBOL_EXTRACTORS: Record<string, (c: string) => SymbolDef[]> = {
  python: extractSymbolsPython,
  javascript: extractSymbolsJs,
  typescript: extractSymbolsJs,
  go: extractSymbolsGo,
  rust: extractSymbolsRust,
  swift: extractSymbolsSwift,
};
