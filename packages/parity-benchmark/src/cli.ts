#!/usr/bin/env node
/**
 * parity-benchmark — CLI entry point.
 *
 * Usage:
 *   parity-benchmark cortex-locomo [--limit N] [--baseline path] [--dataset path]
 *
 * Exit codes:
 *   0 — all measured metrics within ±tolerance_pp of baseline (PASS)
 *   1 — at least one metric regressed beyond tolerance (FAIL)
 *   2 — runtime error (dataset missing, invalid args, etc.)
 *
 * source: cortex@1ef1376 benchmarks/locomo/run_benchmark.py:298-330 — flag parity.
 */

import { resolve } from "node:path";
import { findLocomoDataset, loadLocomo } from "./locomo-loader.js";
import { runLocomo } from "./locomo-runner.js";
import { scoreResults } from "./scoring.js";
import { loadCortexBaseline } from "./baselines.js";
import { buildParityReport, renderReport } from "./report.js";

interface ParsedArgs {
  readonly command: string;
  readonly limit: number | null;
  readonly baseline: string;
  readonly dataset: string | null;
}

const DEFAULT_BASELINE_PATH = "parity-oracle/cortex/baselines/locomo.json";

function parseArgs(argv: readonly string[]): ParsedArgs {
  const cmd = argv[0] ?? "";
  let limit: number | null = null;
  let baseline = DEFAULT_BASELINE_PATH;
  let dataset: string | null = null;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit" && i + 1 < argv.length) {
      const v = argv[++i];
      if (v) limit = parseInt(v, 10);
    } else if (arg === "--baseline" && i + 1 < argv.length) {
      const v = argv[++i];
      if (v) baseline = v;
    } else if (arg === "--dataset" && i + 1 < argv.length) {
      const v = argv[++i];
      if (v) dataset = v;
    }
  }
  return { command: cmd, limit, baseline, dataset };
}

async function runCortexLocomo(args: ParsedArgs): Promise<number> {
  const dsPath = args.dataset ?? findLocomoDataset();
  if (!dsPath) {
    process.stderr.write(
      "ERROR: locomo10.json not found.\n" +
        "  Set CORTEX_LOCOMO_PATH or pass --dataset <path>.\n" +
        "  Default search: ../cortex/benchmarks/locomo/locomo10.json\n",
    );
    return 2;
  }
  process.stderr.write(`Loading dataset: ${dsPath}\n`);
  const conversations = loadLocomo(dsPath);
  const limit = args.limit;
  const total = limit !== null && limit > 0 ? Math.min(limit, conversations.length) : conversations.length;
  process.stderr.write(`Running TS Cortex on ${total} conversation(s)...\n`);
  const start = Date.now();
  const results = await runLocomo(conversations, {
    limit,
    onProgress: (cur, n) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      process.stderr.write(`  [${cur}/${n}] ${elapsed}s elapsed\n`);
    },
  });
  const elapsedSec = (Date.now() - start) / 1000;
  process.stderr.write(`Scored ${results.length} questions in ${elapsedSec.toFixed(1)}s.\n\n`);
  const scores = scoreResults(results);
  const baseline = loadCortexBaseline(resolve(args.baseline));
  const report = buildParityReport(scores, baseline);
  process.stdout.write(`${renderReport(report)}\n`);
  return report.passed ? 0 : 1;
}

function printUsage(): void {
  process.stderr.write(
    "Usage: parity-benchmark <command> [options]\n" +
      "\n" +
      "Commands:\n" +
      "  cortex-locomo    Run LoCoMo against the TS Cortex; compare to Python baseline.\n" +
      "\n" +
      "Options:\n" +
      "  --limit N        Stop after N conversations (default: all 10)\n" +
      "  --baseline PATH  Override baseline JSON path\n" +
      "  --dataset PATH   Override locomo10.json path (else CORTEX_LOCOMO_PATH or sibling repo)\n",
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "cortex-locomo") {
    process.exit(await runCortexLocomo(args));
  }
  printUsage();
  process.exit(args.command ? 2 : 0);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
