/**
 * Tree-sitter extractors for Go, Swift, and Rust.
 *
 * Ported from mcp_server/core/ast_extractors_extra.py
 *
 * Split from ast-extractors.ts to stay under 300 lines.
 */

import type { ImportInfo, SymbolDef } from "./types.js";
import { makeImportInfo, makeSymbolDef } from "./types.js";
import { findChildren, nodeText, walkType } from "./ast-extractors.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TsNode = any;

// ── Go ────────────────────────────────────────────────────────────────────

export function extractGoImports(root: TsNode, source: Buffer): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const node of walkType(root, "import_spec")) {
    const pathNode = node.childForFieldName("path") as TsNode | null;
    if (pathNode) {
      const mod = nodeText(pathNode, source).replace(/^"|"$/g, "");
      imports.push(makeImportInfo(mod));
    }
  }
  return imports;
}

export function extractGoDefinitions(root: TsNode, source: Buffer): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const node of (root.children ?? []) as TsNode[]) {
    if (node.type === "function_declaration") {
      const name = node.childForFieldName("name") as TsNode | null;
      const params = node.childForFieldName("parameters") as TsNode | null;
      if (name) {
        const sig = params ? nodeText(params, source).slice(0, 120) : "";
        defs.push(makeSymbolDef(nodeText(name, source), "function", sig));
      }
    } else if (node.type === "method_declaration") {
      const name = node.childForFieldName("name") as TsNode | null;
      const receiver = node.childForFieldName("receiver") as TsNode | null;
      if (name) {
        const recv = _extractGoReceiver(receiver, source);
        const full = recv ? `${recv}.${nodeText(name, source)}` : nodeText(name, source);
        defs.push(makeSymbolDef(full, "method"));
      }
    } else if (node.type === "type_declaration") {
      for (const spec of findChildren(node, "type_spec")) {
        const n = spec.childForFieldName("name") as TsNode | null;
        const t = spec.childForFieldName("type") as TsNode | null;
        if (n) {
          const kind =
            t && (t.type === "struct_type" || t.type === "interface_type")
              ? (t.type as string).replace("_type", "")
              : "type";
          defs.push(makeSymbolDef(nodeText(n, source), kind));
        }
      }
    }
  }
  return defs;
}

function _extractGoReceiver(receiver: TsNode | null, source: Buffer): string {
  if (!receiver) return "";
  for (const child of walkType(receiver, "type_identifier")) {
    return nodeText(child, source);
  }
  return "";
}

// ── Swift ─────────────────────────────────────────────────────────────────

export function extractSwiftImports(root: TsNode, source: Buffer): ImportInfo[] {
  return walkType(root, "import_declaration").map((n: TsNode) =>
    makeImportInfo(nodeText(n, source).replace(/^import\s+/, "").trim()),
  );
}

export function extractSwiftDefinitions(root: TsNode, source: Buffer): SymbolDef[] {
  const defs: SymbolDef[] = [];
  _extractSwiftNode(root, source, defs, "");
  return defs;
}

const _SWIFT_KIND_MAP: Record<string, string> = {
  class_declaration: "class",
  struct_declaration: "class",
  protocol_declaration: "protocol",
  enum_declaration: "enum",
};

function _extractSwiftNode(
  node: TsNode,
  source: Buffer,
  defs: SymbolDef[],
  parent: string,
): void {
  const type = node.type as string;
  if (type === "function_declaration") {
    const name = node.childForFieldName("name") as TsNode | null;
    if (name) {
      const n = nodeText(name, source);
      const full = parent ? `${parent}.${n}` : n;
      defs.push(makeSymbolDef(full, parent ? "method" : "function"));
    }
  } else if (_SWIFT_KIND_MAP[type]) {
    const name = node.childForFieldName("name") as TsNode | null;
    if (name) {
      const n = nodeText(name, source);
      defs.push(makeSymbolDef(n, _SWIFT_KIND_MAP[type]!));
      const body = node.childForFieldName("body") as TsNode | null;
      if (body) {
        for (const child of (body.children ?? []) as TsNode[]) {
          _extractSwiftNode(child, source, defs, n);
        }
      }
    }
  } else {
    for (const child of (node.children ?? []) as TsNode[]) {
      _extractSwiftNode(child, source, defs, parent);
    }
  }
}

// ── Rust ──────────────────────────────────────────────────────────────────

export function extractRustImports(root: TsNode, source: Buffer): ImportInfo[] {
  return walkType(root, "use_declaration").map((n: TsNode) =>
    makeImportInfo(
      nodeText(n, source)
        .replace(/^use\s+/, "")
        .replace(/;$/, "")
        .trim(),
    ),
  );
}

export function extractRustDefinitions(root: TsNode, source: Buffer): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (const node of (root.children ?? []) as TsNode[]) {
    _extractRustNode(node, source, defs);
  }
  return defs;
}

function _extractRustNode(node: TsNode, source: Buffer, defs: SymbolDef[]): void {
  const type = node.type as string;
  if (type === "function_item") {
    const name = node.childForFieldName("name") as TsNode | null;
    if (name) defs.push(makeSymbolDef(nodeText(name, source), "function"));
  } else if (type === "struct_item") {
    const name = node.childForFieldName("name") as TsNode | null;
    if (name) defs.push(makeSymbolDef(nodeText(name, source), "class"));
  } else if (type === "enum_item") {
    const name = node.childForFieldName("name") as TsNode | null;
    if (name) defs.push(makeSymbolDef(nodeText(name, source), "enum"));
  } else if (type === "trait_item") {
    const name = node.childForFieldName("name") as TsNode | null;
    if (name) defs.push(makeSymbolDef(nodeText(name, source), "trait"));
  } else if (type === "impl_item") {
    _extractRustImpl(node, source, defs);
  }
}

function _extractRustImpl(node: TsNode, source: Buffer, defs: SymbolDef[]): void {
  const typeNode = node.childForFieldName("type") as TsNode | null;
  if (!typeNode) return;
  const implName = nodeText(typeNode, source);
  const body = node.childForFieldName("body") as TsNode | null;
  if (!body) return;
  for (const child of (body.children ?? []) as TsNode[]) {
    if (child.type === "function_item") {
      const fnName = child.childForFieldName("name") as TsNode | null;
      if (fnName) {
        const full = `${implName}.${nodeText(fnName, source)}`;
        defs.push(makeSymbolDef(full, "method"));
      }
    }
  }
}
