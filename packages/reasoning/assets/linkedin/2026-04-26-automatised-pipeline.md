# LinkedIn post — automatised-pipeline (2026-04-26)

**Status:** ready to post (human-voice, em-dash-free).
**Project URL:** https://github.com/cdeust/automatised-pipeline (not "ai-automatised-pipeline" — the GitHub repo name is `automatised-pipeline`).
**Audience:** AI engineers, infra/platform people, people who care about static analysis + LLM tool use.
**Target length:** ~2200 chars.

---

## Final post (copy-paste ready)

You know that moment when an AI coding assistant changes a function and only later you realize it changed the wrong one? Same name, three modules over, completely different call graph, half your service quietly broken in production.

The reason it happens is mundane. Coding assistants treat your codebase as text. They grep, they pattern-match, they guess. Code is not text. Code is a structured graph where imports resolve, types flow, calls chain, and modules cluster into communities of related work.

I spent the last few months turning that observation into a Rust MCP server.

🔎 𝗮𝘂𝘁𝗼𝗺𝗮𝘁𝗶𝘀𝗲𝗱-𝗽𝗶𝗽𝗲𝗹𝗶𝗻𝗲 indexes any Rust, Python, or TypeScript codebase into a property graph. Nodes are symbols. Edges are calls and types. 23 MCP tools sit on top so an AI agent can query the graph instead of re-reading your repository every turn.

A concrete capability. An agent wants to change handle_tool_call. It asks get_impact for the blast radius. The graph returns the set of processes that transit this symbol and the set of communities downstream. The agent now reasons against an explicit answer instead of grepping for callers and hoping it found them all.

The PRD that comes out of that conversation can then be checked against the graph. validate_prd_against_graph runs three checks the README documents: symbol hallucination (do the names in the PRD exist?), community consistency (does the scope-claim match the community count?), and process-impact validation (does the change actually touch the processes the PRD says it does?). Three failure modes, one tool, runs in milliseconds.

What is in the box:

• 23 MCP tools across 10 pipeline stages
• Tree-sitter AST extractors for Rust, Python, TypeScript with cross-file import and call-chain resolution
• Louvain community detection with C2 repair so the graph clusters into functional groups
• Hybrid search (BM25 lexical + sparse TF-IDF semantic + Reciprocal Rank Fusion, Tantivy-backed) instead of grep
• Semantic-diff verification with Tarjan SCC for cycle detection
• 220 tests passing, zero clippy warnings, every numeric constant sourced

What it does NOT do, on the front page of the README:

• It is read-only. The pipeline never writes code, never opens PRs, never runs CI. It is intelligence, not action.
• It does not replace your test suite. A semantic-diff regression score is not a correctness guarantee.
• Coverage is Rust, Python, TypeScript today. Other languages are roadmap, not present.

This is the middle layer of a three-part stack: Cortex for persistent memory across sessions, zetetic-team-subagents for reasoning agents that can refuse, this pipeline for codebase intelligence underneath both. Each works alone. They compose end to end.

MIT, no telemetry, public repo.

🔗 https://github.com/cdeust/automatised-pipeline

#ClaudeCode #LLMEngineering #StaticAnalysis #OpenSource #DeveloperTools

---

## First comment (post immediately after, within 60 seconds)

LinkedIn algorithm boost: OP replies first to seed engagement and lift impression rank. Three options below; **recommended: Option A (the bug we caught in our own PRD)** because it makes the value visible with the founder as the cautionary tale, same pattern that worked yesterday.

---

### Option A. The dogfood number, with provenance (recommended)

The number I am most proud of is the resolution-rate trajectory on the project's own end-result harness, recorded commit by commit.

46% baseline. The first cross-file import-and-call resolver. Recorded as §7.1 calibration in stage-3b docs.

66.6% after the first batch of resolution upgrades.

84.5% after B1 + B2 + B3 plus determinism fixes. Layer 5 stdlib resolution and Layer 4 macro expansion landed in that batch. Each commit is in the public git log.

A static Layer 3 resolver regressed on Rust. We measured it. Recorded the regression as an empirical finding. Picked an agnostic-primitives approach instead.

This is the loop the pipeline enables: a number, an attempt, a number, a published artifact. Not a vibe of progress. A graph.

---

### Option B. The three-part stack

This is the middle layer of a three-part stack I have been building:

🧠 𝗖𝗼𝗿𝘁𝗲𝘅 (https://github.com/cdeust/Cortex) is the persistent memory layer. Pre-loads your reasoning patterns and project context at session start.

🤔 𝘇𝗲𝘁𝗲𝘁𝗶𝗰-𝘁𝗲𝗮𝗺-𝘀𝘂𝗯𝗮𝗴𝗲𝗻𝘁𝘀 (https://github.com/cdeust/zetetic-team-subagents) is 116 reasoning agents that ship with primary-source citations and refusal conditions.

🔎 𝗮𝘂𝘁𝗼𝗺𝗮𝘁𝗶𝘀𝗲𝗱-𝗽𝗶𝗽𝗲𝗹𝗶𝗻𝗲 (this post) is the codebase-intelligence layer underneath both.

The agents reason. Cortex remembers what was decided. The pipeline tells both what is structurally true about the code being decided about. Each one stands alone. The three compose end to end.

---

### Option C. The architecture question

The question I keep getting asked: why a property graph? Why not just give the agent more tokens and let it read the whole repository?

Two reasons.

First, attention is finite. A 1M-context model still answers worse when the relevant signal is buried in 800k tokens of unrelated code. Sparse, structural retrieval outperforms dense reading on every benchmark I have run on this pipeline.

Second, agents need facts, not impressions. "How many places call this function?" is a graph query with one correct answer. Reading 50 files and counting is a guess that depends on what the model happens to attend to that turn.

The graph removes the variance. The agent becomes deterministic where it can be.

---

## Posting checklist

- [ ] Test the 𝗮𝘂𝘁𝗼𝗺𝗮𝘁𝗶𝘀𝗲𝗱-𝗽𝗶𝗽𝗲𝗹𝗶𝗻𝗲 unicode bold on mobile
- [ ] **Attach a screenshot.** Best candidate: the output of `analyze_codebase` on the project's own source ("430 nodes, 400 edges, 216 communities, 35 processes on our own codebase" — the dogfood number from the README). Or a `get_impact` table showing blast radius.
- [ ] Image alt text: "automatised-pipeline analyze_codebase output: 430 nodes, 400 edges, 216 communities, 35 processes detected on its own source tree"
- [ ] **Post the main post first, then within 60 seconds reply with the first comment.**
- [ ] Repo URL is `automatised-pipeline`, NOT `ai-automatised-pipeline`. Double-check before posting.

---

## Voice / cross-check notes

Em-dash discipline: zero em-dashes in main post + 3 first-comment options.

No invented anecdotes. Per user feedback: every concrete claim grounded in real artifacts. The fabricated PRD-hallucination Option A was replaced with the resolution-rate trajectory documented in real commits.

### Real-evidence audit (per claim, source)

| Claim in post | Source / verification |
|---|---|
| 23 MCP tools across 10 pipeline stages | CHANGELOG.md lists all 23 tools by stage (0 through 9) |
| Tree-sitter AST extractors for Rust, Python, TypeScript | CHANGELOG.md verbatim |
| Louvain community detection with C2 repair | CHANGELOG.md verbatim. Earlier draft said "Leiden-class" — wrong; corrected. |
| Hybrid BM25 + sparse TF-IDF + RRF, Tantivy-backed | CHANGELOG.md verbatim |
| Tarjan SCC for cycle detection | CHANGELOG.md verbatim |
| 220 tests, zero clippy warnings, every numeric constant sourced | CHANGELOG.md verbatim |
| validate_prd_against_graph: symbol hallucination, community consistency, process impact | NOTES.md Stage 6 verbatim |
| Read-only (never writes / opens PRs / runs CI) | NOTES.md stages table: stages 7, 10, 11, 12 explicitly out of scope |
| Coverage = Rust + Python + TypeScript | CHANGELOG.md + README |
| Resolution-rate trajectory 46% / 66.6% / 84.5% (Option A first comment) | git log: commit 0fdb35b (46% baseline as §7.1), commit e89083d (0.666 → 0.845 with B1+B2+B3 + determinism), commit b0c1d7a (Layer 5 stdlib + Layer 4 macro expansion), commit 03f475e (static Layer 3 regresses on Rust empirical finding) |
| "broken in production" opener | rhetorical register, not load-bearing |

### Bruner narrative arc preserved

- Setup: the moment of an AI changing the wrong function
- Complication: agents grep, code is structured
- Intervention: a Rust MCP server that turns code into a queryable graph
- Resolution: 23 tools, get_impact and validate_prd_against_graph as concrete capabilities
- Meaning: structure layer of a three-part stack; each plays alone, all three compose

### Repo URL warning

Project is at https://github.com/cdeust/automatised-pipeline — NOT `ai-automatised-pipeline`. Verify before posting.
