/**
 * @agentic/parity-runner — public API.
 *
 * runParityCorpus({ source, inputs, expectedDir }): ParityReport
 *
 * This is the single entry point that the scripts/parity-dual-run.sh
 * orchestrator calls via `node --import tsx/esm`.
 *
 * Popperian contract: the function returns a ParityReport with
 * exit_code 0 iff ALL fixtures match (or are shape_only / skipped).
 * A single divergence produces exit_code 1, falsifying the cutover claim.
 *
 * source: mission brief §1 — "src/index.ts — public API"
 * source: PHASE_PLAN.md §"Phase 6" — "48-hour dual-run with zero divergence"
 */

export type { ParityReport, SourceReport, FixtureResult, Divergence, DivergenceKind, FixtureOutcome, SourceId } from "./types.js";
export type { RunnerOptions } from "./types.js";
export { buildParityReport, buildSourceReport, printReport } from "./report.js";
export { compareWithMasking, diffFixture, checkShapeOnly } from "./diff.js";
export { generateProbes, PROBES_PER_FIXTURE } from "./adversarial.js";
export { runCortexParity } from "./runners/cortex.js";
export { runCodebaseParity } from "./runners/codebase.js";
export { runPrdParity } from "./runners/prd.js";

import { runCortexParity } from "./runners/cortex.js";
import { runCodebaseParity } from "./runners/codebase.js";
import { runPrdParity } from "./runners/prd.js";
import { buildParityReport } from "./report.js";
import type { ParityReport, RunnerOptions, SourceId } from "./types.js";

// ── runParityCorpus ───────────────────────────────────────────────────────────

export interface RunParityCorpusOptions {
  /**
   * Which source implementation to compare against.
   * Pass "all" to run all three runners (cortex + codebase + prd).
   */
  readonly source: SourceId | "all";
  /**
   * Root directory of the monorepo.
   * The runners resolve parity-oracle/ relative to this path.
   * Defaults to the process working directory.
   */
  readonly repoRoot?: string | undefined;
  /**
   * Passed through to RunnerOptions.strictExtraKeys.
   * Default: false.
   */
  readonly strictExtraKeys?: boolean | undefined;
  /**
   * When true, adversarial probes (5 per fixture) are generated and run.
   * Default: false.
   */
  readonly runAdversarialProbes?: boolean | undefined;
}

/**
 * Run the parity corpus for the specified source(s) and return a ParityReport.
 *
 * Usage:
 *   const report = await runParityCorpus({ source: "all", repoRoot: "/path/to/agentic-ai" });
 *   process.exit(report.exit_code);
 *
 * The report JSON can be piped to a file for archival:
 *   console.log(JSON.stringify(report, null, 2)); // stdout — structured output
 */
export async function runParityCorpus(
  opts: RunParityCorpusOptions,
): Promise<ParityReport> {
  const runnerOpts: RunnerOptions = {
    repoRoot: opts.repoRoot ?? process.cwd(),
    strictExtraKeys: opts.strictExtraKeys ?? false,
    runAdversarialProbes: opts.runAdversarialProbes ?? false,
  };

  const sources: SourceId[] =
    opts.source === "all" ? ["cortex", "codebase", "prd"] : [opts.source];

  const sourceReports = await Promise.all(
    sources.map((s) => {
      switch (s) {
        case "cortex":
          return runCortexParity(runnerOpts);
        case "codebase":
          return runCodebaseParity(runnerOpts);
        case "prd":
          return runPrdParity(runnerOpts);
      }
    }),
  );

  return buildParityReport(sourceReports);
}
