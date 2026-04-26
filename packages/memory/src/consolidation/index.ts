/**
 * Consolidation subsystem — public API barrel.
 *
 * Re-exports all public interfaces from the consolidation module.
 */

// Algorithmic core
export * from "./cascade-stages.js";
export * from "./thermodynamics.js";
export * from "./decay-cycle.js";
export * from "./homeostatic-plasticity.js";
export * from "./reconsolidation.js";
export * from "./oscillatory-clock.js";
export * from "./two-stage-model.js";
export * from "./replay.js";
export * from "./microglial-pruning.js";
export * from "./neurogenesis.js";

// Handler
export { handler, schema } from "./handler.js";
export type { ConsolidateArgs, ConsolidationResult } from "./handler.js";

// Stages
export { runDecayCycle } from "./stages/decay.js";
export { runClsCycle } from "./stages/cls.js";
export { runCompressionCycle } from "./stages/compression.js";
export { runHomeostaticCycle } from "./stages/homeostatic.js";
export { runCascadeAdvancement } from "./stages/cascade.js";
export { runPruningCycle } from "./stages/pruning.js";
export { runPlasticityCycle } from "./stages/plasticity.js";
export { runMemifyCycle } from "./stages/memify.js";
export { runDeepSleep } from "./stages/sleep.js";
export { runTwoStageTransfer } from "./stages/transfer.js";
