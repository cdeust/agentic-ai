#!/usr/bin/env node
/**
 * @agentic/parity-runner — CLI entry point.
 *
 * Called by scripts/parity-dual-run.sh.
 *
 * Usage:
 *   node dist/cli.js --source all --repo-root /path/to/agentic-ai
 *   node dist/cli.js --source cortex --strict-extra-keys --adversarial-probes
 *
 * Outputs:
 *   stdout — JSON ParityReport
 *   stderr — human-readable summary lines
 *   exit   — 0 if all fixtures match; 1 if any divergence
 *
 * source: mission brief §2 — "scripts/parity-dual-run.sh orchestrator"
 */

import { runParityCorpus } from "./index.js";
import { printReport } from "./report.js";

// ── CLI argument parsing (no dependencies — stdlib only) ─────────────────────

function parseArgs(args: readonly string[]): {
  source: "all" | "cortex" | "codebase" | "prd";
  repoRoot: string;
  strictExtraKeys: boolean;
  runAdversarialProbes: boolean;
} {
  let source: "all" | "cortex" | "codebase" | "prd" = "all";
  let repoRoot = process.env["AGENTIC_REPO_ROOT"] ?? process.cwd();
  let strictExtraKeys = false;
  let runAdversarialProbes = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source" && args[i + 1] !== undefined) {
      const val = args[i + 1];
      if (val === "all" || val === "cortex" || val === "codebase" || val === "prd") {
        source = val;
      }
      i++;
    } else if (arg === "--repo-root" && args[i + 1] !== undefined) {
      repoRoot = args[i + 1] as string;
      i++;
    } else if (arg === "--strict-extra-keys") {
      strictExtraKeys = true;
    } else if (arg === "--adversarial-probes") {
      runAdversarialProbes = true;
    }
  }

  return { source, repoRoot, strictExtraKeys, runAdversarialProbes };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const report = await runParityCorpus({
    source: opts.source,
    repoRoot: opts.repoRoot,
    strictExtraKeys: opts.strictExtraKeys,
    runAdversarialProbes: opts.runAdversarialProbes,
  });

  // Human summary → stderr (stdout is the JSON channel).
  printReport(report);

  // JSON report → stdout.
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  process.exit(report.exit_code);
}

main().catch((err: unknown) => {
  process.stderr.write(`[parity-runner] fatal: ${String(err)}\n`);
  process.exit(1);
});
