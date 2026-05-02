/**
 * index.ts — Public surface of the remember module.
 *
 * Exports everything the rest of the monorepo needs:
 *   - Types (Zod schemas + inferred types)
 *   - Pure functions (predictive coding, write gate, calibration, abstention)
 *   - Handlers (remember, anchor, forget, rate-memory, remember-global)
 *   - MemoryStore interface + storage adapters
 *   - Ingest utilities
 *   - Post-store side effects
 */

// ── Types ──────────────────────────────────────────────────────────────────
export {
  CalibrationStateSchema,
  ConsolidationStageSchema,
  MemoryInsertDataSchema,
  MemoryItemSchema,
  RememberRequestSchema,
  RememberResponseSchema,
  WriteGateScoreSchema,
  AbstentionDecisionSchema,
} from "./types.js";
export type {
  CalibrationState,
  ConsolidationStage,
  MemoryInsertData,
  MemoryItem,
  RememberRequest,
  RememberResponse,
  WriteGateScore,
  AbstentionDecision,
} from "./types.js";

// ── Predictive coding (pure) ───────────────────────────────────────────────
export {
  computeEmbeddingNovelty,
  computeEntityNovelty,
  computeTemporalNovelty,
  computeStructuralNovelty,
  computeNoveltyScore,
  describeSignals,
  gateDecision,
  computeSensoryErrors,
  computeSensoryPrediction,
  computeEntityErrors,
  computeSchemaErrors,
  hierarchicalGateDecision,
  updatePrecision,
  precisionToConfidence,
  makePrecisionState,
} from "./predictive-coding.js";
export type {
  PredictionLevel,
  HierarchicalPrediction,
  PrecisionState,
} from "./predictive-coding.js";

// ── Write gate (pure) ──────────────────────────────────────────────────────
export {
  determineBypass,
  estimateImportance,
  parseHoursSince,
  scoreCandidate,
  buildRejectionResponse,
} from "./write-gate.js";
export type { WriteGateInput } from "./write-gate.js";

// ── Write gate calibration (pure + process-local state) ──────────────────
export {
  updateAcceptanceEma,
  computeThresholdAdjustment,
  observeGateDecision,
  getState as getCalibrationState,
  record as recordCalibration,
  resetAllStates,
  effectiveThreshold,
  TARGET_ACCEPTANCE_RATE,
  EMA_DECAY,
  ADJUSTMENT_STEP,
  TOLERANCE_BAND,
  MIN_THRESHOLD,
  MAX_THRESHOLD,
  MIN_SAMPLES_BEFORE_ADJUST,
} from "./write-gate-calibration.js";

// ── Abstention gate (pure + optional model) ──────────────────────────────
export {
  filterByAbstention,
  shouldAbstain,
  injectClassifier,
  resetClassifier,
  DEFAULT_THRESHOLD as ABSTENTION_DEFAULT_THRESHOLD,
} from "./abstention-gate.js";
export type { AbstentionClassifier } from "./abstention-gate.js";

// ── Memory ingest ─────────────────────────────────────────────────────────
export { ingestMemory, ingestMemoriesBatch, buildEntitySummary } from "./memory-ingest.js";
export type {
  IngestMemoryInput,
  IngestOptions,
} from "./memory-ingest.js";
// EmbeddingEngine is now the canonical port from @agentic/core.
export type { EmbeddingEngine } from "@agentic/core";

// ── Post-store ────────────────────────────────────────────────────────────
export { postStore } from "./post-store.js";
export type { PostStoreOptions, PostStoreResult } from "./post-store.js";

// ── Storage interface ─────────────────────────────────────────────────────
export type {
  MemoryStore,
  EntityRecord,
  RelationshipRecord,
  VecHit,
  HeatUpdate,
} from "./storage/memory-store.js";

// ── Storage adapters ──────────────────────────────────────────────────────
export { SqliteMemoryStore } from "./storage/sqlite-store.js";
export { PgMemoryStore } from "./storage/pg-store.js";

// ── Handlers ──────────────────────────────────────────────────────────────
export { remember } from "./handlers/remember.js";
export type { } from "./handlers/remember.js";

export { rememberGlobal } from "./handlers/remember-global.js";
export type { RememberGlobalRequest } from "./handlers/remember-global.js";

export { anchor } from "./handlers/anchor.js";
export type { AnchorRequest, AnchorResponse } from "./handlers/anchor.js";

export { forget } from "./handlers/forget.js";
export type { ForgetRequest, ForgetResponse } from "./handlers/forget.js";

export { rateMemory } from "./handlers/rate-memory.js";
export type {
  RateMemoryRequest,
  RateMemoryResponse,
} from "./handlers/rate-memory.js";
