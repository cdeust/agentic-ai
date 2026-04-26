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
