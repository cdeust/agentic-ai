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

// ── Handler public API (deps types + handlers) ──────────────────────────────
// Phase 7 Group E: composition-root DI wiring types. Exported here so the
// MCP composition root (packages/mcp-servers/memory) can import them via the
// @agentic/memory namespace without deep path imports.
export {
  type McpClientPool,
  CODE_GRAPH_TAG_PREFIX,
  projectKey,
  codeGraphTag,
  findCachedGraph,
  memoiseGraphPath,
  callUpstream,
  normaliseMcpPayload,
  McpConnectionError,
} from "./handlers/ingest-helpers.js";
export {
  handler as codebaseAnalyzeHandler,
  type CodebaseAnalyzeDeps,
  schema as codebaseAnalyzeSchema,
} from "./handlers/codebase-analyze.js";
export {
  handler as ingestCodebaseHandler,
  type IngestCodebaseDeps,
  schema as ingestCodebaseSchema,
} from "./handlers/ingest-codebase.js";
export {
  handler as ingestPrdHandler,
  type IngestPrdDeps,
  schema as ingestPrdSchema,
} from "./handlers/ingest-prd.js";
export {
  handler as seedProjectHandler,
  type SeedProjectDeps,
  type SeedProjectArgs,
  type SeedProjectResponse,
  schema as seedProjectSchema,
} from "./handlers/seed-project.js";
export {
  changeImpactHandler,
  type ChangeImpactDeps,
  type ChangeImpactArgs,
  type ChangeImpactResponse,
  type ImpactMatchResult,
  schema as changeImpactSchema,
} from "./handlers/change-impact.js";
export {
  collectAllDiscoveries,
  stageConfigs,
  stageDocs,
  stageEntryPoints,
  stageCicd,
  stageStructuralSummary,
  heatForTags,
  HEAT_BY_TYPE,
  type Discovery,
} from "./file-scanner.js";
