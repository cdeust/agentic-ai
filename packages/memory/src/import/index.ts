/**
 * Public surface of the import subsystem.
 *
 * Exports the handler, schema, and all types needed by callers.
 * Internal utilities (scanner, session-extractor, heat, domain-detector)
 * are also re-exported for test access.
 *
 * source: mcp_server/handlers/import_sessions.py — handler, schema
 */

export { importHandler, schema } from "./handler.js";

export {
  extractMemorableItems,
  extractSessionSummary,
  extractUserMessages,
  classifyMessage,
  scoreImportance,
} from "./session-extractor.js";

export { readHeadTail, discoverJsonlFiles } from "./scanner.js";
export type { JsonlFileEntry } from "./scanner.js";

export { ageDecayedHeat, computeAgeDays } from "./heat.js";
export { detectDomainFromPath } from "./domain-detector.js";

export type {
  ImportRequest,
  ImportResponse,
  PreviewItem,
  ExtractedItem,
  SessionSummary,
  JsonlRecord,
  MessageBlock,
  RememberHandler,
  RememberArgs,
  RememberResult,
} from "./types.js";

export { ImportRequestSchema, ImportResponseSchema } from "./types.js";
