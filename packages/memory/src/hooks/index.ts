/**
 * Cortex hooks — public API.
 *
 * Exports the processEvent function of each hook for use in tests
 * and integration. The main() functions are entry-points for standalone
 * Node invocation (via runner.ts or directly).
 */

export * from "./types.js";

export { processEvent as sessionStartProcess } from "./session-start.js";
export { processEvent as autoRecallProcess } from "./auto-recall.js";
export { processEvent as postToolCaptureProcess } from "./post-tool-capture.js";
export { processEvent as agentBriefingProcess } from "./agent-briefing.js";
export { processEvent as compactionCheckpointProcess } from "./compaction-checkpoint.js";
export { processEvent as sessionLifecycleProcess } from "./session-lifecycle.js";
export { processEvent as preemptiveContextProcess } from "./preemptive-context.js";
export { processEvent as pipelineImpactBumpProcess } from "./pipeline-impact-bump.js";
