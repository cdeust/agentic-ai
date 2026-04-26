/**
 * Tree-sitter AST extractors for Python and JavaScript/TypeScript.
 *
 * Ported from mcp_server/core/ast_extractors.py
 *
 * Additional languages (Go, Swift, Rust) in ast-extractors-extra.ts.
 * Also provides the generic call-site extractor used by all languages.
 *
 * Pure functions — no I/O.
 */

import type { ImportInfo, SymbolDef } from "./types.js";
import { makeImportInfo, makeSymbolDef } from "./types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TsNode = any;

// ── Shared helpers ────────────────────────────────────────────────────────

export function nodeText(node: TsNode, source: Buffer): string {
  return source.slice(node.startIndex as number, node.endIndex as number).toString("utf8");
}

export function findChildren(node: TsNode, ...types: string[]): TsNode[] {
  return ((node.children ?? []) as TsNode[]).filter((c: TsNode) => types.includes(c.type as string));
}

export function walkType(node: TsNode, nodeType: string): TsNode[] {
  const results: TsNode[] = [];
  if ((node.type as string) === nodeType) results.push(node);
  for (const child of (node.children ?? []) as TsNode[]) {
    results.push(...walkType(child, nodeType));
  }
  return results;
}

// ── Python ────────────────────────────────────────────────────────────────

export function extractPythonImports(root: TsNode, source: Buffer): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const node of (root.children ?? []) as TsNode[]) {
    if (node.type === "import_statement") {
      for (const nameNode of findChildren(node, "dotted_name")) {
        imports.push(makeImportInfo(nodeText(nameNode, source)));
      }
    } else if (node.type === "import_from_statement") {
      const modNode = node.childForFieldName("module_name") as TsNode | null;
      const module = modNode ? nodeText(modNode, source) : "";
      const names = findChildren(node, "dotted_name", "aliased_import")
        .filter((n: TsNode) => n !== modNode)
        .map((n: TsNode) => nodeText(n, source));
      const isRelative = module.startsWith(".");
      imports.push(makeImportInfo(module, names, isRelative));
    }
  }
  return imports;
}

export function extractPythonDefinitions(
  root: TsNode,
  source: Buffer,
  parentClass = "",
): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const node of (root.children ?? []) as TsNode[]) {
    if (node.type === "function_definition") {
      _extractPythonFunc(node, source, defs, parentClass);
    } else if (node.type === "decorated_definition") {
      _extractPythonDecorated(node, source, defs, parentClass);
    } else if (node.type === "class_definition") {
      _extractPythonClass(node, source, defs);
    }
  }
  return defs;
}

function _extractPythonFunc(
  node: TsNode,
  source: Buffer,
  defs: SymbolDef[],
  parent: string,
): void {
  const nameNode = node.childForFieldName("name") as TsNode | null;
  const paramsNode = node.childForFieldName("parameters") as TsNode | null;
  const name = nameNode ? nodeText(nameNode, source) : "";
  const sig = paramsNode ? nodeText(paramsNode, source).slice(0, 120) : "";
  const kind = parent ? "method" : "function";
  const fullName = parent ? `${parent}.${name}` : name;
  defs.push(makeSymbolDef(fullName, kind, sig));
}

function _extractPythonDecorated(
  node: TsNode,
  source: Buffer,
  defs: SymbolDef[],
  parent: string,
): void {
  for (const child of (node.children ?? []) as TsNode[]) {
    if (child.type === "function_definition" || child.type === "class_definition") {
      // Wrap in a fake node that extractPythonDefinitions can iterate
      const fake = { children: [child] };
      defs.push(...extractPythonDefinitions(fake, source, parent));
    }
  }
}

function _extractPythonClass(
  node: TsNode,
  source: Buffer,
  defs: SymbolDef[],
): void {
  const nameNode = node.childForFieldName("name") as TsNode | null;
  const superclassNode = node.childForFieldName("superclasses") as TsNode | null;
  const clsName = nameNode ? nodeText(nameNode, source) : "";
  const sig = superclassNode ? nodeText(superclassNode, source).slice(0, 120) : "";
  defs.push(makeSymbolDef(clsName, "class", sig));
  const body = node.childForFieldName("body") as TsNode | null;
  if (body) {
    defs.push(...extractPythonDefinitions(body, source, clsName));
  }
}

// ── JavaScript / TypeScript ───────────────────────────────────────────────

export function extractJsImports(root: TsNode, source: Buffer): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const node of walkType(root, "import_statement")) {
    const src = node.childForFieldName("source") as TsNode | null;
    if (src) {
      const mod = nodeText(src, source).replace(/^['"]|['"]$/g, "");
      imports.push(makeImportInfo(mod, [], mod.startsWith(".")));
    }
  }
  return imports;
}

export function extractJsDefinitions(root: TsNode, source: Buffer): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const node of (root.children ?? []) as TsNode[]) {
    _extractJsNode(node, source, defs, "");
  }
  return defs;
}

function _extractJsNode(
  node: TsNode,
  source: Buffer,
  defs: SymbolDef[],
  parent: string,
): void {
  const type = node.type as string;
  if (type === "function_declaration" || type === "function") {
    _extractJsFunc(node, source, defs, parent);
  } else if (type === "class_declaration") {
    _extractJsClass(node, source, defs);
  } else if (type === "interface_declaration") {
    const name = node.childForFieldName("name") as TsNode | null;
    if (name) defs.push(makeSymbolDef(nodeText(name, source), "interface"));
  } else if (type === "type_alias_declaration") {
    const name = node.childForFieldName("name") as TsNode | null;
    if (name) defs.push(makeSymbolDef(nodeText(name, source), "type"));
  } else if (type === "export_statement") {
    for (const child of (node.children ?? []) as TsNode[]) {
      _extractJsNode(child, source, defs, parent);
    }
  } else if (type === "method_definition") {
    const name = node.childForFieldName("name") as TsNode | null;
    if (name) {
      const text = nodeText(name, source);
      const full = parent ? `${parent}.${text}` : text;
      defs.push(makeSymbolDef(full, "method"));
    }
  }
}

function _extractJsFunc(
  node: TsNode,
  source: Buffer,
  defs: SymbolDef[],
  parent: string,
): void {
  const nameNode = node.childForFieldName("name") as TsNode | null;
  const paramsNode = node.childForFieldName("parameters") as TsNode | null;
  if (nameNode) {
    const name = nodeText(nameNode, source);
    const full = parent ? `${parent}.${name}` : name;
    const sig = paramsNode ? nodeText(paramsNode, source).slice(0, 120) : "";
    defs.push(makeSymbolDef(full, "function", sig));
  }
}

function _extractJsClass(node: TsNode, source: Buffer, defs: SymbolDef[]): void {
  const nameNode = node.childForFieldName("name") as TsNode | null;
  if (!nameNode) return;
  const clsName = nodeText(nameNode, source);
  defs.push(makeSymbolDef(clsName, "class"));
  const body = node.childForFieldName("body") as TsNode | null;
  if (body) {
    for (const child of (body.children ?? []) as TsNode[]) {
      _extractJsNode(child, source, defs, clsName);
    }
  }
}

// ── Generic call extraction ──────────────────────────────────────────────

const _CALL_NODE_TYPES = ["call", "call_expression"] as const;

export function extractCallsGeneric(root: TsNode, source: Buffer): string[] {
  const calls: string[] = [];
  const seen = new Set<string>();
  for (const callType of _CALL_NODE_TYPES) {
    for (const node of walkType(root, callType)) {
      const func = node.childForFieldName("function") as TsNode | null;
      if (!func) continue;
      const name = nodeText(func, source).trim();
      if (name && !seen.has(name) && name.length < 100) {
        calls.push(name);
        seen.add(name);
      }
    }
  }
  return calls;
}

// ── Per-function call extraction (caller-qualified) ─────────────────────

// Tree-sitter node types that represent a function/method definition
// across the grammars we support (Python/JS/TS/Go/Rust/Swift). We walk
// into each one and record the calls made inside its body, keyed by a
// qualified name that includes the enclosing class when applicable. The
// workflow graph's CALLS edges use this to surface WHICH caller made
// each call, not just that the call happened somewhere in the file.

const _FUNCTION_NODE_TYPES = new Set([
  "function_definition",   // Python, Rust, Swift
  "function_declaration",  // JS, TS, Go, Swift
  "method_definition",     // JS, TS (class bodies)
  "method_declaration",    // TS interfaces, Go method receivers
  "function_signature",    // TS interfaces, Swift protocols
]);

// Class/impl-block containers whose children should carry a prefix.
const _CLASS_NODE_TYPES = new Set([
  "class_definition",   // Python
  "class_declaration",  // JS, TS, Java, Kotlin
  "impl_item",          // Rust impl ClassName { ... }
]);

function _calleeBasename(callNode: TsNode, source: Buffer): string {
  /**
   * Best-effort callee basename for resolution via symbol_to_file.
   *
   * Strategy: take the dotted/attribute chain's last segment and strip
   * anything after the first '(', '[', or '<' (generics, subscripts,
   * argument lists that slip into tree-sitter's surface text).
   */
  const fnRef = callNode.childForFieldName("function") as TsNode | null;
  if (!fnRef) return "";
  let text = nodeText(fnRef, source).trim();
  const dotIdx = text.lastIndexOf(".");
  let base = dotIdx >= 0 ? text.slice(dotIdx + 1) : text;
  for (const c of ["(", "[", "<"]) {
    const idx = base.indexOf(c);
    if (idx >= 0) base = base.slice(0, idx);
  }
  return base.trim();
}

export function extractCallsPerFunction(
  root: TsNode,
  source: Buffer,
): Record<string, string[]> {
  /**
   * Return { qualifiedName: [calleeBasename, ...] }.
   *
   * Walks every function/method definition reachable from root.
   * Methods inside a class get `ClassName.method` as their qname
   * (matching the shape extractPythonDefinitions already emits).
   * Anonymous functions (lambdas, unnamed arrows) are skipped — no
   * qname means we can't attach edges to them.
   */
  const out: Record<string, string[]> = {};

  function walk(node: TsNode, classScope: string): void {
    for (const child of (node.children ?? []) as TsNode[]) {
      const ntype = child.type as string;
      if (_CLASS_NODE_TYPES.has(ntype)) {
        const nameNode = child.childForFieldName("name") as TsNode | null;
        const cls = nameNode ? nodeText(nameNode, source) : classScope;
        const body = (child.childForFieldName("body") ?? child) as TsNode;
        walk(body, cls || classScope);
      } else if (ntype === "decorated_definition") {
        walk(child, classScope);
      } else if (_FUNCTION_NODE_TYPES.has(ntype)) {
        const nameNode = child.childForFieldName("name") as TsNode | null;
        const fnName = nameNode ? nodeText(nameNode, source) : "";
        const body = (child.childForFieldName("body") ?? child) as TsNode;
        if (fnName) {
          const qname = classScope ? `${classScope}.${fnName}` : fnName;
          const calls: string[] = [];
          const seen = new Set<string>();
          for (const callType of _CALL_NODE_TYPES) {
            for (const callNode of walkType(body, callType)) {
              const base = _calleeBasename(callNode, source);
              if (base && !seen.has(base) && base.length < 100) {
                calls.push(base);
                seen.add(base);
              }
            }
          }
          out[qname] = calls;
        }
        // Recurse for nested definitions (inner functions, closures).
        walk(body, classScope);
      } else {
        walk(child, classScope);
      }
    }
  }

  walk(root, "");
  return out;
}
