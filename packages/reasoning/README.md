# Zetetic Agents for Claude Code

**The only Claude Code agent system where every claim must cite its source, every commit is checked for invented constants, and every agent refuses to answer when it doesn't know.**

45 agents. 36 skills. 16 commands. 10 tools. 8 hooks. One epistemic standard that none of them can bypass.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Why This Exists

Most Claude Code agent repos ship role prompts: "You are a senior engineer. Follow best practices." The agent sounds authoritative. It invents constants, cites papers it hasn't read, and ships code with confidence inversely proportional to its correctness.

**This repo takes a different position:** an AI agent that cannot say "I don't know" is more dangerous than one that cannot say anything at all.

Every agent in this repo inherits a hard epistemic standard — the **zetetic method** — that is not a suggestion but an enforced constraint:

- No source? Say "I don't know" and stop.
- Single source? It's a hypothesis, not a fact.
- Blog post? Not a source. Read the actual paper.
- Hardcoded number? Cite the equation or the ablation data.
- Confident answer? List what could invalidate it first.

The hooks enforce this automatically. Every `git commit` is scanned for invented constants. Every `git push` is checked for unsourced claims. The standard is not voluntary.

---

## What's In the Box

```
zetetic-team-subagents/
  agents/             18 team agents (engineer, architect, security-auditor, ...)
  agents/genius/      27 genius agents (curie, fermi, dijkstra, jobs, ...)
  skills/             36 skills across 7 categories
  commands/           16 slash commands (/zcommit, /qestimate, /qverify, ...)
  tools/              10 shell utilities (zetetic-checker, difficulty-book-manager, ...)
  hooks/               8 automated enforcement hooks
  scripts/             2 agent spawning scripts
```

### Team Agents (18)

Standard engineering and research roles — but each inherits Clean Architecture, SOLID, and the zetetic standard. Not just "you are an engineer"; rather, an engineer who traces every fix to its root cause, never applies band-aids, and refuses to ship code that violates layer boundaries.

| | | | |
|---|---|---|---|
| engineer | architect | code-reviewer | test-engineer |
| dba | frontend-engineer | devops-engineer | security-auditor |
| ux-designer | research-scientist | paper-writer | experiment-runner |
| data-scientist | mlops | reviewer-academic | latex-engineer |
| professor | **orchestrator** | | |

### Genius Agents (27)

**This is the part no one else has.**

27 agents that extract reproducible reasoning *procedures* from the primary-source record of history's most productive thinkers. Not personas. Not "pretend to be Einstein." Actual methods — each with 4-7 canonical moves, primary-source citations, documented blind spots, explicit refusal conditions, and hand-off protocols to other agents.

Routed by **problem shape**, not by field. Curie is not "the chemistry agent" — she is the agent you call when a measurement exceeds what known parts predict and the residual needs a carrier. That applies to latency debugging, cost analysis, ML leakage detection, and security traffic anomalies.

<details>
<summary><b>Full genius roster (click to expand)</b></summary>

| Agent | Reasoning Shape | When to Use |
|---|---|---|
| **curie** | Residual with a carrier | Measured > predicted; signal buried in noise; need isolation |
| **fermi** | Order-of-magnitude first | "We don't have data"; need a bracket before a decision |
| **hamilton** | Hard real-time / priority under failure | System must degrade gracefully, not crash |
| **shannon** | Define the measure first | Optimizing without a defined objective; layers tangled |
| **lamport** | Distributed causality / spec before code | Concurrency bugs; "works on my machine"; no written spec |
| **darwin** | Long-horizon observation | Slow phenomenon; theory without a difficulty book |
| **noether** | Symmetry / invariance | Hidden regularity; unexplained conserved quantity |
| **mendeleev** | Tabulate and predict gaps | Many items, suspected pattern, unnamed holes |
| **feynman** | Rederive / cargo-cult detector | Claimed understanding nobody can explain simply |
| **mcclintock** | Anomaly others discarded | "One-off, ignore it" — but is it? |
| **dijkstra** | Proof and program together | Correctness can't be established by testing |
| **hopper** | Compile as abstraction barrier | Users forced to think like the machine |
| **engelbart** | Augment, don't automate | "Automate this" when "augment this" is better |
| **ramanujan** | Conjecture generator | Need many candidates fast — **mandatory prover pairing** |
| **turing** | Reduce to mechanism | Drowning in detail; nobody asked what the simplest machine is |
| **vonneumann** | Cross-domain transfer | Problem isomorphic to a solved one in another field |
| **lavoisier** | Mass-balance | Inputs ≠ outputs; something is disappearing |
| **fisher** | Experimental design | Causal claim without randomization, blocking, replication |
| **einstein** | Gedankenexperiment | Concept without operational definition; frame-dependent rule |
| **galileo** | Idealize away friction | Phenomenon obscured by secondary effects |
| **liskov** | Substitutability as contract | Swap-test fails; interface has no behavioral spec |
| **semmelweis** | Data against institution | Evidence is clear; the organization refuses to act |
| **fleming** | Serendipity capture | Anomaly during routine work; "that's weird" goes uninvestigated |
| **kay** | Late binding / malleability | Hardcoded decisions that should be deferred to runtime |
| **knuth** | Profile before optimizing | Optimizing without profiling; misquoting "premature optimization" |
| **kekule** | Structure from constraints | Components have connection rules; topology unknown |
| **jobs** | Integrated experience | "It works" per component but the user experience is broken |

</details>

> See [`agents/genius/INDEX.md`](agents/genius/INDEX.md) for the full 130+ shape lookup table with triggers, common pairings, and composition chains.

### Skills (36)

Reusable procedures invocable as workflows. Every skill has **four zetetic gates** (logical, critical, rational, essential) that must pass before output is delivered. A skill that can't clear its gates says so and stops.

| Category | Skills | Examples |
|---|---|---|
| **Zetetic** (4) | Epistemic backbone | `/verify-claim` `/difficulty-book` `/cargo-cult-check` `/seek-disconfirmation` |
| **Engineering** (9) | Daily workflows | `/review` `/implement` `/debug` `/optimize` `/secure` `/refactor` `/test` `/deploy` `/migrate-db` |
| **Analysis** (6) | Investigation | `/estimate` `/investigate` `/benchmark` `/balance` `/experiment` `/audit-integrity` |
| **Architecture** (5) | Structural decisions | `/decompose` `/adr` `/spec` `/contract` `/evaluate-tool` |
| **Research** (5) | Academic & ML | `/literature-review` `/explain` `/write-paper` `/pre-submit-review` `/design-experiment` |
| **Compose** (7) | Multi-agent chains | `/performance-investigation` `/anomaly-to-explanation` `/conjecture-to-code` `/failure-resilient-design` `/product-quality-audit` `/new-tool-design` `/statistical-intervention` |

### Commands (16)

Quick slash commands for daily use:

| Category | Commands |
|---|---|
| **Agent management** | `/agent-list` `/agent-spawn` `/agent-status` |
| **Git workflow** | `/zcommit` `/zpr` `/zclean` |
| **Session** | `/session-save` `/session-recall` |
| **Quality gates** | `/pre-commit` `/pre-push` |
| **Zetetic shortcuts** | `/qverify` `/qestimate` `/qreview` `/qdifficulty` `/qintegrity` |

### Tools (10)

Shell utilities that agents, commands, and hooks call:

`agent-catalog` `zetetic-checker` `difficulty-book-manager` `shape-router` `skill-runner` `worktree-manager` `session-store` `hook-runner` `balance-auditor` `profile-runner`

### Hooks (8) — The Differentiator

**This is what no other agent repo does: automated epistemic enforcement.**

| Hook | Trigger | What it enforces |
|------|---------|-----------------|
| **pre-commit-zetetic** | Before `git commit` | Blocks on: invented constants, unsourced claims, orphaned TODOs |
| **pre-push-review** | Before `git push` | Blocks on: zetetic violations in the push diff |
| **pre-edit-layer-check** | Before file edit | Warns on: core/ files at risk of layer violation |
| **post-commit-difficulty** | After `git commit` | Reminds: update difficulty book if related area was changed |
| **post-edit-balance** | After pipeline edit | Reminds: verify data conservation (inputs = outputs) |
| **session-start** | Session begins | Loads: repo state, difficulty books, cached context |
| **session-end** | Session ends | Saves: decisions, files changed, open questions |
| **notification-handler** | Subagent completes | Logs result, checks for unmerged worktrees |

The hooks turn the zetetic standard from a prompt instruction into an automated gate. You cannot commit a magic number without citing its source. You cannot push code with unsourced claims in comments. The standard is not "please follow these guidelines" — it is "the commit is blocked until you do."

---

## Quick Start

### 1. Install agents

```bash
git clone https://github.com/cdeust/zetetic-team-subagents.git

# Global (all projects)
cp zetetic-team-subagents/agents/*.md ~/.claude/agents/
cp -r zetetic-team-subagents/agents/genius ~/.claude/agents/genius
cp -r zetetic-team-subagents/commands/* ~/.claude/commands/

# Or per-project
mkdir -p .claude/agents/genius .claude/commands
cp zetetic-team-subagents/agents/*.md .claude/agents/
cp zetetic-team-subagents/agents/genius/*.md .claude/agents/genius/
cp -r zetetic-team-subagents/commands/* .claude/commands/
```

### 2. Use agents

```
Use the engineer agent to fix the authentication bug in login.py

Use the fermi agent to estimate whether this service can handle 10x traffic

Use the curie agent to investigate why p99 latency exceeds the sum of profiled components

Use the jobs agent to audit the onboarding flow for "it just works" violations
```

### 3. Use commands

```
/qestimate How much would retraining cost at 10x data?

/qverify "PostgreSQL is faster than MySQL for analytical queries"

/zcommit

/qintegrity
```

### 4. Enable hooks (optional but recommended)

Add to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "/path/to/zetetic-team-subagents/hooks/pre-commit-zetetic.sh",
        "timeout": 30000
      },
      {
        "matcher": "Bash",
        "command": "/path/to/zetetic-team-subagents/hooks/pre-push-review.sh",
        "timeout": 60000
      }
    ],
    "Stop": [
      {
        "command": "/path/to/zetetic-team-subagents/hooks/session-end.sh",
        "timeout": 15000
      }
    ]
  }
}
```

See [`hooks/README.md`](hooks/README.md) for the full configuration with all 8 hooks.

---

## Parallel Agents in Worktrees

Spawn any agent as its own `claude` process in an isolated git worktree:

```bash
# One agent per terminal, full parallel execution, no permission blocks
scripts/spawn-agent.sh engineer     "Fix the auth bug in login.py"
scripts/spawn-agent.sh architect    "Propose a module split for src/core"
scripts/spawn-agent.sh code-reviewer "Review diff against main"
scripts/spawn-agent.sh fermi        "Estimate the cost of retraining at 10x"
```

Each agent gets its own branch (`agent/<name>/<timestamp>`), its own filesystem, and `--permission-mode bypassPermissions` so it is never blocked. Merge when done:

```bash
git merge agent/engineer/20260409-143000
git worktree remove ../myrepo-engineer-20260409-143000
```

---

## Compose Chains

The most powerful skills chain genius agents in pipelines:

| Skill | Pipeline | What it does |
|---|---|---|
| `/performance-investigation` | fermi → curie → knuth | Bracket expected → measure actual → profile hot 3% |
| `/anomaly-to-explanation` | mcclintock → curie → shannon | Notice → isolate carrier → formalize |
| `/conjecture-to-code` | ramanujan → dijkstra → engineer | Generate candidates → prove → implement |
| `/failure-resilient-design` | hamilton → lamport → engineer | Design degradation → specify → build |
| `/product-quality-audit` | jobs → galileo → dijkstra | Experience spec → strip essential → verify |
| `/new-tool-design` | engelbart → hopper → kay → jobs | Augment → abstract → make malleable → integrate |
| `/statistical-intervention` | semmelweis → fisher → feynman | Detect anomaly → design experiment → integrity-check |

---

## Permissions

| Mode | File ops | Shell | Best for |
|---|---|---|---|
| `bypassPermissions` | Auto | Auto | Worktree isolation (spawn script default) |
| `acceptEdits` | Auto | Prompt | Interactive pairing |
| Per-project `settings.json` | Configurable | Configurable | Team standards |
| Default | Prompt | Prompt | First-time exploration |

```json
{
  "permissions": {
    "allow": ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git *)", "Bash(npm test*)"]
  }
}
```

---

## The Zetetic Standard

Every agent, skill, command, and hook inherits this. It is not optional.

**Four pillars** (Adel.M):

| Pillar | Question | What it does |
|---|---|---|
| **Logical** | *"Is it consistent?"* | Check internal structure, validity, contradictions |
| **Critical** | *"Is it true?"* | Compare claims against evidence and verifiable data |
| **Rational** | *"Is it useful?"* | Evaluate practical rationality given the circumstances |
| **Essential** | *"Is it necessary?"* | Remove what doesn't serve the goal. *"Why this? Why now?"* |

**Seven rules:**

1. No source → say "I don't know" and stop
2. Single source = hypothesis. Cross-reference required
3. Read the actual paper, not summaries or blog posts
4. No invented constants. Cite the equation or the data
5. Benchmark every change. No regressions
6. A confident wrong answer destroys trust. "I don't know" preserves it
7. Actively seek disconfirming evidence

Grounded in published epistemology: Friedman 2020 (*Zetetic Epistemology*), Flores & Woodard 2023 (*Epistemic norms on evidence-gathering*).

---

## Architecture Standard

Agents that write code enforce Clean Architecture and SOLID:

```
TRANSPORT → SERVER → HANDLERS → CORE ← SHARED
                                  ↓
                            INFRASTRUCTURE → SHARED
```

- **Core**: pure logic, zero I/O, testable without mocks
- **Infrastructure**: all I/O, implements interfaces defined by core
- **Handlers**: composition roots, the ONLY layer that wires core + infrastructure
- Inner layers NEVER import outer layers. The hooks catch violations automatically.

---

## Cortex Memory Integration

Each agent includes a memory section for [Cortex](https://github.com/cdeust/Cortex), a persistent memory MCP server. Agents recall prior decisions, remember lessons, and share context across sessions. Without Cortex, the memory sections are safely ignored.

---

## Customization

Every file is Markdown with YAML frontmatter. Fork, edit, extend:

- **Change model tier** — `model: sonnet` for speed, `model: opus` for depth
- **Edit the methodology** — tailor to your team's standards
- **Add domain skills** — use `skills/_template.md` as the starting point
- **Create new genius agents** — use `agents/genius/curie.md` as the template. Every canonical move needs a primary-source citation
- **Write new hooks** — see `hooks/README.md` for the settings.json format

---

## License

MIT
