/**
 * @agentic/memory/shared — public API of the foundation package.
 *
 * Every other Phase-4 cortex module imports primitives from here.
 * Source-of-truth: cortex-shared worktree (commit d10ad8b).
 */

// ── Errors ───────────────────────────────────────────────────────────────────
export {
  MethodologyError,
  ValidationError,
  StorageError,
  AnalysisError,
  McpConnectionError,
} from "./errors.js";

// ── Core types (types.ts) ────────────────────────────────────────────────────
export {
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
} from "./types.js";

// ── Profile types ────────────────────────────────────────────────────────────
export {
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
} from "./types-profiles.js";

// ── Memory types ─────────────────────────────────────────────────────────────
export {
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
} from "./memory-types.js";

// ── Wiki IR types ────────────────────────────────────────────────────────────
export {
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
} from "./wiki-ir.js";

// ── Hash + similarity + linear algebra + sparse + text + vader + categorize ──
export { simpleHash } from "./hash.js";
export { jaccardSimilarity } from "./similarity.js";
export {
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
} from "./linear-algebra.js";
export {
  sparseDot,
  sparseNorm,
  sparseAdd,
  sparseScale,
  sparseTopK,
  sparseCosine,
  denseToSparse,
  sparseToDense,
  type SparseVector,
} from "./sparse.js";
export {
  TECHNICAL_SHORT_TERMS,
  STOPWORDS,
  extractKeywords,
  extractKeywordsArray,
} from "./text.js";
export { vaderCompound, vaderScores, type VaderScores } from "./vader.js";
export {
  categorize,
  categorizeWithScores,
  type WorkCategory,
} from "./categorizer.js";

// ── Hardening + entity canonical + project ids + yaml + domain + handler ─────
export { hardenContent, CONTENT_MAX_BYTES } from "./content-hardening.js";
export { canonicalizeEntityName } from "./entity-canonical.js";
export {
  cwdToProjectId,
  projectIdToLabel,
  domainIdFromLabel,
} from "./project-ids.js";
export {
  parseYamlFrontmatter,
  type FrontmatterResult,
} from "./yaml-parser.js";
export {
  resolveDomain,
  resolveCwd,
  resetRegistry,
  type RepoInfo,
} from "./domain-mapping.js";
export { safeHandler, type HandlerFn } from "./error-handler.js";

// ── Observability + validation ───────────────────────────────────────────────
export {
  incCounter,
  setGauge,
  observeHistogram,
  Timer,
  render as renderMetrics,
  reset as resetMetrics,
} from "./observability/metrics.js";
export { validateToolArgs } from "./validation/schemas.js";
