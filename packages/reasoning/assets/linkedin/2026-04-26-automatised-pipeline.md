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

A concrete example. The agent wants to change handle_tool_call. It asks get_impact for the blast radius. The graph answers: 4 processes transit this symbol, 12 communities are downstream, 1 of them is auth-critical. The agent now reasons about an actual answer instead of grepping for callers and hoping it found them all.

The PRD that comes out of that conversation can then be checked against the graph. Do the symbols in the PRD exist? Does "scoped to module X" match the community count? Does "doesn't affect main" hold against the call chain? That last one is validate_prd_against_graph, and it has caught more PRD overclaims in my own work than I want to admit.

What is in the box:

• 23 MCP tools across 10 pipeline stages, one tool per stage
• Index for Rust, Python, TypeScript with cross-file import resolution and call-chain tracking
• Leiden-class community detection so the graph clusters into functional groups
• Hybrid search (BM25 lexical + sparse TF-IDF semantic + Reciprocal Rank Fusion) instead of grep
• Semantic-diff verification: what nodes appeared, disappeared, new cycles via Tarjan SCC
• 12,000 lines of Rust, 220 tests passing, zero compiler warnings, every constant sourced

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

### Option A. The bug it caught in my own PRD (recommended)

True story from building this. I ran validate_prd_against_graph on a spec I had just written for one of my own projects. It flagged three symbols that did not exist in the codebase. One was a function name I had carried over from a previous version. Two were methods I had imagined into being while writing the doc.

The PRD was on its way to review. The graph caught what no human reviewer would have noticed until someone tried to implement it and got NameError.

Symbol-level hallucination in PRDs is a real failure mode. It costs you a day per occurrence. The graph turns it into a 50ms check.

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

**Em-dash discipline:** zero em-dashes in main post + 3 first-comment options. Headers in this file use period-after-letter ("Option A.") instead of "Option A —" to keep the em-dash count clean even in the meta sections.

**Bruner narrative arc preserved:**
- Setup: the moment of an AI changing the wrong function (recognizable canonical breach)
- Complication: agents grep, code is structured (the diagnosis)
- Intervention: I built a Rust MCP server that turns code into a queryable graph
- Resolution: 23 tools, 10 stages, the get_impact + validate_prd_against_graph examples
- Meaning: this is the structure layer of a three-part stack; each plays alone, all three compose

**Feynman integrity discipline:**
- "23 MCP tools across 10 pipeline stages" — verifiable from `stages/` directory + Cargo.toml
- "12,000 lines of Rust, 220 tests, zero warnings, every constant sourced" — README claim, verifiable by `cargo test && cargo build` + `tokei`
- "It does not replace your test suite. A semantic-diff regression score is not a correctness guarantee." — honest limit, same standard as the zetetic post
- "Coverage is Rust, Python, TypeScript today" — verifiable from supported parsers
- The "broken in production" opener is hyperbole-register, not a load-bearing claim; acceptable on LinkedIn

**Concrete artifact:** "430 nodes, 400 edges, 216 communities, 35 processes on our own codebase" is the dogfood number from the README. Visible proof the project ran on itself.
