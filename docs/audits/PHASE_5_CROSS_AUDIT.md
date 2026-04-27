# Phase 5 Cross-Audit — Feynman Integrity Report

**Auditor**: Feynman pattern (rederive, plain-language check, cargo-cult scan, lean-over-backwards)
**Audit date**: 2026-04-27
**Commit under audit**: `bca0ece` — "merge: port/phase5-mcp-servers (4 MCP servers + orchestrator + PATTERNS.md)"
**Worktree**: `port/phase5-cross-check`
**Method**: Every load-bearing claim independently falsified or verified by empirical test. No claim accepted on the word of the commit message alone.

---

## Scope

Phase 5 deliverables as stated in `bca0ece` commit message:

1. 46 Cortex tools registered in `@agentic/mcp-server-memory`
2. Four composition roots (memory, codebase, reasoning, prd)
3. A runnable memory MCP server (stdin/stdout smoke test)
4. Three named design patterns in `docs/PATTERNS.md`, with code that instantiates them
5. `pnpm -r build` exits 0 across all 5 new packages
6. Tool names match the inventory exactly (no spelling drift)
7. No `${VAR:-fallback}` in `.claude-plugin/` or `packages/` (ADR-0010)

---

## Rederivation Check

| Claim | Test performed | Result | Notes |
|---|---|---|---|
| 46 tools registered | `tools/list` JSON-RPC to live binary | VERIFIED: 46 tools returned | Server logs "46 tools registered" to stderr; `tools/list` response length == 46 |
| Topic arithmetic (recall:4 + remember:4 + methodology:5 + consolidation:4 + management:5 + narrative:3 + advanced:6 + wiki:8 + ingest:5 + navigation:2 = 46) | `grep -c "server.registerTool"` per file | VERIFIED: per-file counts match exactly | See per-file counts below |
| Four composition roots | `ls packages/mcp-servers/` | VERIFIED: codebase, memory, prd, reasoning | Plus `packages/orchestrator/` (skeleton, not a 5th root) |
| Build exits 0 | `pnpm -r build` | VERIFIED: exit code 0 | 7 of 8 workspace projects built; one skipped (no build script) |
| Tool name parity vs inventory | diff of sorted live names vs sorted inventory | VERIFIED: zero diff | See parity section |
| ADR-0010 no `${VAR:-fallback}` | grep on packages/ and .claude-plugin/ | VERIFIED: 0 violations | |
| PATTERNS.md code conformance | Read pattern prescriptions; check code structure | PARTIALLY VERIFIED: 1 discrepancy (see defect F-002) | |

**Per-topic registerTool counts** (rederived from source, not from commit message):

| Topic file | Claimed | Counted |
|---|---|---|
| recall.ts | 4 | 4 |
| remember.ts | 4 | 4 |
| methodology.ts | 5 | 5 |
| consolidation.ts | 4 | 4 |
| management.ts | 5 | 5 |
| narrative.ts | 3 | 3 |
| advanced.ts | 6 | 6 |
| wiki.ts | 8 | 8 |
| ingest.ts | 5 | 5 |
| navigation.ts | 2 | 2 |
| **Total** | **46** | **46** |

---

## Plain-Language Check

| Concept | Plain-language definition | Gap? |
|---|---|---|
| MCP Composition Root | A TypeScript package that does exactly three things: create an MCP server object, call one "register tools" function per topic, then plug in a stdio transport. It knows no domain logic itself. | No gap |
| Tool-as-Adapter | A function that wraps one domain function behind an MCP tool boundary: validate input with Zod, call the domain function, return `{ content: [{ type: "text", text: JSON.stringify(result) }] }` | No gap |
| Stub-First Composition Root | A placeholder package that exports one constant (`PORT_STATUS = "pending"`) and builds cleanly, so the workspace can include the package before its real implementation exists | No gap |
| Phase 5 stub note | Every tool adapter in this phase returns its real response shape but with a `note:` field explaining that the domain store is not yet injected. This is intentional self-documentation, not accidental | No gap |

---

## Cargo-Cult Scan

| Procedure | Stated justification | Causal mechanism | Action |
|---|---|---|---|
| One file per topic in `src/tools/` | "SRP: one reason to change per file" | Verified: wiki.ts has 8 wiki tools; changing wiki schema requires touching only wiki.ts. This is SRP applied, not imitated | Keep |
| `process.stderr.write` instead of `console.log` | "stdout corrupts the JSON-RPC framing on stdio transport" | Verified: the MCP stdio transport reads from stdin and writes to stdout; any extraneous stdout bytes would corrupt the JSON-RPC stream | Keep — causal |
| `pnpm.onlyBuiltDependencies` in memory package.json | "better-sqlite3 requires a native build step" | Partially valid — `better-sqlite3` does require native build. But the field in per-package config has no effect; it must be at workspace root | Investigate: see defect F-003 |

---

## Tool Name Parity Check

**Test**: sorted list of tool names from live `tools/list` response vs sorted list of `### \`name\`` headings in `worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md`.

**Result**: `diff` output was empty. Zero discrepancies.

Full sorted list (both sources agree):

```
add_rule, anchor, assess_coverage, backfill_memories, change_impact,
checkpoint, codebase_analyze, consolidate, create_trigger, detect_domain,
detect_gaps, drill_down, explore_features, forget, get_causal_chain,
get_methodology_graph, get_project_story, get_rules, import_sessions,
ingest_codebase, ingest_prd, list_domains, memory_stats, narrative,
navigate_memory, open_visualization, query_methodology, query_workflow_graph,
rate_memory, rebuild_profiles, recall, recall_hierarchical, record_session_end,
remember, seed_project, sync_instructions, unified_search, validate_memory,
wiki_adr, wiki_link, wiki_list, wiki_purge, wiki_read, wiki_reindex,
wiki_verify, wiki_write
```

No `recall_heirarchical` typo or equivalent. Parity oracle would pass.

---

## Smoke Transcript

Command:
```
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"audit","version":"0.0.1"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' \
  | node packages/mcp-servers/memory/dist/index.js 2>&1
```

Stderr line 1:
```
[mcp-server-memory] running on stdio, 46 tools registered
```

Stdout line 1 (initialize response):
```json
{"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"@agentic/mcp-server-memory","version":"0.1.0"}},"jsonrpc":"2.0","id":1}
```

Stdout line 2 (tools/list response, first 3 tools shown):
```json
{"result":{"tools":[
  {"name":"recall","description":"Retrieve memories using multi-signal fusion ..."},
  {"name":"recall_hierarchical","description":"Retrieve memories using fractal hierarchy ..."},
  {"name":"navigate_memory","description":"Navigate memory space using Successor Representation ..."},
  ... (46 total)
]},"jsonrpc":"2.0","id":2}
```

Both responses are valid JSON-RPC 2.0. Both have `"jsonrpc":"2.0"` and matching `"id"` fields.

**Smoke result**: PASS

---

## Build Cleanness

Command: `pnpm -r build` (7 of 8 workspace projects)

Exit code: 0

Build output (all 5 new packages):
```
packages/mcp-servers/codebase build: Done
packages/mcp-servers/reasoning build: Done
packages/mcp-servers/prd build: Done
packages/mcp-servers/memory build: Done
packages/orchestrator build: Done
```

WARN (2 occurrences, both from `pnpm.onlyBuiltDependencies` misplacement):
```
packages/mcp-servers/memory WARN: The field "pnpm.onlyBuiltDependencies" was found in
  packages/mcp-servers/memory/package.json. This will not take effect.
  You should configure "pnpm.onlyBuiltDependencies" at the root of the workspace instead.

packages/memory WARN: The field "pnpm.onlyBuiltDependencies" was found in
  packages/memory/package.json. This will not take effect.
```

Note: the `packages/memory` warning is pre-Phase-5 (introduced in `5ede263`). The `packages/mcp-servers/memory` warning was introduced in Phase 5.

---

## PATTERNS.md Code Conformance

### PATTERN: MCP Composition Root

**Prescription**: `src/index.ts < 60 lines`

**Reality**: `packages/mcp-servers/memory/src/index.ts` is **75 lines total**, 44 logic lines (non-blank, non-comment).

**Assessment**: The file contains a 23-line JSDoc block. Logic lines (44) are under both "50 lines of logic" (stated in the file's own comment) and the pattern's "< 60 lines." However the pattern document's `# < 60 lines` annotation is unqualified — a reader would interpret it as total file lines, and the file exceeds that. The code's own inline comment says "under 50 lines of logic," which is true.

**Verdict**: Document/code ambiguity. The prescription text should read `< 60 lines of logic (excluding docblock)` or the docblock should be truncated.

### PATTERN: Stub-First Composition Root

**Prescription**: "Contains a `// STATUS: port-pending` header."

**Reality**: The stubs use JSDoc-style notation — `* STATUS: port-pending` inside a `/** ... */` block, not a standalone `// STATUS:` comment.

**Assessment**: Functionally equivalent; the intent is the same. However the pattern document specifies the exact comment syntax `// STATUS: port-pending`. A future tool that greps for the exact string `// STATUS: port-pending` would not find it.

**Verdict**: Form deviation, low severity. The semantic is preserved; the exact string is not.

### PATTERN: Tool-as-Adapter

**Prescription**: error envelope `{ error: string }`, return `{ content: [{ type: "text", text: JSON.stringify(...) }] }`.

**Reality**: verified in `recall.ts`, `wiki.ts`. The `errorText` helper in every topic file produces exactly this shape. Constants (`min_heat: 0.05`, `k: 60`) have `// source:` annotations as required.

**Verdict**: CONFORMS.

---

## Findings (Ranked by Impact)

### F-001 — FIRST-RUN BUILD REQUIRES `pnpm install` (MED)

**Severity**: MED
**File**: `packages/mcp-servers/memory/package.json`
**Observation**: `pnpm --filter @agentic/mcp-server-memory build` fails on first attempt if `node_modules` is not yet populated, with TypeScript errors for `@modelcontextprotocol/sdk` and `zod`. After `pnpm install`, the build succeeds. This is expected behaviour for a workspace package, but the commit message says "Smoke test verified: initialize + tools/list returns all 46 tools" — that implies a functioning build, which only holds after install.

The specific errors observed before install:
```
src/index.ts(25,27): error TS2307: Cannot find module '@modelcontextprotocol/sdk/server/mcp.js'
src/tools/advanced.ts(13,19): error TS2307: Cannot find module 'zod'
src/index.ts(69,3): error TS2580: Cannot find name 'process'. Install @types/node.
```

**Why it matters**: A CI runner that clones the repo and runs `pnpm --filter @agentic/mcp-server-memory build` without first running `pnpm install` (workspace root) will see 68 type errors and a non-zero exit. The claim "build exits 0" is conditionally true: it requires `pnpm install` first. This is standard for workspaces but the claim should be qualified.

**Recommended fix**: In `QUALITY_GATES.md` or CI config, ensure `pnpm install` runs before any `--filter` build. Add a note in `packages/mcp-servers/memory/README.md` (when created) that the package builds only in the workspace context.

---

### F-002 — PATTERNS.md `index.ts < 60 lines` EXCEEDED BY TOTAL FILE LENGTH (LOW)

**Severity**: LOW
**File**: `docs/PATTERNS.md:45`, `packages/mcp-servers/memory/src/index.ts`
**Observation**: The pattern document states `index.ts # < 60 lines`. The actual file is 75 lines (44 logic lines, 23-line docblock, 8 blank lines). Logic lines satisfy the spirit; total lines do not satisfy the literal text.

**Specific location**:
- Pattern prescription: `docs/PATTERNS.md` line 45
- Actual file: `packages/mcp-servers/memory/src/index.ts` — 75 lines total

**Recommended fix**: Update `docs/PATTERNS.md` line 45 from:
```
    index.ts            # < 60 lines: instantiate McpServer, call register*, connect transport
```
to:
```
    index.ts            # < 60 logic lines (docblock not counted): instantiate McpServer, call register*, connect transport
```

---

### F-003 — `pnpm.onlyBuiltDependencies` MISPLACED IN PER-PACKAGE `package.json` (LOW)

**Severity**: LOW
**File**: `packages/mcp-servers/memory/package.json` — lines 34–38
**Observation**: pnpm emits a WARN on every install:
```
WARN The field "pnpm.onlyBuiltDependencies" was found in packages/mcp-servers/memory/package.json.
This will not take effect. You should configure "pnpm.onlyBuiltDependencies" at the root.
```
The field has no effect in a per-package `package.json`. The workspace root `package.json` already contains `pnpm.onlyBuiltDependencies` with `better-sqlite3` listed.

**Why it matters**: The field has zero effect here — it is dead configuration. It produces noise in install output that could mask real warnings. It also violates the "no dead code" principle from `coding-standards.md §9`.

**Recommended fix**: Remove the `"pnpm": { "onlyBuiltDependencies": [...] }` block from `packages/mcp-servers/memory/package.json`. The root workspace config already covers it.

---

### F-004 — STUB `// STATUS:` COMMENT FORMAT DEVIATION FROM PATTERN (LOW)

**Severity**: LOW
**Files**: `packages/mcp-servers/codebase/src/index.ts`, `packages/mcp-servers/prd/src/index.ts`, `packages/mcp-servers/reasoning/src/index.ts`
**Observation**: PATTERNS.md specifies the exact comment `// STATUS: port-pending`. The stub files use JSDoc notation (`* STATUS: port-pending` inside `/** */`). A grep for the literal `// STATUS: port-pending` returns no matches.

**Recommended fix**: Either (a) change the JSDoc notation to an inline comment `// STATUS: port-pending` as prescribed, or (b) update PATTERNS.md to show the JSDoc notation as the canonical form. Option (a) is preferred to match what future tooling might grep for.

---

## Self-Deception Check

**Personal investment in the Phase 5 result being clean**: LOW (auditor has no authorship stake in Phase 5 deliverables).

**Procedural checks applied**:
- Empirical falsification: ran the binary instead of reading the claim
- Tool count cross-reference: diffed live output vs inventory (not just read the commit message)
- Build test: ran `pnpm -r build` fresh
- Pattern conformance: read the pattern prescription and compared against the actual code structure
- ADR-0010: ran grep rather than reading comments claiming compliance

**Things that could make this audit wrong**:
1. The `tools/list` response could theoretically include duplicate tool names that the diff comparison would not catch (two tools with the same name). Countermeasure: the MCP SDK's `registerTool` does not deduplicate; duplicates would appear in the list. Manual scan of the 46 tool names shows all unique names.
2. The parity oracle (`parity-oracle/`) was not executed as part of this audit. The tool-name diff checks spelling but not schema parity (parameter names, types, defaults). A parameter named `max_result` (missing 's') would pass this audit but fail the parity oracle.
3. This audit did not test tool *execution* — only registration. A tool can be registered and return a valid stub response while having a broken Zod schema that rejects all real inputs. Full execution tests are the parity-oracle's job.

---

## Alternative Explanations (Sum Over Histories)

| Alternative explanation | Supporting evidence | Incompatible evidence |
|---|---|---|
| The 46-tool count is real but the tools are hollow stubs that could not function | Commit message explicitly states "Tool adapters are Phase-5 stubs with self-documenting note: fields" | Not a falsification — the claim was always "46 tools registered," not "46 tools functioning" |
| The build "exits 0" only because tsc is in skip-lib-check mode | tsconfig.json in memory package uses `"strict": true`; errors we saw before install were real type errors | After install, zero type errors — build is genuinely clean |
| The parity inventory used for comparison is itself wrong | Port-inventory-cortex is the documented canonical source for MCP_TOOLS.md | No contradictory inventory found |

**Convergence**: The 46-tool claim is supported by (1) the live server output, (2) the registerTool call count in source, (3) the topic-by-topic arithmetic in the commit message, and (4) the inventory diff. Four independent lines agree. The claim is solid.

---

## Honest Summary

**What is verified**:
- 46 tools are registered and returned by `tools/list` (verified by running the binary)
- All 46 tool names exactly match the inventory (zero spelling drift)
- The topic arithmetic (recall:4 + ... + navigation:2 = 46) is correct
- All 5 new packages build to exit code 0 after `pnpm install`
- No `${VAR:-fallback}` pattern exists in `.claude-plugin/` or `packages/` (ADR-0010 clean)
- The memory MCP server runs and returns valid JSON-RPC for `initialize` and `tools/list`
- Four composition roots exist: memory (live), codebase/prd/reasoning (stubs)
- PATTERNS.md documents three Alexander-style patterns; code structure conforms

**What is uncertain**:
- Tool execution (not tested — only registration and schema shape checked)
- Parameter schema parity (names were checked; parameter types and defaults not cross-referenced against inventory for every tool)
- The parity-oracle test suite was not run (no `pnpm parity` in this audit)

**What the integrity check surfaced that was not in the original claim**:
1. `pnpm.onlyBuiltDependencies` in per-package `package.json` has zero effect and generates a warning on every install (F-003)
2. `index.ts` is 75 total lines, exceeding the pattern's stated `< 60 lines` (F-002)
3. Stub packages use JSDoc-style comment for STATUS rather than inline `//` as pattern specifies (F-004)
4. The "build exits 0" claim requires `pnpm install` first — not self-evident from the commit message (F-001)

---

## Claims Summary

| Claim | Verdict | Severity |
|---|---|---|
| 46 tools registered | VERIFIED | — |
| Tool names match inventory exactly | VERIFIED (0 diff) | — |
| Four composition roots | VERIFIED | — |
| Memory server runnable (smoke test) | VERIFIED | — |
| `pnpm -r build` exits 0 | VERIFIED (after pnpm install) | — |
| No ADR-0010 violations | VERIFIED | — |
| PATTERNS.md prescriptions followed | PARTIALLY — 2 form deviations (F-002, F-004) | LOW |
| pnpm.onlyBuiltDependencies config correct | FALSIFIED (misplaced, no effect) | LOW (F-003) |
| Build is unconditional (no install prereq) | FALSIFIED (requires pnpm install first) | MED (F-001) |

**Total claims**: 9
**Verified**: 7
**Falsified/Qualified**: 2 (F-001 qualified, F-003 falsified)
**Critical findings**: 0
**High findings**: 0
**Medium findings**: 1 (F-001)
**Low findings**: 3 (F-002, F-003, F-004)

---

## Hand-offs

- **F-001** (build prereq): no follow-up worktree needed; a one-line note in `QUALITY_GATES.md` suffices.
- **F-002** (PATTERNS.md line count): a one-line doc edit in `docs/PATTERNS.md` line 45.
- **F-003** (misplaced pnpm config): remove 4 lines from `packages/mcp-servers/memory/package.json`.
- **F-004** (STATUS comment format): 3-line change across stub files.

None of the findings rise to CRIT or HIGH. No follow-up worktree is required. All four can be addressed in a single quick-fix PR against `main`.

**Parity oracle not run**: a future audit should run `pnpm parity` to verify parameter-level schema conformance. This audit checked tool-name parity only.
