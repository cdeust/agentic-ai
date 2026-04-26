/**
 * @agentic/memory — Cortex memory subsystem.
 *
 * Entry point for the memory package.
 * Hooks subsystem is available via the "hooks" export path.
 */
export * from "./hooks/index.js";
 * @agentic/memory — public API surface
 * Re-exports all shared primitives, types, and utilities ported from
 * the Cortex Python mcp_server. Every other Phase-4 cortex port imports
 * from this package rather than from Python source.
// ── Errors ───────────────────────────────────────────────────────────────────
export {
  MethodologyError,
  ValidationError,
  StorageError,
  AnalysisError,
  McpConnectionError,
} from "./shared/errors.js";
// ── Core types (types.ts) ─────────────────────────────────────────────────────
  ConversationMetaSchema,
  MemoryMetaSchema,
  GraphNodeSchema,
  GraphEdgeSchema,
  GraphDataSchema,
  TopSignalSchema,
  BehavioralFeatureSchema,
  SparseActivationSchema,
  AttributionNodeSchema,
  AttributionEdgeSchema,
  AttributionGraphSchema,
  PersonaVectorSchema,
  PersistentFeatureSchema,
  FeatureDictionarySchema,
  type ConversationMeta,
  type MemoryMeta,
  type GraphNode,
  type GraphEdge,
  type GraphData,
  type TopSignal,
  type BehavioralFeature,
  type SparseActivation,
  type AttributionNode,
  type AttributionEdge,
  type AttributionGraph,
  type PersonaVector,
  type PersistentFeature,
  type FeatureDictionary,
} from "./shared/types.js";
// ── Profile types (types-profiles.ts) ────────────────────────────────────────
  EntryPointSchema,
  RecurringPatternSchema,
  ToolPreferenceSchema,
  SessionShapeSchema,
  CognitiveStyleSchema,
  GlobalStyleSchema,
  BridgeSchema,
  BlindSpotSchema,
  DetectionContextSchema,
  AlternativeDomainSchema,
  DetectionResultSchema,
  DomainProfileSchema,
  ProfilesV2Schema,
  SessionLogEntrySchema,
  SessionLogSchema,
  type EntryPoint,
  type RecurringPattern,
  type ToolPreference,
  type SessionShape,
  type CognitiveStyle,
  type GlobalStyle,
  type Bridge,
  type BlindSpot,
  type DetectionContext,
  type AlternativeDomain,
  type DetectionResult,
  type DomainProfile,
  type ProfilesV2,
  type SessionLogEntry,
  type SessionLog,
} from "./shared/types-profiles.js";
// ── Memory types (memory-types.ts) ───────────────────────────────────────────
  MemorySchema,
  EntitySchema,
  RelationshipSchema,
  ProspectiveTriggerSchema,
  CheckpointSchema,
  MemoryArchiveSchema,
  ConsolidationLogSchema,
  MemoryStatsSchema,
  RecallResultSchema,
  type Memory,
  type Entity,
  type Relationship,
  type ProspectiveTrigger,
  type Checkpoint,
  type MemoryArchive,
  type ConsolidationLog,
  type MemoryStats,
  type RecallResult,
} from "./shared/memory-types.js";
// ── Wiki IR types (wiki-ir.ts) ────────────────────────────────────────────────
  ClaimTypeSchema,
  EvidenceRefSchema,
  ClaimEventSchema,
  ConceptStatusSchema,
  AxialSlotsSchema,
  ConceptSchema,
  DraftStatusSchema,
  SectionSchema,
  ProvenanceSchema,
  DraftPageSchema,
  PageStatusSchema,
  LifecycleStateSchema,
  ApprovedPageSchema,
  MemoSubjectSchema,
  CurationMemoSchema,
  type ClaimType,
  type EvidenceRef,
  type ClaimEvent,
  type ConceptStatus,
  type AxialSlots,
  type Concept,
  type DraftStatus,
  type Section,
  type Provenance,
  type DraftPage,
  type PageStatus,
  type LifecycleState,
  type ApprovedPage,
  type MemoSubject,
  type CurationMemo,
} from "./shared/wiki-ir.js";
// ── Hash ─────────────────────────────────────────────────────────────────────
export { simpleHash } from "./shared/hash.js";
// ── Similarity ───────────────────────────────────────────────────────────────
export { jaccardSimilarity } from "./shared/similarity.js";
// ── Linear algebra ───────────────────────────────────────────────────────────
  dot,
  norm,
  normalize,
  cosineSimilarity,
  add,
  subtract,
  scale,
  project,
  clamp,
  zeros,
} from "./shared/linear-algebra.js";
// ── Sparse vectors ───────────────────────────────────────────────────────────
  sparseDot,
  sparseNorm,
  sparseAdd,
  sparseScale,
  sparseTopK,
  sparseCosine,
  denseToSparse,
  sparseToDense,
  type SparseVector,
} from "./shared/sparse.js";
// ── Text / keywords ──────────────────────────────────────────────────────────
  TECHNICAL_SHORT_TERMS,
  STOPWORDS,
  extractKeywords,
  extractKeywordsArray,
} from "./shared/text.js";
// ── VADER sentiment ──────────────────────────────────────────────────────────
export { vaderCompound, vaderScores, type VaderScores } from "./shared/vader.js";
// ── Categorizer ──────────────────────────────────────────────────────────────
  categorize,
  categorizeWithScores,
  type WorkCategory,
} from "./shared/categorizer.js";
// ── Content hardening ─────────────────────────────────────────────────────────
export { hardenContent, CONTENT_MAX_BYTES } from "./shared/content-hardening.js";
// ── Entity canonicalization ───────────────────────────────────────────────────
export { canonicalizeEntityName } from "./shared/entity-canonical.js";
// ── Project IDs ───────────────────────────────────────────────────────────────
export { cwdToProjectId, projectIdToLabel, domainIdFromLabel } from "./shared/project-ids.js";
// ── YAML frontmatter parser ───────────────────────────────────────────────────
  parseYamlFrontmatter,
  type FrontmatterResult,
} from "./shared/yaml-parser.js";
// ── Domain mapping ────────────────────────────────────────────────────────────
  resolveDomain,
  resolveCwd,
  resetRegistry,
  type RepoInfo,
} from "./shared/domain-mapping.js";
// ── Error handler ─────────────────────────────────────────────────────────────
export { safeHandler, type HandlerFn } from "./shared/error-handler.js";
// ── Observability / metrics ───────────────────────────────────────────────────
  incCounter,
  setGauge,
  observeHistogram,
  Timer,
  render as renderMetrics,
  reset as resetMetrics,
} from "./shared/observability/metrics.js";
// ── Validation schemas ────────────────────────────────────────────────────────
export { validateToolArgs } from "./shared/validation/schemas.js";
 * @agentic/memory — root package export.
 * Re-exports the remember module. Other modules (recall, consolidation)
 * will be added as their worktrees merge.
export * from "./remember/index.js";
 * @agentic/memory — Cortex memory subsystem
 * Consolidation subsystem public API.
export * from "./consolidation/index.js";
 * @agentic/memory — memory package public surface.
export * from "./graph/index.js";
 * Memory package root — re-exports methodology subsystem.
export * from "./methodology/index.js";
 * @agentic/memory — public API.
 * Narrative subsystem: session extraction + narrative arc construction.
// Types
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
} from "./narrative/types.js";
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
// Session extractor
  classifyMessage,
  extractMemorableItems,
  extractSessionSummary,
  extractText,
  extractUserMessages,
  scoreImportance,
} from "./narrative/session-extractor.js";
// Narrative builder
  arcFunctionSequence,
  detectArc,
  extractDecisions,
  extractEvents,
  extractHotTopics,
  extractTopEntities,
  generateBriefSummary,
  generateNarrative,
} from "./narrative/narrative-builder.js";
// Handler
export type { MemoryPort } from "./narrative/handlers/narrative.js";
export { narrativeHandler } from "./narrative/handlers/narrative.js";
