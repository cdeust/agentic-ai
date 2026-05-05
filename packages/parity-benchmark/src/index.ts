/**
 * @agentic/parity-benchmark — public exports.
 *
 * End-to-end benchmark parity harness. Drives the same datasets the source
 * repos use and asserts the TS port reproduces their published scores within
 * the documented tolerance.
 */

export { scoreResults, type BenchmarkScores, type CategoryScores, type QuestionResult } from "./scoring.js";
export {
  CATEGORY_NAMES,
  extractSessions,
  findLocomoDataset,
  loadLocomo,
  parseEvidenceRefs,
  type LocomoConversation,
  type LocomoQA,
  type LocomoSession,
  type LocomoTurn,
} from "./locomo-loader.js";
export { runLocomo, type RunOptions } from "./locomo-runner.js";
export { loadCortexBaseline, type CortexBaseline, type BaselineCategoryMetrics } from "./baselines.js";
export { buildParityReport, renderReport, type ParityReport, type MetricDelta } from "./report.js";
