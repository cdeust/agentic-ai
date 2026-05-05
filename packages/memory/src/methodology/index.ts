/**
 * Methodology subsystem — public API surface.
 *
 * Hierarchy of contexts (Bateson constraint — do not flatten):
 *   Level 1 (cognitive-profile.ts): what a profile update IS — pure EMA on vectors
 *   Level 2 (methodology-engine.ts): when/how updates accumulate — domain routing,
 *             bridge finding, blind spot detection, feature dictionaries
 *
 * Handlers are infrastructure-agnostic: they receive profiles as arguments.
 * The infrastructure layer (not in this module) loads/saves profiles.json.
 */

// Types
export type {
  CognitiveStyle,
  ConnectionBridge,
  BlindSpot,
  DomainDetectionResult,
  DomainContext,
  DomainProfile,
  FeatureActivation,
  FeatureDictionary,
  FiredTrigger,
  HotMemory,
  MethodologyQuery,
  MethodologyResponse,
  PersonaDim,
  PersonaNumericDim,
  PersonaVector,
  PersistentFeature,
  ProfilesStore,
  SessionData,
  SessionLog,
  SessionLogEntry,
  SessionShape,
  ToolPreferences,
  CritiqueResult,
  AttributionGraph,
} from "./types.js";

export {
  PERSONA_DIMENSIONS,
  PERSONA_NUMERIC_DIMENSIONS,
  PERSONA_CATEGORICAL_DIMENSIONS,
  PERSONA_VECTOR_DIM,
} from "./types.js";

// Linear algebra
export {
  dot, norm, normalize, cosineSimilarity,
  add, subtract, scale, zeros, project,
} from "./linear-algebra.js";

// Cognitive profile (Level 1)
export {
  applySessionUpdate,
  buildPersonaVector,
  composePersonas,
  personaDistance,
  personaDrift,
  personaToArray,
  updateStyleEma,
} from "./cognitive-profile.js";

// Domain detector
export { detectDomain, cwdToProjectId, mapProjectToDomain } from "./domain-detector.js";

// Methodology engine (Level 2)
export {
  detectBlindSpots,
  detectPersistentFeatures,
  compareFeatureProfiles,
  findBridges,
  generateContext,
} from "./methodology-engine.js";

// Attribution pipeline
export { traceAttribution, SIGNAL_NAMES, D } from "./attribution-pipeline.js";

// Blindspot detection (standalone modules)
export { detectBlindSpotsFull, ALL_CATEGORIES, COMMON_TOOLS, TOOL_CATEGORY_RELEVANCE } from "./blindspot-detector.js";
export type { ConversationRecord as BlindspotConversationRecord, WorkCategory } from "./blindspot-detector.js";
export { checkExplorationGap, countDurationBuckets, checkDurationGaps } from "./blindspot-patterns.js";

// Cognitive map (Successor Representation)
export {
  buildCoAccessGraph,
  buildTemporalCoAccess,
  computeSrScores,
  navigateFrom,
  projectTo2d,
} from "./cognitive-map.js";
export type { SrGraph, NavigationResult, MemoryWithAccess } from "./cognitive-map.js";

// Metacognition — gap detection
export {
  detectIsolatedEntities,
  detectStaleRegions,
  detectLowConfidence,
  detectMissingConnections,
  detectUnresolvedErrors,
  detectAllGaps,
} from "./metacognition.js";
export type { KnowledgeGap } from "./metacognition.js";

// Metacognition analysis — coverage + chunking + context management
export {
  computeCoverage,
  chunkMemories,
  manageContext,
  summarizeOverflow,
  DEFAULT_MAX_CHUNKS,
} from "./metacognition-analysis.js";
export type { CoverageResult, ChunkableMemory } from "./metacognition-analysis.js";

// Style classifier (Felder-Silverman full scoring)
export {
  classifyStyle,
  ABSTRACT_KEYWORDS,
  CONCRETE_KEYWORDS,
  PLANNING_KEYWORDS,
  TRIAL_KEYWORDS,
} from "./style-classifier.js";
export type { StyleConversationRecord } from "./style-classifier.js";

// Emergence tracker + metrics
export {
  computeSpacingBenefit,
  computeTestingBenefit,
  computeSchemaAccelerationMetric,
  computePhaseLockingBenefit,
} from "./emergence-tracker.js";
export type {
  MemoryEvent,
  TestingBenefitResult,
  SchemaAccelerationResult,
  PhaseLockingResult,
} from "./emergence-tracker.js";
export {
  computeForgettingCurve,
  generateEmergenceReport,
} from "./emergence-metrics.js";
export type { ForgettingCurveResult, EmergenceReport } from "./emergence-metrics.js";

// Profile assembler (Level-2 orchestration)
export { buildDomainProfiles } from "./profile-assembler.js";
export type { BuildDomainProfilesInput } from "./profile-assembler.js";

// Session critique
export { generateCritique } from "./session-critique.js";

// Handlers
export { queryMethodology } from "./handlers/query-methodology.js";
export { detectDomainHandler } from "./handlers/detect-domain.js";
export { updateProfiles, buildSessionLogEntry } from "./handlers/update-profiles.js";
export type { UpdateProfilesResult } from "./handlers/update-profiles.js";
export { rebuildProfiles, checkSkip } from "./handlers/rebuild-profiles.js";
export type { RebuildInput, RebuildResult, ConversationRecord } from "./handlers/rebuild-profiles.js";
export { exploreFeatures } from "./handlers/explore-features.js";
export type { ExploreMode } from "./handlers/explore-features.js";
