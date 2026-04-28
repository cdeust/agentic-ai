<p align="center">
  <img src="assets/banner.svg" alt="Zetetic Agents — 98 reasoning patterns, one epistemic standard" width="100%"/>
</p>

<p align="center">
  <a href="https://github.com/cdeust/zetetic-team-subagents/actions/workflows/ci.yml"><img src="https://github.com/cdeust/zetetic-team-subagents/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/tests-241-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/agents-116-8A2BE2" alt="Agents">
  <img src="https://img.shields.io/badge/skills-63-green" alt="Skills">
  <img src="https://img.shields.io/badge/hooks-16_lifecycle-red" alt="Hooks">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
</p>

> **Claude Code agents whose commits are blocked when constants lack source citations.**
> 98 genius reasoning agents (plus 19 team-role agents = 116 total) each citing their primary paper and documenting their refusal conditions, paired with a pre-commit hook that blocks any floating-point constant with 3+ significant digits that lacks a `source:` annotation.
> Not a prompt library. A methodology with **commit-time enforcement**.

---

## The system enforcing its own standard

```
$ git commit -m "tune retry backoff"

UNSOURCED   (error)    retry.py:1: # It always works
MAGIC_NUMBER (error)    retry.py:2: DELAY = 2.741592

Profile: strict  (staged mode)
Errors:   2  (blocking)
Warnings: 0  (informational — promoted to errors when profile=strict)
FAILED: 2 blocking violation(s).

BLOCKED: Zetetic violations in staged files.
```

Composite output: lines 1–2 are verbatim from `tools/zetetic-checker.sh --staged`; the closing `BLOCKED:` line is the wrapper from `hooks/pre-commit-zetetic.sh` that returns exit 2 to git. Reproduce on your machine: `echo "DELAY = 2.741592" > /tmp/x.py && cd /tmp && git init -q && git add x.py && ZETETIC_PROFILE=strict bash <repo>/tools/zetetic-checker.sh --staged`.

The commit re-runs once each flagged line carries a `# source:` comment, a benchmark reference, or a measured-on note.

---

## Why this exists

Every AI agent system ships a role prompt. *"You are a senior engineer."* The agent sounds confident. It invents numbers, cites papers it hasn't read, and ships code with conviction inversely proportional to its correctness.

Zetetic Agents are different in one specific way: **they can say "I don't know."**

98 reasoning patterns drawn from primary sources — Dijkstra's correctness discipline, Curie's residual-with-a-carrier method, Hamilton's fault-tolerance protocol, Cochrane's evidence synthesis — routed automatically to your problem by *shape*, not by *field*. Every output is sourced. Every commit is checked. The standard is not a prompt. It is a gate.

---

## What you type → what happens

```
/paper-vs-code-audit arxiv:2401.12345 ./src/
→ Extracts every claim → finds corresponding code → flags mismatches → traceability matrix

/autoresearch-loop "optimize beam search for abstention"
→ Hypothesis → implement → commit → benchmark → keep/revert → iterate until diminishing returns

/deep-research "transformer attention alternatives 2024-2026"
→ Plans search → parallel researchers → synthesizes → verifies citations → writes cited brief + provenance sidecar

/incident-investigation
→ Forensic timeline → three-timescale decomposition → common vs special cause → structural root cause → remediation

/genius route "p99 latency exceeds the sum of profiled components"
→ Routes to the reasoning procedure that fits the problem shape
```

These aren't prompts dressed up as commands. Each is a **multi-step pipeline** that names the procedure used, surfaces blind spots in its output, and refuses to ship if a step fails. See [`docs/EXAMPLES.md`](docs/EXAMPLES.md) for full session transcripts.

---

## Install

```bash
claude plugin marketplace add cdeust/zetetic-team-subagents
claude plugin install zetetic-team-subagents
```

That's the whole install. The plugin's installer copies agents, skills, hooks, and tools into `~/.claude/`. Manual install + advanced config: [`docs/INSTALL.md`](docs/INSTALL.md).

---

## What you actually get

| Capability | What it gives you (concretely) |
|---|---|
| **98 documented refusals** | Each genius agent's body documents conditions under which it refuses (when to stop, what to cite, when to hand off). Refusal conditions are intent statements, not enforced contracts. |
| **63 multi-step workflows** | Type one slash command, get a sourced research brief / debugging trace / ADR. Each agent in the chain produces output and declares what it could not verify. |
| **Commit-time gates** | `pre-commit-zetetic.sh` blocks commits with `UNSOURCED` keywords (always/never/obviously) at any profile. `MAGIC_NUMBER` floats (3+ decimals without `source:`) and `TODO_NO_REF` warn at default profile, block under `ZETETIC_PROFILE=strict`. Active only when `git commit` is invoked through Claude Code's hook system. |
| **650+ problem-shape triggers** | [`agents/genius/INDEX.md`](agents/genius/INDEX.md) maps natural-language problem descriptions to reasoning methods. <!-- source: 654 data rows counted by python3 -c "from re import sub; ..." (see docs/AGENT-INTERNALS.md) on 2026-04-25. --> |

---

## Reasoning procedures, not personas

Most AI agent libraries ship "pretend to be Einstein." This ships **Einstein's method** — gedankenexperiment, operational definitions, equivalence-principle reasoning — with the citations, the canonical moves, the documented blind spots, and the conditions under which the agent must refuse.

A small sample, by problem shape:

| Domain | Agents | Example trigger |
|---|---|---|
| **Measurement & Signal** | Curie, Ekman, Wu | "the measurement exceeds what known parts predict" |
| **Causal & Abductive** | Pearl, Peirce, Snow/Hill | "does X cause Y, or is it confounded?" |
| **Formal & Correctness** | Dijkstra, Lamport, Pāṇini, Gödel, Turing | "can we prove this correct?" |
| **Failure & Resilience** | Hamilton, Taleb, Carnot, Boyd | "what happens when everything goes wrong?" |
| **Decision & Bias** | Kahneman, Schön, Roger Fisher, Simon | "is this decision driven by bias?" |
| **Ethics & Justice** | Rawls, Arendt, Le Guin, Ostrom | "who benefits and who bears the cost?" |

Full routing table — 400+ triggers, pairings, composition chains — in [`agents/genius/INDEX.md`](agents/genius/INDEX.md).

---

## Compose chains — multi-agent pipelines

The most powerful skills *chain* reasoning procedures in sequence:

```
/performance-investigation     fermi → curie → knuth
  Bracket expected → measure actual → profile hot 3%

/incident-investigation        ginzburg → braudel → deming → peirce → hamilton
  Forensic trace → three timescales → common/special cause → root cause → remediation

/anomaly-to-explanation        mcclintock → curie → shannon
  Notice → isolate the carrier → formalize

/deep-research                 peirce → cochrane → feynman → toulmin
  Hypothesize → synthesize evidence → integrity check → structure argument

/autoresearch-loop             peirce → fisher → curie → laplace → schön
  Hypothesize → design experiment → measure → compare → detect diminishing returns
```

Each chain is a procedure. Each step is sourced. Each output declares what it was unable to verify.

---

## The Zetetic Standard

Every agent, skill, and hook inherits the same epistemic gates. Not optional.

| Pillar | Question |
|---|---|
| **Logical** | *Is it consistent?* |
| **Critical** | *Is it true?* |
| **Rational** | *Is it useful?* |
| **Essential** | *Is it necessary?* |

The rules:

1. No source → say *"I don't know"* and stop
2. Single source = hypothesis. Cross-reference required
3. Read the actual paper, not the blog post
4. No invented constants. Cite the equation or the data
5. Benchmark every change. No regressions accepted
6. *"I don't know"* preserves trust. Confident wrong answers destroy it
7. Actively seek disconfirming evidence

*Zetetic* (adj.): proceeding by inquiry; admitting nothing without proof.

---

## What this system does not do

The same standard applied to itself. Honest limits:

1. **Citation presence ≠ citation validity.** `// source: Knuth 1998` satisfies the checker whether or not Knuth 1998 exists or supports the constant. The hook enforces that a citation IS THERE, not that it's true.
2. **Hooks fire only inside Claude Code's invocation path.** Direct terminal commits, CI scripts, and other editors bypass the gates. A developer who works outside Claude Code is unaffected.
3. **Refusal conditions are intent, not contract.** Each genius agent documents conditions under which it should refuse — these are prompt-level guidance, not runtime guarantees. An agent can name a blind spot in its own description and exhibit it anyway.
4. **The checker has a narrow scope.** It flags absolute-claim keywords in comments, floats with 3+ decimals lacking `source:` annotations, and TODOs without issue references. It does **not** check code correctness, architectural soundness, or whether the reasoning in agent output is logically valid.
5. **Integer constants are not flagged by design.** `batch_size=128`, `timeout=30`, `max_retries=3` pass unchecked — too many false positives. Only floating-point constants with 3+ significant digits are gated.

These are documented because the gates are real, the limits are real, and overclaiming either undermines the standard the agents are supposed to enforce.

---

## Memory that survives sessions

Ships a local replica of Anthropic's [`memory_20250818`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) tool with scope-based ACL: agents persist decisions, lessons, and project context to `/memories/<scope>/<file>` and recall them on every spawn. **241 tests passing** across functional, ACL, concurrency, stale-lock, MCP, and PII suites.

A `pre-tool-secret-shield` hook blocks any agent from reading `.env`, `.aws/credentials`, `*.pem`, `*.key`, or shell-history files — credentials the agent *can never need to read*. Full architecture: [`docs/MEMORY-MCP.md`](docs/MEMORY-MCP.md), contract: [`memory/contract.md`](memory/contract.md).

---

## Adopt in an existing project (gradual)

If your codebase has historical magic numbers and orphan TODOs, running `--staged` on every commit would be painful. The plugin supports a **transition profile**:

```bash
# .zetetic.conf at repo root
ZETETIC_PROFILE=permissive    # everything informational; never blocks
                              # → graduate to standard → strict over weeks
```

Full migration path: [`docs/MIGRATION.md`](docs/MIGRATION.md).

---

## Companion projects

| Project | Role |
|---|---|
| [Cortex](https://github.com/cdeust/Cortex) | Local persistent memory + cognitive profiling — pre-loads your reasoning patterns at session start |
| [automatised-pipeline](https://github.com/cdeust/automatised-pipeline) | Codebase-intelligence MCP — agents query a property graph instead of `grep -r` |
| [prd-spec-generator](https://github.com/cdeust/prd-spec-generator) | TypeScript MCP that turns a feature description into a 9-file PRD with multi-judge verification using these agents |

---

## Documentation

- [`docs/EXAMPLES.md`](docs/EXAMPLES.md) — real session transcripts (bug caught, refusal fired, ADR generated)
- [`docs/COMPARE.md`](docs/COMPARE.md) — vs vanilla Claude Code, Aider, Cline, Continue, Cursor agents
- [`docs/INSTALL.md`](docs/INSTALL.md) — manual install, advanced config, model overrides
- [`docs/MIGRATION.md`](docs/MIGRATION.md) — adopting in an existing non-compliant project
- [`docs/MEMORY-MCP.md`](docs/MEMORY-MCP.md) — memory tool architecture + MCP server
- [`docs/AGENT-INTERNALS.md`](docs/AGENT-INTERNALS.md) — agent file shape, frontmatter, routing
- [`agents/genius/INDEX.md`](agents/genius/INDEX.md) — 400+ problem shapes → agent routing table
- [`rules/coding-standards.md`](rules/coding-standards.md) — the engineering standard agents enforce

---

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center"><sub>Built by <a href="https://github.com/cdeust">cdeust</a>. All 116 agent files pass the <a href="tools/agent-definition-auditor.sh">structural auditor</a>. The system enforces source-citation discipline on the constants in its own commits.</sub></p>
