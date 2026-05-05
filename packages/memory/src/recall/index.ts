/**
 * Public exports for @agentic/memory/recall
 */

export { computeBm25Scores, computeNgramScore, tokenize, tokenizeRaw } from "./bm25.js";
export { applyCoActivation } from "./co-activation.js";
export {
  applyHeatDecay,
  computeRecencyBoost,
  computeSessionCoherence,
  ebbinghausRetention,
} from "./heat.js";
export {
  applyStrategicOrdering,
  buildRecallResult,
  computeTextSignals,
  extractHeatSignal,
  fuseSignals,
} from "./multi-signal-fusion.js";
export type { EmbeddingEngine, MemoryStore } from "./port.js";
export { classifyQueryIntent, computeRetrievalWeights } from "./query-intent.js";
export {
  DEFAULT_RECALL_SETTINGS,
  recallHandler,
} from "./recall-handler.js";
export {
  computeLevelWeights,
  recallHierarchicalHandler,
} from "./recall-hierarchical-handler.js";
export {
  drillDownHandler,
  type DrillDownDeps,
  type DrillDownArgs,
  type DrillDownResponse,
  type DrillDownLeafChild,
  type DrillDownClusterChild,
} from "./fractal-drill-down.js";
export { applyRules } from "./rules.js";
export { DEFAULT_RRF_K, rrfFuseIds, rrfFuseScorePairs, rrfFuseSignals } from "./rrf.js";
export * from "./types.js";
export { cosineSimilarity, dot, norm, normalize } from "./vector-similarity.js";

// ── Exact-portage Eng-3 ────────────────────────────────────────────────────
export { computeKeywordOverlap } from "./scoring.js";
export { computeRetrievalConfidence, computeAdaptiveAlpha, blendScores, rerankResults, rerankWithScores } from "./reranker.js";
export type { FlashRankAdapter, RerankPassage, RerankScore } from "./reranker.js";
export {
  hopfieldComplete, hdcRerank, spreadingActivationExpand, dendriticModulate,
  emotionalRetrievalRerank, moodCongruentRerank, reconsolidationApply,
  RRF_K, HOPFIELD_BETA, HDC_BETA, SA_BETA, DENDRITIC_DELTA,
  EMOTIONAL_RETRIEVAL_BETA, MOOD_CONGRUENT_BETA, EMOTIONAL_QUERY_VALENCE_FLOOR,
} from "./recall-pipeline.js";
export type {
  Candidate, RecallStore, HopfieldEngine, HdcEngine, ExtractQueryEntities,
  VaderCompoundFn, ComputeReconsolidationFn, ReconsolidationAction,
} from "./recall-pipeline.js";
export { computePgWeights, BASE_PG_WEIGHTS, PG_INTENT_OVERRIDES } from "./pg-recall-weights.js";
export { chronologicalRerank, recall as pgRecall } from "./pg-recall.js";
export type { PgRecallStore, EmbeddingsEngine, IntentInfo, RecallDependencies, RecallOptions } from "./pg-recall.js";
export { classifyTier, wrrfFuse, computeSignalWeights, mergeMultihopResults, dispatchRetrieval } from "./retrieval-dispatch.js";
export type { DispatchRetrievalOpts } from "./retrieval-dispatch.js";
export { computeHopfieldHdc, computeGraphSignals } from "./retrieval-signals.js";
export type { SignalStore, RetrievalSettings } from "./retrieval-signals.js";
export {
  orthogonalizePair, computeRetrievalSuppression, computeDomainInterferencePressure,
  detectProactiveInterference, detectRetroactiveInterference,
  ORTHOGONALIZATION_RATE, MIN_ORTHOGONAL_SIMILARITY, RETRIEVAL_SUPPRESSION,
  INTERFERENCE_THRESHOLD, CONTEXT_DISCOUNT, CRITICAL_INTERFERENCE,
} from "./interference.js";
export type { DomainInterferencePressure, InterferenceDescriptor, RetroactiveRisk, MemoryForInterference } from "./interference.js";
