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

// ── Eng-3 ports (recall core) ─────────────────────────────────────────────
export {
  computeBm25Scores as computeBm25ScoresCore,
  computeNgramScore as computeNgramScoreCore,
  computeKeywordOverlap,
  tokenize as tokenizeCore,
  tokenizeRaw as tokenizeRawCore,
} from "./scoring.js";
export {
  classifyTier,
  computeSignalWeights,
  dispatchRetrieval,
  mergeMultihopResults,
  wrfFuse,
} from "./retrieval-dispatch.js";
export {
  computeHopfieldHdc,
  computeGraphSignals,
  type RetrievalSignalSettings,
  type ExtendedMemoryStore,
} from "./retrieval-signals.js";
export {
  rerankResults,
  getRawCeScore,
} from "./reranker.js";
export {
  orthogonalizePair,
  computeRetrievalSuppression,
  computeDomainInterferencePressure,
  detectProactiveInterference,
  detectRetroactiveInterference,
  ORTHOGONALIZATION_RATE,
  MIN_ORTHOGONAL_SIMILARITY,
  RETRIEVAL_SUPPRESSION,
  INTERFERENCE_THRESHOLD,
  CONTEXT_DISCOUNT,
  CRITICAL_INTERFERENCE,
  type InterferenceDescriptor,
  type RetroactiveDescriptor,
} from "./interference.js";
export {
  rrfBlend,
  hopfieldComplete,
  hdcRerank,
  spreadingActivationExpand,
  dendriticModulate,
  RRF_K,
  HOPFIELD_BETA,
  HDC_BETA,
  SA_BETA,
  DENDRITIC_DELTA,
  type Candidate,
  type CandidateStore,
} from "./recall-pipeline-stages.js";
export {
  emotionalRetrievalRerank,
  moodCongruentRerank,
  reconsolidationApply,
  registerVaderProvider,
  EMOTIONAL_RETRIEVAL_BETA,
  MOOD_CONGRUENT_BETA,
  EMOTIONAL_QUERY_VALENCE_FLOOR,
  type VaderProvider,
  type ReconsolidationStore,
} from "./recall-pipeline.js";
export {
  computePgWeights,
  chronologicalRerank,
  type ChronoCandidate,
} from "./pg-recall-weights.js";
export {
  recall as pgRecall,
  type PgStore,
  type PgRecallMemoriesParams,
  type RecallOptions,
} from "./pg-recall.js";
