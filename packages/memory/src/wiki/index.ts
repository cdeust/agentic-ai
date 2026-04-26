/**
 * Wiki subsystem — public barrel export.
 *
 * Propp grammar for the wiki page lifecycle:
 *   Create (write/adr) → Refine (refine/synthesize) → Link (link) →
 *   Verify (verify) → Consolidate (consolidate) → Retire (purge/consolidate)
 *
 * Actors (user, LLM, daemon) are interchangeable; the function is primary.
 * The grammar makes gaps visible: a page that skips Verify is structurally
 * different from one that skips Refine.
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

// Handlers (stubs — LLM-pass-heavy)
export * from "./handlers/wiki-stubs.js";

// Storage adapters
export * from "./storage/wiki-store.js";
export * from "./storage/pg-wiki-store-pages.js";
export * from "./storage/pg-wiki-store-concepts.js";
