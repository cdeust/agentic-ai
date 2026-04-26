/**
 * Cortex-side writers for ingest-codebase.
 *
 * Ported from mcp_server/handlers/ingest_codebase_writers.py
 *
 * Project the upstream graph projection (symbols, files, edges) into
 * Cortex's MemoryStore: memories, KG entities, and KG relationships.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoryStore = any;

import type { SymbolRow, FileRow } from "./ingest-codebase-cypher.js";

// ── Symbol writers ────────────────────────────────────────────────────────

function _shortSymbolSummary(sym: SymbolRow & Record<string, unknown>): string {
  const qn = sym.qualified_name ?? sym.name ?? "<anon>";
  const kind = sym.kind ?? "symbol";
  const community = sym["community"] as unknown;
  const process = sym["process"] as unknown;
  const parts = [`${kind} ${qn}`];
  if (community !== undefined && community !== null) parts.push(`community=${community}`);
  if (process) parts.push(`process=${process}`);
  return parts.join(" | ");
}

export function writeSymbolMemories(
  store: MemoryStore,
  symbols: (SymbolRow & Record<string, unknown>)[],
  projectPath: string,
  domain: string,
): number[] {
  /**
   * Persist symbols as standalone memories. Returns new memory ids.
   */
  const ids: number[] = [];
  for (const sym of symbols) {
    const qn = sym.qualified_name ?? sym.name;
    if (!qn) continue;
    const summary = _shortSymbolSummary(sym);
    let content = `Code symbol: ${qn}\n\n${summary}`;
    if (sym.file) content += `\nFile: ${sym.file}`;
    const record = {
      content,
      tags: ["code-reference", "ingest", sym.kind ?? "symbol"],
      source: "ingest_codebase",
      domain,
      directory_context: projectPath,
      importance: Number((sym["relevance_score"] as unknown) ?? 0.5) || 0.5,
      heat: 0.8,
      is_protected: false,
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      ids.push(store.insertMemory(record) as number);
    } catch {
      // best-effort — log in production via caller
    }
  }
  return ids;
}

export function writeSymbolEntities(
  store: MemoryStore,
  symbols: (SymbolRow & Record<string, unknown>)[],
  domain: string,
): [Map<string, number>, string[]] {
  /**
   * Persist symbols as KG entities. Returns [nameToId, diagnostics].
   *
   * qualified_name is the dedupe key. When two distinct symbols share
   * a qn (overloads, decorator-generated copies, indexer noise) we can
   * only retain one entity, since call edges from the upstream graph
   * are themselves keyed on qn. We surface collisions as diagnostics.
   */
  const nameToId = new Map<string, number>();
  const collisions = new Map<string, number>();

  for (const sym of symbols) {
    const qn = sym.qualified_name ?? sym.name;
    if (!qn) continue;
    if (nameToId.has(qn)) {
      collisions.set(qn, (collisions.get(qn) ?? 1) + 1);
      continue;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const eid = store.insertEntity({
        name: qn,
        type: sym.kind ?? "symbol",
        domain,
        heat: 0.8,
      }) as number;
      nameToId.set(qn, eid);
    } catch {
      // best-effort
    }
  }

  const diagnostics: string[] = [];
  if (collisions.size > 0) {
    const total = [...collisions.values()].reduce((a, b) => a + b, 0);
    const sample = [...collisions.keys()].sort().slice(0, 3).join(", ");
    diagnostics.push(
      `qn-collision: ${collisions.size} qualified_names had ${total} duplicate ` +
        `symbols (kept first). sample: ${sample}`,
    );
  }
  return [nameToId, diagnostics];
}

export function writeSymbolRelationships(
  store: MemoryStore,
  edges: [string, string][],
  nameToId: Map<string, number>,
): number {
  /**
   * Persist call edges between known entities.
   *
   * Only edges where BOTH endpoints are present in `nameToId` are
   * materialised — anything else would be a dangling reference.
   */
  let written = 0;
  for (const [srcName, targetName] of edges) {
    const srcId = nameToId.get(srcName);
    const dstId = nameToId.get(targetName);
    if (srcId === undefined || dstId === undefined || srcId === dstId) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      store.insertRelationship({
        source_entity_id: srcId,
        target_entity_id: dstId,
        relationship_type: "calls",
        weight: 1.0,
        confidence: 0.9,
      });
      written++;
    } catch {
      // best-effort
    }
  }
  return written;
}

// ── File writers ──────────────────────────────────────────────────────────

export function writeFileMemories(
  store: MemoryStore,
  files: FileRow[],
  projectPath: string,
  domain: string,
): number[] {
  const ids: number[] = [];
  for (const f of files) {
    if (!f.path) continue;
    const ext = f.extension ?? "";
    const size = f.size_bytes ?? 0;
    const record = {
      content: `Code file: ${f.path}\n\nextension=${ext} | size_bytes=${size}`,
      tags: ["code-reference", "ingest", "file"],
      source: "ingest_codebase",
      domain,
      directory_context: projectPath,
      importance: 0.4,
      heat: 0.6,
      is_protected: false,
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      ids.push(store.insertMemory(record) as number);
    } catch {
      // best-effort
    }
  }
  return ids;
}

export function writeFileEntities(
  store: MemoryStore,
  files: FileRow[],
  domain: string,
): Map<string, number> {
  /**
   * Persist files as KG entities. Returns {filePath: entityId}.
   */
  const nameToId = new Map<string, number>();
  for (const f of files) {
    if (!f.path || nameToId.has(f.path)) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const eid = store.insertEntity({
        name: f.path,
        type: "file",
        domain,
        heat: 0.6,
      }) as number;
      nameToId.set(f.path, eid);
    } catch {
      // best-effort
    }
  }
  return nameToId;
}

export function writeFileRelationships(
  store: MemoryStore,
  edges: [string, string][],
  fileToId: Map<string, number>,
  symbolToId: Map<string, number>,
): number {
  /**
   * Persist (file)-[:contains]->(symbol) edges.
   */
  let written = 0;
  for (const [filePath, symbolQn] of edges) {
    const srcId = fileToId.get(filePath);
    const dstId = symbolToId.get(symbolQn);
    if (srcId === undefined || dstId === undefined) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      store.insertRelationship({
        source_entity_id: srcId,
        target_entity_id: dstId,
        relationship_type: "contains",
        weight: 1.0,
        confidence: 0.95,
      });
      written++;
    } catch {
      // best-effort
    }
  }
  return written;
}
