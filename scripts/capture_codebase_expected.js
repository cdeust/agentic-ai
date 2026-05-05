#!/usr/bin/env node
/**
 * capture_codebase_expected.js — Capture expected outputs for all codebase fixtures.
 *
 * Sends each parity-oracle/codebase/inputs/<tool>.json to the Rust binary via
 * the correct MCP protocol (tools/call), extracts the inner result JSON, masks
 * nondeterministic fields, and writes parity-oracle/codebase/expected/<tool>.json.
 *
 * Usage:
 *   AI_ARCH_BIN=<path/to/binary> node scripts/capture_codebase_expected.js
 *
 * source: ai-automatised-pipeline commit 2cc3780 (v0.0.4)
 * source: parity-oracle/RUNBOOK.md §3 — capture protocol
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const BINARY = process.env.AI_ARCH_BIN;

if (!BINARY) { console.error('AI_ARCH_BIN env var must be set'); process.exit(1); }
if (!existsSync(BINARY)) { console.error(`Binary not found: ${BINARY}`); process.exit(1); }

// ── Nondeterministic fields to mask ──────────────────────────────────────────
// source: parity-oracle/RUNBOOK.md strip_nondeterministic.py
const ALWAYS_MASKED = new Set(['elapsed_ms', 'elapsedMs', 'created_at',
  'generated_at_utc', 'lastActive', 'duration_ms', 'aborted_at',
  'sha256', 'transcript_digest', 'bytes_written', 'checked_at', 'extractor_version',
]);
const MASKED = '<MASKED:nondeterministic>';

/** Recursively mask nondeterministic fields. */
function mask(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(mask);
  if (typeof obj === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(obj)) {
      if (ALWAYS_MASKED.has(k)) {
        r[k] = MASKED;
      } else if (k === 'run_id' && typeof v === 'string' && /^\d{8}-\d{6}-/.test(v)) {
        r[k] = '<MASKED:nondeterministic-run-id>';
      } else if ((k === 'artifact_path' || k === 'report_path') && typeof v === 'string') {
        r[k] = v
          .replace(/\/runs\/\d{8}-\d{6}-[a-z0-9]+\//, '/runs/<MASKED:run-id>/')
          .replace('/tmp/parity-capture-eng22', '<CAPTURE_TMP>');
      } else if (k === 'graph_path' && typeof v === 'string') {
        r[k] = v.replace('/tmp/parity-capture-eng22', '<CAPTURE_TMP>');
      } else {
        r[k] = mask(v);
      }
    }
    return r;
  }
  return obj;
}

/**
 * Call a tool on the Rust binary via MCP tools/call protocol.
 * source: MCP protocol 2024-11-05 — tools/call
 */
function callTool(toolName, args) {
  const req = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: toolName, arguments: args },
  });
  const r = spawnSync(BINARY, [], { input: req + '\n', encoding: 'utf-8', timeout: 120_000 });
  if (r.status !== 0 || r.error) return { _capture_error: r.stderr || String(r.error) };
  try {
    const env = JSON.parse(r.stdout);
    if (env.error) return { _capture_error: env.error.message, _error_code: env.error.code };
    const text = env?.result?.content?.[0]?.text;
    if (text) { try { return JSON.parse(text); } catch { return { _capture_raw: text }; } }
    return env.result ?? env;
  } catch { return { _capture_raw: r.stdout }; }
}

// ── Setup ─────────────────────────────────────────────────────────────────────
const CAPTURE_TMP = '/tmp/parity-capture-eng22';
if (existsSync(CAPTURE_TMP)) rmSync(CAPTURE_TMP, { recursive: true, force: true });
mkdirSync(CAPTURE_TMP, { recursive: true });

const EXPECTED_DIR = join(REPO_ROOT, 'parity-oracle', 'codebase', 'expected');
mkdirSync(EXPECTED_DIR, { recursive: true });

const SMALL_PYTHON_PATH = join(REPO_ROOT, 'parity-oracle', 'codebase', 'fixture-repos', 'small-python');

// Canonical finding — matches spec §3.2 required fields
// source: measured from binary validation error messages
const FINDING = {
  id: 'FIXTURE-FINDING-001',
  title: 'Parity test finding',
  severity: 'low',
  relevance_category: 'bug',
  description: 'Parity capture fixture — deterministic content.',
  source: 'parity-oracle/eng22',
};

// ── Index fixture repo (used by all graph-dependent tools) ────────────────────
console.log('=== Step 1: Index fixture repo ===');
const GRAPH_DIR = join(CAPTURE_TMP, 'graph');
mkdirSync(GRAPH_DIR, { recursive: true });

const indexR = callTool('index_codebase', {
  path: SMALL_PYTHON_PATH, language: 'python', output_dir: GRAPH_DIR,
});
if (indexR._capture_error || indexR.status === 'error') {
  console.error('FATAL: index failed:', JSON.stringify(indexR)); process.exit(1);
}
const GRAPH_PATH = indexR.graph_path;
console.log(`  graph_path: ${GRAPH_PATH}`);
console.log(`  nodes: ${indexR.node_count}, edges: ${indexR.edge_count}`);

// ── Setup pipeline state for stage 1-4 tools ─────────────────────────────────
console.log('\n=== Step 2: Setup pipeline state ===');

// Pipeline 1: extract → refine → start → answer → finalize (for prepare_prd_input)
const P1_DIR = join(CAPTURE_TMP, 'p1');
mkdirSync(P1_DIR, { recursive: true });
const p1Extract = callTool('extract_finding', { finding: FINDING, output_dir: P1_DIR });
const P1_RUN = p1Extract.run_id;
const P1_FID = FINDING.id;
console.log(`  p1 run_id: ${P1_RUN}`);
callTool('refine_finding', {
  run_id: P1_RUN, finding_id: P1_FID, output_dir: P1_DIR,
  refined_prompt: { text: 'Parity test refined prompt', role_hint: 'engineer' },
  refinement: { added_context: [{ kind: 'file', content: 'test' }], orchestrator_version: '0.1.0' },
});
callTool('start_verification', { run_id: P1_RUN, finding_id: P1_FID, output_dir: P1_DIR });
callTool('append_clarification', {
  run_id: P1_RUN, finding_id: P1_FID, output_dir: P1_DIR,
  kind: 'agent_question', content: 'Is behavior correct?',
});
callTool('append_clarification', {
  run_id: P1_RUN, finding_id: P1_FID, output_dir: P1_DIR,
  kind: 'user_answer', content: 'Yes.',
});
const p1Finalize = callTool('finalize_verification', {
  run_id: P1_RUN, finding_id: P1_FID, output_dir: P1_DIR,
});
console.log(`  p1 finalize: ${p1Finalize.status}`);

// Pipeline 2: fresh extract for individual fixture captures
const P2_DIR = join(CAPTURE_TMP, 'p2');
mkdirSync(P2_DIR, { recursive: true });
const p2Extract = callTool('extract_finding', {
  finding: { ...FINDING, id: 'FIXTURE-FINDING-002' }, output_dir: P2_DIR,
});
const P2_RUN = p2Extract.run_id;
const P2_FID = 'FIXTURE-FINDING-002';
console.log(`  p2 run_id: ${P2_RUN}`);

// Dummy PRD for validate_prd_against_graph
const PRD_PATH = join(CAPTURE_TMP, 'test.md');
writeFileSync(PRD_PATH, '# Test PRD\n\nParity test PRD with no real symbols.\n');

console.log('\n=== Step 3: Capture fixtures ===\n');

// ── Fixture definitions ───────────────────────────────────────────────────────

/**
 * Each fixture: name (filename), toolName, args(), optional notes.
 * Tools with stateful prerequisites receive the relevant pre-captured state
 * via closure. Each "fixture" maps 1-to-1 to a parity-oracle/codebase/inputs file.
 */
const FIXTURES = [
  // Tool 1: health_check
  {
    name: 'health_check',
    toolName: 'health_check',
    args: () => ({}),
  },

  // Tool 2: extract_finding — new output dir for isolation
  {
    name: 'extract_finding',
    toolName: 'extract_finding',
    args: () => ({
      finding: FINDING,
      output_dir: join(CAPTURE_TMP, 'p-extract'),
    }),
    notes: ['finding enriched with canonical §3.2 required fields: id, relevance_category, description, source'],
  },

  // Tool 3: refine_finding — uses p2 pipeline (pre-extracted)
  {
    name: 'refine_finding',
    toolName: 'refine_finding',
    args: () => ({
      run_id: P2_RUN,
      finding_id: P2_FID,
      output_dir: P2_DIR,
      refined_prompt: { text: 'Refined text', role_hint: 'engineer' },
      refinement: {
        added_context: [{ kind: 'file', content: 'test' }],
        orchestrator_version: '0.1.0',
      },
    }),
  },

  // Tool 4: start_verification — uses fresh p3 pipeline
  {
    name: 'start_verification',
    toolName: 'start_verification',
    args: () => {
      const p3Dir = join(CAPTURE_TMP, 'p3');
      mkdirSync(p3Dir, { recursive: true });
      const e = callTool('extract_finding', { finding: { ...FINDING, id: 'FIXTURE-FINDING-003' }, output_dir: p3Dir });
      callTool('refine_finding', {
        run_id: e.run_id, finding_id: 'FIXTURE-FINDING-003', output_dir: p3Dir,
        refined_prompt: { text: 'test', role_hint: 'engineer' },
        refinement: { added_context: [], orchestrator_version: '0.1.0' },
      });
      return { run_id: e.run_id, finding_id: 'FIXTURE-FINDING-003', output_dir: p3Dir };
    },
  },

  // Tool 5: append_clarification — uses p4 pipeline with open session
  {
    name: 'append_clarification',
    toolName: 'append_clarification',
    args: () => {
      const p4Dir = join(CAPTURE_TMP, 'p4');
      mkdirSync(p4Dir, { recursive: true });
      const e = callTool('extract_finding', { finding: { ...FINDING, id: 'FIXTURE-FINDING-004' }, output_dir: p4Dir });
      callTool('refine_finding', {
        run_id: e.run_id, finding_id: 'FIXTURE-FINDING-004', output_dir: p4Dir,
        refined_prompt: { text: 'test', role_hint: 'engineer' },
        refinement: { added_context: [], orchestrator_version: '0.1.0' },
      });
      callTool('start_verification', { run_id: e.run_id, finding_id: 'FIXTURE-FINDING-004', output_dir: p4Dir });
      return {
        run_id: e.run_id, finding_id: 'FIXTURE-FINDING-004', output_dir: p4Dir,
        kind: 'agent_question', content: 'What is the expected behavior?',
      };
    },
  },

  // Tool 6: finalize_verification — uses p5 pipeline: open → question → answer
  {
    name: 'finalize_verification',
    toolName: 'finalize_verification',
    args: () => {
      const p5Dir = join(CAPTURE_TMP, 'p5');
      mkdirSync(p5Dir, { recursive: true });
      const e = callTool('extract_finding', { finding: { ...FINDING, id: 'FIXTURE-FINDING-005' }, output_dir: p5Dir });
      callTool('refine_finding', {
        run_id: e.run_id, finding_id: 'FIXTURE-FINDING-005', output_dir: p5Dir,
        refined_prompt: { text: 'test', role_hint: 'engineer' },
        refinement: { added_context: [], orchestrator_version: '0.1.0' },
      });
      callTool('start_verification', { run_id: e.run_id, finding_id: 'FIXTURE-FINDING-005', output_dir: p5Dir });
      callTool('append_clarification', {
        run_id: e.run_id, finding_id: 'FIXTURE-FINDING-005', output_dir: p5Dir,
        kind: 'agent_question', content: 'Correct?',
      });
      callTool('append_clarification', {
        run_id: e.run_id, finding_id: 'FIXTURE-FINDING-005', output_dir: p5Dir,
        kind: 'user_answer', content: 'Yes.',
      });
      return { run_id: e.run_id, finding_id: 'FIXTURE-FINDING-005', output_dir: p5Dir };
    },
  },

  // Tool 7: abort_verification — p6: extract → refine → start → abort
  {
    name: 'abort_verification',
    toolName: 'abort_verification',
    args: () => {
      const p6Dir = join(CAPTURE_TMP, 'p6');
      mkdirSync(p6Dir, { recursive: true });
      const e = callTool('extract_finding', { finding: { ...FINDING, id: 'FIXTURE-FINDING-006' }, output_dir: p6Dir });
      callTool('refine_finding', {
        run_id: e.run_id, finding_id: 'FIXTURE-FINDING-006', output_dir: p6Dir,
        refined_prompt: { text: 'test', role_hint: 'engineer' },
        refinement: { added_context: [], orchestrator_version: '0.1.0' },
      });
      callTool('start_verification', { run_id: e.run_id, finding_id: 'FIXTURE-FINDING-006', output_dir: p6Dir });
      return {
        run_id: e.run_id, finding_id: 'FIXTURE-FINDING-006', output_dir: p6Dir,
        reason: 'parity test abort',
      };
    },
  },

  // Tool 8: index_codebase — fresh output dir (avoid re-index collision)
  {
    name: 'index_codebase_smallrepo',
    toolName: 'index_codebase',
    args: () => ({
      path: SMALL_PYTHON_PATH,
      language: 'python',
      output_dir: join(CAPTURE_TMP, 'graph2'),
    }),
    notes: ['removed non-schema fields top_symbols/top_processes from original fixture'],
  },

  // Tool 9: query_graph — Cypher query against indexed graph
  {
    name: 'query_graph_simple',
    toolName: 'query_graph',
    args: () => ({
      graph_path: GRAPH_PATH,
      query: 'MATCH (n:Function) RETURN n.name LIMIT 5',
    }),
    notes: [
      'added required graph_path field',
      'replaced non-schema qualified_name+depth fields with Cypher query',
    ],
  },

  // Tool 10: get_symbol — use an actual symbol present in the small-python graph
  // source: measured via query_graph — Function nodes present in small-python repo
  {
    name: 'get_symbol_known',
    toolName: 'get_symbol',
    args: () => ({
      graph_path: GRAPH_PATH,
      qualified_name: 'src/retrieval.py::recall',
    }),
    notes: [
      'added required graph_path field',
      'qualified_name changed from src.store.MemoryStore (not in small-python graph) to src/retrieval.py::recall (confirmed present)',
    ],
  },

  // Tool 15: search_codebase
  {
    name: 'search_codebase_keyword',
    toolName: 'search_codebase',
    args: () => ({
      graph_path: GRAPH_PATH,
      query: 'decay',
      limit: 20,
    }),
    notes: [
      'added required graph_path field',
      'renamed max_results → limit (Rust schema field name)',
    ],
  },

  // Tool 18: detect_changes
  {
    name: 'detect_changes',
    toolName: 'detect_changes',
    args: () => ({
      graph_path: GRAPH_PATH,
      diff_text: "diff --git a/src/retrieval.py b/src/retrieval.py\n--- a/src/retrieval.py\n+++ b/src/retrieval.py\n@@ -1,3 +1,4 @@\n+# added comment\n def recall(): pass",
    }),
  },

  // Tool 20: prepare_prd_input — uses p1 (fully finalized)
  {
    name: 'prepare_prd_input',
    toolName: 'prepare_prd_input',
    args: () => ({
      run_id: P1_RUN,
      finding_id: P1_FID,
      output_dir: P1_DIR,
      graph_path: GRAPH_PATH,
    }),
  },

  // Tool 21: validate_prd_against_graph
  {
    name: 'validate_prd_against_graph',
    toolName: 'validate_prd_against_graph',
    args: () => ({
      prd_path: PRD_PATH,
      graph_path: GRAPH_PATH,
    }),
  },

  // Tool 22: check_security_gates
  {
    name: 'check_security_gates',
    toolName: 'check_security_gates',
    args: () => ({
      graph_path: GRAPH_PATH,
      changed_symbols: ['src/retrieval.py::recall'],
    }),
  },

  // Tool 23: verify_semantic_diff — self-diff → regression_score=0
  {
    name: 'verify_semantic_diff',
    toolName: 'verify_semantic_diff',
    args: () => ({
      before_graph_path: GRAPH_PATH,
      after_graph_path: GRAPH_PATH,
    }),
  },
];

let captured = 0;
let errors = 0;

for (const fixture of FIXTURES) {
  let args;
  try {
    args = fixture.args();
  } catch (err) {
    console.log(`  SETUP_ERROR  ${fixture.name}: ${err.message}`);
    errors++;
    continue;
  }

  console.log(`  CALL  ${fixture.name} (${fixture.toolName})`);

  const raw = callTool(fixture.toolName, args);
  const masked = mask(raw);

  const expected = {
    _capture_status: 'CAPTURED',
    _capture_source: 'ai-automatised-pipeline commit 2cc3780 v0.0.4',
    _capture_date: '2026-05-04',
    ...(fixture.notes ? { _fixture_notes: fixture.notes } : {}),
    ...masked,
  };

  const outPath = join(EXPECTED_DIR, `${fixture.name}.json`);
  writeFileSync(outPath, JSON.stringify(expected, null, 2) + '\n');

  if (raw?._capture_error) {
    console.log(`  ERROR  ${fixture.name}: ${raw._capture_error}`);
    errors++;
  } else if (raw?.status === 'error') {
    console.log(`  WARN   ${fixture.name}: status=error reason=${raw.reason ?? raw.message ?? '?'}`);
    captured++;
  } else {
    console.log(`  OK     status=${raw?.status ?? '?'} → ${outPath}`);
    captured++;
  }
}

console.log(`\n=== Done: ${captured} captured, ${errors} hard errors ===`);
if (errors > 0) process.exit(1);
