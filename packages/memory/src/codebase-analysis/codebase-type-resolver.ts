/**
 * Type-reference resolution for cross-file linking.
 *
 * Ported from mcp_server/core/codebase_type_resolver.py
 *
 * For languages like Swift where files in the same module reference each
 * other's types without explicit imports. Scans file content for type name
 * usage and creates file→file edges.
 *
 * Pure business logic — no I/O.
 */

import type { FileAnalysis, FileEdge } from "./types.js";

// Types too generic to be meaningful cross-file references
const _NOISE_TYPES = new Set([
  "Self",
  "self",
  "Any",
  "String",
  "Int",
  "Bool",
  "Double",
  "Float",
  "Array",
  "Dictionary",
  "Set",
  "Optional",
  "Result",
  "Error",
  "Void",
  "View",
  "Body",
  "some",
  "Type",
  "Data",
  "URL",
  "Date",
  "UUID",
  "True",
  "False",
  "None",
  "nil",
  "List",
  "Dict",
  "Tuple",
  "object",
  "str",
  "int",
  "float",
  "bool",
  "bytes",
  "dict",
  "list",
  "tuple",
  "set",
  "type",
  "cls",
  "args",
  "kwargs",
]);

const _TYPE_KINDS = new Set([
  "class",
  "protocol",
  "enum",
  "interface",
  "trait",
  "struct",
  "type",
]);

const MIN_TYPE_NAME_LENGTH = 3;

export function buildTypeIndex(analyses: FileAnalysis[]): Map<string, string> {
  /**
   * Map exported type names to their defining file.
   *
   * Only includes class/struct/protocol/enum/interface/trait — not
   * functions or methods, which would produce too much noise.
   *
   * Returns:
   *   Map of typeName → defining file path.
   */
  const index = new Map<string, string>();
  for (const analysis of analyses) {
    for (const sym of analysis.definitions) {
      if (!_TYPE_KINDS.has(sym.kind)) continue;
      const base = sym.name.split(".").at(-1)!;
      if (_NOISE_TYPES.has(base) || base.length < MIN_TYPE_NAME_LENGTH) continue;
      if (!index.has(base)) index.set(base, analysis.path);
    }
  }
  return index;
}

export function resolveTypeReferences(
  analyses: FileAnalysis[],
  fileContents: Map<string, string>,
): FileEdge[] {
  /**
   * Resolve cross-file edges by scanning for type name usage.
   *
   * For languages like Swift where files in the same module reference
   * each other's types without explicit imports.
   *
   * Args:
   *   analyses: All parsed file analyses.
   *   fileContents: Map of filePath to raw file text.
   *
   * Returns:
   *   List of [usingFile, definingFile] tuples.
   */
  const typeIndex = buildTypeIndex(analyses);
  const edges: FileEdge[] = [];
  const seen = new Set<string>();

  for (const analysis of analyses) {
    const content = fileContents.get(analysis.path) ?? "";
    if (!content) continue;
    for (const [typeName, defFile] of typeIndex) {
      if (defFile === analysis.path) continue;
      const re = new RegExp(`\\b${escapeRegex(typeName)}\\b`);
      if (re.test(content)) {
        const key = `${analysis.path}::${defFile}`;
        if (!seen.has(key)) {
          edges.push([analysis.path, defFile]);
          seen.add(key);
        }
      }
    }
  }

  return edges;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
