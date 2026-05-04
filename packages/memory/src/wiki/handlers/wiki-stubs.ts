/**
 * Compatibility re-export shim — wiki-stubs.ts → wiki-handlers.ts.
 *
 * CRIT-B fix (Phase 7 Group C): wikiSynthesizeHandler and wikiPipelineHandler
 * are now real implementations in wiki-handlers.ts.  This file is kept as a
 * thin re-export so that existing callers importing from "wiki-stubs.js" do
 * not break during the transition.
 *
 * The canonical source is wiki-handlers.ts.
 */

export * from "./wiki-handlers.js";
