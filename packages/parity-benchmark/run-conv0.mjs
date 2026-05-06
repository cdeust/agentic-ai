/**
 * Standalone runner: execute TS LoCoMo bench for conversation 0 only,
 * capture per-question hit_rank, and write to /tmp/ts_results.json.
 *
 * Usage: node run-conv0.mjs
 *
 * Integrity audit script — not production code.
 * source: mirrors cortex benchmarks/locomo/run_benchmark.py:191-225
 */
import { loadLocomo, parseEvidenceRefs } from "./dist/locomo-loader.js";
import { runLocomo } from "./dist/locomo-runner.js";
import { writeFileSync } from "node:fs";

const DATASET = "/Users/cdeust/Developments/cortex/benchmarks/locomo/locomo10.json";

process.stderr.write("Loading dataset...\n");
const conversations = loadLocomo(DATASET);
const conv0 = conversations[0];
if (!conv0) {
  process.stderr.write("ERROR: no conversation 0\n");
  process.exit(1);
}

process.stderr.write(`Conversation 0: ${conv0.qa.length} QA pairs\n`);
process.stderr.write("Running TS bench (limit=1, useEmbeddings=true)...\n");

const start = Date.now();
const results = await runLocomo(conversations, {
  limit: 1,
  useEmbeddings: true,
  onProgress: (cur, n) => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    process.stderr.write(`  [${cur}/${n}] ${elapsed}s elapsed\n`);
  },
});

// Correlate results with question text.
// runLocomo processes conv.qa in order, skipping qa with no evidence refs.
// We replicate the same filter to get the question text for each result.
const qaWithEvidence = [];
for (const qa of conv0.qa) {
  const refs = parseEvidenceRefs(qa.evidence);
  const targetSessions = new Set(refs.map(([sidx]) => sidx));
  if (targetSessions.size === 0) continue;
  qaWithEvidence.push(qa.question);
}

if (qaWithEvidence.length !== results.length) {
  process.stderr.write(
    `WARNING: question count mismatch — expected ${qaWithEvidence.length} got ${results.length}\n`
  );
}

const output = {};
const min = Math.min(qaWithEvidence.length, results.length);
for (let i = 0; i < min; i++) {
  const question = qaWithEvidence[i];
  const r = results[i];
  if (!question || !r) continue;
  output[question] = r.hit_rank;
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1);
process.stderr.write(`Done in ${elapsed}s — captured ${Object.keys(output).length} question results\n`);
writeFileSync("/tmp/ts_results.json", JSON.stringify(output, null, 2));
process.stderr.write("Written to /tmp/ts_results.json\n");
