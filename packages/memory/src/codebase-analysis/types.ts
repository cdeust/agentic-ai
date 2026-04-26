/**
 * Shared types for the codebase-analysis subsystem.
 *
 * Mirrors the Python dataclasses in:
 *   mcp_server/core/codebase_parser.py
 *   mcp_server/core/schema_extraction.py
 *   mcp_server/handlers/ingest_codebase_schema.py
 *   mcp_server/handlers/ingest_prd.py  (schema types)
 *
 * Pure types — no I/O.
 */

// ── Parser primitives ──────────────────────────────────────────────────────

export interface ImportInfo {
  module: string;
  names: string[];
  isRelative: boolean;
}

export function makeImportInfo(
  module: string,
  names: string[] = [],
  isRelative = false,
): ImportInfo {
  return { module, names, isRelative };
}

export interface SymbolDef {
  name: string;
  /** function | class | interface | type | constant | protocol | trait | enum | method */
  kind: string;
  signature: string;
  docstring: string;
}

export function makeSymbolDef(
  name: string,
  kind: string,
  signature = "",
  docstring = "",
): SymbolDef {
  return { name, kind, signature, docstring };
}

export interface FileAnalysis {
  path: string;
  language: string;
  contentHash: string;
  imports: ImportInfo[];
  definitions: SymbolDef[];
  docstring: string;
  lineCount: number;
  /**
   * Per-function call map: { callerQualifiedName: [calleeBasename, ...] }.
   * Populated by the tree-sitter path (astParser.parseFileAst) and consumed
   * by codbaseGraph.buildResolvedCallEdges. Empty when parsing via regex.
   */
  callsPerFunction: Record<string, string[]>;
}

// ── Schema types ──────────────────────────────────────────────────────────

export interface Schema {
  schemaId: string;
  domain: string;
  label: string;
  /** Expected entities with their frequency weights. */
  entitySignature: Record<string, number>;
  /** Expected relationship patterns: [source_type, relationship_type, target_type]. */
  relationshipTypes: [string, string, string][];
  tagSignature: Record<string, number>;
  consistencyThreshold: number;
  formationCount: number;
  assimilationCount: number;
  violationCount: number;
  lastUpdatedHours: number;
}

// ── Ingest request/response ───────────────────────────────────────────────

export interface IngestCodebaseRequest {
  projectPath: string;
  outputDir?: string;
  language?: "auto" | "rust" | "python" | "typescript";
  forceReindex?: boolean;
  topSymbols?: number | null;
  topProcesses?: number | null;
}

export interface IngestCodebaseResponse {
  ingested: boolean;
  graphPath?: string;
  analyze?: Record<string, unknown>;
  memoriesWritten?: number;
  entitiesWritten?: number;
  edgesWritten?: number;
  wikiPagesWritten?: string[];
  symbolCountSeen?: number;
  fileCountSeen?: number;
  processCountSeen?: number;
  diagnostics?: string[];
  reason?: string;
  error?: string;
}

export interface PRDIngestRequest {
  path?: string;
  content?: string;
  pipelineId?: string;
  title?: string;
  validate?: boolean;
  domain?: string;
}

export interface PRDIngestResponse {
  ingested: boolean;
  title?: string;
  source?: string;
  wikiPath?: string | null;
  summaryMemoryId?: number | null;
  decisionCount?: number;
  requirementCount?: number;
  validation?: Record<string, unknown> | null;
  reason?: string;
  error?: string;
}

// ── Graph edge tuples ─────────────────────────────────────────────────────

/** (sourceFile, targetFile) */
export type FileEdge = [string, string];

/** (callerFile, calledSymbol, definingFile) */
export type CallEdge = [string, string, string];

/** (callerFile, callerQname, calleeFile, calleeQname) */
export type ResolvedCallEdge = [string, string, string, string];

/** (childClass, parentClass) */
export type InheritanceEdge = [string, string];
