/**
 * Wiki subsystem -- public barrel export.
 *
 * source: mcp_server/core/wiki_*.py + mcp_server/handlers/wiki_*.py (Cortex ed33435)
 */

// Types
export * from "./types.js";

// Core layout + path computation
export * from "./layout.js";

// Page rendering + frontmatter
export * from "./pages.js";

// Templates
export * from "./templates.js";

// Rule engine
export * from "./rule-engine.js";

// Schema loader
export * from "./schema-loader.js";

// Classifier
export * from "./page-classifier.js";

// Links
export * from "./links.js";

// Staleness
export * from "./staleness.js";

// Symbol extraction + verification
export * from "./symbol-extract.js";
export * from "./symbol-verify.js";

// Wiki groomer (drift detection -- pure, no I/O)
// source: mcp_server/core/wiki_groomer.py (Cortex ed33435)
export * from "./groomer.js";

// Thermodynamics (heat decay + lifecycle -- pure, no I/O).
// Named re-exports to avoid collision with pg-wiki-store-pages.HeatDecision.
// source: mcp_server/core/wiki_thermodynamics.py (Cortex ed33435)
export {
  HALF_LIFE_DAYS,
  ACTIVE_TO_AREA_HEAT,
  ACTIVE_TO_AREA_IDLE_DAYS,
  AREA_TO_ARCHIVED_HEAT,
  AREA_TO_ARCHIVED_IDLE_DAYS,
  ARCHIVED_REVIVAL_HEAT,
  HEAT_FLOOR,
  transitionLifecycle,
  summarise as thermoSummarise,
  evaluatePage as thermoEvaluatePage,
} from "./thermodynamics.js";
export type {
  HeatDecision as WikiThermoHeatDecision,
  ThermoStats,
} from "./thermodynamics.js";

// View DSL executor (cortex-query -> parameterised SQL -- pure, no I/O)
// source: mcp_server/core/wiki_view_executor.py (Cortex ed33435)
export * from "./view-executor.js";

// Sync (memory -> wiki page promotion decision -- pure, no I/O)
// source: mcp_server/core/wiki_sync.py (Cortex ed33435)
export * from "./sync.js";

// Plain-language README generator (pure, no I/O)
// source: mcp_server/core/wiki_readme.py (Cortex ed33435)
export * from "./readme.js";

// Claim extraction + resolution
export * from "./claim-extractor.js";
export * from "./claim-resolver.js";

// Concept emergence (Strauss grounded theory)
export * from "./concept-emerger.js";
export * from "./concept-vocabulary.js";

// Enrichment
export * from "./enrichment.js";

// Handlers (fully ported)
export * as wikiWrite from "./handlers/wiki-write.js";
export * as wikiRead from "./handlers/wiki-read.js";
export * as wikiList from "./handlers/wiki-list.js";
export * as wikiAdr from "./handlers/wiki-adr.js";
export * as wikiLink from "./handlers/wiki-link.js";
export * as wikiReindex from "./handlers/wiki-reindex.js";
export * as wikiPurge from "./handlers/wiki-purge.js";
export * as wikiVerify from "./handlers/wiki-verify.js";
export * as wikiView from "./handlers/wiki-view.js";

// Handlers (real implementations)
export * from "./handlers/wiki-errors.js";
export * from "./handlers/wiki-handlers.js";

// Draft synthesizer (pure logic, no I/O)
export * from "./draft-synthesizer.js";

// Storage adapters
export * from "./storage/wiki-store.js";
export * from "./storage/pg-wiki-store-pages.js";
export * from "./storage/pg-wiki-store-concepts.js";
