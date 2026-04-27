# Parity Oracle — Capture Runbook

This runbook documents how to capture the EXPECTED outputs for every fixture in
`parity-oracle/`. Run these commands once per environment when the expected/
files show `STATUS: TO-BE-CAPTURED-IN-PHASE-0-DAY-1`. After capture, commit the
resulting expected/ files to lock the baseline.

---

## 0. Prerequisites

```bash
# Absolute path to this worktree (substitute your actual path)
WORKTREE=/Users/cdeust/Developments/agentic-ai/worktrees/port-parity-baseline

# Cortex repo
CORTEX=/Users/cdeust/Developments/Cortex

# prd-spec-generator repo
PRD=/Users/cdeust/Developments/prd-spec-generator

# automatised-pipeline Rust repo (find it or clone it)
PIPELINE=/Users/cdeust/Developments/automatised-pipeline
```

---

## 1. Infrastructure setup (Phase 0 Day 1)

These steps are BLOCKING for all Cortex expected/ captures.

### 1.1 Install Cortex dependencies

```bash
cd $CORTEX
uv sync
# Verify:
python -m mcp_server --help
```

### 1.2 Start PostgreSQL + pgvector

```bash
# If using Docker:
docker run -d \
  --name cortex-test-pg \
  -e POSTGRES_USER=cortex \
  -e POSTGRES_PASSWORD=cortex \
  -e POSTGRES_DB=cortex \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Run Cortex DB migrations:
cd $CORTEX
python -m mcp_server.infrastructure.db_setup --init
```

### 1.3 Seed the DB with representative memories

The recall/ and narrative/ fixtures require memories in the DB. Seed with the
Cortex project's own history:

```bash
cd $CORTEX
# Import session history (dry_run=false this time to actually seed)
python -c "
import asyncio
from mcp_server.handlers.import_sessions import handler
result = asyncio.run(handler({'dry_run': False, 'min_importance': 0.4}))
print(result)
"

# Alternatively, seed a minimal set via remember:
python -c "
import asyncio
from mcp_server.handlers.remember import handler
seeds = [
  {'content': 'why did we choose pgvector over Pinecone? Latency was 3x better and no network roundtrip.', 'tags': ['decision', 'embeddings'], 'force': True},
  {'content': 'Recall regression on 2026-03-12 traced to FlashRank ONNX cache; clearing fixed it.', 'tags': ['bug-fix', 'recall'], 'force': True},
  {'content': 'consolidation decay cycle performance: entity decay takes ~50ms on 10k entities.', 'tags': ['performance', 'consolidation'], 'force': True},
]
for s in seeds:
    print(asyncio.run(handler(s)))
"
```

### 1.4 Rebuild cognitive profiles

```bash
cd $CORTEX
python -c "
import asyncio
from mcp_server.handlers.rebuild_profiles import handler
result = asyncio.run(handler({'force': True}))
print(result)
"
```

---

## 2. Cortex handler capture commands

### 2.1 Helper: capture_fixture.py

Create this helper script at `$CORTEX/scripts/capture_fixture.py`:

```python
#!/usr/bin/env python3
"""Capture fixture output from a Cortex handler.

Usage: python scripts/capture_fixture.py <handler_module> <fixture_name>

Reads input from parity-oracle/cortex/inputs/<handler>/<fixture_name>.json,
calls the handler, and prints the output as JSON to stdout.
The caller pipes through strip_nondeterministic.py.
"""
import asyncio
import json
import sys
from pathlib import Path
import importlib

handler_name = sys.argv[1]  # e.g. "recall"
fixture_name = sys.argv[2]  # e.g. "recall_simple_query"

# Load input fixture
fixture_dir = Path(__file__).parent.parent / "parity-oracle" / "cortex" / "inputs"
# Find the file (it could be in a subdirectory)
matches = list(fixture_dir.rglob(f"{fixture_name}.json"))
if not matches:
    print(f"Fixture not found: {fixture_name}", file=sys.stderr)
    sys.exit(1)
fixture_path = matches[0]
with open(fixture_path) as f:
    args = json.load(f)
# Remove _meta field — not a handler argument
args.pop("_meta", None)

# Load and call handler
module = importlib.import_module(f"mcp_server.handlers.{handler_name}")
result = asyncio.run(module.handler(args))
print(json.dumps(result, indent=2, default=str))
```

### 2.2 Helper: strip_nondeterministic.py

Create this helper script at `$CORTEX/scripts/strip_nondeterministic.py`:

```python
#!/usr/bin/env python3
"""Strip non-deterministic fields from a captured fixture output.

Reads JSON from stdin, replaces fields listed in a masking config,
writes masked JSON to stdout.

Usage: python scripts/capture_fixture.py recall recall_simple_query \
         | python scripts/strip_nondeterministic.py > expected/recall/recall_simple_query.json
"""
import json
import sys

MASKED = "<MASKED:nondeterministic>"

# Fields to mask by key name (applied at any depth)
ALWAYS_MASKED_KEYS = {
    "id", "memory_id", "merged_with",
    "created_at", "generated_at_utc", "lastActive",
    "duration_ms",
}

# Fields to mask only when they are float/numeric scores
SCORE_KEYS = {"score", "heat"}

def mask(obj, depth=0):
    if isinstance(obj, dict):
        return {
            k: MASKED if k in ALWAYS_MASKED_KEYS
               else MASKED if k in SCORE_KEYS and isinstance(v, (int, float))
               else mask(v, depth+1)
            for k, v in obj.items()
            for v in [obj[k]]
        }
    if isinstance(obj, list):
        return [mask(item, depth+1) for item in obj]
    return obj

data = json.load(sys.stdin)
print(json.dumps(mask(data), indent=2, default=str))
```

### 2.3 Run all Cortex captures

```bash
cd $CORTEX

# Recall
python scripts/capture_fixture.py recall recall_simple_query | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/recall/recall_simple_query.json
python scripts/capture_fixture.py recall recall_multi_signal | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/recall/recall_multi_signal.json
python scripts/capture_fixture.py recall recall_with_domain | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/recall/recall_with_domain.json
python scripts/capture_fixture.py recall recall_unicode | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/recall/recall_unicode.json
# Note: recall_empty_corpus and recall_no_query are SHAPE-KNOWN; no capture needed.

# Remember
python scripts/capture_fixture.py remember remember_basic | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/remember/remember_basic.json
python scripts/capture_fixture.py remember remember_with_tags | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/remember/remember_with_tags.json
python scripts/capture_fixture.py remember remember_global | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/remember/remember_global.json
python scripts/capture_fixture.py remember remember_with_initial_heat | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/remember/remember_with_initial_heat.json
python scripts/capture_fixture.py remember remember_unicode_content | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/remember/remember_unicode_content.json
# Note: remember_no_content is SHAPE-KNOWN; no capture needed.

# Consolidation
python scripts/capture_fixture.py consolidate decay_recent | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/consolidation/decay_recent.json
python scripts/capture_fixture.py consolidate compress_stale | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/consolidation/compress_stale.json

# Methodology
python scripts/capture_fixture.py query_methodology query_methodology_cwd | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/methodology/query_methodology_cwd.json
python scripts/capture_fixture.py detect_domain detect_domain_cwd | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/methodology/detect_domain_cwd.json
# Note: query_methodology_cold_start is SHAPE-KNOWN; no capture needed.

# Narrative
python scripts/capture_fixture.py narrative narrative_query | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/narrative/narrative_query.json
python scripts/capture_fixture.py narrative narrative_brief | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/narrative/narrative_brief.json

# Import
python scripts/capture_fixture.py import_sessions claude_mem_smallset | python scripts/strip_nondeterministic.py > $WORKTREE/parity-oracle/cortex/expected/import/claude_mem_smallset.json
# Note: import_no_sessions is SHAPE-KNOWN; no capture needed.
```

---

## 3. Codebase / Rust binary capture

### 3.1 Build the automatised-pipeline binary

```bash
cd $PIPELINE
cargo build --release
BINARY=$PIPELINE/target/release/ai-architect-mcp
echo "Binary built at: $BINARY"
```

### 3.2 Helper: capture_codebase_fixture.js

Create this helper at `$WORKTREE/scripts/capture_codebase_fixture.js`:

```javascript
#!/usr/bin/env node
/**
 * Capture fixture output from the automatised-pipeline Rust binary.
 * 
 * Usage: AIPRD_PIPELINE_BIN=<path> node capture_codebase_fixture.js <fixture_name>
 * 
 * Reads input from parity-oracle/codebase/inputs/<fixture_name>.json,
 * sends it as a JSON-RPC call to the Rust binary via stdio,
 * prints the response JSON to stdout.
 */
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureName = process.argv[2];
const binaryPath = process.env.AIPRD_PIPELINE_BIN;

if (!binaryPath) {
  console.error('AIPRD_PIPELINE_BIN env var must be set');
  process.exit(1);
}

const inputPath = join(__dirname, '..', 'parity-oracle', 'codebase', 'inputs', `${fixtureName}.json`);
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
delete input._meta;

// Replace <WORKTREE_ROOT> placeholder in path fields
const worktreeRoot = join(__dirname, '..');
for (const key of Object.keys(input)) {
  if (typeof input[key] === 'string') {
    input[key] = input[key].replace('<WORKTREE_ROOT>', worktreeRoot);
  }
}

const proc = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: fixtureName.replace(/_/g, '/'), params: input });
proc.stdin.write(request + '\n');
proc.stdin.end();

let output = '';
proc.stdout.on('data', d => output += d);
proc.stdout.on('end', () => {
  try {
    const parsed = JSON.parse(output);
    console.log(JSON.stringify(parsed.result ?? parsed, null, 2));
  } catch {
    console.log(output);
  }
});
```

### 3.3 Run all codebase captures

```bash
cd $WORKTREE

# First, index the fixture repo
export AIPRD_PIPELINE_BIN=$PIPELINE/target/release/ai-architect-mcp
node scripts/capture_codebase_fixture.js health_check \
  | node scripts/strip_nondeterministic.js \
  > parity-oracle/codebase/expected/health_check.json

node scripts/capture_codebase_fixture.js index_codebase_smallrepo \
  | node scripts/strip_nondeterministic.js \
  > parity-oracle/codebase/expected/index_codebase_smallrepo.json

# These require the index to be built first:
node scripts/capture_codebase_fixture.js query_graph_simple \
  | node scripts/strip_nondeterministic.js \
  > parity-oracle/codebase/expected/query_graph_simple.json

node scripts/capture_codebase_fixture.js get_symbol_known \
  | node scripts/strip_nondeterministic.js \
  > parity-oracle/codebase/expected/get_symbol_known.json

node scripts/capture_codebase_fixture.js search_codebase_keyword \
  | node scripts/strip_nondeterministic.js \
  > parity-oracle/codebase/expected/search_codebase_keyword.json
```

---

## 4. prd-pipeline capture

### 4.1 Install dependencies

```bash
cd $PRD
pnpm install
pnpm build
```

### 4.2 Multi-step capture sequence for submit_clarification_proceed

The submit_clarification_proceed fixture requires running a pipeline to the
clarification step first. Use this sequence:

```bash
cd $PRD

# Step 1: Start pipeline (saves run_id to /tmp/parity_run_id)
node -e "
const { createServer } = require('./packages/mcp-server/dist/index.js');
// ... (use the MCP client to call start_pipeline)
// run_id saved to /tmp/parity_run_id.txt
"

# Alternative: use the orchestration package directly
node -e "
const { newPipelineState, step } = require('./packages/orchestration/dist/index.js');

// Run to clarification step
let state = newPipelineState({
  run_id: 'parity-test-001',
  feature_description: 'Add dark mode toggle',
  codebase_path: null,
  skip_preflight: true,
});

// Advance past banner, preflight, context_detection, input_analysis, feasibility_gate
let out;
for (let i = 0; i < 10; i++) {
  out = step({ state, result: { type: 'ok', data: {} } });
  state = out.state;
  if (state.current_step === 'clarification') break;
  if (state.current_step === 'complete') break;
}

console.log(JSON.stringify({ run_id: state.run_id, step: state.current_step }));
" > /tmp/parity_pipeline_state.json
```

### 4.3 Simple captures (start_pipeline fixtures)

These are deterministic from source and don't require a live server:

```bash
cd $PRD

node -e "
const { newPipelineState, step } = require('./packages/orchestration/dist/index.js');
const state = newPipelineState({
  run_id: 'parity-capture-001',
  feature_description: 'Add dark mode toggle',
  codebase_path: null,
  skip_preflight: false,
});
const out = step({ state });
// Mask run_id
out.state.run_id = '<MASKED:nondeterministic>';
console.log(JSON.stringify({
  run_id: '<MASKED:nondeterministic>',
  current_step: out.state.current_step,
  messages: out.messages,
  action: out.action,
  state_summary: { sections: out.state.sections.map(s => ({ section_type: s.section_type, status: s.status })) }
}, null, 2));
" > parity-oracle/prd/expected/start_pipeline_no_codebase.json
```

---

## 5. Verify captures

After running all captures, check for any remaining TO-BE-CAPTURED markers:

```bash
grep -r "TO-BE-CAPTURED" /Users/cdeust/Developments/agentic-ai/worktrees/port-parity-baseline/parity-oracle/
```

Update the MISSION.md §5 findings table to close F-001 and F-002 once captures complete.

---

## 6. Lock the baseline

After captures are complete and verified:

```bash
cd /Users/cdeust/Developments/agentic-ai/worktrees/port-parity-baseline

# Verify fixture counts
find parity-oracle/cortex/inputs -name "*.json" | wc -l
find parity-oracle/codebase/inputs -name "*.json" | wc -l
find parity-oracle/prd/inputs -name "*.json" | wc -l

# Commit the baseline
git add parity-oracle/
git commit -m "parity oracle: lock expected/ baseline after Phase 0 Day 1 capture"
```

---

## 7. Phase 6 — Dual-run harness (parity-runner)

Added in Phase 6 (`port/phase6-dual-run-harness`).

### 7.1 Environment variables

| Variable | Purpose | Example |
|---|---|---|
| `CORTEX_PYTHON_BIN` | Path to Python interpreter with Cortex installed | `/path/to/Cortex/.venv/bin/python` |
| `AI_ARCH_BIN` | Path to the compiled `ai-architect-mcp` Rust binary | `$PIPELINE/target/release/ai-architect-mcp` |
| `PRD_GEN_BIN` | Path to the prd-spec-generator CLI entry point (Node.js) | `$PRD/packages/mcp-server/dist/cli.js` |
| `AGENTIC_REPO_ROOT` | Root of the agentic-ai monorepo | `/path/to/agentic-ai` |
| `PARITY_STRICT` | Set to `1` to enable strictExtraKeys mode | `0` |
| `PARITY_ADVERSARIAL` | Set to `1` to run 5 adversarial probes per fixture | `0` |

When an env var is not set, the corresponding runner falls back to stub-runner
mode (validates fixture well-formedness only) and emits a "skipped" entry.

### 7.2 Running the harness

```bash
# Full dual-run with all live binaries:
CORTEX_PYTHON_BIN=/path/to/Cortex/.venv/bin/python \
AI_ARCH_BIN=/path/to/ai-architect-mcp \
PRD_GEN_BIN=/path/to/prd-spec-generator/packages/mcp-server/dist/cli.js \
  ./scripts/parity-dual-run.sh > reports/parity-$(date +%Y%m%dT%H%M%S).json

# Stub-runner mode only (no live binaries — validates fixture well-formedness):
./scripts/parity-dual-run.sh

# With adversarial probes:
PARITY_ADVERSARIAL=1 ./scripts/parity-dual-run.sh
```

### 7.3 Expected output paths

| Run mode | What is produced |
|---|---|
| Full dual-run | `reports/parity-<timestamp>.json` — master ParityReport |
| Stub-runner | Same file; all entries have `status: "skipped"` |
| Self-test | `pnpm -F @agentic/parity-runner test` — 23 self-tests |

### 7.4 The 48-hour cutover gate

The cutover claim is: "the TS port produces the same outputs as the live
source repos across ALL fixtures over 48 hours."

Falsification condition (Popper): `exit_code === 1` in ANY run of the
harness over the 48-hour window falsifies the claim. The harness must be
run at least twice per day (cron `0 6 * * *` + `0 18 * * *`) with all
three live binaries available.

When `exit_code === 0` holds for 48 consecutive hours, the cutover gate is met.

### 7.5 Adversarial probes

The harness generates 5 adversarial probes per fixture (total 170 probes
across all 34 fixtures). Each probe mutates one field:

| Probe | Mutation |
|---|---|
| P1 | Empty string in primary text field |
| P2 | Unicode stress string (multi-script, RTL, emoji) |
| P3 | null for an optional field |
| P4 | Deeply nested object replacing primary text field |
| P5 | 64 KiB payload in primary text field (2^16 bytes) |

A divergence found by a probe is a first-class finding, not a secondary concern.
source: Popper (1963). Conjectures and Refutations, Ch. 1.
