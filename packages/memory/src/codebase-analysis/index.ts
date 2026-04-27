/**
 * Codebase-analysis subsystem — public API barrel.
 *
 * Core (pure, no I/O):
 *   types, codebase-parser, codebase-extractors, codebase-graph,
 *   codebase-type-resolver, schema-extraction, schema-engine
 *
 * AST (tree-sitter, graceful fallback):
 *   ast-parser, ast-extractors, ast-extractors-extra
 *
 * Infrastructure (filesystem):
 *   scanner, scanner-parse
 *
 * Handlers (MCP tools):
 *   handlers/codebase-analyze
 *   handlers/ingest-codebase
 *   handlers/ingest-prd
 */

export * from "./types.js";
export * from "./codebase-parser.js";
export * from "./codebase-extractors.js";
export * from "./codebase-graph.js";
export * from "./codebase-type-resolver.js";
export * from "./schema-extraction.js";
export * from "./schema-engine.js";
export * from "./ast-extractors.js";
export * from "./ast-extractors-extra.js";
// Named re-export: excludes `nodeText` which is already exported via ast-extractors.js
// to prevent TS2308 duplicate-export ambiguity in barrel re-export chains.
export { isAvailable, parseFileAst } from "./ast-parser.js";
export * from "./scanner-parse.js";
export * from "./scanner.js";
