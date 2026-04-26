/**
 * @agentic/memory/narrative — public API of the narrative subsystem.
 * Source-of-truth: cortex-narrative worktree (commit ac75d24).
 */

export type {
  MemorableItem,
  MemoryRecord,
  NarrativeArc,
  NarrativeFunction,
  NarrativeFunctionType,
  NarrativeRequest,
  NarrativeResponse,
  SessionEvent,
  SessionRecord,
  SessionSummary,
} from "./types.js";

export {
  MemorableItemSchema,
  MemoryRecordSchema,
  NarrativeArcSchema,
  NarrativeFunctionSchema,
  NarrativeFunctionTypeSchema,
  NarrativeRequestSchema,
  NarrativeResponseSchema,
  SessionEventSchema,
  SessionRecordSchema,
  SessionSummarySchema,
} from "./types.js";

export {
  classifyMessage,
  extractMemorableItems,
  extractSessionSummary,
  extractText,
  extractUserMessages,
  scoreImportance,
} from "./session-extractor.js";

export {
  arcFunctionSequence,
  detectArc,
  extractDecisions,
  extractEvents,
  extractHotTopics,
  extractTopEntities,
  generateBriefSummary,
  generateNarrative,
} from "./narrative-builder.js";

export type { MemoryPort } from "./handlers/narrative.js";
export { narrativeHandler } from "./handlers/narrative.js";
