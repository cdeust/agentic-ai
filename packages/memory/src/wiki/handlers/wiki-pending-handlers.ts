/**
 * Wiki sub-handler re-exports — all 10 handlers are now real implementations.
 *
 * This file is the public API surface for the 10 handlers that previously
 * threw WikiUnavailableError. It re-exports both the handler functions and
 * their argument/result types from the individual handler files.
 *
 * source: mcp_server/handlers/wiki_emerge.py     (Cortex ed33435)
 * source: mcp_server/handlers/wiki_extract.py    (Cortex ed33435)
 * source: mcp_server/handlers/wiki_curate.py     (Cortex ed33435)
 * source: mcp_server/handlers/wiki_consolidate.py (Cortex ed33435)
 * source: mcp_server/handlers/wiki_resolve.py    (Cortex ed33435)
 * source: mcp_server/handlers/wiki_seed_codebase.py (Cortex ed33435)
 * source: mcp_server/handlers/wiki_export.py     (Cortex ed33435)
 * source: mcp_server/handlers/wiki_compile.py    (Cortex ed33435)
 * source: mcp_server/handlers/wiki_migrate.py    (Cortex ed33435)
 * source: mcp_server/handlers/wiki_api.py        (Cortex ed33435)
 */

export {
  wikiEmergeHandler,
  type WikiEmergeArgs,
  type WikiEmergeResult,
} from "./wiki-emerge-handler.js";

export {
  wikiExtractHandler,
  type WikiExtractArgs,
  type WikiExtractResult,
} from "./wiki-extract-handler.js";

export {
  wikiCurateHandler,
  type WikiCurateArgs,
  type WikiCurateResult,
} from "./wiki-curate-handler.js";

export {
  wikiConsolidateHandler,
  type WikiConsolidateArgs,
  type WikiConsolidateResult,
} from "./wiki-consolidate-handler.js";

export {
  wikiResolveHandler,
  type WikiResolveArgs,
  type WikiResolveResult,
} from "./wiki-resolve-handler.js";

export {
  wikiSeedCodebaseHandler,
  type WikiSeedCodebaseArgs,
  type WikiSeedCodebaseResult,
  type SeedImportPayload,
} from "./wiki-seed-codebase-handler.js";

export {
  wikiExportHandler,
  type WikiExportArgs,
  type WikiExportResult,
} from "./wiki-export-handler.js";

export {
  wikiCompileHandler,
  type WikiCompileArgs,
  type WikiCompileResult,
} from "./wiki-compile-handler.js";

export {
  wikiMigrateHandler,
  type WikiMigrateArgs,
  type WikiMigrateResult,
} from "./wiki-migrate-handler.js";

export {
  wikiApiHandler,
  type WikiApiArgs,
  type WikiApiResult,
} from "./wiki-api-handler.js";
